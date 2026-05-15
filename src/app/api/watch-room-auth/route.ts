/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * GET /api/watch-room-auth
 *
 * 需要登錄才能訪問的接口，返回觀影室外部服務器的認證信息
 * 這樣可以避免將敏感的 externalServerAuth 暴露給未登錄用戶
 */
export async function GET(request: NextRequest) {
  console.log('watch-room-auth called: ', request.url);

  // 從 cookie 獲取用戶信息
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 返回外部服務器認證信息
  const externalServerAuth = process.env.WATCH_ROOM_EXTERNAL_SERVER_AUTH;

  return NextResponse.json({
    externalServerAuth: externalServerAuth || null,
  });
}
