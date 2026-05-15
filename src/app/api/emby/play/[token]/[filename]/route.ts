/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * 獲取 Emby 客戶端
 */
async function getEmbyClient(embyKey?: string) {
  const config = await getConfig();

  if (!config.EmbyConfig?.Sources || config.EmbyConfig.Sources.length === 0) {
    throw new Error('Emby 未配置或未啟用');
  }

  const { embyManager } = await import('@/lib/emby-manager');
  return await embyManager.getClient(embyKey);
}

/**
 * GET /api/emby/play/{token}/{filename}?itemId=xxx
 * 代理 Emby 視頻播放鏈接，URL 中包含文件擴展名（如 video.mp4）
 * 實際返回的內容根據 Emby 服務器的 Content-Type 決定
 *
 * 權限驗證：TVBox Token（路徑參數） 或 用戶登錄（滿足其一即可）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { token: string; filename: string } }
) {
  try {
    const { searchParams } = new URL(request.url);

    // 雙重驗證：TVBox Token（全局或用戶） 或 用戶登錄
    const requestToken = params.token;
    const globalToken = process.env.TVBOX_SUBSCRIBE_TOKEN;
    const authInfo = getAuthInfoFromCookie(request);

    // 驗證 TVBox Token（全局token或用戶token）
    let hasValidToken = false;
    if (requestToken === 'proxy') {
      // 使用固定的 'proxy' token，跳過token驗證，依賴用戶登錄驗證
      hasValidToken = false;
    } else if (globalToken && requestToken === globalToken) {
      // 全局token
      hasValidToken = true;
    } else {
      // 檢查是否是用戶token
      const { db } = await import('@/lib/db');
      const username = await db.getUsernameByTvboxToken(requestToken);
      if (username) {
        // 檢查用戶是否被封禁
        const userInfo = await db.getUserInfoV2(username);
        const allowed = await hasFeaturePermission(username, 'emby');
        if (userInfo && !userInfo.banned && allowed) {
          hasValidToken = true;
        }
      }
    }

    // 驗證用戶登錄
    const hasValidAuth = !!(
      authInfo?.username &&
      (await hasFeaturePermission(authInfo.username, 'emby'))
    );

    // 兩者至少滿足其一
    if (!hasValidToken && !hasValidAuth) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const itemId = searchParams.get('itemId');
    const embyKey = searchParams.get('embyKey') || undefined;

    if (!itemId) {
      return NextResponse.json({ error: '缺少 itemId 參數' }, { status: 400 });
    }

    // 獲取 Emby 客戶端
    let client = await getEmbyClient(embyKey);

    // 構建 Emby 原始播放鏈接（強制獲取直接URL，避免代理循環）
    let embyStreamUrl = await client.getStreamUrl(itemId, true, true);
	console.log(embyStreamUrl)

    // 構建請求頭，轉發 Range 請求，並添加自定義 User-Agent
    const requestHeaders: HeadersInit = {
      'User-Agent': client.getUserAgent(),
    };
    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      requestHeaders['Range'] = rangeHeader;
    }

    // 創建 AbortController 用於超時控制
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 300000); // 5分鐘超時

    try {
      // 流式代理視頻內容
      let videoResponse = await fetch(embyStreamUrl, {
        headers: requestHeaders,
        signal: abortController.signal,
      });

      // 如果返回 401，嘗試重新認證並重試
      if (videoResponse.status === 401) {
        console.log('[Emby Play] 收到 401 錯誤，嘗試重新認證');
        const { embyManager } = await import('@/lib/emby-manager');
        embyManager.clearCache();
        client = await getEmbyClient(embyKey);
        embyStreamUrl = await client.getStreamUrl(itemId, true, true);

        // 重置超時
        clearTimeout(timeoutId);
        const retryAbortController = new AbortController();
        const retryTimeoutId = setTimeout(() => retryAbortController.abort(), 300000);

        try {
          videoResponse = await fetch(embyStreamUrl, {
            headers: requestHeaders,
            signal: retryAbortController.signal,
          });
        } finally {
          clearTimeout(retryTimeoutId);
        }
      }

      // 清除超時定時器
      clearTimeout(timeoutId);

    if (!videoResponse.ok) {
      console.error('[Emby Play] 獲取視頻流失敗:', {
        itemId,
        status: videoResponse.status,
        statusText: videoResponse.statusText,
      });
      return NextResponse.json(
        { error: '獲取視頻流失敗' },
        { status: 500 }
      );
    }

    // 獲取 Content-Type
    const contentType = videoResponse.headers.get('content-type') || 'video/mp4';

    // 構建響應頭
    const headers = new Headers();
    headers.set('Content-Type', contentType);

    // 複製重要的響應頭
    const contentLength = videoResponse.headers.get('content-length');
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }

    const acceptRanges = videoResponse.headers.get('accept-ranges');
    if (acceptRanges) {
      headers.set('Accept-Ranges', acceptRanges);
    }

    const contentRange = videoResponse.headers.get('content-range');
    if (contentRange) {
      headers.set('Content-Range', contentRange);
    }

    // 使用 URL 中的文件名
    headers.set('Content-Disposition', `inline; filename="${params.filename}"`);

    // 創建一個可以被中斷的流
    const { readable, writable } = new TransformStream();
    const reader = videoResponse.body?.getReader();

    if (!reader) {
      return NextResponse.json(
        { error: '無法讀取視頻流' },
        { status: 500 }
      );
    }

    // 異步管道傳輸，確保在客戶端斷開時清理資源
    (async () => {
      const writer = writable.getWriter();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
      } catch (error) {
        // 客戶端斷開連接或其他錯誤
        console.log('[Emby Play] 流傳輸中斷:', error instanceof Error ? error.message : 'Unknown error');
        // 取消上游 fetch，停止繼續下載
        try {
          await reader.cancel();
        } catch (e) {
          // 忽略取消錯誤
        }
      } finally {
        // 確保資源被釋放
        try {
          reader.releaseLock();
          await writer.close();
        } catch (e) {
          // 忽略關閉錯誤
        }
      }
    })();

    // 流式返回視頻內容
    return new NextResponse(readable, {
      status: videoResponse.status,
      headers,
    });
    } catch (error) {
      // 清除超時定時器
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        console.error('[Emby Play] 請求超時');
        return NextResponse.json(
          { error: '請求超時' },
          { status: 504 }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error('[Emby Play] 錯誤:', error);
    return NextResponse.json(
      { error: '播放失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
