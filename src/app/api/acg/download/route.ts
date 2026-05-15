/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { OpenListClient } from '@/lib/openlist.client';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * POST /api/acg/download
 * 添加 ACG 資源到 OpenList 離線下載（僅管理員和站長可用）
 */
export async function POST(req: NextRequest) {
  try {
    // 檢查權限
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo?.username || !(await hasFeaturePermission(authInfo.username, 'magnet_save_private_library'))) {
      return NextResponse.json(
        { error: '無權限訪問' },
        { status: 403 }
      );
    }

    const { url, name } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: '下載鏈接不能為空' },
        { status: 400 }
      );
    }

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: '資源名稱不能為空' },
        { status: 400 }
      );
    }

    // 獲取 OpenList 配置
    const config = await getConfig();
    const openlistConfig = config.OpenListConfig;

    if (!openlistConfig?.Enabled) {
      return NextResponse.json(
        { error: '私人影庫功能未啟用' },
        { status: 400 }
      );
    }

    if (!openlistConfig.URL || !openlistConfig.Username || !openlistConfig.Password) {
      return NextResponse.json(
        { error: 'OpenList 配置不完整' },
        { status: 400 }
      );
    }

    // 構建下載路徑（使用離線下載目錄）
    const offlineDownloadPath = openlistConfig.OfflineDownloadPath || '/';
    const downloadPath = `${offlineDownloadPath.replace(/\/$/, '')}/${name}`;

    // 使用 OpenListClient 添加離線下載任務
    const client = new OpenListClient(
      openlistConfig.URL,
      openlistConfig.Username,
      openlistConfig.Password
    );

    // 獲取 Token 並調用 API
    const token = await (client as any).getToken();
    const openlistUrl = `${openlistConfig.URL.replace(/\/$/, '')}/api/fs/add_offline_download`;

    const response = await fetch(openlistUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token,
      },
      body: JSON.stringify({
        path: downloadPath,
        urls: [url],
        tool: 'aria2',
      }),
    });

    const data = await response.json();

    // 檢查響應狀態
    if (!response.ok || data.code !== 200) {
      throw new Error(data.message || '添加離線下載任務失敗');
    }

    return NextResponse.json({
      success: true,
      message: '已添加到離線下載隊列',
      path: downloadPath,
    });

  } catch (error: any) {
    console.error('添加離線下載任務失敗:', error);
    return NextResponse.json(
      { error: error.message || '添加離線下載任務失敗' },
      { status: 500 }
    );
  }
}
