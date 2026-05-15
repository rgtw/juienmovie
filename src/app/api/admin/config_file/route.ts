/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, refineConfig } from '@/lib/config';
import { db } from '@/lib/db';

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

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const username = authInfo.username;

  try {
    // 檢查用戶權限
    let adminConfig = await getConfig();

    // 僅站長可以修改配置文件
    if (username !== process.env.USERNAME) {
      return NextResponse.json(
        { error: '權限不足，只有站長可以修改配置文件' },
        { status: 401 }
      );
    }

    // 獲取請求體
    const body = await request.json();
    const { configFile, subscriptionUrl, autoUpdate, lastCheckTime } = body;

    if (!configFile || typeof configFile !== 'string') {
      return NextResponse.json(
        { error: '配置文件內容不能為空' },
        { status: 400 }
      );
    }

    // 驗證 JSON 格式
    try {
      JSON.parse(configFile);
    } catch (e) {
      return NextResponse.json(
        { error: '配置文件格式錯誤，請檢查 JSON 語法' },
        { status: 400 }
      );
    }

    adminConfig.ConfigFile = configFile;
    if (!adminConfig.ConfigSubscribtion) {
      adminConfig.ConfigSubscribtion = {
        URL: '',
        AutoUpdate: false,
        LastCheck: '',
      };
    }

    // 更新訂閱配置
    if (subscriptionUrl !== undefined) {
      adminConfig.ConfigSubscribtion.URL = subscriptionUrl;
    }
    if (autoUpdate !== undefined) {
      adminConfig.ConfigSubscribtion.AutoUpdate = autoUpdate;
    }
    adminConfig.ConfigSubscribtion.LastCheck = lastCheckTime || '';

    adminConfig = refineConfig(adminConfig);
    // 更新配置文件
    await db.saveAdminConfig(adminConfig);

    // 清除短劇視頻源緩存（因為配置文件可能包含新的視頻源）
    try {
      await db.deleteGlobalValue('duanju');
      console.log('已清除短劇視頻源緩存');
    } catch (error) {
      console.error('清除短劇視頻源緩存失敗:', error);
      // 不影響主流程，繼續執行
    }

    return NextResponse.json({
      success: true,
      message: '配置文件更新成功',
    });
  } catch (error) {
    console.error('更新配置文件失敗:', error);
    return NextResponse.json(
      {
        error: '更新配置文件失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
