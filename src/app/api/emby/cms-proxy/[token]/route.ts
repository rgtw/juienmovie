/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { EmbyClient } from '@/lib/emby.client';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * Emby CMS 代理接口（動態路由）
 * 將 Emby 媒體庫轉換為 TVBox 兼容的 CMS API 格式
 * 路徑格式：/api/emby/cms-proxy/{token}?ac=videolist&...
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  const { searchParams } = new URL(request.url);
  const ac = searchParams.get('ac');
  const wd = searchParams.get('wd'); // 搜索關鍵詞
  const ids = searchParams.get('ids'); // 視頻ID

  // 檢查必要參數
  if (ac !== 'videolist' && ac !== 'list' && ac !== 'detail') {
    return NextResponse.json(
      { code: 400, msg: '不支持的操作' },
      { status: 400 }
    );
  }

  // 驗證 TVBox Token（從路徑中獲取）
  const requestToken = params.token;
  const globalToken = process.env.TVBOX_SUBSCRIBE_TOKEN;

  // 檢查是否是全局token或用戶token
  let isValidToken = false;
  if (globalToken && requestToken === globalToken) {
    // 全局token
    isValidToken = true;
  } else {
    // 檢查是否是用戶token
    const { db } = await import('@/lib/db');
    const username = await db.getUsernameByTvboxToken(requestToken);
    if (username) {
      // 檢查用戶是否被封禁
      const userInfo = await db.getUserInfoV2(username);
      const allowed = await hasFeaturePermission(username, 'emby');
      if (userInfo && !userInfo.banned && allowed) {
        isValidToken = true;
      }
    }
  }

  if (!isValidToken) {
    return NextResponse.json({
      code: 401,
      msg: '無效的訪問token',
      page: 1,
      pagecount: 0,
      limit: 0,
      total: 0,
      list: [],
    });
  }

  try {
    const config = await getConfig();

    // 驗證 Emby 配置（多源）
    if (!config.EmbyConfig?.Sources || config.EmbyConfig.Sources.length === 0) {
      return NextResponse.json({
        code: 0,
        msg: 'Emby 未配置或未啟用',
        page: 1,
        pagecount: 0,
        limit: 0,
        total: 0,
        list: [],
      });
    }

    // 獲取 embyKey 參數
    const embyKey = searchParams.get('embyKey') || undefined;

    // 使用 EmbyManager 獲取客戶端
    const { embyManager } = await import('@/lib/emby-manager');
    const client = await embyManager.getClient(embyKey);

    // 路由處理
    if (wd) {
      // 搜索模式
      if (ac === 'detail') {
        return await handleDetailBySearch(client, wd, requestToken, embyKey, request);
      }
      return await handleSearch(client, wd, requestToken);
    } else if (ids || ac === 'detail') {
      // 詳情模式
      if (!ids) {
        return NextResponse.json({
          code: 0,
          msg: '缺少視頻ID',
          page: 1,
          pagecount: 0,
          limit: 0,
          total: 0,
          list: [],
        });
      }
      return await handleDetail(client, ids, requestToken, embyKey, request);
    } else {
      // 列表模式
      return await handleSearch(client, '', requestToken);
    }
  } catch (error) {
    console.error('[Emby CMS Proxy] 錯誤:', error);
    return NextResponse.json({
      code: 500,
      msg: (error as Error).message,
      page: 1,
      pagecount: 0,
      limit: 0,
      total: 0,
      list: [],
    });
  }
}

/**
 * 處理搜索請求
 */
