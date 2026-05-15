import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
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

    const adminConfig = await getConfig();
    const embyConfig = adminConfig.EmbyConfig || {};

    const exportData = JSON.stringify(embyConfig, null, 2);

    return new NextResponse(exportData, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="emby-config-${Date.now()}.json"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: '導出失敗: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
