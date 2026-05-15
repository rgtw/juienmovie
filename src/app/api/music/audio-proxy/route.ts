/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';
import { OpenListClient } from '@/lib/openlist.client';

export const runtime = 'nodejs';

// 獲取 OpenList 客戶端
async function getOpenListClient(): Promise<OpenListClient | null> {
  const config = await getConfig();
  const musicConfig = config?.MusicConfig;

  if (!musicConfig?.OpenListCacheEnabled) {
    return null;
  }

  const url = musicConfig.OpenListCacheURL;
  const username = musicConfig.OpenListCacheUsername;
  const password = musicConfig.OpenListCachePassword;

  if (!url || !username || !password) {
    return null;
  }

  return new OpenListClient(url, username, password);
}

// 代理OpenList緩存的音頻文件
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'music', '無權限訪問音樂功能');
    if (authResult instanceof NextResponse) return authResult;
    const { searchParams } = new URL(request.url);
    const platform = searchParams.get('platform');
    const id = searchParams.get('id');
    const quality = searchParams.get('quality');

    if (!platform || !id || !quality) {
      return NextResponse.json(
        { error: '缺少必要參數: platform, id, quality' },
        { status: 400 }
      );
    }

    // 獲取OpenList客戶端
    const openListClient = await getOpenListClient();
    if (!openListClient) {
      return NextResponse.json(
        { error: 'OpenList未配置或未啟用' },
        { status: 503 }
      );
    }

    // 獲取配置
    const config = await getConfig();
    const cachePath = config?.MusicConfig?.OpenListCachePath || '/music-cache';

    // 構建音頻文件路徑
    const audioPath = `${cachePath}/${platform}/audio/${id}-${quality}.mp3`;

    // 獲取文件信息
    const fileResponse = await openListClient.getFile(audioPath);

    if (fileResponse.code !== 200 || !fileResponse.data?.raw_url) {
      return NextResponse.json(
        { error: '音頻文件未找到' },
        { status: 404 }
      );
    }

    // 檢查是否有 Range 請求頭
    const range = request.headers.get('range');
    const ifNoneMatch = request.headers.get('if-none-match');
    const ifModifiedSince = request.headers.get('if-modified-since');

    // 生成基於文件路徑的 ETag
    const generatedETag = `"${Buffer.from(audioPath).toString('base64')}"`;

    // 如果客戶端發送了 If-None-Match，檢查是否匹配
    if (ifNoneMatch && ifNoneMatch === generatedETag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          'ETag': generatedETag,
        },
      });
    }

    // 構建上游請求頭
    const upstreamHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    };

    // 如果有 Range 請求，轉發給上游
    if (range) {
      upstreamHeaders['Range'] = range;
    }

    // 轉發條件請求頭到上游
    if (ifNoneMatch) {
      upstreamHeaders['If-None-Match'] = ifNoneMatch;
    }
    if (ifModifiedSince) {
      upstreamHeaders['If-Modified-Since'] = ifModifiedSince;
    }

    // 從OpenList獲取音頻流
    const response = await fetch(fileResponse.data.raw_url, {
      headers: upstreamHeaders,
    });

    // 如果上游返回 304 Not Modified，直接返回 304
    if (response.status === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          'ETag': generatedETag,
        },
      });
    }

    if (!response.ok && response.status !== 206) {
      return NextResponse.json(
        { error: '獲取音頻失敗' },
        { status: response.status }
      );
    }

    // 獲取響應頭
    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const contentLength = response.headers.get('content-length');
    const contentRange = response.headers.get('content-range');
    const acceptRanges = response.headers.get('accept-ranges');
    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');

    // 創建響應頭 - 設置永久緩存
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable', // 永久緩存（1年）
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': acceptRanges || 'bytes',
      'X-Cache-Source': 'openlist-audio-proxy',
    };

    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }

    // 如果上游返回了 Content-Range，轉發給客戶端
    if (contentRange) {
      headers['Content-Range'] = contentRange;
    }

    // 轉發 ETag 和 Last-Modified 以支持瀏覽器緩存驗證
    if (etag) {
      headers['ETag'] = etag;
    }
    if (lastModified) {
      headers['Last-Modified'] = lastModified;
    }

    // 如果上游沒有提供 ETag，使用生成的 ETag
    if (!etag) {
      headers['ETag'] = generatedETag;
    }

    // 返回音頻流，保持原始狀態碼（200 或 206）
    return new NextResponse(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    console.error('代理OpenList音頻失敗:', error);
    return NextResponse.json(
      {
        error: '代理請求失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
