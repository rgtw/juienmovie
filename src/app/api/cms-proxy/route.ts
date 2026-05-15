/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  getCachedMetaInfo,
  MetaInfo,
  setCachedMetaInfo,
} from '@/lib/openlist-cache';
import { getTMDBImageUrl } from '@/lib/tmdb.search';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

/**
 * CMS 採集站代理接口
 * 用於代理 CMS API 請求，並自動將播放鏈接替換為帶去廣告的代理鏈接
 * GET /api/cms-proxy?api=<CMS API地址>&參數1=值1&參數2=值2...
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const apiUrl = searchParams.get('api');
    const yellowFilter = searchParams.get('yellowFilter') === 'true';

    if (!apiUrl) {
      return NextResponse.json(
        { error: '缺少必要參數: api' },
        { status: 400 }
      );
    }

    // 特殊處理 openlist
    if (apiUrl === 'openlist') {
      return handleOpenListProxy(request);
    }

    // 構建完整的 API 請求 URL，包含所有查詢參數
    const targetUrl = new URL(apiUrl);

    // 將所有查詢參數（除了 api）轉發到目標 API
    searchParams.forEach((value, key) => {
      if (key !== 'api') {
        targetUrl.searchParams.append(key, value);
      }
    });

    // 請求原始 CMS API
    console.log('CMS 代理請求:', targetUrl.toString());

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超時

    try {
      const response = await fetch(targetUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error('CMS API 請求失敗:', response.status, response.statusText);
        return NextResponse.json(
          { error: '請求 CMS API 失敗' },
          { status: response.status }
        );
      }

      const data = await response.json();
      console.log('CMS API 返回數據:', {
        code: data.code,
        msg: data.msg,
        page: data.page,
        pagecount: data.pagecount,
        limit: data.limit,
        total: data.total,
        listCount: data.list?.length || 0,
      });

      // 獲取當前請求的 origin
      // 優先級：SITE_BASE 環境變量 > 從請求頭構建
      let origin = process.env.SITE_BASE;

      if (!origin) {
        // 從請求頭中獲取 Host 和協議
        const host = request.headers.get('host') || request.headers.get('x-forwarded-host');
        const proto = request.headers.get('x-forwarded-proto') ||
                      (host?.includes('localhost') || host?.includes('127.0.0.1') ? 'http' : 'https');
        origin = `${proto}://${host}`;
      }

      console.log('CMS 代理 origin:', origin);

      // 處理返回數據，替換播放鏈接為代理鏈接
      const processedData = processCmsResponse(data, origin, yellowFilter);

      return NextResponse.json(processedData, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    } catch (fetchError: any) {
      clearTimeout(timeoutId);

      if (fetchError.name === 'AbortError') {
        console.error('CMS API 請求超時:', targetUrl.toString());
        return NextResponse.json(
          { error: '請求超時' },
          { status: 504 }
        );
      }

      throw fetchError;
    }

  } catch (error) {
    console.error('CMS 代理失敗:', error);
    return NextResponse.json(
      { error: '代理失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * 處理 CMS API 返回數據，將播放鏈接替換為代理鏈接
 */
