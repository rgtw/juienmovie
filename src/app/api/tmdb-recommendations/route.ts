import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import {
  getTMDBImageUrl,
  getTMDBMovieRecommendations,
  getTMDBTVRecommendations,
  searchTMDBMulti,
} from '@/lib/tmdb.client';

// 服務器端緩存（1天）
const searchCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 1天

// 移除季度信息的輔助函數
function removeSeasonInfo(title: string): string {
  // 移除 "第一季"、"第1季"、"第一（1）季" 等格式
  return title
    .replace(/第[一二三四五六七八九十\d]+[（(]\d+[）)][季部]/g, '')
    .replace(/第[一二三四五六七八九十\d]+[季部]/g, '')
    .replace(/[（(]\d+[）)]/g, '')
    .replace(/\s+season\s+\d+/gi, '')
    .replace(/\s+S\d+/gi, '')
    .trim();
}

// 精確匹配標題
function findExactMatch(results: any[], originalTitle: string): any | null {
  if (!results || results.length === 0) return null;

  // 如果只有一個結果，直接返回
  if (results.length === 1) return results[0];

  const cleanedTitle = removeSeasonInfo(originalTitle).toLowerCase();

  // 尋找完全匹配的結果
  for (const result of results) {
    const resultTitle = (result.title || result.name || '').toLowerCase();
    const resultOriginalTitle = (result.original_title || result.original_name || '').toLowerCase();

    if (resultTitle === cleanedTitle || resultOriginalTitle === cleanedTitle) {
      return result;
    }
  }

  // 如果沒有完全匹配，返回第一個
  return results[0];
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const title = searchParams.get('title');
    const cachedId = searchParams.get('cachedId'); // 瀏覽器緩存的ID

    if (!title && !cachedId) {
      return NextResponse.json(
        { error: '缺少必要參數' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig.TMDBApiKey;
    const tmdbProxy = config.SiteConfig.TMDBProxy;
    const tmdbReverseProxy = config.SiteConfig.TMDBReverseProxy;

    if (!tmdbApiKey) {
      return NextResponse.json(
        { error: 'TMDB API Key 未配置' },
        { status: 500 }
      );
    }

    let tmdbId: number;
    let mediaType: 'movie' | 'tv';

    // 如果有緩存的ID，直接使用
    if (cachedId) {
      const [type, id] = cachedId.split(':');
      mediaType = type as 'movie' | 'tv';
      tmdbId = parseInt(id);
    } else {
      // 否則搜索
      const cleanedTitle = removeSeasonInfo(title!);
      const cacheKey = `search:${cleanedTitle}`;

      // 檢查服務器緩存
      const cached = searchCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        tmdbId = cached.data.tmdbId;
        mediaType = cached.data.mediaType;
      } else {
        // 搜索TMDB
        const searchResult = await searchTMDBMulti(tmdbApiKey, cleanedTitle, tmdbProxy, tmdbReverseProxy);

        if (searchResult.code !== 200 || !searchResult.results.length) {
          return NextResponse.json(
            { recommendations: [], tmdbId: null, mediaType: null },
            {
              status: 200,
              headers: {
                'Cache-Control': 'public, max-age=86400', // 瀏覽器緩存1天
              },
            }
          );
        }

        // 過濾出電影和電視劇
        const validResults = searchResult.results.filter(
          (r: any) => r.media_type === 'movie' || r.media_type === 'tv'
        );

        // 精確匹配
        const matched = findExactMatch(validResults, title!);

        if (!matched) {
          return NextResponse.json(
            { recommendations: [], tmdbId: null, mediaType: null },
            {
              status: 200,
              headers: {
                'Cache-Control': 'public, max-age=86400',
              },
            }
          );
        }

        tmdbId = matched.id;
        mediaType = matched.media_type;

        // 保存到服務器緩存
        searchCache.set(cacheKey, {
          data: { tmdbId, mediaType },
          timestamp: Date.now(),
        });

        // 清理過期緩存
        Array.from(searchCache.entries()).forEach(([key, value]) => {
          if (Date.now() - value.timestamp > CACHE_TTL) {
            searchCache.delete(key);
          }
        });
      }
    }

    // 獲取推薦
    const recommendationsResult =
      mediaType === 'movie'
        ? await getTMDBMovieRecommendations(tmdbApiKey, tmdbId, tmdbProxy, tmdbReverseProxy)
        : await getTMDBTVRecommendations(tmdbApiKey, tmdbId, tmdbProxy, tmdbReverseProxy);

    if (recommendationsResult.code !== 200) {
      return NextResponse.json(
        { recommendations: [], tmdbId: `${mediaType}:${tmdbId}`, mediaType },
        {
          status: 200,
          headers: {
            'Cache-Control': 'public, max-age=86400',
          },
        }
      );
    }

    // 轉換為統一格式
    const recommendations = (recommendationsResult.results as any[])
      .filter((r: any) => r.poster_path) // 只保留有海報的
      .slice(0, 20) // 最多20個
      .map((r: any) => ({
        tmdbId: r.id,
        title: r.title || r.name,
        poster: getTMDBImageUrl(r.poster_path, 'w342'),
        rating: r.vote_average ? r.vote_average.toFixed(1) : '',
        mediaType,
      }));

    return NextResponse.json(
      {
        recommendations,
        tmdbId: `${mediaType}:${tmdbId}`, // 返回給瀏覽器用於緩存
        mediaType,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, max-age=86400', // 瀏覽器緩存1天
        },
      }
    );
  } catch (error) {
    console.error('獲取 TMDB 推薦失敗:', error);
    return NextResponse.json(
      { error: '獲取推薦失敗' },
      { status: 500 }
    );
  }
}
