/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { OpenListClient } from '@/lib/openlist.client';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * GET /api/openlist/play/{token}?folder=xxx&fileName=xxx
 * 獲取單個視頻文件的播放鏈接（懶加載）
 * 返回重定向到真實播放 URL
 *
 * 權限驗證：TVBox Token（路徑參數） 或 用戶登錄（滿足其一即可）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const { searchParams } = new URL(request.url);

    // 雙重驗證：TVBox Token（全局或用戶） 或 用戶登錄
    const requestToken = params.token;
    const globalToken = process.env.TVBOX_SUBSCRIBE_TOKEN;
    const authInfo = getAuthInfoFromCookie(request);

    // 驗證 TVBox Token（全局token或用戶token）
    let hasValidToken = false;
    if (globalToken && requestToken === globalToken) {
      // 全局token
      hasValidToken = true;
    } else {
      // 檢查是否是用戶token
      const { db } = await import('@/lib/db');
      const username = await db.getUsernameByTvboxToken(requestToken);
      if (username) {
        // 檢查用戶是否被封禁
        const userInfo = await db.getUserInfoV2(username);
        const allowed = await hasFeaturePermission(username, 'private_library');
        if (userInfo && !userInfo.banned && allowed) {
          hasValidToken = true;
        }
      }
    }

    // 驗證用戶登錄
    const hasValidAuth = !!(
      authInfo?.username &&
      (await hasFeaturePermission(authInfo.username, 'private_library'))
    );

    // 兩者至少滿足其一
    if (!hasValidToken && !hasValidAuth) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const folderName = searchParams.get('folder');
    const fileName = searchParams.get('fileName');

    if (!folderName || !fileName) {
      return NextResponse.json({ error: '缺少參數' }, { status: 400 });
    }

    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    if (
      !openListConfig ||
      !openListConfig.Enabled ||
      !openListConfig.URL ||
      !openListConfig.Username ||
      !openListConfig.Password
    ) {
      return NextResponse.json({ error: 'OpenList 未配置或未啟用' }, { status: 400 });
    }

    const rootPath = openListConfig.RootPath || '/';
    const folderPath = `${rootPath}${rootPath.endsWith('/') ? '' : '/'}${folderName}`;
    const filePath = `${folderPath}/${fileName}`;

    const client = new OpenListClient(
      openListConfig.URL,
      openListConfig.Username,
      openListConfig.Password
    );

    // 獲取文件的播放鏈接
    const fileResponse = await client.getFile(filePath);

    if (fileResponse.code !== 200 || !fileResponse.data.raw_url) {
      console.error('[OpenList Play] 獲取播放URL失敗:', {
        fileName,
        code: fileResponse.code,
        message: fileResponse.message,
      });
      return NextResponse.json(
        { error: '獲取播放鏈接失敗' },
        { status: 500 }
      );
    }

    // 返回重定向到真實播放 URL
    return NextResponse.redirect(fileResponse.data.raw_url);
  } catch (error) {
    console.error('獲取播放鏈接失敗:', error);
    return NextResponse.json(
      { error: '獲取失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
