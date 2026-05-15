/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getTMDBMovieDetails, getTMDBTVDetails } from '@/lib/tmdb.client';

export const runtime = 'nodejs';

/**
 * GET /api/tmdb/detail?id=xxx&type=movie|tv
 * 獲取TMDB詳情
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const type = searchParams.get('type') || 'movie';

    if (!id) {
      return NextResponse.json({ error: '缺少ID參數' }, { status: 400 });
    }

    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig.TMDBApiKey;
    const tmdbProxy = config.SiteConfig.TMDBProxy;
    const tmdbReverseProxy = config.SiteConfig.TMDBReverseProxy;

    if (!tmdbApiKey) {
      return NextResponse.json(
        { error: 'TMDB API Key 未配置' },
        { status: 400 }
      );
    }

    const response =
      type === 'movie'
        ? await getTMDBMovieDetails(tmdbApiKey, parseInt(id), tmdbProxy, tmdbReverseProxy)
        : await getTMDBTVDetails(tmdbApiKey, parseInt(id), tmdbProxy, tmdbReverseProxy);

    if (response.code !== 200 || !response.details) {
      return NextResponse.json(
        { error: 'TMDB 詳情獲取失敗', code: response.code },
        { status: response.code }
      );
    }

    return NextResponse.json(response.details);
  } catch (error) {
    console.error('TMDB詳情獲取失敗:', error);
    return NextResponse.json(
      { error: '獲取詳情失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
