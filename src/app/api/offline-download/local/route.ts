/**
 * 本地下載視頻播放代理 API
 */

import * as fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import * as path from 'path';

import { getAuthInfoFromCookie } from '@/lib/auth';

// 檢查是否啟用離線下載功能
const OFFLINE_DOWNLOAD_ENABLED = process.env.NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD === 'true';
const OFFLINE_DOWNLOAD_DIR = process.env.OFFLINE_DOWNLOAD_DIR || '/data';

/**
 * 檢查用戶權限（僅管理員和站長）
 */
function checkPermission(request: NextRequest): boolean {
  if (!OFFLINE_DOWNLOAD_ENABLED) {
    return false;
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return false;
  }

  // 只有管理員和站長可以訪問
  return authInfo.role === 'owner' || authInfo.role === 'admin';
}

/**
 * GET - 代理本地視頻文件
 */
export async function GET(request: NextRequest) {
  if (!checkPermission(request)) {
    return NextResponse.json({ error: '無權限' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const videoId = searchParams.get('videoId');
    const episodeIndex = searchParams.get('episodeIndex');
    const file = searchParams.get('file'); // 'playlist.m3u8', 'segment_00001.ts', 'key.key' 等

    if (!source || !videoId || episodeIndex === null || !file) {
      return NextResponse.json({ error: '參數不完整' }, { status: 400 });
    }

    // 構建文件路徑
    const downloadDir = path.join(
      OFFLINE_DOWNLOAD_DIR,
      source,
      videoId,
      `ep${parseInt(episodeIndex) + 1}`
    );
    const filePath = path.join(downloadDir, file);

    // 安全檢查：確保文件路徑在下載目錄內
    const normalizedFilePath = path.normalize(filePath);
    const normalizedDownloadDir = path.normalize(downloadDir);
    if (!normalizedFilePath.startsWith(normalizedDownloadDir)) {
      return NextResponse.json({ error: '非法路徑' }, { status: 403 });
    }

    // 檢查文件是否存在
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }

    // 讀取文件
    const fileBuffer = fs.readFileSync(filePath);

    // 如果是 m3u8 文件，需要修改內容使片段指向代理地址
    if (file === 'playlist.m3u8') {
      let content = fileBuffer.toString('utf-8');
      const lines = content.split('\n');
      const modifiedLines: string[] = [];

      for (const line of lines) {
        const trimmedLine = line.trim();

        // 處理 Key URI
        if (trimmedLine.startsWith('#EXT-X-KEY:')) {
          const modifiedLine = trimmedLine.replace(
            /URI="([^"]+)"/,
            `URI="/api/offline-download/local?source=${source}&videoId=${videoId}&episodeIndex=${episodeIndex}&file=$1"`
          );
          modifiedLines.push(modifiedLine);
        }
        // 處理 ts 片段
        else if (trimmedLine && !trimmedLine.startsWith('#')) {
          modifiedLines.push(
            `/api/offline-download/local?source=${source}&videoId=${videoId}&episodeIndex=${episodeIndex}&file=${trimmedLine}`
          );
        } else {
          modifiedLines.push(line);
        }
      }

      content = modifiedLines.join('\n');

      return new NextResponse(content, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // 其他文件（ts、key 等）直接返回
    const contentType = file.endsWith('.ts')
      ? 'video/mp2t'
      : file.endsWith('.key')
        ? 'application/octet-stream'
        : 'application/octet-stream';

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('代理本地文件失敗:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '代理失敗' },
      { status: 500 }
    );
  }
}
