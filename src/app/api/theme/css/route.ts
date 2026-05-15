/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

import { getThemeCSS } from '@/styles/themes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // 禁用緩存

export async function GET(request: NextRequest) {
  try {
    const adminConfig = await getConfig();
    const themeConfig = adminConfig.ThemeConfig;

    // 如果沒有配置主題，返回空CSS
    if (!themeConfig) {
      return new NextResponse('', {
        headers: {
          'Content-Type': 'text/css',
          'Cache-Control': 'no-store',
        },
      });
    }

    let css = '';

    // 如果啟用了內置主題，使用內置主題CSS
    if (themeConfig.enableBuiltInTheme) {
      css = getThemeCSS(themeConfig.builtInTheme as any);
    } else {
      // 否則使用自定義CSS
      css = themeConfig.customCSS || '';
    }

    // 設置緩存控制
    const cacheMinutes = themeConfig.cacheMinutes || 1440; // 默認1天（1440分鐘）
    const maxAge = cacheMinutes * 60; // 轉換為秒
    const staleWhileRevalidate = maxAge * 7; // 過期後7倍時間內可使用舊版本
    const cacheControl = themeConfig.enableCache
      ? `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`
      : 'no-store';

    // 添加版本號到ETag
    const etag = `"${themeConfig.cacheVersion}"`;

    // 檢查客戶端緩存
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch === etag && themeConfig.enableCache) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': cacheControl,
          ETag: etag,
        },
      });
    }

    return new NextResponse(css, {
      headers: {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': cacheControl,
        ETag: etag,
      },
    });
  } catch (error) {
    console.error('獲取主題CSS失敗:', error);
    return new NextResponse('', {
      headers: {
        'Content-Type': 'text/css',
        'Cache-Control': 'no-store',
      },
    });
  }
}
