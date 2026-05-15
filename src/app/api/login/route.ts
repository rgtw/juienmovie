/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { parseAuthInfo } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  generateRefreshToken,
  generateTokenId,
  storeRefreshToken,
  TOKEN_CONFIG,
} from '@/lib/refresh-token';

export const runtime = 'nodejs';

// 讀取存儲類型環境變量，默認 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | 'kvrocks'
    | undefined) || 'localstorage';

function buildLoginResponse(authToken?: string | null) {
  const body: Record<string, unknown> = { ok: true };

  if (authToken) {
    body.token = authToken;
    const authInfo = parseAuthInfo(authToken);
    if (authInfo) {
      const { password, ...rest } = authInfo;
      body.auth = rest;
    }
  }

  return NextResponse.json(body);
}

// 生成簽名
async function generateSignature(
  data: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  // 導入密鑰
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // 生成簽名
  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  // 轉換為十六進制字符串
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 生成認證Cookie（帶簽名和 Refresh Token）
async function generateAuthCookie(
  username?: string,
  password?: string,
  role?: 'owner' | 'admin' | 'user',
  includePassword = false,
  deviceInfo?: string
): Promise<string> {
  const now = Date.now();
  const authData: any = { role: role || 'user' };

  // 只在需要時包含 password
  if (includePassword && password) {
    authData.password = password;
  }

  if (username && process.env.PASSWORD) {
    authData.username = username;
    authData.timestamp = now; // Access Token 時間戳

    // 生成 Refresh Token（僅數據庫模式）
    if (!includePassword && STORAGE_TYPE !== 'localstorage') {
      const tokenId = generateTokenId();
      const refreshToken = generateRefreshToken();
      const refreshExpires = now + TOKEN_CONFIG.REFRESH_TOKEN_AGE;

      authData.tokenId = tokenId;
      authData.refreshToken = refreshToken;
      authData.refreshExpires = refreshExpires;

      // 存儲到 Redis Hash
      try {
        await storeRefreshToken(username, tokenId, {
          token: refreshToken,
          deviceInfo: deviceInfo || 'Unknown Device',
          createdAt: now,
          expiresAt: refreshExpires,
          lastUsed: now,
        });
      } catch (error) {
        console.error('Failed to store refresh token:', error);
      }
    }

    // 簽名所有關鍵字段（username, role, timestamp）防止篡改
    const dataToSign = JSON.stringify({
      username: authData.username,
      role: authData.role,
      timestamp: authData.timestamp
    });
    const signature = await generateSignature(dataToSign, process.env.PASSWORD);
    authData.signature = signature;
  }

  return encodeURIComponent(JSON.stringify(authData));
}

// 驗證Cloudflare Turnstile Token
async function verifyTurnstileToken(token: string, secretKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
      }),
    });

    const data = await response.json();
    return data.success === true;
  } catch (error) {
    console.error('Turnstile驗證失敗:', error);
    return false;
  }
}

// 獲取設備信息
function getDeviceInfo(request: NextRequest): string {
  const userAgent = request.headers.get('user-agent') || 'Unknown';

  // 檢查是否為 MoonTVPlus APP
  if (userAgent.toLowerCase().includes('moontvplus')) {
    return 'MoonTVPlus APP';
  }

  // 檢查是否為 OrionTV
  if (userAgent.toLowerCase().includes('oriontv')) {
    return 'OrionTV';
  }

  // 簡單解析 User-Agent
  let browser = 'Unknown Browser';
  let os = 'Unknown OS';

  if (userAgent.includes('Chrome')) browser = 'Chrome';
  else if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Safari')) browser = 'Safari';
  else if (userAgent.includes('Edge')) browser = 'Edge';

  if (userAgent.includes('Windows')) os = 'Windows';
  else if (userAgent.includes('Mac')) os = 'macOS';
  else if (userAgent.includes('Linux')) os = 'Linux';
  else if (userAgent.includes('Android')) os = 'Android';
  else if (userAgent.includes('iOS')) os = 'iOS';

  return `${browser} on ${os}`;
}

