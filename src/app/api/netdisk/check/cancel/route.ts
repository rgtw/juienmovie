import { NextRequest, NextResponse } from 'next/server';

import { cancelNetdiskCheckTask } from '@/lib/netdisk-check-task';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(
      request,
      'netdisk_search',
      '無權限使用網盤有效性檢測'
    );
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json();
    const taskId = String(body?.taskId || '');
    if (!taskId) {
      return NextResponse.json({ error: '缺少任務ID' }, { status: 400 });
    }
    const task = cancelNetdiskCheckTask(taskId);
    if (!task) {
      return NextResponse.json({ error: '任務不存在' }, { status: 404 });
    }
    return NextResponse.json({ task });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '取消檢測任務失敗' },
      { status: 500 }
    );
  }
}
