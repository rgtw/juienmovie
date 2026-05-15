/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { embyManager } from '@/lib/emby-manager';
import { getProxyToken } from '@/lib/emby-token';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get('id');
  const embyKey = searchParams.get('embyKey') || undefined;

  if (!itemId) {
    return NextResponse.json({ error: '缺少媒體ID' }, { status: 400 });
  }

  try {
    const authResult = await requireFeaturePermission(request, 'emby', '無權限訪問 Emby');
    if (authResult instanceof NextResponse) return authResult;
    // 獲取Emby客戶端
    const client = await embyManager.getClient(embyKey);

    // 獲取代理 token（如果啟用了代理）
    const proxyToken = client.isProxyEnabled() ? await getProxyToken(request) : null;

    // 獲取媒體詳情
    const item = await client.getItem(itemId);

    let episodes: any[] = [];

    if (item.Type === 'Series') {
      // 獲取所有劇集
      const allEpisodes = await client.getEpisodes(itemId);

      episodes = await Promise.all(
        allEpisodes
          .sort((a, b) => {
            if (a.ParentIndexNumber !== b.ParentIndexNumber) {
              return (a.ParentIndexNumber || 0) - (b.ParentIndexNumber || 0);
            }
            return (a.IndexNumber || 0) - (b.IndexNumber || 0);
          })
          .map(async (ep) => ({
            id: ep.Id,
            title: ep.Name,
            episode: ep.IndexNumber || 0,
            season: ep.ParentIndexNumber || 1,
            overview: ep.Overview || '',
            playUrl: await client.getStreamUrl(ep.Id),
          }))
      );
    }

    return NextResponse.json({
      success: true,
      item: {
        id: item.Id,
        title: item.Name,
        type: item.Type === 'Movie' ? 'movie' : 'tv',
        overview: item.Overview || '',
        poster: client.getImageUrl(item.Id, 'Primary', undefined, proxyToken || undefined),
        year: item.ProductionYear?.toString() || '',
        rating: item.CommunityRating || 0,
        playUrl: item.Type === 'Movie' ? await client.getStreamUrl(item.Id) : undefined,
      },
      episodes: item.Type === 'Series' ? episodes : [],
    });
  } catch (error) {
    console.error('獲取 Emby 詳情失敗:', error);
    return NextResponse.json(
      { error: '獲取 Emby 詳情失敗: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
