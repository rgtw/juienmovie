/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getTVSeasonDetails } from '@/lib/tmdb.search';

export const runtime = 'nodejs';

/**
 * GET /api/tmdb/episodes?id=xxx&season=xxx
 * 獲取電視劇季度的集數詳情（帶圖片）
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const season = searchParams.get('season');

    if (!id || !season) {
      return NextResponse.json({ error: '缺少參數' }, { status: 400 });
    }

    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig.TMDBApiKey;
    const tmdbProxy = config.SiteConfig.TMDBProxy;
    const tmdbReverseProxy = config.SiteConfig.TMDBReverseProxy;

    if (!tmdbApiKey) {
      return NextResponse.json({ error: 'TMDB API Key 未配置' }, { status: 400 });
    }

    const response = await getTVSeasonDetails(
      tmdbApiKey,
      parseInt(id),
      parseInt(season),
      tmdbProxy,
      tmdbReverseProxy
    );

    if (response.code !== 200 || !response.season) {
      return NextResponse.json(
        { error: '獲取失敗', code: response.code },
        { status: response.code }
      );
    }

    return NextResponse.json(response.season);
  } catch (error) {
    console.error('獲取集數詳情失敗:', error);
    return NextResponse.json(
      { error: '獲取失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
