/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { requireFeaturePermission } from '@/lib/permissions';
import { getScanTask } from '@/lib/scan-task';

export const runtime = 'nodejs';

/**
 * GET /api/openlist/scan-progress?taskId=xxx
 * 獲取掃描任務進度
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'private_library', '無權限訪問私人影庫');
    if (authResult instanceof NextResponse) return authResult;
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json({ error: '缺少 taskId' }, { status: 400 });
    }

    const task = getScanTask(taskId);

    if (!task) {
      return NextResponse.json({ error: '任務不存在' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      task,
    });
  } catch (error) {
    console.error('獲取掃描進度失敗:', error);
    return NextResponse.json(
      { error: '獲取失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
