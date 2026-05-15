import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { NETDISK_UC_SOURCE } from '@/lib/netdisk/source';
import { listUCShareVideos } from '@/lib/netdisk/uc.client';
import { createUCNetdiskSession } from '@/lib/netdisk/uc-session-cache';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: '未登錄' }, { status: 401 });
    }
    if (!(await hasFeaturePermission(authInfo.username, 'netdisk_temp_play'))) {
      return NextResponse.json({ error: '無權限使用臨時播放' }, { status: 403 });
    }

    const { shareUrl, passcode, title } = await request.json();
    if (!shareUrl) {
      return NextResponse.json({ error: '分享鏈接不能為空' }, { status: 400 });
    }

    const config = await getConfig();
    const ucConfig = config.NetDiskConfig?.UC;
    if (!ucConfig?.Enabled || !ucConfig.Cookie) {
      return NextResponse.json({ error: 'UC網盤未配置或未啟用' }, { status: 400 });
    }

    const result = await listUCShareVideos(shareUrl, ucConfig.Cookie, passcode || '');
    const session = createUCNetdiskSession({
      title: title || result.title,
      shareUrl,
      passcode,
      shareId: result.shareId,
      shareToken: result.shareToken,
      files: result.files,
    });

    return NextResponse.json({
      success: true,
      source: NETDISK_UC_SOURCE,
      id: session.id,
      title: title || result.title,
      fileCount: result.files.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '立即播放失敗' },
      { status: 500 }
    );
  }
}
