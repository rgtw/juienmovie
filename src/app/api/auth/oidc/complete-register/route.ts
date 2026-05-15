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

export async function POST(request: NextRequest) {
  try {
    const { username } = await request.json();

    // 驗證用戶名
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用戶名不能為空' }, { status: 400 });
    }

    // 驗證用戶名格式
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return NextResponse.json(
        { error: '用戶名只能包含字母、數字、下劃線，長度3-20位' },
        { status: 400 }
      );
    }

    // 獲取OIDC session
    const oidcSessionCookie = request.cookies.get('oidc_session')?.value;
    if (!oidcSessionCookie) {
      return NextResponse.json(
        { error: 'OIDC會話已過期，請重新登錄' },
        { status: 400 }
      );
    }

    let oidcSession: any;
    try {
      oidcSession = JSON.parse(oidcSessionCookie);
    } catch {
      return NextResponse.json(
        { error: 'OIDC會話無效' },
        { status: 400 }
      );
    }

    // 檢查session是否過期(10分鐘)
    if (Date.now() - oidcSession.timestamp > 600000) {
      return NextResponse.json(
        { error: 'OIDC會話已過期，請重新登錄' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    const siteConfig = config.SiteConfig;

    // 檢查是否啟用OIDC註冊
    if (!siteConfig.EnableOIDCRegistration) {
      return NextResponse.json(
        { error: 'OIDC註冊未啟用' },
        { status: 403 }
      );
    }

    // 檢查最低信任等級
    const minTrustLevel = siteConfig.OIDCMinTrustLevel || 0;
    if (minTrustLevel > 0) {
      const userTrustLevel = oidcSession.trust_level ?? 0;
      if (userTrustLevel < minTrustLevel) {
        return NextResponse.json(
          { error: `您的信任等級(${userTrustLevel})不滿足最低要求(${minTrustLevel})` },
          { status: 403 }
        );
      }
    }

    // 檢查是否與站長同名
    if (username === process.env.USERNAME) {
      return NextResponse.json(
        { error: '該用戶名不可用' },
        { status: 409 }
      );
    }

    // 檢查用戶名是否已存在
    const userExists = await db.checkUserExistV2(username);
    if (userExists) {
      return NextResponse.json(
        { error: '用戶名已存在' },
        { status: 409 }
      );
    }

    // 檢查OIDC sub是否已被使用
    const existingOIDCUsername = await db.getUserByOidcSub(oidcSession.sub);
    if (existingOIDCUsername) {
      return NextResponse.json(
        { error: '該OIDC賬號已被註冊' },
        { status: 409 }
      );
    }

    // 創建用戶
    try {
      // 生成隨機密碼(OIDC用戶不需要密碼登錄)
      const randomPassword = crypto.randomUUID();

      // 獲取默認用戶組
      const defaultTags = siteConfig.DefaultUserTags && siteConfig.DefaultUserTags.length > 0
        ? siteConfig.DefaultUserTags
        : undefined;

      // 使用新版本創建用戶（帶SHA256加密和OIDC綁定）
      await db.createUserV2(username, randomPassword, 'user', defaultTags, oidcSession.sub);

      // 設置認證cookie
      const response = NextResponse.json({ ok: true, message: '註冊成功' });
      const userAgent = request.headers.get('user-agent') || 'Unknown';
      const deviceInfo = getDeviceInfo(userAgent);
      const cookieValue = await generateAuthCookie(username, 'user', deviceInfo);
      const expires = new Date(Date.now() + TOKEN_CONFIG.REFRESH_TOKEN_AGE);

      response.cookies.set('auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax',
        httpOnly: false,
        secure: false,
      });

      // 清除OIDC session
      response.cookies.delete('oidc_session');

      return response;
    } catch (err) {
      console.error('創建用戶失敗', err);
      return NextResponse.json({ error: '註冊失敗，請稍後重試' }, { status: 500 });
    }
  } catch (error) {
    console.error('OIDC註冊完成失敗:', error);
    return NextResponse.json({ error: '服務器錯誤' }, { status: 500 });
  }
}
