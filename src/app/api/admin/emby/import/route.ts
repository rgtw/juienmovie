import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存儲進行管理員配置' },
      { status: 400 }
    );
  }

  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 僅站長可用
    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json({ error: '權限不足，僅站長可用' }, { status: 403 });
    }

    const body = await request.json();
    const { data } = body;

    if (!data) {
      return NextResponse.json({ error: '缺少導入數據' }, { status: 400 });
    }

    const adminConfig = await getConfig();

    // 追加和覆蓋：合併Sources數組
    if (data.Sources && Array.isArray(data.Sources)) {
      const existingSources = adminConfig.EmbyConfig?.Sources || [];

      // 覆蓋已存在的，追加新的
      const mergedSources = [...existingSources];
      for (const importSource of data.Sources) {
        const existingIndex = mergedSources.findIndex(s => s.key === importSource.key);
        if (existingIndex >= 0) {
          mergedSources[existingIndex] = importSource;
        } else {
          mergedSources.push(importSource);
        }
      }

      adminConfig.EmbyConfig = {
        ...adminConfig.EmbyConfig,
        Sources: mergedSources,
      };
    } else {
      // 舊格式：直接覆蓋
      adminConfig.EmbyConfig = {
        ...adminConfig.EmbyConfig,
        ...data,
      };
    }

    await db.saveAdminConfig(adminConfig);

    // 更新內存緩存
    await setCachedConfig(adminConfig);

    return NextResponse.json({
      success: true,
      message: '導入成功',
    });
  } catch (error) {
    return NextResponse.json(
      { error: '導入失敗: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
