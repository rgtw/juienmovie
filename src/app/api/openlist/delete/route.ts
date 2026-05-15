/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';
import { db } from '@/lib/db';
import {
  invalidateMetaInfoCache,
  MetaInfo,
  setCachedMetaInfo,
} from '@/lib/openlist-cache';

export const runtime = 'nodejs';

/**
 * POST /api/openlist/delete
 * 刪除私人影庫中的視頻記錄
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'private_library', '無權限訪問私人影庫');
    if (authResult instanceof NextResponse) return authResult;
    // 權限檢查
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 獲取請求參數
    const body = await request.json();
    const { key } = body;

    if (!key) {
      return NextResponse.json({ error: '缺少 key 參數' }, { status: 400 });
    }

    // 獲取配置
    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    if (
      !openListConfig ||
      !openListConfig.Enabled ||
      !openListConfig.URL
    ) {
      return NextResponse.json(
        { error: 'OpenList 未配置或未啟用' },
        { status: 400 }
      );
    }

    // 從數據庫讀取 metainfo
    const metainfoContent = await db.getGlobalValue('video.metainfo');
    if (!metainfoContent) {
      return NextResponse.json(
        { error: '未找到視頻元數據' },
        { status: 404 }
      );
    }

    const metaInfo: MetaInfo = JSON.parse(metainfoContent);

    // 檢查 key 是否存在
    if (!metaInfo.folders[key]) {
      return NextResponse.json(
        { error: '未找到該視頻記錄' },
        { status: 404 }
      );
    }

    // 刪除記錄
    delete metaInfo.folders[key];

    // 保存到數據庫
    const updatedMetainfoContent = JSON.stringify(metaInfo);
    await db.setGlobalValue('video.metainfo', updatedMetainfoContent);

    // 更新緩存
    invalidateMetaInfoCache();
    setCachedMetaInfo(metaInfo);

    // 更新配置中的資源數量
    if (config.OpenListConfig) {
      config.OpenListConfig.ResourceCount = Object.keys(metaInfo.folders).length;
      await db.saveAdminConfig(config);
    }

    return NextResponse.json({
      success: true,
      message: '刪除成功',
    });
  } catch (error) {
    console.error('刪除視頻記錄失敗:', error);
    return NextResponse.json(
      { error: '刪除失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
