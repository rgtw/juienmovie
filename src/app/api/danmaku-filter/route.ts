/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { DanmakuFilterConfig } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未登錄' }, { status: 401 });
    }

    if (authInfo.username !== process.env.USERNAME) {
      // 非站長，檢查用戶存在或被封禁
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2) {
        return NextResponse.json({ error: '用戶不存在' }, { status: 401 });
      }
      if (userInfoV2.banned) {
        return NextResponse.json({ error: '用戶已被封禁' }, { status: 401 });
      }
    }

    // 獲取彈幕過濾配置
    const filterConfig = await db.getDanmakuFilterConfig(authInfo.username);

    // 如果沒有配置，返回默認值
    if (!filterConfig) {
      return NextResponse.json({ rules: [] });
    }

    return NextResponse.json(filterConfig);
  } catch (error) {
    console.error('獲取彈幕過濾配置失敗:', error);
    return NextResponse.json(
      { error: '獲取彈幕過濾配置失敗' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未登錄' }, { status: 401 });
    }

    if (authInfo.username !== process.env.USERNAME) {
      // 非站長，檢查用戶存在或被封禁
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2) {
        return NextResponse.json({ error: '用戶不存在' }, { status: 401 });
      }
      if (userInfoV2.banned) {
        return NextResponse.json({ error: '用戶已被封禁' }, { status: 401 });
      }
    }

    const body = await request.json();
    const config: DanmakuFilterConfig = body;

    if (!config || !Array.isArray(config.rules)) {
      return NextResponse.json({ error: '配置格式錯誤' }, { status: 400 });
    }

    // 驗證每個規則的格式
    const validatedRules = config.rules.map((rule) => ({
      keyword: String(rule.keyword || ''),
      type: (rule.type === 'regex' || rule.type === 'normal') ? rule.type : 'normal',
      enabled: Boolean(rule.enabled),
      id: rule.id || undefined,
    }));

    const validatedConfig: DanmakuFilterConfig = {
      rules: validatedRules,
    };

    await db.setDanmakuFilterConfig(authInfo.username, validatedConfig);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('保存彈幕過濾配置失敗:', error);
    return NextResponse.json(
      { error: '保存彈幕過濾配置失敗' },
      { status: 500 }
    );
  }
}
