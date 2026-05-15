/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { EmbyClient } from '@/lib/emby.client';
import { clearEmbyCache } from '@/lib/emby-cache';

export const runtime = 'nodejs';

/**
 * POST /api/admin/emby
 * Emby 配置管理接口
 * - test: 測試 Emby 連接
 * - clearCache: 清除 Emby 緩存
 */
export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存儲進行管理員配置' },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { action, ServerURL, ApiKey, Username, Password } = body;

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    // 獲取配置
    const adminConfig = await getConfig();

    // 權限檢查
    if (username !== process.env.USERNAME) {
      const userInfo = await db.getUserInfoV2(username);
      if (!userInfo || userInfo.role !== 'admin' || userInfo.banned) {
        return NextResponse.json({ error: '權限不足' }, { status: 401 });
      }
    }

    if (action === 'test') {
      // 測試連接
      if (!ServerURL) {
        return NextResponse.json({ error: '請填寫 Emby 服務器地址' }, { status: 400 });
      }

      if (!ApiKey && !Username) {
        return NextResponse.json(
          { error: '請填寫 API Key 或用戶名' },
          { status: 400 }
        );
      }

      const testConfig = {
        ServerURL,
        ApiKey,
        Username,
        Password,
      };

      const client = new EmbyClient(testConfig);

      // 如果使用用戶名密碼，先認證
      if (!ApiKey && Username) {
        try {
          await client.authenticate(Username, Password || '');
        } catch (error) {
          return NextResponse.json(
            { success: false, message: 'Emby 認證失敗: ' + (error as Error).message },
            { status: 200 }
          );
        }
      }

      // 測試連接
      const isConnected = await client.checkConnectivity();
      if (!isConnected) {
        return NextResponse.json(
          { success: false, message: 'Emby 連接失敗，請檢查服務器地址和認證信息' },
          { status: 200 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'Emby 連接測試成功',
      });
    }

    if (action === 'clearCache') {
      // 清除緩存
      const result = clearEmbyCache();
      return NextResponse.json({
        success: true,
        message: `已清除 ${result.cleared} 條 Emby 緩存`,
        cleared: result.cleared,
      });
    }

    return NextResponse.json({ error: '不支持的操作' }, { status: 400 });
  } catch (error) {
    console.error('Emby 配置保存失敗:', error);
    return NextResponse.json(
      { error: 'Emby 配置保存失敗: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