async function handleSearch(client: EmbyClient, query: string, token: string) {
  const result = await client.getItems({
    searchTerm: query || undefined,
    IncludeItemTypes: 'Movie,Series',
    Recursive: true,
    Fields: 'Overview,ProductionYear',
    Limit: 100,
  });

  const list = result.Items.map((item) => ({
    vod_id: item.Id,
    vod_name: item.Name,
    vod_pic: client.getImageUrl(item.Id, 'Primary', undefined, token),
    vod_remarks: item.Type === 'Movie' ? '電影' : '劇集',
    vod_year: item.ProductionYear?.toString() || '',
    vod_content: item.Overview || '',
    type_name: item.Type === 'Movie' ? '電影' : '電視劇',
  }));

  return NextResponse.json({
    code: 1,
    msg: '數據列表',
    page: 1,
    pagecount: 1,
    limit: list.length,
    total: list.length,
    list,
  });
}

/**
 * 處理通過搜索關鍵詞獲取詳情的請求
 */
async function handleDetailBySearch(
  client: EmbyClient,
  query: string,
  token: string,
  embyKey: string | undefined,
  request: NextRequest
) {
  const result = await client.getItems({
    searchTerm: query,
    IncludeItemTypes: 'Movie,Series',
    Recursive: true,
    Fields: 'Overview,ProductionYear',
    Limit: 1,
  });

  if (result.Items.length === 0) {
    return NextResponse.json({
      code: 0,
      msg: '未找到該視頻',
      page: 1,
      pagecount: 0,
      limit: 0,
      total: 0,
      list: [],
    });
  }

  return await handleDetail(client, result.Items[0].Id, token, embyKey, request);
}

/**
 * 處理詳情請求
 */
async function handleDetail(
  client: EmbyClient,
  itemId: string,
  token: string,
  embyKey: string | undefined,
  request: NextRequest
) {
  const item = await client.getItem(itemId);

  // 獲取當前請求的 baseUrl
  const host = request.headers.get('host') || request.headers.get('x-forwarded-host');
  const proto = request.headers.get('x-forwarded-proto') ||
    (host?.includes('localhost') || host?.includes('127.0.0.1') ? 'http' : 'https');
  const baseUrl = process.env.SITE_BASE || `${proto}://${host}`;

  const embyKeyParam = embyKey ? `&embyKey=${embyKey}` : '';
  let vodPlayUrl = '';

  if (item.Type === 'Movie') {
    // 電影：單個播放鏈接（使用代理，添加 .mp4 擴展名）
    const proxyUrl = `${baseUrl}/api/emby/play/${encodeURIComponent(token)}/video.mp4?itemId=${item.Id}${embyKeyParam}`;
    vodPlayUrl = `正片$${proxyUrl}`;
  } else if (item.Type === 'Series') {
    // 劇集：獲取所有集
    const allEpisodes = await client.getEpisodes(itemId);

    const episodes = allEpisodes
      .sort((a, b) => {
        if (a.ParentIndexNumber !== b.ParentIndexNumber) {
          return (a.ParentIndexNumber || 0) - (b.ParentIndexNumber || 0);
        }
        return (a.IndexNumber || 0) - (b.IndexNumber || 0);
      })
      .map((ep) => {
        const title = `第${ep.IndexNumber}集`;
        const proxyUrl = `${baseUrl}/api/emby/play/${encodeURIComponent(token)}/video.mp4?itemId=${ep.Id}${embyKeyParam}`;
        return `${title}$${proxyUrl}`;
      });

    vodPlayUrl = episodes.join('#');
  }

  return NextResponse.json({
    code: 1,
    msg: '數據列表',
    page: 1,
    pagecount: 1,
    limit: 1,
    total: 1,
    list: [
      {
        vod_id: item.Id,
        vod_name: item.Name,
        vod_pic: client.getImageUrl(item.Id, 'Primary', undefined, token),
        vod_remarks: item.Type === 'Movie' ? '電影' : '劇集',
        vod_year: item.ProductionYear?.toString() || '',
        vod_content: item.Overview || '',
        type_name: item.Type === 'Movie' ? '電影' : '電視劇',
        vod_play_url: vodPlayUrl,
        vod_play_from: 'Emby',
      },
    ],
  });
}
