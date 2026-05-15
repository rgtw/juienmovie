/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * OpenList CMS 代理接口（動態路由）
 * 將 OpenList 私人影庫轉換為 TVBox 兼容的 CMS API 格式
 * 路徑格式：/api/openlist/cms-proxy/{token}?ac=videolist&...
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  const { searchParams } = new URL(request.url);
  const ac = searchParams.get('ac');
  const wd = searchParams.get('wd'); // 搜索關鍵詞
  const ids = searchParams.get('ids'); // 視頻ID（即文件夾key）

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
      const allowed = await hasFeaturePermission(username, 'private_library');
      if (userInfo && !userInfo.banned && allowed) {
        isValidToken = true;
      }
    }
  }

  if (!isValidToken) {
    return NextResponse.json(
      {
        code: 401,
        msg: '無效的訪問token',
        page: 1,
        pagecount: 0,
        limit: 0,
        total: 0,
        list: [],
      },
      { status: 401 }
    );
  }

  try {
    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    // 驗證 OpenList 配置
    if (
      !openListConfig ||
      !openListConfig.Enabled ||
      !openListConfig.URL ||
      !openListConfig.Username ||
      !openListConfig.Password
    ) {
      return NextResponse.json({
        code: 0,
        msg: 'OpenList 未配置或未啟用',
        page: 1,
        pagecount: 0,
        limit: 0,
        total: 0,
        list: [],
      });
    }

    const rootPath = openListConfig.RootPath || '/';

    // 讀取元數據
    const { getCachedMetaInfo, setCachedMetaInfo } = await import('@/lib/openlist-cache');
    const { db } = await import('@/lib/db');

    let metaInfo = getCachedMetaInfo();

    if (!metaInfo) {
      try {
        const metainfoJson = await db.getGlobalValue('video.metainfo');
        if (metainfoJson) {
          metaInfo = JSON.parse(metainfoJson);
          if (metaInfo) {
            setCachedMetaInfo(metaInfo);
          }
        }
      } catch (error) {
        console.error('[OpenList CMS Proxy] 從數據庫讀取 metainfo 失敗:', error);
      }
    }

    if (!metaInfo || !metaInfo.folders) {
      return NextResponse.json({
        code: 0,
        msg: '未找到元數據',
        page: 1,
        pagecount: 0,
        limit: 0,
        total: 0,
        list: [],
      });
    }

    // 搜索模式
    if (wd) {
      // 如果是 detail 模式且有搜索詞，返回第一個匹配結果的詳情
      if (ac === 'detail') {
        return await handleDetailBySearch(metaInfo, wd, openListConfig, rootPath, requestToken, request);
      }
      return await handleSearch(metaInfo, wd, request);
    }

    // 詳情模式
    if (ids || ac === 'detail') {
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
      return await handleDetail(metaInfo, ids, openListConfig, rootPath, requestToken, request);
    }

    // 列表模式（返回所有）
    return await handleSearch(metaInfo, '', request);
  } catch (error) {
    console.error('[OpenList CMS Proxy] 錯誤:', error);
    return NextResponse.json(
      {
        code: 500,
        msg: (error as Error).message,
        page: 1,
        pagecount: 0,
        limit: 0,
        total: 0,
        list: [],
      },
      { status: 500 }
    );
  }
}

/**
 * 處理搜索請求
 */
