/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { AnimeSubscription } from '@/types/anime-subscription';

export const runtime = 'nodejs';

/**
 * GET /api/admin/anime-subscription
 * 獲取訂閱列表和配置
 */
export async function GET(req: NextRequest) {
  try {
    // 權限檢查
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo || (authInfo.role !== 'admin' && authInfo.role !== 'owner')) {
      return NextResponse.json({ error: '無權限訪問' }, { status: 403 });
    }

    const config = await getConfig();
    const animeConfig = config.AnimeSubscriptionConfig || {
      Enabled: false,
      Subscriptions: [],
    };

    return NextResponse.json(animeConfig);
  } catch (error: any) {
    console.error('獲取追番訂閱配置失敗:', error);
    return NextResponse.json(
      { error: error.message || '獲取配置失敗' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/anime-subscription
 * 創建新訂閱
 */
export async function POST(req: NextRequest) {
  try {
    // 權限檢查
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo || (authInfo.role !== 'admin' && authInfo.role !== 'owner')) {
      return NextResponse.json({ error: '無權限訪問' }, { status: 403 });
    }

    const { title, filterText, source, enabled, lastEpisode } =
      await req.json();

    // 驗證必填字段
    if (!title || !filterText || !source) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    // 驗證 source
    if (!['acgrip', 'mikan', 'dmhy'].includes(source)) {
      return NextResponse.json({ error: '無效的搜索源' }, { status: 400 });
    }

    const config = await getConfig();
    if (!config.AnimeSubscriptionConfig) {
      config.AnimeSubscriptionConfig = { Enabled: false, Subscriptions: [] };
    }

    // 驗證集數
    let episodeNum = 0;
    if (lastEpisode !== undefined) {
      episodeNum = parseInt(String(lastEpisode), 10);
      if (isNaN(episodeNum) || episodeNum < 0) {
        return NextResponse.json(
          { error: '集數必須是非負整數' },
          { status: 400 }
        );
      }
    }

    // 創建新訂閱
    const newSubscription: AnimeSubscription = {
      id: crypto.randomUUID(),
      title: title.trim(),
      filterText: filterText.trim(),
      source,
      enabled: enabled ?? true,
      lastCheckTime: 0,
      lastEpisode: episodeNum,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: authInfo.username || 'unknown',
    };

    config.AnimeSubscriptionConfig.Subscriptions.push(newSubscription);
    await db.saveAdminConfig(config);

    return NextResponse.json(newSubscription);
  } catch (error: any) {
    console.error('創建追番訂閱失敗:', error);
    return NextResponse.json(
      { error: error.message || '創建訂閱失敗' },
      { status: 500 }
    );
  }
}
