/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getTVSeasons } from '@/lib/tmdb.search';

export const runtime = 'nodejs';

/**
 * GET /api/tmdb/seasons?tvId=xxx
 * 獲取電視劇的季度列表
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tvIdStr = searchParams.get('tvId');

    if (!tvIdStr) {
      return NextResponse.json({ error: '缺少 tvId 參數' }, { status: 400 });
    }

    const tvId = parseInt(tvIdStr, 10);
    if (isNaN(tvId)) {
      return NextResponse.json({ error: 'tvId 必須是數字' }, { status: 400 });
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

    const result = await getTVSeasons(tmdbApiKey, tvId, tmdbProxy, tmdbReverseProxy);

    if (result.code === 200 && result.seasons) {
      return NextResponse.json({
        success: true,
        seasons: result.seasons,
      });
    } else {
      return NextResponse.json(
        { error: '獲取季度列表失敗', code: result.code },
        { status: result.code }
      );
    }
  } catch (error) {
    console.error('獲取季度列表失敗:', error);
    return NextResponse.json(
      { error: '獲取失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
