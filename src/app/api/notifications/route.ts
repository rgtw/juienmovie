import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getStorage } from '@/lib/db';

export const runtime = 'nodejs';

// GET: 獲取所有通知
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const storage = getStorage();
    const notifications = await storage.getNotifications(authInfo.username);
    const unreadCount = await storage.getUnreadNotificationCount(authInfo.username);

    return NextResponse.json({
      notifications,
      unreadCount,
    });
  } catch (error) {
    console.error('獲取通知失敗:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

// POST: 標記通知為已讀或刪除通知
export async function POST(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, notificationId } = body;

    const storage = getStorage();

    if (action === 'mark_read' && notificationId) {
      await storage.markNotificationAsRead(authInfo.username, notificationId);
      return NextResponse.json({ message: '已標記為已讀' });
    }

    if (action === 'delete' && notificationId) {
      await storage.deleteNotification(authInfo.username, notificationId);
      return NextResponse.json({ message: '已刪除' });
    }

    if (action === 'clear_all') {
      await storage.clearAllNotifications(authInfo.username);
      return NextResponse.json({ message: '已清空所有通知' });
    }

    return NextResponse.json({ error: '無效的操作' }, { status: 400 });
  } catch (error) {
    console.error('操作通知失敗:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
