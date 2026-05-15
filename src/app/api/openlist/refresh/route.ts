/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';
import { startOpenListRefresh } from '@/lib/openlist-refresh';

export const runtime = 'nodejs';

/**
 * POST /api/openlist/refresh
 * 刷新私人影庫元數據（後臺任務模式）
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

    // 檢查 TMDB API Key 是否配置
    const config = await getConfig();
    if (!config.SiteConfig.TMDBApiKey || config.SiteConfig.TMDBApiKey.trim() === '') {
      return NextResponse.json(
        { error: '請先在站點配置中配置 TMDB API Key' },
        { status: 400 }
      );
    }

    // 獲取請求參數
    const body = await request.json().catch(() => ({}));
    const clearMetaInfo = body.clearMetaInfo === true;

    // 啟動掃描任務
    const { taskId } = await startOpenListRefresh(clearMetaInfo);

    return NextResponse.json({
      success: true,
      taskId,
      message: '掃描任務已啟動',
    });
  } catch (error) {
    console.error('啟動刷新任務失敗:', error);
    return NextResponse.json(
      { error: '啟動失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
