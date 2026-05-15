/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { OpenListClient } from '@/lib/openlist.client';

export const runtime = 'nodejs';

/**
 * 清理字符串中的 BOM 和其他不可見字符
 */
function cleanPath(path: string): string {
  // 移除 UTF-8 BOM (U+FEFF) 和其他零寬度字符
  let cleaned = path
    .replace(/^\uFEFF/, '') // 移除開頭的 BOM
    .replace(/\uFEFF/g, '') // 移除所有 BOM
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // 移除零寬度字符
    .trim(); // 移除首尾空白

  // 移除末尾的 /（除非路徑就是 /）
  if (cleaned.length > 1 && cleaned.endsWith('/')) {
    cleaned = cleaned.slice(0, -1);
  }

  return cleaned;
}

/**
 * POST /api/admin/openlist
 * 保存 OpenList 配置
 */
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
    const { action, Enabled, URL, Username, Password, RootPaths, OfflineDownloadPath, ScanInterval, ScanMode, DisableVideoPreview } = body;

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    // 獲取配置
    const adminConfig = await getConfig();

    // 權限檢查 - 使用v2用戶系統
    if (username !== process.env.USERNAME) {
      const userInfo = await db.getUserInfoV2(username);
      if (!userInfo || userInfo.role !== 'admin' || userInfo.banned) {
        return NextResponse.json({ error: '權限不足' }, { status: 401 });
      }
    }

    if (action === 'save') {
      // 如果功能未啟用，允許保存空配置
      if (!Enabled) {
        adminConfig.OpenListConfig = {
          Enabled: false,
          URL: URL || '',
          Username: Username || '',
          Password: Password || '',
          RootPaths: RootPaths || ['/'],
          OfflineDownloadPath: OfflineDownloadPath || '/',
          LastRefreshTime: adminConfig.OpenListConfig?.LastRefreshTime,
          ResourceCount: adminConfig.OpenListConfig?.ResourceCount,
          ScanInterval: 0,
          ScanMode: ScanMode || 'hybrid',
          DisableVideoPreview: DisableVideoPreview || false,
        };

        await db.saveAdminConfig(adminConfig);

        return NextResponse.json({
          success: true,
          message: '保存成功',
        });
      }

      // 功能啟用時，驗證必填字段
      if (!URL || !Username || !Password) {
        return NextResponse.json(
          { error: '請提供 URL、賬號和密碼' },
          { status: 400 }
        );
      }

      // 驗證 RootPaths
      if (!Array.isArray(RootPaths) || RootPaths.length === 0) {
        return NextResponse.json(
          { error: '請至少提供一個根目錄' },
          { status: 400 }
        );
      }

      // 清理 RootPaths 中的 BOM 和不可見字符
      const cleanedRootPaths = RootPaths.map(cleanPath);

      // 驗證掃描間隔
      const scanInterval = parseInt(ScanInterval) || 0;
      if (scanInterval > 0 && scanInterval < 60) {
        return NextResponse.json(
          { error: '定時掃描間隔最低為 60 分鐘' },
          { status: 400 }
        );
      }

      // 驗證賬號密碼是否正確
      try {
        console.log('[OpenList Config] 驗證賬號密碼');
        await OpenListClient.login(URL, Username, Password);
        console.log('[OpenList Config] 賬號密碼驗證成功');
      } catch (error) {
        console.error('[OpenList Config] 賬號密碼驗證失敗:', error);
        return NextResponse.json(
          { error: '賬號密碼驗證失敗: ' + (error as Error).message },
          { status: 400 }
        );
      }

      adminConfig.OpenListConfig = {
        Enabled: true,
        URL,
        Username,
        Password,
        RootPaths: cleanedRootPaths,
        OfflineDownloadPath: OfflineDownloadPath || '/',
        LastRefreshTime: adminConfig.OpenListConfig?.LastRefreshTime,
        ResourceCount: adminConfig.OpenListConfig?.ResourceCount,
        ScanInterval: scanInterval,
        ScanMode: ScanMode || 'hybrid',
        DisableVideoPreview: DisableVideoPreview || false,
      };

      await db.saveAdminConfig(adminConfig);

      return NextResponse.json({
        success: true,
        message: '保存成功',
      });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('OpenList 配置操作失敗:', error);
    return NextResponse.json(
      { error: '操作失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
