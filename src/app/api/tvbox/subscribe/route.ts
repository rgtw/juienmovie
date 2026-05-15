/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getAvailableApiSites, getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getCachedLiveChannels } from '@/lib/live';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * TVBOX訂閱API
 * 根據視頻源和直播源生成TVBOX訂閱
 * 支持全局token（管理員）和用戶token（普通用戶）
 */
export async function GET(request: NextRequest) {
  // 檢查是否開啟訂閱功能
  const enableSubscribe = process.env.ENABLE_TVBOX_SUBSCRIBE === 'true';
  if (!enableSubscribe) {
    return NextResponse.json(
      { error: '訂閱功能未開啟' },
      { status: 403 }
    );
  }

  // 驗證token
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');
  const globalToken = process.env.TVBOX_SUBSCRIBE_TOKEN;
  const adFilter = searchParams.get('adFilter') === 'true'; // 獲取去廣告參數
  const yellowFilter = searchParams.get('yellowFilter') === 'true';

  if (!token) {
    return NextResponse.json(
      { error: '缺少訂閱token' },
      { status: 401 }
    );
  }

  // 判斷是全局token還是用戶token
  let username: string | undefined;
  let isGlobalToken = false;

  if (globalToken && token === globalToken) {
    // 全局token（管理員訂閱）
    isGlobalToken = true;
    console.log('使用全局token訪問TVBox訂閱');
  } else {
    // 用戶token，查詢用戶名
    username = await db.getUsernameByTvboxToken(token) || undefined;
    if (!username) {
      return NextResponse.json(
        { error: '無效的訂閱token' },
        { status: 401 }
      );
    }

    // 檢查用戶是否被封禁
    const userInfo = await db.getUserInfoV2(username);
    if (userInfo?.banned) {
      return NextResponse.json(
        { error: '用戶已被封禁' },
        { status: 403 }
      );
    }

    console.log(`用戶 ${username} 訪問TVBox訂閱`);
  }

  try {
    // 獲取配置
    const config = await getConfig();

    // 獲取視頻源
    // 全局token返回所有源，用戶token返回該用戶有權限的源
    const apiSites = await getAvailableApiSites(username);

    // 獲取直播源
    const canAccessLive = isGlobalToken || !username
      ? true
      : await hasFeaturePermission(username, 'live');
    const liveConfig = canAccessLive
      ? config.LiveConfig?.filter(live => !live.disabled) || []
      : [];

    // 獲取當前請求的 origin，用於構建代理鏈接
    // 優先級：SITE_BASE 環境變量 > origin 參數 > 從請求頭構建
    let baseUrl = process.env.SITE_BASE || searchParams.get('origin');

    if (!baseUrl) {
      // 從請求頭中獲取 Host 和協議
      const host = request.headers.get('host') || request.headers.get('x-forwarded-host');
      const proto = request.headers.get('x-forwarded-proto') ||
                    (host?.includes('localhost') || host?.includes('127.0.0.1') ? 'http' : 'https');
      baseUrl = `${proto}://${host}`;
    }

    console.log('TVBOX 訂閱 baseUrl:', baseUrl, 'adFilter:', adFilter, 'yellowFilter:', yellowFilter);

    // 檢查是否配置了 OpenList
    const hasOpenList = !!(
      config.OpenListConfig?.Enabled &&
      config.OpenListConfig?.URL &&
      config.OpenListConfig?.Username &&
      config.OpenListConfig?.Password
    );

    // 獲取所有啟用的 Emby 源
    const { embyManager } = await import('@/lib/emby-manager');
    const embySources = await embyManager.getEnabledSources();

    // 構建 OpenList 站點配置
    const openlistSites = hasOpenList ? [{
      key: 'openlist',
      name: '私人影庫',
      type: 1,
      api: `${baseUrl}/api/openlist/cms-proxy/${encodeURIComponent(token)}`,
      searchable: 1,
      quickSearch: 1,
      filterable: 1,
      ext: '',
    }] : [];

    // 構建 Emby 站點配置（為每個啟用的Emby源生成獨立站點）
    const embySites = embySources.map(source => ({
      key: `emby_${source.key}`,
      name: source.name || 'Emby媒體庫',
      type: 1,
      api: `${baseUrl}/api/emby/cms-proxy/${encodeURIComponent(token)}?embyKey=${source.key}`,
      searchable: 1,
      quickSearch: 1,
      filterable: 1,
      ext: '',
    }));

    // 構建TVBOX訂閱數據
    const tvboxSubscription = {
      // 站點配置
      spider: `${baseUrl}/tvbox/custom_spider.jar`,
      wallpaper: '',

      // 視頻源站點 - 根據 adFilter 參數決定是否使用代理
      // OpenList 和 Emby 源放在最前面
      sites: [
        ...openlistSites,
        ...embySites,
        ...apiSites.map(site => ({
          key: site.key,
          name: site.name,
          type: 1,
          // 開啟去廣告或黃色過濾時使用 CMS 代理
          api: (adFilter || yellowFilter)
            ? `${baseUrl}/api/cms-proxy?api=${encodeURIComponent(site.api)}${adFilter ? '&adFilter=true' : ''}${yellowFilter ? '&yellowFilter=true' : ''}`
            : site.api,
          searchable: 1,
          quickSearch: 1,
          filterable: 1,
          ext: site.detail || '',
        }))
      ],

      // 直播源
      lives: await Promise.all(
        liveConfig.map(async (live) => {
          try {
            const liveChannels = await getCachedLiveChannels(live.key);
            return {
              name: live.name,
              type: 0,
              url: live.url,
              epg: live.epg || (liveChannels?.epgUrl || ''),
              logo: '',
            };
          } catch (error) {
            return {
              name: live.name,
              type: 0,
              playerType: 1,
              url: live.url,
              epg: live.epg || '',
              logo: '',
            };
          }
        })
      ),

      // 解析器
      parses: [],

      // 規則
      rules: [],

      // 廣告配置
      ads: [],
    };

    // 獲取屏蔽源列表並過濾
    const blockedSources = process.env.TVBOX_BLOCKED_SOURCES
      ? process.env.TVBOX_BLOCKED_SOURCES.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    if (blockedSources.length > 0) {
      tvboxSubscription.sites = tvboxSubscription.sites.filter(
        site => !blockedSources.includes(site.key)
      );
      console.log('TVBOX 訂閱已屏蔽源:', blockedSources);
    }

    return NextResponse.json(tvboxSubscription, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('生成TVBOX訂閱失敗:', error);
    return NextResponse.json(
      {
        error: '生成訂閱失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
