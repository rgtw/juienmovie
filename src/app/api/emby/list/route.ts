/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getCachedEmbyList, setCachedEmbyList } from '@/lib/emby-cache';
import { embyManager } from '@/lib/emby-manager';
import { getProxyToken } from '@/lib/emby-token';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '20');
  const parentId = searchParams.get('parentId') || undefined;
  const embyKey = searchParams.get('embyKey') || undefined;
  const sortBy = searchParams.get('sortBy') || 'SortName';
  const sortOrder = searchParams.get('sortOrder') || 'Ascending';

  try {
    const authResult = await requireFeaturePermission(request, 'emby', '無權限訪問 Emby');
    if (authResult instanceof NextResponse) return authResult;
    // 判斷是否是默認排序（只有默認排序才使用緩存）
    const isDefaultSort = sortBy === 'SortName' && sortOrder === 'Ascending';

    // 只有默認排序才檢查緩存
    if (isDefaultSort) {
      const cached = getCachedEmbyList(page, pageSize, parentId, embyKey);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    // 獲取Emby客戶端
    const client = await embyManager.getClient(embyKey);

    // 獲取代理 token（如果啟用了代理）
    const proxyToken = client.isProxyEnabled() ? await getProxyToken(request) : null;

    // 獲取媒體列表
    const result = await client.getItems({
      ParentId: parentId,
      IncludeItemTypes: 'Movie,Series',
      Recursive: true,
      Fields: 'Overview,ProductionYear',
      SortBy: sortBy,
      SortOrder: sortOrder,
      StartIndex: (page - 1) * pageSize,
      Limit: pageSize,
    });

    const list = result.Items.map((item) => ({
      id: item.Id,
      title: item.Name,
      poster: client.getImageUrl(item.Id, 'Primary', undefined, proxyToken || undefined),
      year: item.ProductionYear?.toString() || '',
      rating: item.CommunityRating || 0,
      mediaType: item.Type === 'Movie' ? 'movie' : 'tv',
    }));

    const totalPages = Math.ceil(result.TotalRecordCount / pageSize);

    const response = {
      success: true,
      list,
      totalPages,
      currentPage: page,
      total: result.TotalRecordCount,
    };

    // 只有默認排序才緩存結果
    if (isDefaultSort) {
      setCachedEmbyList(page, pageSize, response, parentId, embyKey);
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('獲取 Emby 列表失敗:', error);
    return NextResponse.json({
      error: '獲取 Emby 列表失敗: ' + (error as Error).message,
      list: [],
      totalPages: 0,
      currentPage: page,
      total: 0,
    });
  }
}
