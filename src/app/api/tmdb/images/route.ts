/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getTMDBImages } from '@/lib/tmdb.client';

export const runtime = 'nodejs';

/**
 * GET /api/tmdb/images?id=xxx&type=movie|tv&page=1&pageSize=24
 * 獲取 TMDB 照片牆數據，並在服務端分頁
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
    const pageParam = searchParams.get('page');
    const pageSizeParam = searchParams.get('pageSize');
    const page = pageParam ? Math.max(parseInt(pageParam, 10), 1) : null;
    const pageSize = pageSizeParam ? Math.min(Math.max(parseInt(pageSizeParam, 10), 1), 60) : null;

    if (!id) {
      return NextResponse.json({ error: '缺少ID參數' }, { status: 400 });
    }

    if (type !== 'movie' && type !== 'tv') {
      return NextResponse.json({ error: '類型參數必須是movie或tv' }, { status: 400 });
    }

    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig.TMDBApiKey;
    const tmdbProxy = config.SiteConfig.TMDBProxy;
    const tmdbReverseProxy = config.SiteConfig.TMDBReverseProxy;

    if (!tmdbApiKey) {
      return NextResponse.json({ error: 'TMDB API Key 未配置' }, { status: 400 });
    }

    const response = await getTMDBImages(
      tmdbApiKey,
      parseInt(id, 10),
      type as 'movie' | 'tv',
      tmdbProxy,
      tmdbReverseProxy
    );

    if (response.code !== 200 || !response.images) {
      return NextResponse.json(
        { error: 'TMDB 圖片信息獲取失敗', code: response.code },
        { status: response.code }
      );
    }

    const backdrops = (response.images.backdrops || []).map((item: any) => ({
      ...item,
      imageType: 'backdrop' as const,
    }));
    const posters = (response.images.posters || []).map((item: any) => ({
      ...item,
      imageType: 'poster' as const,
    }));

    const allImages = [...backdrops, ...posters].sort((a, b) => {
      const voteDiff = (b.vote_average || 0) - (a.vote_average || 0);
      if (voteDiff !== 0) return voteDiff;
      return (b.vote_count || 0) - (a.vote_count || 0);
    });

    const total = allImages.length;

    if (!page || !pageSize) {
      return NextResponse.json({
        total,
        list: allImages,
      });
    }

    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const list = allImages.slice(start, start + pageSize);

    return NextResponse.json({
      page: safePage,
      pageSize,
      total,
      totalPages,
      list,
    });
  } catch (error) {
    console.error('TMDB圖片信息獲取失敗:', error);
    return NextResponse.json(
      { error: '獲取圖片信息失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
