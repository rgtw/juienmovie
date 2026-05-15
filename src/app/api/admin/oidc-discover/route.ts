/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存儲進行管理員配置',
      },
      { status: 400 }
    );
  }

  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { issuerUrl } = await request.json();

    if (!issuerUrl || typeof issuerUrl !== 'string') {
      return NextResponse.json(
        { error: 'Issuer URL不能為空' },
        { status: 400 }
      );
    }

    // 構建well-known URL
    const wellKnownUrl = `${issuerUrl}/.well-known/openid-configuration`;

    console.log('正在獲取OIDC配置:', wellKnownUrl);

    // 通過後端獲取配置，避免CORS問題
    const response = await fetch(wellKnownUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      // 設置超時
      signal: AbortSignal.timeout(10000), // 10秒超時
    });

    if (!response.ok) {
      console.error('獲取OIDC配置失敗:', response.status, response.statusText);
      return NextResponse.json(
        {
          error: `無法獲取OIDC配置: ${response.status} ${response.statusText}`,
        },
        { status: 400 }
      );
    }

    const data = await response.json();

    // 驗證返回的數據包含必需的端點
    if (!data.authorization_endpoint || !data.token_endpoint || !data.userinfo_endpoint) {
      return NextResponse.json(
        {
          error: 'OIDC配置不完整，缺少必需的端點',
        },
        { status: 400 }
      );
    }

    // 返回端點配置
    return NextResponse.json({
      authorization_endpoint: data.authorization_endpoint,
      token_endpoint: data.token_endpoint,
      userinfo_endpoint: data.userinfo_endpoint,
      issuer: data.issuer,
    });
  } catch (error) {
    console.error('OIDC自動發現失敗:', error);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return NextResponse.json(
          { error: '請求超時，請檢查Issuer URL是否正確' },
          { status: 408 }
        );
      }
      return NextResponse.json(
        { error: `獲取配置失敗: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: '獲取配置失敗，請檢查Issuer URL是否正確' },
      { status: 500 }
    );
  }
}
