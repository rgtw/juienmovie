/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getCachedEmbyViews, setCachedEmbyViews } from '@/lib/emby-cache';
import { embyManager } from '@/lib/emby-manager';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'emby', '無權限訪問 Emby');
    if (authResult instanceof NextResponse) return authResult;
    const { searchParams } = new URL(request.url);
    const embyKey = searchParams.get('embyKey') || undefined;

    // 檢查緩存（按embyKey緩存）
    const cacheKey = embyKey || 'default';
    const cached = getCachedEmbyViews(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // 獲取Emby客戶端
    const client = await embyManager.getClient(embyKey);

    // 獲取媒體庫列表
    const views = await client.getUserViews();

    // 過濾出電影和電視劇媒體庫
    const filteredViews = views.filter(
      (view) => view.CollectionType === 'movies' || view.CollectionType === 'tvshows'
    );

    const response = {
      success: true,
      views: filteredViews.map((view) => ({
        id: view.Id,
        name: view.Name,
        type: view.CollectionType,
      })),
    };

    // 緩存結果
    setCachedEmbyViews(cacheKey, response);

    return NextResponse.json(response);
  } catch (error) {
    console.error('獲取 Emby 媒體庫列表失敗:', error);
    return NextResponse.json({
      error: '獲取 Emby 媒體庫列表失敗: ' + (error as Error).message,
      views: [],
    });
  }
}
