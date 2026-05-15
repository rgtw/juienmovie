import { NextRequest, NextResponse } from 'next/server';

import { embyManager } from '@/lib/emby-manager';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // 禁用緩存

/**
 * 獲取所有啟用的Emby源列表
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'emby', '無權限訪問 Emby');
    if (authResult instanceof NextResponse) return authResult;
    const sources = await embyManager.getEnabledSources();

    return NextResponse.json({
      sources: sources.map(s => ({
        key: s.key,
        name: s.name,
      })),
    });
  } catch (error) {
    console.error('[Emby Sources] 獲取Emby源列表失敗:', error);
    return NextResponse.json(
      { error: '獲取Emby源列表失敗', sources: [] },
      { status: 500 }
    );
  }
}