export async function POST(req: NextRequest) {
  try {
    // 獲取站點配置
    const adminConfig = await getConfig();
    const siteConfig = adminConfig.SiteConfig;

    // 本地 / localStorage 模式——僅校驗固定密碼
    if (STORAGE_TYPE === 'localstorage') {
      const envPassword = process.env.PASSWORD;

      // 未配置 PASSWORD 時直接放行
      if (!envPassword) {
        const response = buildLoginResponse();

        // 清除可能存在的認證cookie
        response.cookies.set('auth', '', {
          path: '/',
          expires: new Date(0),
          sameSite: 'lax',
          httpOnly: false,
        });

        return response;
      }

      const { password } = await req.json();
      if (typeof password !== 'string') {
        return NextResponse.json({ error: '密碼不能為空' }, { status: 400 });
      }

      if (password !== envPassword) {
        return NextResponse.json(
          { ok: false, error: '密碼錯誤' },
          { status: 401 }
        );
      }

      // 驗證成功，設置認證cookie
      const username = process.env.USERNAME || 'default';
      const deviceInfo = getDeviceInfo(req);
      const cookieValue = await generateAuthCookie(
        username,
        password,
        'owner',
        true,
        deviceInfo
      ); // localstorage 模式包含 password
      const response = buildLoginResponse(cookieValue);
      const expires = new Date();
      expires.setDate(expires.getDate() + 60); // 60天過期（Refresh Token 有效期）

      response.cookies.set('auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax',
        httpOnly: false, // 允許客戶端訪問
        secure: false,
      });

      return response;
    }

    // 數據庫 / redis 模式——校驗用戶名並嘗試連接數據庫
    const { username, password, turnstileToken } = await req.json();

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用戶名不能為空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密碼不能為空' }, { status: 400 });
    }

    // 如果開啟了Turnstile驗證
    if (siteConfig.LoginRequireTurnstile) {
      if (!turnstileToken) {
        return NextResponse.json(
          { error: '請完成人機驗證' },
          { status: 400 }
        );
      }

      if (!siteConfig.TurnstileSecretKey) {
        console.error('Turnstile Secret Key未配置');
        return NextResponse.json(
          { error: '服務器配置錯誤' },
          { status: 500 }
        );
      }

      // 驗證Turnstile Token
      const isValid = await verifyTurnstileToken(turnstileToken, siteConfig.TurnstileSecretKey);
      if (!isValid) {
        return NextResponse.json(
          { error: '人機驗證失敗，請重試' },
          { status: 400 }
        );
      }
    }

    // 可能是站長，直接讀環境變量
    if (
      username === process.env.USERNAME &&
      password === process.env.PASSWORD
    ) {
      // 驗證成功，設置認證cookie
      const deviceInfo = getDeviceInfo(req);
      const cookieValue = await generateAuthCookie(
        username,
        password,
        'owner',
        false,
        deviceInfo
      ); // 數據庫模式不包含 password
      const response = buildLoginResponse(cookieValue);
      const expires = new Date();
      expires.setDate(expires.getDate() + 60); // 60天過期（Refresh Token 有效期）

      response.cookies.set('auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax',
        httpOnly: false, // 允許客戶端訪問
        secure: false,
      });

      return response;
    } else if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '用戶名或密碼錯誤' }, { status: 401 });
    }

    // 使用新版本的用戶驗證
    let pass = false;
    let userRole: 'owner' | 'admin' | 'user' = 'user';
    let isBanned = false;

    // 驗證用戶
    const userInfoV2 = await db.getUserInfoV2(username);

    if (userInfoV2) {
      // 使用新版本驗證
      pass = await db.verifyUserV2(username, password);
      userRole = userInfoV2.role;
      isBanned = userInfoV2.banned;
    }

    // 檢查用戶是否被封禁
    if (isBanned) {
      return NextResponse.json({ error: '用戶被封禁' }, { status: 401 });
    }

    if (!pass) {
      return NextResponse.json(
        { error: '用戶名或密碼錯誤' },
        { status: 401 }
      );
    }

    // 驗證成功，設置認證cookie
    const deviceInfo = getDeviceInfo(req);
    const cookieValue = await generateAuthCookie(
      username,
      password,
      userRole,
      false,
      deviceInfo
    ); // 數據庫模式不包含 password
    const response = buildLoginResponse(cookieValue);
    const expires = new Date();
    expires.setDate(expires.getDate() + 60); // 60天過期（Refresh Token 有效期）

  response.cookies.set('auth', cookieValue, {
    path: '/',
    expires,
    sameSite: 'lax',
    httpOnly: false, // 允許客戶端訪問
  });

    console.log(`Cookie已設置`);

    return response;
  } catch (error) {
    console.error('登錄接口異常', error);
    return NextResponse.json({ error: '服務器錯誤' }, { status: 500 });
  }
}
