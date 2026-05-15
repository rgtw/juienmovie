/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { requireFeaturePermission } from '@/lib/permissions';
import { OpenListClient } from '@/lib/openlist.client';

export const runtime = 'nodejs';

/**
 * POST /api/openlist/check
 * 檢查 OpenList 連通性
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'private_library', '無權限訪問私人影庫');
    if (authResult instanceof NextResponse) return authResult;
    // 權限檢查
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 獲取請求參數
    const body = await request.json();
    const { url, username, password } = body;

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '缺少必要參數' },
        { status: 400 }
      );
    }

    // 創建客戶端並檢查連通性
    const client = new OpenListClient(url, username, password);
    const result = await client.checkConnectivity();

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: result.message,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: result.message,
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('檢查 OpenList 連通性失敗:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '檢查失敗',
      },
      { status: 500 }
    );
  }
}
