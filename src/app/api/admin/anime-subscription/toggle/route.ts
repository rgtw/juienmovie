/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * PUT /api/admin/anime-subscription/toggle
 * 切換追番功能啟用狀態
 */
export async function PUT(req: NextRequest) {
  try {
    // 權限檢查
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo || (authInfo.role !== 'admin' && authInfo.role !== 'owner')) {
      return NextResponse.json({ error: '無權限訪問' }, { status: 403 });
    }

    const { enabled } = await req.json();

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled 必須是布爾值' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    if (!config.AnimeSubscriptionConfig) {
      config.AnimeSubscriptionConfig = { Enabled: false, Subscriptions: [] };
    }

    config.AnimeSubscriptionConfig.Enabled = enabled;
    await db.saveAdminConfig(config);

    return NextResponse.json({ success: true, enabled });
  } catch (error: any) {
    console.error('切換追番功能狀態失敗:', error);
    return NextResponse.json(
      { error: error.message || '切換狀態失敗' },
      { status: 500 }
    );
  }
}
