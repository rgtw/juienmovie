import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { generateTvboxToken } from '@/lib/tvbox-token';

export const runtime = 'nodejs';

/**
 * 重置用戶的TVBox訂閱token
 * 舊token將失效
 */
export async function POST(request: NextRequest) {
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

    // 生成新token
    const newToken = generateTvboxToken();
    await db.setTvboxSubscribeToken(username, newToken);

    console.log(`用戶 ${username} 重置了TVBox訂閱token`);

    return NextResponse.json({
      token: newToken,
      message: '訂閱token已重置，舊鏈接已失效',
    });
  } catch (error) {
    console.error('重置TVBox訂閱token失敗:', error);
    return NextResponse.json(
      {
        error: '重置訂閱token失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
