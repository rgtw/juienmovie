/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AdminConfigResult } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存儲進行管理員配置',
      },
      { status: 400 }
    );
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const username = authInfo.username;

  try {
    const config = await getConfig();
    const result: AdminConfigResult = {
      Role: 'owner',
      Config: config,
    };
    if (username === process.env.USERNAME) {
      result.Role = 'owner';
    } else {
      // 從新版數據庫獲取用戶信息
      const { db } = await import('@/lib/db');
      const userInfoV2 = await db.getUserInfoV2(username);

      if (userInfoV2 && userInfoV2.role === 'admin' && !userInfoV2.banned) {
        result.Role = 'admin';
      } else {
        return NextResponse.json(
          { error: '你是管理員嗎你就訪問？' },
          { status: 401 }
        );
      }
    }

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store', // 管理員配置不緩存
      },
    });
  } catch (error) {
    console.error('獲取管理員配置失敗:', error);
    return NextResponse.json(
      {
        error: '獲取管理員配置失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存儲進行管理員配置' },
      { status: 400 }
    );
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const username = authInfo.username;

  try {
    const newConfig = await request.json();

    // 權限檢查
    if (username !== process.env.USERNAME) {
      const { db } = await import('@/lib/db');
      const userInfoV2 = await db.getUserInfoV2(username);

      if (!userInfoV2 || (userInfoV2.role !== 'admin' && userInfoV2.role !== 'owner') || userInfoV2.banned) {
        return NextResponse.json({ error: '權限不足' }, { status: 401 });
      }
    }

    // 保存配置
    const { db } = await import('@/lib/db');
    const { configSelfCheck, setCachedConfig } = await import('@/lib/config');

    // 自檢配置
    const checkedConfig = configSelfCheck(newConfig);

    // 保存到數據庫
    await db.saveAdminConfig(checkedConfig);

    // 更新緩存
    await setCachedConfig(checkedConfig);

    return NextResponse.json({ success: true, message: '配置已保存' });
  } catch (error) {
    console.error('保存配置失敗:', error);
    return NextResponse.json(
      { error: '保存配置失敗: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
