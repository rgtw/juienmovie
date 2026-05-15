/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  generateRefreshToken,
  generateTokenId,
  storeRefreshToken,
  TOKEN_CONFIG,
} from '@/lib/refresh-token';

export const runtime = 'nodejs';

// 生成簽名
async function generateSignature(
  data: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 獲取設備信息
function getDeviceInfo(userAgent: string): string {
  const ua = userAgent.toLowerCase();

  // 檢查是否為 MoonTVPlus APP
  if (ua.includes('moontvplus')) {
    return 'MoonTVPlus APP';
  }

  // 檢查是否為 OrionTV
  if (ua.includes('oriontv')) {
    return 'OrionTV';
  }

  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    if (ua.includes('android')) return 'Android Mobile';
    if (ua.includes('iphone')) return 'iPhone';
    return 'Mobile Device';
  }

  if (ua.includes('tablet') || ua.includes('ipad')) {
    return 'Tablet';
  }

  if (ua.includes('windows')) return 'Windows PC';
  if (ua.includes('mac')) return 'Mac';
  if (ua.includes('linux')) return 'Linux';

  return 'Unknown Device';
}

// 生成認證Cookie
async function generateAuthCookie(
  username: string,
  role: 'owner' | 'admin' | 'user',
  deviceInfo: string
): Promise<string> {
  const authData: any = { role };

  if (username && process.env.PASSWORD) {
    authData.username = username;
    authData.timestamp = Date.now();

    // 生成簽名（包含 username, role, timestamp）
    const dataToSign = JSON.stringify({
      username: authData.username,
      role: authData.role,
      timestamp: authData.timestamp
    });
    const signature = await generateSignature(dataToSign, process.env.PASSWORD);
    authData.signature = signature;

    // 生成雙 Token
    const tokenId = generateTokenId();
    const refreshToken = generateRefreshToken();
    const now = Date.now();
    const refreshExpires = now + TOKEN_CONFIG.REFRESH_TOKEN_AGE;

    authData.tokenId = tokenId;
    authData.refreshToken = refreshToken;
    authData.refreshExpires = refreshExpires;

    // 存儲 Refresh Token
    await storeRefreshToken(username, tokenId, {
      token: refreshToken,
      deviceInfo,
      createdAt: now,
      expiresAt: refreshExpires,
      lastUsed: now,
    });
  }

  return encodeURIComponent(JSON.stringify(authData));
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // 使用環境變量SITE_BASE或當前請求的origin
    const origin = process.env.SITE_BASE || request.nextUrl.origin;

    // 檢查是否有錯誤
    if (error) {
      console.error('OIDC認證錯誤:', error);
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent('OIDC認證失敗')}`, origin)
      );
    }

    // 驗證必需參數
    if (!code || !state) {
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('缺少必需參數'), origin)
      );
    }

    // 驗證state
    const storedState = request.cookies.get('oidc_state')?.value;
    if (!storedState || storedState !== state) {
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('狀態驗證失敗'), origin)
      );
    }

    const config = await getConfig();
    const siteConfig = config.SiteConfig;

    // 檢查OIDC配置
    if (!siteConfig.OIDCTokenEndpoint || !siteConfig.OIDCUserInfoEndpoint || !siteConfig.OIDCClientId || !siteConfig.OIDCClientSecret) {
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('OIDC配置不完整'), origin)
      );
    }

    const redirectUri = `${origin}/api/auth/oidc/callback`;

    // 交換code獲取token
    const tokenResponse = await fetch(siteConfig.OIDCTokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        client_id: siteConfig.OIDCClientId,
        client_secret: siteConfig.OIDCClientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      console.error('獲取token失敗:', await tokenResponse.text());
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('獲取token失敗'), origin)
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    const idToken = tokenData.id_token;

    if (!accessToken || !idToken) {
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('token無效'), origin)
      );
    }

    // 獲取用戶信息
    const userInfoResponse = await fetch(siteConfig.OIDCUserInfoEndpoint, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!userInfoResponse.ok) {
      console.error('獲取用戶信息失敗:', await userInfoResponse.text());
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('獲取用戶信息失敗'), origin)
      );
    }

    const userInfo = await userInfoResponse.json();
    const oidcSub = userInfo.sub; // OIDC的唯一標識符

    if (!oidcSub) {
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('用戶信息無效'), origin)
      );
    }

    // 檢查用戶是否已存在(通過OIDC sub查找)
    const username = await db.getUserByOidcSub(oidcSub);
    let userRole: 'owner' | 'admin' | 'user' = 'user';

    if (username) {
      // 獲取用戶信息
      const userInfoV2 = await db.getUserInfoV2(username);
      if (userInfoV2) {
        userRole = userInfoV2.role;
        // 檢查用戶是否被封禁
        if (userInfoV2.banned) {
          return NextResponse.redirect(
            new URL('/login?error=' + encodeURIComponent('用戶被封禁'), origin)
          );
        }
      }
    }

    if (username) {
      // 用戶已存在,直接登錄
      const response = NextResponse.redirect(new URL('/', origin));
      const userAgent = request.headers.get('user-agent') || 'Unknown';
      const deviceInfo = getDeviceInfo(userAgent);
      const cookieValue = await generateAuthCookie(username, userRole, deviceInfo);
      const expires = new Date(Date.now() + TOKEN_CONFIG.REFRESH_TOKEN_AGE);

      response.cookies.set('auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax',
        httpOnly: false,
        secure: false,
      });

      // 清除state cookie
      response.cookies.delete('oidc_state');

      return response;
    }

    // 用戶不存在,檢查是否允許註冊
    if (!siteConfig.EnableOIDCRegistration) {
      return NextResponse.redirect(
        new URL('/login?error=' + encodeURIComponent('該OIDC賬號未註冊'), origin)
      );
    }

    // 需要註冊,跳轉到用戶名輸入頁面
    // 將OIDC信息存儲到session中
    const oidcSession = {
      sub: oidcSub,
      email: userInfo.email,
      name: userInfo.name,
      trust_level: userInfo.trust_level, // 提取trust_level字段
      timestamp: Date.now(),
    };

    const response = NextResponse.redirect(new URL('/oidc-register', origin));
    response.cookies.set('oidc_session', JSON.stringify(oidcSession), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600, // 10分鐘
    });

    // 清除state cookie
    response.cookies.delete('oidc_state');

    return response;
  } catch (error) {
    console.error('OIDC回調處理失敗:', error);
    const origin = process.env.SITE_BASE || request.nextUrl.origin;
    return NextResponse.redirect(
      new URL('/login?error=' + encodeURIComponent('服務器錯誤'), origin)
    );
  }
}
