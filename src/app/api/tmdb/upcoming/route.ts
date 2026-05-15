import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getTMDBUpcomingContent } from '@/lib/tmdb.client';

// 內存緩存對象
interface CacheItem {
  data: any;
  timestamp: number;
}

let cache: CacheItem | null = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1小時（毫秒）

export async function GET(request: NextRequest) {
  try {
    // 檢查緩存是否存在且未過期
    const now = Date.now();
    if (cache && now - cache.timestamp < CACHE_DURATION) {
      return NextResponse.json({
        code: 200,
        data: cache.data,
        cached: true,
        cacheAge: Math.floor((now - cache.timestamp) / 1000), // 緩存年齡（秒）
      });
    }

    // 緩存不存在或已過期，獲取新數據
    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig?.TMDBApiKey;
    const tmdbProxy = config.SiteConfig?.TMDBProxy;
    const tmdbReverseProxy = config.SiteConfig?.TMDBReverseProxy;

    if (!tmdbApiKey) {
      return NextResponse.json(
        { code: 400, message: 'TMDB API Key 未配置' },
        { status: 400 }
      );
    }

    // 調用TMDB API獲取數據
    const result = await getTMDBUpcomingContent(tmdbApiKey, tmdbProxy, tmdbReverseProxy);

    if (result.code !== 200) {
      return NextResponse.json(
        { code: result.code, message: '獲取TMDB數據失敗' },
        { status: result.code === 401 ? 401 : 500 }
      );
    }

    // 更新緩存
    cache = {
      data: result.list,
      timestamp: now,
    };

    return NextResponse.json({
      code: 200,
      data: result.list,
      cached: false,
    });
  } catch (error) {
    console.error('獲取TMDB即將上映數據失敗:', error);
    return NextResponse.json(
      { code: 500, message: '服務器內部錯誤' },
      { status: 500 }
    );
  }
}
