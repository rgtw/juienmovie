/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

// GET - 獲取用戶的所有歌單
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'music', '無權限訪問音樂功能');
    if (authResult instanceof NextResponse) return authResult;
    // 從 cookie 獲取用戶信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 檢查用戶狀態
    if (authInfo.username !== process.env.USERNAME) {
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2) {
        return NextResponse.json({ error: '用戶不存在' }, { status: 401 });
      }
      if (userInfoV2.banned) {
        return NextResponse.json({ error: '用戶已被封禁' }, { status: 401 });
      }
    }

    const playlists = await db.getUserMusicPlaylists(authInfo.username);

    return NextResponse.json({ playlists });
  } catch (error) {
    console.error('GET /api/music/playlists error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - 創建新歌單
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'music', '無權限訪問音樂功能');
    if (authResult instanceof NextResponse) return authResult;
    // 從 cookie 獲取用戶信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 檢查用戶狀態
    if (authInfo.username !== process.env.USERNAME) {
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2) {
        return NextResponse.json({ error: '用戶不存在' }, { status: 401 });
      }
      if (userInfoV2.banned) {
        return NextResponse.json({ error: '用戶已被封禁' }, { status: 401 });
      }
    }

    const body = await request.json();
    const { name, description } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: '歌單名稱不能為空' },
        { status: 400 }
      );
    }

    const playlistId = randomUUID();

    await db.createMusicPlaylist(authInfo.username, {
      id: playlistId,
      name: name.trim(),
      description: description?.trim(),
    });

    const playlist = await db.getMusicPlaylist(playlistId);

    return NextResponse.json({ playlist });
  } catch (error) {
    console.error('POST /api/music/playlists error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT - 更新歌單信息
export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'music', '無權限訪問音樂功能');
    if (authResult instanceof NextResponse) return authResult;
    // 從 cookie 獲取用戶信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 檢查用戶狀態
    if (authInfo.username !== process.env.USERNAME) {
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2) {
        return NextResponse.json({ error: '用戶不存在' }, { status: 401 });
      }
      if (userInfoV2.banned) {
        return NextResponse.json({ error: '用戶已被封禁' }, { status: 401 });
      }
    }

    const body = await request.json();
    const { playlistId, name, description, cover } = body;

    if (!playlistId) {
      return NextResponse.json(
        { error: '歌單ID不能為空' },
        { status: 400 }
      );
    }

    // 檢查歌單是否存在且屬於當前用戶
    const playlist = await db.getMusicPlaylist(playlistId);
    if (!playlist) {
      return NextResponse.json({ error: '歌單不存在' }, { status: 404 });
    }
    if (playlist.username !== authInfo.username) {
      return NextResponse.json({ error: '無權限操作此歌單' }, { status: 403 });
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim();
    if (cover !== undefined) updates.cover = cover;

    await db.updateMusicPlaylist(playlistId, updates);

    const updatedPlaylist = await db.getMusicPlaylist(playlistId);

    return NextResponse.json({ playlist: updatedPlaylist });
  } catch (error) {
    console.error('PUT /api/music/playlists error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - 刪除歌單
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'music', '無權限訪問音樂功能');
    if (authResult instanceof NextResponse) return authResult;
    // 從 cookie 獲取用戶信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 檢查用戶狀態
    if (authInfo.username !== process.env.USERNAME) {
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2) {
        return NextResponse.json({ error: '用戶不存在' }, { status: 401 });
      }
      if (userInfoV2.banned) {
        return NextResponse.json({ error: '用戶已被封禁' }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const playlistId = searchParams.get('playlistId');

    if (!playlistId) {
      return NextResponse.json(
        { error: '歌單ID不能為空' },
        { status: 400 }
      );
    }

    // 檢查歌單是否存在且屬於當前用戶
    const playlist = await db.getMusicPlaylist(playlistId);
    if (!playlist) {
      return NextResponse.json({ error: '歌單不存在' }, { status: 404 });
    }
    if (playlist.username !== authInfo.username) {
      return NextResponse.json({ error: '無權限操作此歌單' }, { status: 403 });
    }

    await db.deleteMusicPlaylist(playlistId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/music/playlists error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
