/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
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

  try {
    const body = await request.json();

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const {
      enableBuiltInTheme,
      builtInTheme,
      customCSS,
      enableCache,
      cacheMinutes,
      loginBackgroundImage,
      registerBackgroundImage,
      homeBackgroundImage,
      progressThumbType,
      progressThumbPresetId,
      progressThumbCustomUrl,
    } = body as {
      enableBuiltInTheme: boolean;
      builtInTheme: string;
      customCSS: string;
      enableCache: boolean;
      cacheMinutes: number;
      loginBackgroundImage?: string;
      registerBackgroundImage?: string;
      homeBackgroundImage?: string;
      progressThumbType?: 'default' | 'preset' | 'custom';
      progressThumbPresetId?: string;
      progressThumbCustomUrl?: string;
    };

    // 參數校驗
    if (
      typeof enableBuiltInTheme !== 'boolean' ||
      typeof builtInTheme !== 'string' ||
      typeof customCSS !== 'string' ||
      typeof enableCache !== 'boolean' ||
      typeof cacheMinutes !== 'number'
    ) {
      return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
    }

    // 驗證背景圖URL格式（支持多行，每行一個URL）
    if (loginBackgroundImage && loginBackgroundImage.trim() !== '') {
      const urls = loginBackgroundImage
        .split('\n')
        .map((url) => url.trim())
        .filter((url) => url !== '');

      for (const url of urls) {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          return NextResponse.json(
            { error: `登錄界面背景圖URL格式錯誤：${url}，每個URL必須以http://或https://開頭` },
            { status: 400 }
          );
        }
      }
    }

    if (registerBackgroundImage && registerBackgroundImage.trim() !== '') {
      const urls = registerBackgroundImage
        .split('\n')
        .map((url) => url.trim())
        .filter((url) => url !== '');

      for (const url of urls) {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          return NextResponse.json(
            { error: `註冊界面背景圖URL格式錯誤：${url}，每個URL必須以http://或https://開頭` },
            { status: 400 }
          );
        }
      }
    }

    if (homeBackgroundImage && homeBackgroundImage.trim() !== '') {
      const urls = homeBackgroundImage
        .split('\n')
        .map((url) => url.trim())
        .filter((url) => url !== '');

      for (const url of urls) {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          return NextResponse.json(
            { error: `首頁背景圖URL格式錯誤：${url}，每個URL必須以http://或https://開頭` },
            { status: 400 }
          );
        }
      }
    }

    const adminConfig = await getConfig();

    // 權限校驗 - 使用v2用戶系統
    if (username !== process.env.USERNAME) {
      const userInfo = await db.getUserInfoV2(username);
      if (!userInfo || userInfo.role !== 'admin' || userInfo.banned) {
        return NextResponse.json({ error: '權限不足' }, { status: 401 });
      }
    }

    // 獲取當前版本號，如果CSS有變化則遞增
    const currentVersion = adminConfig.ThemeConfig?.cacheVersion || 0;
    const currentCSS = enableBuiltInTheme
      ? adminConfig.ThemeConfig?.builtInTheme
      : adminConfig.ThemeConfig?.customCSS;
    const newCSS = enableBuiltInTheme ? builtInTheme : customCSS;
    const cssChanged = currentCSS !== newCSS;

    // 更新主題配置
    adminConfig.ThemeConfig = {
      enableBuiltInTheme,
      builtInTheme,
      customCSS,
      enableCache,
      cacheMinutes,
      cacheVersion: cssChanged ? currentVersion + 1 : currentVersion,
      loginBackgroundImage: loginBackgroundImage?.trim() || undefined,
      registerBackgroundImage: registerBackgroundImage?.trim() || undefined,
      homeBackgroundImage: homeBackgroundImage?.trim() || undefined,
      progressThumbType: progressThumbType || 'default',
      progressThumbPresetId: progressThumbPresetId?.trim() || undefined,
      progressThumbCustomUrl: progressThumbCustomUrl?.trim() || undefined,
    };

    // 寫入數據庫
    await db.saveAdminConfig(adminConfig);

    return NextResponse.json(
      {
        ok: true,
        cacheVersion: adminConfig.ThemeConfig.cacheVersion,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('更新主題配置失敗:', error);
    return NextResponse.json(
      {
        error: '更新主題配置失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
