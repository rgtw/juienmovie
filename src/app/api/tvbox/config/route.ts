import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * 獲取TVBOX訂閱配置
 */
export async function GET(request: NextRequest) {
  // 驗證用戶登錄
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // 檢查是否開啟訂閱功能
  const enableSubscribe = process.env.ENABLE_TVBOX_SUBSCRIBE === 'true';
  const subscribeToken = process.env.TVBOX_SUBSCRIBE_TOKEN;

  if (!enableSubscribe || !subscribeToken) {
    return NextResponse.json(
      {
        enabled: false,
        url: '',
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  // 構建訂閱鏈接
  // 優先使用 SITE_BASE 環境變量，如果沒有則使用前端傳來的 origin
  const siteBase = process.env.SITE_BASE;
  const searchParams = request.nextUrl.searchParams;
  const clientOrigin = searchParams.get('origin');
  const adFilter = searchParams.get('adFilter') === 'true'; // 獲取去廣告參數

  const baseUrl = siteBase || clientOrigin || request.nextUrl.origin;

  // 構建訂閱鏈接，包含 adFilter 參數
  const subscribeUrl = `${baseUrl}/api/tvbox/subscribe?token=${encodeURIComponent(subscribeToken)}&adFilter=${adFilter}`;

  return NextResponse.json(
    {
      enabled: true,
      url: subscribeUrl,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