function processCmsResponse(data: any, proxyOrigin: string, yellowFilter: boolean): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  // 深拷貝數據，避免修改原始對象
  const processedData = JSON.parse(JSON.stringify(data));

  if (yellowFilter) {
    if (processedData.class && Array.isArray(processedData.class)) {
      processedData.class = processedData.class.filter((item: any) => !matchesYellowContent(item?.type_name));
    }

    if (processedData.list && Array.isArray(processedData.list)) {
      processedData.list = processedData.list.filter((item: any) => !matchesYellowContent(
        item?.vod_name,
        item?.type_name,
        item?.vod_remarks,
        item?.vod_content,
      ));

      if (typeof processedData.total === 'number') {
        processedData.total = processedData.list.length;
      }
      if (typeof processedData.limit === 'number') {
        processedData.limit = processedData.list.length;
      }
    }
  }

  // 獲取 M3U8 代理 token
  const proxyToken = process.env.NEXT_PUBLIC_PROXY_M3U8_TOKEN || '';
  const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';

  // 處理列表數據
  if (processedData.list && Array.isArray(processedData.list)) {
    processedData.list = processedData.list.map((item: any, index: number) => {
      // 只處理有播放地址的項目
      if (item.vod_play_url && typeof item.vod_play_url === 'string') {
        try {
          const originalUrl = item.vod_play_url;
          item.vod_play_url = processPlayUrlString(item.vod_play_url, item.vod_play_from || '', proxyOrigin, tokenParam);

          // 只為第一個視頻輸出詳細日誌
          if (index === 0) {
            console.log('播放地址處理:', {
              vod_name: item.vod_name,
              vod_play_from: item.vod_play_from,
              original_length: originalUrl.length,
              processed_length: item.vod_play_url.length,
              original_preview: originalUrl.substring(0, 100),
              processed_preview: item.vod_play_url.substring(0, 150),
            });
          }
        } catch (error) {
          // 如果處理失敗，保持原樣
          console.error('處理播放地址失敗:', error, item.vod_name);
        }
      }
      return item;
    });
  }

  return processedData;
}

function matchesYellowContent(...values: Array<string | undefined>): boolean {
  const normalized = values
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!normalized) {
    return false;
  }

  return yellowWords.some((word) => normalized.includes(word.toLowerCase()));
}

/**
 * 處理播放地址字符串
 * 格式: 第01集$url1#第02集$url2#...
 */
function processPlayUrlString(playUrl: string, playFrom: string, proxyOrigin: string, tokenParam: string): string {
  if (!playUrl) return playUrl;

  // 按 $ 分割，分別處理每個播放源
  const playSources = playUrl.split('$$$');

  return playSources.map(source => {
    // 處理每個播放源的劇集列表
    const episodes = source.split('#');

    return episodes.map(episode => {
      // 格式: 第01集$url 或 url
      // 使用 indexOf 找到第一個 $ 的位置
      const dollarIndex = episode.indexOf('$');

      if (dollarIndex > 0) {
        // 有標題的格式: 第01集$url 或 第01集$url$其他
        const title = episode.substring(0, dollarIndex);
        const rest = episode.substring(dollarIndex + 1);

        // 檢查後面是否還有 $，如果有就保留
        const nextDollarIndex = rest.indexOf('$');
        if (nextDollarIndex > 0) {
          // 格式: 第01集$url$其他
          const url = rest.substring(0, nextDollarIndex);
          const other = rest.substring(nextDollarIndex);
          const processedUrl = processUrl(url.trim(), playFrom, proxyOrigin, tokenParam);
          return `${title}$${processedUrl}${other}`;
        } else {
          // 格式: 第01集$url
          const processedUrl = processUrl(rest.trim(), playFrom, proxyOrigin, tokenParam);
          return `${title}$${processedUrl}`;
        }
      } else if (episode.trim()) {
        // 只有 URL 的格式
        const processedUrl = processUrl(episode.trim(), playFrom, proxyOrigin, tokenParam);
        return processedUrl;
      }

      return episode;
    }).join('#');
  }).join('$$$');
}

/**
 * 處理單個播放地址
 */
function processUrl(url: string, playFrom: string, proxyOrigin: string, tokenParam: string): string {
  if (!url) return url;

  // 只處理 m3u8 鏈接
  if (url.includes('.m3u8')) {
    // 提取播放源類型（如果有的話）
    const source = playFrom ? `&source=${encodeURIComponent(playFrom)}` : '';

    // 將 m3u8 鏈接替換為代理鏈接
    return `${proxyOrigin}/api/proxy-m3u8?url=${encodeURIComponent(url)}${source}${tokenParam}`;
  }

  // 非 m3u8 鏈接不處理
  return url;
}

/**
 * 處理 OpenList 代理請求
 */
