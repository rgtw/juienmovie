/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { validateProxyUrlServerSide } from '@/lib/server/ssrf';
import { buildProxyStreamHeaders } from '@/lib/server/proxy-headers';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = searchParams.get('source');

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  if (!source) {
    return NextResponse.json({ error: 'Missing source' }, { status: 400 });
  }

  // 定義直鏈播放模式常量
  const DIRECT_PLAY_SOURCE = 'directplay';

  // 直鏈播放模式：跳過源站配置檢查，直接代理
  if (source !== DIRECT_PLAY_SOURCE) {
    // 檢查該視頻源是否啟用了代理模式
    const config = await getConfig();
    const videoSource = config.SourceConfig?.find((s: any) => s.key === source);

    if (!videoSource) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    if (!videoSource.proxyMode) {
      return NextResponse.json({ error: 'Proxy mode not enabled for this source' }, { status: 403 });
    }
  }

  let response: Response | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  try {
    const decodedUrl = decodeURIComponent(url);

    // 安全校驗：防 SSRF 攔截請求內網或非法 URL (強制檢查所有代理請求)
    const isSafeUrl = await validateProxyUrlServerSide(decodedUrl);
    if (!isSafeUrl) {
      return NextResponse.json({ error: 'Proxy request to local or invalid network is forbidden' }, { status: 403 });
    }

    response = await fetch(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': decodedUrl,
      },
    });
    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch segment' }, { status: 500 });
    }

    const headers = buildProxyStreamHeaders(
      response.headers.get('Content-Type') || 'video/mp2t',
      response.headers.get('content-length')
    );

    // 使用流式傳輸，避免佔用內存
    let isCancelled = false;

    const stream = new ReadableStream({
      start(controller) {
        if (!response?.body) {
          controller.close();
          return;
        }

        reader = response.body.getReader();

        function pump() {
          if (isCancelled || !reader) {
            return;
          }

          reader.read().then(({ done, value }) => {
            if (isCancelled) {
              return;
            }

            if (done) {
              controller.close();
              cleanup();
              return;
            }

            controller.enqueue(value);
            pump();
          }).catch((error) => {
            if (!isCancelled) {
              controller.error(error);
              cleanup();
            }
          });
        }

        function cleanup() {
          if (reader) {
            try {
              reader.releaseLock();
            } catch (e) {
              // reader 可能已經被釋放，忽略錯誤
            }
            reader = null;
          }
        }

        pump();
      },
      cancel() {
        isCancelled = true;
        // 當流被取消時，確保釋放所有資源
        if (reader) {
          try {
            reader.releaseLock();
          } catch (e) {
            // reader 可能已經被釋放，忽略錯誤
          }
          reader = null;
        }

        if (response?.body) {
          try {
            response.body.cancel();
          } catch (e) {
            // 忽略取消時的錯誤
          }
        }
      }
    });

    return new Response(stream, { headers });
  } catch (error) {
    // 確保在錯誤情況下也釋放資源
    if (reader) {
      try {
        (reader as ReadableStreamDefaultReader<Uint8Array>).releaseLock();
      } catch (e) {
        // 忽略錯誤
      }
    }

    if (response?.body) {
      try {
        response.body.cancel();
      } catch (e) {
        // 忽略錯誤
      }
    }

    return NextResponse.json({ error: 'Failed to fetch segment' }, { status: 500 });
  }
}
