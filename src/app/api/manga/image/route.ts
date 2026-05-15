import { NextRequest, NextResponse } from 'next/server';

import { getAuthorizedUsername } from '../_utils';
import { getSuwayomiConfig, loginWithSimpleAuth } from '@/lib/suwayomi.client';

export const runtime = 'nodejs';

function resolveUpstreamUrl(serverBaseUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    const target = new URL(pathOrUrl);
    const base = new URL(serverBaseUrl);
    if (target.origin !== base.origin) {
      throw new Error('不允許代理非當前 Suwayomi 服務的地址');
    }
    return target.toString();
  }

  if (!pathOrUrl.startsWith('/')) {
    pathOrUrl = `/${pathOrUrl}`;
  }

  return `${serverBaseUrl}${pathOrUrl}`;
}

export async function GET(request: NextRequest) {
  const username = await getAuthorizedUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const pathOrUrl = new URL(request.url).searchParams.get('path')?.trim();
    if (!pathOrUrl) {
      return NextResponse.json({ error: '缺少 path 參數' }, { status: 400 });
    }

    const config = await getSuwayomiConfig();
    const upstreamUrl = resolveUpstreamUrl(config.serverBaseUrl, pathOrUrl);
    const buildHeaders = async (
      forceRelogin: boolean
    ): Promise<HeadersInit | undefined> => {
      if (config.authMode === 'basic_auth') {
        if (!config.username || !config.password) {
          throw new Error('Suwayomi basic_auth 缺少用戶名或密碼');
        }

        return new Headers({
          Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
        });
      }

      if (config.authMode === 'simple_login') {
        return new Headers({
          Cookie: await loginWithSimpleAuth(config, forceRelogin),
        });
      }

      return undefined;
    };

    let response = await fetch(upstreamUrl, {
      headers: await buildHeaders(false),
      cache: 'no-store',
    });

    if (response.status === 401 && config.authMode === 'simple_login') {
      response = await fetch(upstreamUrl, {
        headers: await buildHeaders(true),
        cache: 'no-store',
      });
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Suwayomi 圖片請求失敗: ${response.status}` },
        { status: response.status }
      );
    }

    const headers = new Headers();
    const contentType = response.headers.get('content-type');
    const cacheControl = response.headers.get('cache-control');
    if (contentType) headers.set('content-type', contentType);
    headers.set('cache-control', cacheControl || 'public, max-age=300');

    return new NextResponse(response.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '圖片代理失敗' },
      { status: 500 }
    );
  }
}
