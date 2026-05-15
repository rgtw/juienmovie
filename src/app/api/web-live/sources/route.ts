import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic'; // 禁用緩存

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'web_live', '無權限訪問網絡直播');
    if (authResult instanceof NextResponse) return authResult;
    const config = await getConfig();
    if (!config?.WebLiveConfig) {
      return NextResponse.json([]);
    }

    const sources = config.WebLiveConfig.filter(s => !s.disabled);
    return NextResponse.json(sources);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '獲取失敗' },
      { status: 500 }
    );
  }
}
