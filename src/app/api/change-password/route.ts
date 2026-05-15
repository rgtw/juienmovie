/* eslint-disable no-console*/

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { getUserDevices, revokeRefreshToken } from '@/lib/refresh-token';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  // 不支持 localstorage 模式
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存儲模式修改密碼',
      },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { newPassword } = body;

    // 獲取認證信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 驗證新密碼
    if (!newPassword || typeof newPassword !== 'string') {
      return NextResponse.json({ error: '新密碼不得為空' }, { status: 400 });
    }

    const username = authInfo.username;

    // 不允許站長修改密碼（站長用戶名等於 process.env.USERNAME）
    if (username === process.env.USERNAME) {
      return NextResponse.json(
        { error: '站長不能通過此接口修改密碼' },
        { status: 403 }
      );
    }

    // 修改密碼（只更新V2存儲）
    await db.changePasswordV2(username, newPassword);

    // 撤銷除當前設備外的所有 Refresh Token
    try {
      const currentTokenId = authInfo.tokenId;
      const devices = await getUserDevices(username);

      // 撤銷所有非當前設備的 token
      for (const device of devices) {
        if (device.tokenId !== currentTokenId) {
          await revokeRefreshToken(username, device.tokenId);
          console.log(`Revoked token ${device.tokenId} for ${username} after password change`);
        }
      }

      console.log(`Password changed for ${username}, revoked ${devices.length - 1} other devices`);
    } catch (error) {
      console.error('Failed to revoke other devices after password change:', error);
      // 不影響密碼修改的成功，只記錄錯誤
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('修改密碼失敗:', error);
    return NextResponse.json(
      {
        error: '修改密碼失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
