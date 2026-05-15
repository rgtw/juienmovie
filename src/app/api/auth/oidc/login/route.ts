/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const config = await getConfig();
    const siteConfig = config.SiteConfig;

    // 檢查是否啟用OIDC登錄
    if (!siteConfig.EnableOIDCLogin) {
      return NextResponse.json(
        { error: 'OIDC登錄未啟用' },
        { status: 403 }
      );
    }

    // 檢查OIDC配置
    if (!siteConfig.OIDCAuthorizationEndpoint || !siteConfig.OIDCClientId) {
      return NextResponse.json(
        { error: 'OIDC配置不完整，請配置Authorization Endpoint和Client ID' },
        { status: 500 }
      );
    }

    // 生成state參數用於防止CSRF攻擊
    const state = crypto.randomUUID();

    // 使用環境變量SITE_BASE或當前請求的origin
    const origin = process.env.SITE_BASE || request.nextUrl.origin;
    const redirectUri = `${origin}/api/auth/oidc/callback`;

    // 構建授權URL
    const authUrl = new URL(siteConfig.OIDCAuthorizationEndpoint);
    authUrl.searchParams.set('client_id', siteConfig.OIDCClientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid profile email');
    authUrl.searchParams.set('state', state);

    // 將state存儲到cookie中
    const response = NextResponse.redirect(authUrl);

    response.cookies.set('oidc_state', state, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600, // 10分鐘
    });

    return response;
  } catch (error) {
    console.error('OIDC登錄發起失敗:', error);
    return NextResponse.json(
      { error: '服務器錯誤' },
      { status: 500 }
    );
  }
}
