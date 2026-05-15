/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { checkSubscription } from '@/lib/anime-subscription';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * POST /api/admin/anime-subscription/[id]/check
 * 手動觸發檢查單個訂閱
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 權限檢查
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo || (authInfo.role !== 'admin' && authInfo.role !== 'owner')) {
      return NextResponse.json({ error: '無權限訪問' }, { status: 403 });
    }

    const config = await getConfig();
    const subscriptions = config.AnimeSubscriptionConfig?.Subscriptions || [];

    const subscription = subscriptions.find((sub) => sub.id === params.id);
    if (!subscription) {
      return NextResponse.json({ error: '訂閱不存在' }, { status: 404 });
    }

    // 執行檢查邏輯（忽略時間間隔限制）
    const result = await checkSubscription(subscription);

    // 保存配置
    await db.saveAdminConfig(config);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('檢查追番訂閱失敗:', error);
    return NextResponse.json(
      { error: error.message || '檢查失敗' },
      { status: 500 }
    );
  }
}
