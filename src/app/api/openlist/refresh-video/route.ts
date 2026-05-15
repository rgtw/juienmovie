/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';
import { OpenListClient } from '@/lib/openlist.client';
import { invalidateVideoInfoCache } from '@/lib/openlist-cache';

export const runtime = 'nodejs';

/**
 * POST /api/openlist/refresh-video
 * 刷新單個視頻的 videoinfo.json
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'private_library', '無權限訪問私人影庫');
    if (authResult instanceof NextResponse) return authResult;
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const body = await request.json();
    const { folder } = body;

    if (!folder) {
      return NextResponse.json({ error: '缺少參數' }, { status: 400 });
    }

    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    if (
      !openListConfig ||
      !openListConfig.Enabled ||
      !openListConfig.URL ||
      !openListConfig.Username ||
      !openListConfig.Password
    ) {
      return NextResponse.json({ error: 'OpenList 未配置或未啟用' }, { status: 400 });
    }

    // folder 已經是完整路徑，直接使用
    const folderPath = folder;
    const client = new OpenListClient(
      openListConfig.URL,
      openListConfig.Username,
      openListConfig.Password
    );

    // 清除緩存
    invalidateVideoInfoCache(folderPath);

    return NextResponse.json({
      success: true,
      message: '刷新成功',
    });
  } catch (error) {
    console.error('刷新視頻失敗:', error);
    return NextResponse.json(
      { error: '刷新失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
