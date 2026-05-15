/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

// GET - 獲取歌單中的所有歌曲
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
      return NextResponse.json({ error: '無權限訪問此歌單' }, { status: 403 });
    }

    const songs = await db.getPlaylistSongs(playlistId);

    return NextResponse.json({ songs });
  } catch (error) {
    console.error('GET /api/music/playlists/songs error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - 添加歌曲到歌單
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
    const { playlistId, song } = body;

    if (!playlistId) {
      return NextResponse.json(
        { error: '歌單ID不能為空' },
        { status: 400 }
      );
    }

    if (!song || !song.platform || !song.id || !song.name || !song.artist) {
      return NextResponse.json(
        { error: '歌曲信息不完整' },
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

    // 檢查歌曲是否已在歌單中
    const exists = await db.isSongInPlaylist(playlistId, song.platform, song.id);
    if (exists) {
      return NextResponse.json(
        { error: '歌曲已在歌單中' },
        { status: 400 }
      );
    }

    await db.addSongToPlaylist(playlistId, {
      platform: song.platform,
      id: song.id,
      name: song.name,
      artist: song.artist,
      album: song.album,
      pic: song.pic,
      duration: song.duration || 0,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/music/playlists/songs error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - 從歌單中移除歌曲
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
    const platform = searchParams.get('platform');
    const songId = searchParams.get('songId');

    if (!playlistId || !platform || !songId) {
      return NextResponse.json(
        { error: '參數不完整' },
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

    await db.removeSongFromPlaylist(playlistId, platform, songId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/music/playlists/songs error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
