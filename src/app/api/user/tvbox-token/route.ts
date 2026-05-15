import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { generateTvboxToken } from '@/lib/tvbox-token';

export const runtime = 'nodejs';

/**
 * 獲取用戶的TVBox訂閱token
 * 如果用戶沒有token，自動生成一個
 */
export async function GET(request: NextRequest) {
  try {
    // 驗證用戶登錄
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json(
        { error: '未登錄' },
        { status: 401 }
      );
    }

    const username = authInfo.username;

    // 獲取token，如果沒有則生成
    let token = await db.getTvboxSubscribeToken(username);

    if (!token) {
      // 懶加載：首次訪問時生成token
      token = generateTvboxToken();
      await db.setTvboxSubscribeToken(username, token);
      console.log(`為用戶 ${username} 生成TVBox訂閱token`);
    }

    return NextResponse.json({ token });
  } catch (error) {
    console.error('獲取TVBox訂閱token失敗:', error);
    return NextResponse.json(
      {
        error: '獲取訂閱token失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
