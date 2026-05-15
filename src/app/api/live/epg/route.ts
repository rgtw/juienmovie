import { NextRequest, NextResponse } from 'next/server';

import { getCachedLiveChannels } from '@/lib/live';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'live', '無權限訪問電視直播');
    if (authResult instanceof NextResponse) return authResult;
    const { searchParams } = new URL(request.url);
    const sourceKey = searchParams.get('source');
    const tvgId = searchParams.get('tvgId');

    if (!sourceKey) {
      return NextResponse.json({ error: '缺少直播源參數' }, { status: 400 });
    }

    if (!tvgId) {
      return NextResponse.json({ error: '缺少頻道tvg-id參數' }, { status: 400 });
    }

    const channelData = await getCachedLiveChannels(sourceKey);

    if (!channelData) {
      // 頻道信息未找到時返回空的節目單數據
      return NextResponse.json({
        success: true,
        data: {
          tvgId,
          source: sourceKey,
          epgUrl: '',
          programs: []
        }
      });
    }

    // 從epgs字段中獲取對應tvgId的節目單信息
    const epgData = channelData.epgs[tvgId] || [];

    return NextResponse.json({
      success: true,
      data: {
        tvgId,
        source: sourceKey,
        epgUrl: channelData.epgUrl,
        programs: epgData
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: '獲取節目單信息失敗' },
      { status: 500 }
    );
  }
}
