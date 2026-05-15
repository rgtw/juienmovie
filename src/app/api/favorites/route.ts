/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { Favorite } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * GET /api/favorites
 *
 * 支持兩種調用方式：
 * 1. 不帶 query，返回全部收藏列表（Record<string, Favorite>）。
 * 2. 帶 key=source+id，返回單條收藏（Favorite | null）。
 */
export async function GET(request: NextRequest) {
  try {
    // 從 cookie 獲取用戶信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 檢查用戶狀態和執行遷移
    if (authInfo.username !== process.env.USERNAME) {
      // 非站長，檢查用戶存在或被封禁
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2) {
        return NextResponse.json({ error: '用戶不存在' }, { status: 401 });
      }
      if (userInfoV2.banned) {
        return NextResponse.json({ error: '用戶已被封禁' }, { status: 401 });
      }

      // 檢查收藏遷移標識，沒有遷移標識時執行遷移
      if (!userInfoV2.favorite_migrated) {
        console.log(`用戶 ${authInfo.username} 收藏未遷移，開始執行遷移...`);
        await db.migrateFavorites(authInfo.username);
      }
    } else {
      // 站長也需要執行遷移（站長可能不在數據庫中，直接嘗試遷移）
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2 || !userInfoV2.favorite_migrated) {
        console.log(`站長 ${authInfo.username} 收藏未遷移，開始執行遷移...`);
        await db.migrateFavorites(authInfo.username);
      }
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    // 查詢單條收藏
    if (key) {
      const [source, id] = key.split('+');
      if (!source || !id) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }
      const fav = await db.getFavorite(authInfo.username, source, id);
      return NextResponse.json(fav, { status: 200 });
    }

    // 查詢全部收藏
    const favorites = await db.getAllFavorites(authInfo.username);
    return NextResponse.json(favorites, { status: 200 });
  } catch (err) {
    console.error('獲取收藏失敗', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/favorites
 * body: { key: string; favorite: Favorite }
 */
export async function POST(request: NextRequest) {
  try {
    // 從 cookie 獲取用戶信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (authInfo.username !== process.env.USERNAME) {
      // 非站長，檢查用戶存在或被封禁
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2) {
        return NextResponse.json({ error: '用戶不存在' }, { status: 401 });
      }
      if (userInfoV2.banned) {
        return NextResponse.json({ error: '用戶已被封禁' }, { status: 401 });
      }
    }

    const body = await request.json();
    const { key, favorite }: { key: string; favorite: Favorite } = body;

    if (!key || !favorite) {
      return NextResponse.json(
        { error: 'Missing key or favorite' },
        { status: 400 }
      );
    }

    // 驗證必要字段
    if (!favorite.title || !favorite.source_name) {
      return NextResponse.json(
        { error: 'Invalid favorite data' },
        { status: 400 }
      );
    }

    const [source, id] = key.split('+');
    if (!source || !id) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 }
      );
    }

    const finalFavorite = {
      ...favorite,
      save_time: favorite.save_time ?? Date.now(),
    } as Favorite;

    await db.saveFavorite(authInfo.username, source, id, finalFavorite);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('保存收藏失敗', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/favorites
 *
 * 1. 不帶 query -> 清空全部收藏
 * 2. 帶 key=source+id -> 刪除單條收藏
 */
export async function DELETE(request: NextRequest) {
  try {
    // 從 cookie 獲取用戶信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (authInfo.username !== process.env.USERNAME) {
      // 非站長，檢查用戶存在或被封禁
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2) {
        return NextResponse.json({ error: '用戶不存在' }, { status: 401 });
      }
      if (userInfoV2.banned) {
        return NextResponse.json({ error: '用戶已被封禁' }, { status: 401 });
      }
    }

    const username = authInfo.username;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      // 刪除單條
      const [source, id] = key.split('+');
      if (!source || !id) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }
      await db.deleteFavorite(username, source, id);
    } else {
      // 清空全部
      const all = await db.getAllFavorites(username);
      await Promise.all(
        Object.keys(all).map(async (k) => {
          const [s, i] = k.split('+');
          if (s && i) await db.deleteFavorite(username, s, i);
        })
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('刪除收藏失敗', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
