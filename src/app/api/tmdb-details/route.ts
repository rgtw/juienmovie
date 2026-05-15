import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import {
  getTMDBImageUrl,
  getTMDBMovieDetails,
  getTMDBTVDetails,
  searchTMDBMulti,
} from '@/lib/tmdb.client';

// 服務器端緩存（內存）
const searchCache = new Map<
  string,
  { data: { tmdbId: number; mediaType: 'movie' | 'tv' }; timestamp: number }
>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 1天

// 移除季度信息的輔助函數
function removeSeasonInfo(title: string): string {
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
  if (results.length === 1) return results[0];

  const cleanTitle = originalTitle.toLowerCase().trim();

  // 嘗試精確匹配
  for (const result of results) {
    const resultTitle = (result.title || result.name || '').toLowerCase().trim();
    if (resultTitle === cleanTitle) {
      return result;
    }
  }

  // 如果沒有精確匹配，返回第一個
  return results[0];
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const title = searchParams.get('title');
    const cachedId = searchParams.get('cachedId');

    if (!title && !cachedId) {
      return NextResponse.json(
        { error: '缺少 title 或 cachedId 參數' },
        { status: 400 }
      );
    }

    // 獲取配置
    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig.TMDBApiKey;
    const tmdbProxy = config.SiteConfig.TMDBProxy;
    const tmdbReverseProxy = config.SiteConfig.TMDBReverseProxy;

    if (!tmdbApiKey) {
      return NextResponse.json(
        { error: '未配置 TMDB API Key' },
        { status: 500 }
      );
    }

    let tmdbId: number;
    let mediaType: 'movie' | 'tv';

    // 如果提供了cachedId，直接使用
    if (cachedId) {
      const [type, id] = cachedId.split(':');
      mediaType = type as 'movie' | 'tv';
      tmdbId = parseInt(id, 10);
    } else {
      // 否則需要搜索獲取ID
      const cleanedTitle = removeSeasonInfo(title!);
      const cacheKey = `search_${cleanedTitle}`;

      // 檢查服務器緩存
      const cached = searchCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('使用服務器緩存的搜索結果');
        tmdbId = cached.data.tmdbId;
        mediaType = cached.data.mediaType;
      } else {
        // 搜索TMDB
        console.log('搜索TMDB:', cleanedTitle);
        const searchResult = await searchTMDBMulti(
          tmdbApiKey,
          cleanedTitle,
          tmdbProxy,
          tmdbReverseProxy
        );

        if (searchResult.code !== 200 || !searchResult.results.length) {
          return NextResponse.json(
            { error: '未找到匹配的內容' },
            { status: 404 }
          );
        }

        // 精確匹配
        const match = findExactMatch(searchResult.results, cleanedTitle);
        if (!match) {
          return NextResponse.json(
            { error: '未找到匹配的內容' },
            { status: 404 }
          );
        }

        tmdbId = match.id;
        mediaType = match.media_type;

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

    // 獲取詳情
    let detailsResult;
    if (mediaType === 'movie') {
      detailsResult = await getTMDBMovieDetails(tmdbApiKey, tmdbId, tmdbProxy, tmdbReverseProxy);
    } else {
      detailsResult = await getTMDBTVDetails(tmdbApiKey, tmdbId, tmdbProxy, tmdbReverseProxy);
    }

    if (detailsResult.code !== 200 || !detailsResult.details) {
      return NextResponse.json(
        { error: '獲取詳情失敗' },
        { status: detailsResult.code }
      );
    }

    const details = detailsResult.details;

    // 構建返回數據
    const responseData = {
      tmdbId: `${mediaType}:${tmdbId}`, // 用於緩存
      mediaType,
      title: details.title || details.name,
      backdrop: details.backdrop_path
        ? getTMDBImageUrl(details.backdrop_path, 'w1280')
        : null,
      poster: details.poster_path
        ? getTMDBImageUrl(details.poster_path, 'w500')
        : null,
      overview: details.overview || '',
      rating: details.vote_average ? details.vote_average.toFixed(1) : '',
      releaseDate: details.release_date || details.first_air_date || '',
      genres: details.genres || [], // 添加類型標籤
    };

    return NextResponse.json(responseData, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=86400', // 瀏覽器緩存1天
      },
    });
  } catch (error) {
    console.error('獲取 TMDB 詳情失敗:', error);
    return NextResponse.json(
      { error: '獲取詳情失敗' },
      { status: 500 }
    );
  }
}
