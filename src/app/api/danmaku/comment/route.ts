// 獲取彈幕 API 路由
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getDanmakuApiBaseUrl } from '@/lib/danmaku/config';

export const runtime = 'nodejs';

// 解析彈幕 XML 為 JSON
function parseXmlDanmaku(xmlText: string): Array<{ p: string; m: string; cid: number }> {
  const comments: Array<{ p: string; m: string; cid: number }> = [];

  // 使用正則表達式提取所有 <d> 標籤
  const dTagRegex = /<d\s+p="([^"]+)"[^>]*>([^<]*)<\/d>/g;
  let match;

  while ((match = dTagRegex.exec(xmlText)) !== null) {
    const p = match[1];
    const m = match[2];

    // 從 p 屬性中提取 cid（彈幕ID）
    const pParts = p.split(',');
    const cid = pParts[7] ? parseInt(pParts[7]) : 0;

    comments.push({
      p,
      m,
      cid,
    });
  }

  return comments;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const episodeId = searchParams.get('episodeId');
    const url = searchParams.get('url');

    // 至少需要一個參數
    if (!episodeId && !url) {
      return NextResponse.json(
        {
          count: 0,
          comments: [],
        },
        { status: 400 }
      );
    }

    // 從數據庫讀取彈幕配置
    const config = await getConfig();
    const baseUrl = getDanmakuApiBaseUrl(config.SiteConfig);

    let apiUrl: string;

    if (episodeId) {
      // 通過劇集 ID 獲取彈幕 - 使用 XML 格式
      apiUrl = `${baseUrl}/api/v2/comment/${episodeId}?format=xml`;
    } else {
      // 通過視頻 URL 獲取彈幕 - 使用 XML 格式
      apiUrl = `${baseUrl}/api/v2/comment?url=${encodeURIComponent(url!)}&format=xml`;
    }

    // 添加超時控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2分鐘超時

    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/xml, text/xml',
        },
        signal: controller.signal,
        keepalive: true,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // 獲取 XML 文本
      const xmlText = await response.text();

      // 解析 XML 為 JSON
      const comments = parseXmlDanmaku(xmlText);

      return NextResponse.json({
        count: comments.length,
        comments,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);

      // 如果是超時錯誤，返回更友好的錯誤信息
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        throw new Error('彈幕服務器請求超時，請稍後重試');
      }

      throw fetchError;
    }
  } catch (error) {
    console.error('獲取彈幕代理錯誤:', error);
    return NextResponse.json(
      {
        count: 0,
        comments: [],
      },
      { status: 500 }
    );
  }
}