async function handleOpenListProxy(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const wd = searchParams.get('wd'); // 搜索關鍵詞
  const ids = searchParams.get('ids'); // 詳情ID

  const config = await getConfig();
  const openListConfig = config.OpenListConfig;

  if (!openListConfig || !openListConfig.URL || !openListConfig.Username || !openListConfig.Password) {
    return NextResponse.json(
      { code: 0, msg: 'OpenList 未配置', list: [] },
      { status: 200 }
    );
  }

  // 讀取 metainfo (從數據庫或緩存)
  let metaInfo: MetaInfo | null = getCachedMetaInfo();

  if (!metaInfo) {
    try {
      const metainfoJson = await db.getGlobalValue('video.metainfo');
      if (metainfoJson) {
        metaInfo = JSON.parse(metainfoJson) as MetaInfo;
        setCachedMetaInfo(metaInfo);
      }
    } catch (error) {
      return NextResponse.json(
        { code: 0, msg: 'metainfo 不存在', list: [] },
        { status: 200 }
      );
    }
  }

  if (!metaInfo) {
    return NextResponse.json(
      { code: 0, msg: '無數據', list: [] },
      { status: 200 }
    );
  }

  // 搜索模式
  if (wd) {
    const results = Object.entries(metaInfo.folders)
      .filter(
        ([_key, info]) =>
          info.folderName.toLowerCase().includes(wd.toLowerCase()) ||
          info.title.toLowerCase().includes(wd.toLowerCase())
      )
      .map(([key, info]) => ({
        vod_id: key,
        vod_name: info.title,
        vod_pic: getTMDBImageUrl(info.poster_path),
        vod_remarks: info.media_type === 'movie' ? '電影' : '劇集',
        vod_year: info.release_date.split('-')[0] || '',
        type_name: info.media_type === 'movie' ? '電影' : '電視劇',
      }));

    return NextResponse.json({
      code: 1,
      msg: '數據列表',
      page: 1,
      pagecount: 1,
      limit: results.length,
      total: results.length,
      list: results,
    });
  }

  // 詳情模式
  if (ids) {
    const key = ids;
    const info = metaInfo.folders[key];

    if (!info) {
      return NextResponse.json(
        { code: 0, msg: '視頻不存在', list: [] },
        { status: 200 }
      );
    }

    const folderName = info.folderName;

    // 獲取視頻詳情
    try {
      const detailResponse = await fetch(
        `${request.headers.get('x-forwarded-proto') || 'http'}://${request.headers.get('host')}/api/openlist/detail?folder=${encodeURIComponent(folderName)}`
      );

      if (!detailResponse.ok) {
        throw new Error('獲取視頻詳情失敗');
      }

      const detailData = await detailResponse.json();

      if (!detailData.success) {
        throw new Error('獲取視頻詳情失敗');
      }

      // 構建播放列表
      const playUrls = detailData.episodes
        .map((ep: any) => {
          const title = ep.title || `第${ep.episode}集`;
          return `${title}$${ep.playUrl}`;
        })
        .join('#');

      return NextResponse.json({
        code: 1,
        msg: '數據列表',
        page: 1,
        pagecount: 1,
        limit: 1,
        total: 1,
        list: [
          {
            vod_id: key,
            vod_name: info.title,
            vod_pic: getTMDBImageUrl(info.poster_path),
            vod_remarks: info.media_type === 'movie' ? '電影' : '劇集',
            vod_year: info.release_date.split('-')[0] || '',
            vod_content: info.overview,
            vod_play_from: 'OpenList',
            vod_play_url: playUrls,
            type_name: info.media_type === 'movie' ? '電影' : '電視劇',
          },
        ],
      });
    } catch (error) {
      console.error('獲取 OpenList 視頻詳情失敗:', error);
      return NextResponse.json(
        { code: 0, msg: '獲取詳情失敗', list: [] },
        { status: 200 }
      );
    }
  }

  // 默認返回所有視頻
  const results = Object.entries(metaInfo.folders).map(
    ([key, info]) => ({
      vod_id: key,
      vod_name: info.title,
      vod_pic: getTMDBImageUrl(info.poster_path),
      vod_remarks: info.media_type === 'movie' ? '電影' : '劇集',
      vod_year: info.release_date.split('-')[0] || '',
      type_name: info.media_type === 'movie' ? '電影' : '電視劇',
    })
  );

  return NextResponse.json({
    code: 1,
    msg: '數據列表',
    page: 1,
    pagecount: 1,
    limit: results.length,
    total: results.length,
    list: results,
  });
}
