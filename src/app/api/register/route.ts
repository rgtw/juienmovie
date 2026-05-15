/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { lockManager } from '@/lib/lock';

export const runtime = 'nodejs';

// 讀取存儲類型環境變量，默認 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | 'kvrocks'
    | undefined) || 'localstorage';

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

export async function POST(req: NextRequest) {
  try {
    // localStorage 模式不支持註冊
    if (STORAGE_TYPE === 'localstorage') {
      return NextResponse.json(
        { error: 'localStorage模式不支持註冊功能' },
        { status: 400 }
      );
    }

    // 獲取站點配置
    const config = await getConfig();
    const siteConfig = config.SiteConfig;

    // 檢查是否開啟註冊
    if (!siteConfig.EnableRegistration) {
      return NextResponse.json(
        { error: '註冊功能未開啟' },
        { status: 403 }
      );
    }

    const { username, password, inviteCode, turnstileToken } = await req.json();

    // 驗證輸入
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用戶名不能為空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密碼不能為空' }, { status: 400 });
    }
    if (inviteCode !== undefined && typeof inviteCode !== 'string') {
      return NextResponse.json({ error: '邀請碼格式錯誤' }, { status: 400 });
    }

    // 驗證用戶名格式（只允許字母、數字、下劃線，長度3-20）
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return NextResponse.json(
        { error: '用戶名只能包含字母、數字、下劃線，長度3-20位' },
        { status: 400 }
      );
    }

    // 驗證密碼長度
    if (password.length < 6) {
      return NextResponse.json(
        { error: '密碼長度至少為6位' },
        { status: 400 }
      );
    }

    // 檢查是否與站長同名
    if (username === process.env.USERNAME) {
      return NextResponse.json(
        { error: '該用戶名不可用' },
        { status: 409 }
      );
    }

    if (siteConfig.RequireRegistrationInviteCode) {
      const expectedInviteCode = (siteConfig.RegistrationInviteCode || '').trim();
      if (!expectedInviteCode) {
        return NextResponse.json(
          { error: '服務器未配置邀請碼' },
          { status: 500 }
        );
      }

      if (!inviteCode || inviteCode.trim() !== expectedInviteCode) {
        return NextResponse.json(
          { error: '邀請碼錯誤' },
          { status: 400 }
        );
      }
    }

    // 獲取用戶名鎖，防止併發註冊
    let releaseLock: (() => void) | null = null;
    try {
      releaseLock = await lockManager.acquire(`register:${username}`);
    } catch (error) {
      return NextResponse.json(
        { error: '服務器繁忙，請稍後重試' },
        { status: 503 }
      );
    }

    try {
      // 檢查用戶是否已存在（只檢查V2存儲）
      const userExists = await db.checkUserExistV2(username);
      if (userExists) {
        return NextResponse.json(
          { error: '用戶名已存在' },
          { status: 409 }
        );
      }

      // 如果開啟了Turnstile驗證
      if (siteConfig.RegistrationRequireTurnstile) {
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

      // 創建用戶
      try {
        // 使用新版本創建用戶（帶SHA256加密）
        const defaultTags = siteConfig.DefaultUserTags && siteConfig.DefaultUserTags.length > 0
          ? siteConfig.DefaultUserTags
          : undefined;

        await db.createUserV2(username, password, 'user', defaultTags);

        // 註冊成功
        return NextResponse.json({ ok: true, message: '註冊成功' });
      } catch (err: any) {
        console.error('創建用戶失敗', err);
        // 如果是用戶已存在的錯誤，返回409
        if (err.message === '用戶已存在') {
          return NextResponse.json({ error: '用戶名已存在' }, { status: 409 });
        }
        return NextResponse.json({ error: '註冊失敗，請稍後重試' }, { status: 500 });
      }
    } finally {
      // 釋放鎖
      if (releaseLock) {
        releaseLock();
      }
    }
  } catch (error) {
    console.error('註冊接口異常', error);
    return NextResponse.json({ error: '服務器錯誤' }, { status: 500 });
  }
}
