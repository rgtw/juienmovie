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
 * GET /api/emby/image/{token}/{itemId}?imageType=Primary&maxWidth=300&embyKey=xxx
 * 代理 Emby 圖片
 *
 * 權限驗證：TVBox Token（路徑參數） 或 用戶登錄（滿足其一即可）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { token: string; itemId: string } }
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

    const itemId = params.itemId;
    const imageType = (searchParams.get('imageType') || 'Primary') as 'Primary' | 'Backdrop' | 'Logo';
    const maxWidth = searchParams.get('maxWidth') ? parseInt(searchParams.get('maxWidth')!) : undefined;
    const embyKey = searchParams.get('embyKey') || undefined;

    // 獲取 Emby 客戶端
    const client = await getEmbyClient(embyKey);

    // 獲取圖片 URL（強制獲取直接URL，避免代理循環）
    const imageUrl = client.getImageUrl(itemId, imageType, maxWidth, undefined, true);

    // 構建請求頭，添加自定義 User-Agent
    const requestHeaders: HeadersInit = {
      'User-Agent': client.getUserAgent(),
    };

    // 創建 AbortController 用於超時控制
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 20000); // 20秒超時

    try {
      // 請求圖片
      const imageResponse = await fetch(imageUrl, {
        headers: requestHeaders,
        signal: abortController.signal,
      });

      // 清除超時定時器
      clearTimeout(timeoutId);

    if (!imageResponse.ok) {
      console.error('[Emby Image] 獲取圖片失敗:', {
        itemId,
        imageType,
        status: imageResponse.status,
        statusText: imageResponse.statusText,
      });
      return NextResponse.json(
        { error: '獲取圖片失敗' },
        { status: 500 }
      );
    }

    // 獲取 Content-Type
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

    // 構建響應頭
    const headers = new Headers();
    headers.set('Content-Type', contentType);

    // 複製重要的響應頭
    const contentLength = imageResponse.headers.get('content-length');
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }

    // 設置緩存頭
    headers.set('Cache-Control', 'public, max-age=86400'); // 緩存1天

    // 返回圖片內容
    return new NextResponse(imageResponse.body, {
      status: imageResponse.status,
      headers,
    });
    } catch (error) {
      // 清除超時定時器
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        console.error('[Emby Image] 請求超時');
        return NextResponse.json(
          { error: '請求超時' },
          { status: 504 }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error('[Emby Image] 錯誤:', error);
    return NextResponse.json(
      { error: '獲取圖片失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
