import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  executeSavedSourceScript,
  normalizeScriptRecommendResults,
  normalizeScriptSources,
} from '@/lib/source-script';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sourceKey = searchParams.get('source');
  const page = Number(searchParams.get('page') || '1');

  if (!sourceKey) {
    return NextResponse.json({ error: '缺少參數: source' }, { status: 400 });
  }

  try {
    let sources = [{ id: 'default', name: '默認源' }];

    try {
      const sourcesExecution = await executeSavedSourceScript({
        key: sourceKey,
        hook: 'getSources',
        payload: {},
      });
      sources = normalizeScriptSources(sourcesExecution.result);
    } catch {
      // 允許腳本未實現 getSources，繼續使用默認源
    }

    const execution = await executeSavedSourceScript({
      key: sourceKey,
      hook: 'recommend',
      payload: { page },
    });

    const results = normalizeScriptRecommendResults({
      scriptKey: sourceKey,
      scriptName: execution.meta?.name || sourceKey,
      result: execution.result,
      sources,
      defaultSourceId: sources[0]?.id || 'default',
    });

    return NextResponse.json({
      results,
      page: Number(execution.result?.page || page),
      pageCount: Number(execution.result?.pageCount || 1),
      total: Number(execution.result?.total || results.length),
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || '獲取高級推薦失敗' },
      { status: 500 }
    );
  }
}
