/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

// 代理音頻流
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'music', '無權限訪問音樂功能');
    if (authResult instanceof NextResponse) return authResult;
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url) {
      return NextResponse.json(
        { error: '缺少 url 參數' },
        { status: 400 }
      );
    }

    // 安全檢查：只允許代理音樂平臺的音頻和圖片 CDN
    const allowedDomains = [
      'sycdn.kuwo.cn',
      'kwcdn.kuwo.cn',
      'img1.kwcdn.kuwo.cn',
      'img2.kwcdn.kuwo.cn',
      'img3.kwcdn.kuwo.cn',
      'img4.kwcdn.kuwo.cn',
      'music.163.com',
      'y.qq.com',
      'ws.stream.qqmusic.qq.com',
      'isure.stream.qqmusic.qq.com',
      'dl.stream.qqmusic.qq.com',
    ];

    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch {
      return NextResponse.json(
        { error: '無效的 URL' },
        { status: 400 }
      );
    }

    const isAllowed = allowedDomains.some(domain =>
      urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
    );

    if (!isAllowed) {
      console.warn(`拒絕代理音頻請求: ${urlObj.hostname}`);
      return NextResponse.json(
        { error: '不允許的目標域名' },
        { status: 403 }
      );
    }

    // 檢查是否有 Range 請求頭
    const range = request.headers.get('range');

    // 構建上游請求頭
    const upstreamHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'http://www.kuwo.cn/',
    };

    // 如果有 Range 請求，轉發給上游
    if (range) {
      upstreamHeaders['Range'] = range;
    }

    // 發起請求獲取音頻流
    const response = await fetch(url, {
      headers: upstreamHeaders,
    });

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

    // 創建響應頭
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': acceptRanges || 'bytes',
    };

    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }

    // 如果上游返回了 Content-Range，轉發給客戶端
    if (contentRange) {
      headers['Content-Range'] = contentRange;
    }

    // 返回音頻流，保持原始狀態碼（200 或 206）
    return new NextResponse(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    console.error('代理音頻失敗:', error);
    return NextResponse.json(
      {
        error: '代理請求失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