async function handleSearch(metaInfo: any, query: string, request: NextRequest) {
  const { getTMDBImageUrl } = await import('@/lib/tmdb.search');

  const lowerQuery = query.toLowerCase();
  const results = Object.entries(metaInfo.folders)
    .filter(([folderName, info]: [string, any]) => {
      if (!query) return true; // 空查詢返回所有
      const matchFolder = folderName.toLowerCase().includes(lowerQuery);
      const matchTitle = info.title.toLowerCase().includes(lowerQuery);
      return matchFolder || matchTitle;
    })
    .map(([folderKey, info]: [string, any]) => ({
      vod_id: folderKey,
      vod_name: info.title,
      vod_pic: getTMDBImageUrl(info.poster_path),
      vod_remarks: info.media_type === 'movie' ? '電影' : '劇集',
      vod_year: info.release_date ? info.release_date.split('-')[0] : '',
      vod_content: info.overview || '',
      type_name: info.media_type === 'movie' ? '電影' : '電視劇',
      vod_douban_id: 0,
      vod_class: '',
      // 不在搜索結果中返回 vod_play_url，TVBox 會調用詳情接口獲取
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

/**
 * 處理通過搜索關鍵詞獲取詳情的請求
 */
async function handleDetailBySearch(
  metaInfo: any,
  query: string,
  openListConfig: any,
  rootPath: string,
  token: string,
  request: NextRequest
) {
  const lowerQuery = query.toLowerCase();

  // 搜索匹配的第一個文件夾
  const matchedEntry = Object.entries(metaInfo.folders).find(([folderName, info]: [string, any]) => {
    const matchFolder = folderName.toLowerCase().includes(lowerQuery);
    const matchTitle = info.title.toLowerCase().includes(lowerQuery);
    return matchFolder || matchTitle;
  });

  if (!matchedEntry) {
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

  // 使用找到的 folderKey 調用詳情處理函數
  const [folderKey] = matchedEntry;
  return await handleDetail(metaInfo, folderKey, openListConfig, rootPath, token, request);
}

/**
 * 處理詳情請求
 */
async function handleDetail(
  metaInfo: any,
  folderKey: string,
  openListConfig: any,
  rootPath: string,
  token: string,
  request: NextRequest
) {
  const { getTMDBImageUrl } = await import('@/lib/tmdb.search');

  // 查找文件夾信息
  const folderMeta = metaInfo.folders?.[folderKey];
  if (!folderMeta) {
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

  // 獲取文件夾名稱和路徑
  const folderName = folderMeta.folderName;
  const folderPath = `${rootPath}${rootPath.endsWith('/') ? '' : '/'}${folderName}`;

  // 調用 OpenList 客戶端獲取視頻文件列表
  const { OpenListClient } = await import('@/lib/openlist.client');
  const { getCachedVideoInfo, setCachedVideoInfo } = await import('@/lib/openlist-cache');
  const { parseVideoFileName } = await import('@/lib/video-parser');

  const client = new OpenListClient(
    openListConfig.URL,
    openListConfig.Username,
    openListConfig.Password
  );

  let videoInfo = getCachedVideoInfo(folderPath);

  // 獲取所有分頁的視頻文件
  const allFiles: any[] = [];
  let currentPage = 1;
  const pageSize = 100;
  let total = 0;

  while (true) {
    const listResponse = await client.listDirectory(folderPath, currentPage, pageSize);

    if (listResponse.code !== 200) {
      return NextResponse.json({
        code: 0,
        msg: 'OpenList 列表獲取失敗2',
        page: 1,
        pagecount: 0,
        limit: 0,
        total: 0,
        list: [],
      });
    }

    total = listResponse.data.total;
    allFiles.push(...listResponse.data.content);

    if (allFiles.length >= total) {
      break;
    }

    currentPage++;
  }

  const videoExtensions = ['.mp4', '.mkv', '.avi', '.m3u8', '.flv', '.ts', '.mov', '.wmv', '.webm', '.rmvb', '.rm', '.mpg', '.mpeg', '.3gp', '.f4v', '.m4v', '.vob'];
  const videoFiles = allFiles.filter((item) => {
    if (item.is_dir || item.name.startsWith('.') || item.name.endsWith('.json')) return false;
    return videoExtensions.some(ext => item.name.toLowerCase().endsWith(ext));
  });

  if (!videoInfo) {
    videoInfo = { episodes: {}, last_updated: Date.now() };
    videoFiles.sort((a, b) => a.name.localeCompare(b.name));
    for (let i = 0; i < videoFiles.length; i++) {
      const file = videoFiles[i];
      const parsed = parseVideoFileName(file.name);
      videoInfo.episodes[file.name] = {
        episode: parsed.episode || (i + 1),
        season: parsed.season,
        title: parsed.title,
        parsed_from: 'filename',
        isOVA: parsed.isOVA,
      };
    }
    setCachedVideoInfo(folderPath, videoInfo);
  }

  // 構建播放鏈接
  // 獲取當前請求的 baseUrl
  const host = request.headers.get('host') || request.headers.get('x-forwarded-host');
  const proto = request.headers.get('x-forwarded-proto') ||
    (host?.includes('localhost') || host?.includes('127.0.0.1') ? 'http' : 'https');
  const baseUrl = process.env.SITE_BASE || `${proto}://${host}`;

  const episodes = videoFiles
    .map((file, index) => {
      const parsed = parseVideoFileName(file.name);
      let episodeInfo;
      if (parsed.episode) {
        episodeInfo = { episode: parsed.episode, season: parsed.season, title: parsed.title, parsed_from: 'filename', isOVA: parsed.isOVA };
      } else {
        episodeInfo = videoInfo!.episodes[file.name] || { episode: index + 1, season: undefined, title: undefined, parsed_from: 'filename' };
      }
      let displayTitle = episodeInfo.title;
      if (!displayTitle && episodeInfo.episode) {
        displayTitle = episodeInfo.isOVA ? `OVA ${episodeInfo.episode}` : `第${episodeInfo.episode}集`;
      }
      if (!displayTitle) {
        displayTitle = file.name;
      }

      // 生成播放鏈接，將 token 放在路徑中
      const playUrl = `${baseUrl}/api/openlist/play/${encodeURIComponent(token)}?folder=${encodeURIComponent(folderName)}&fileName=${encodeURIComponent(file.name)}`;

      return {
        fileName: file.name,
        episode: episodeInfo.episode || 0,
        season: episodeInfo.season,
        title: displayTitle,
        playUrl,
        isOVA: episodeInfo.isOVA,
      };
    })
    .sort((a, b) => {
      // OVA 排在最後
      if (a.isOVA && !b.isOVA) return 1;
      if (!a.isOVA && b.isOVA) return -1;
      // 都是 OVA 或都不是 OVA，按集數排序
      return a.episode !== b.episode ? a.episode - b.episode : a.fileName.localeCompare(b.fileName);
    });

  // 轉換為 CMS vod_play_url 格式
  // 格式：第1集$url1#第2集$url2#第3集$url3
  const vodPlayUrl = episodes
    .map(ep => `${ep.title}$${ep.playUrl}`)
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
        vod_id: folderKey,
        vod_name: folderMeta.title,
        vod_pic: getTMDBImageUrl(folderMeta.poster_path),
        vod_remarks: folderMeta.media_type === 'movie' ? '電影' : '劇集',
        vod_year: folderMeta.release_date ? folderMeta.release_date.split('-')[0] : '',
        vod_content: folderMeta.overview || '',
        type_name: folderMeta.media_type === 'movie' ? '電影' : '電視劇',
        vod_douban_id: 0,
        vod_class: '',
        vod_play_url: vodPlayUrl,
        vod_play_from: '私人影庫',
      },
    ],
  });
}
