// 自動匹配 API 路由
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getDanmakuApiBaseUrl } from '@/lib/danmaku/config';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fileName } = body;

    if (!fileName) {
      return NextResponse.json(
        {
          errorCode: -1,
          success: false,
          errorMessage: '缺少文件名參數',
          isMatched: false,
          matches: [],
        },
        { status: 400 }
      );
    }

    // 從數據庫讀取彈幕配置
    const config = await getConfig();
    const baseUrl = getDanmakuApiBaseUrl(config.SiteConfig);

    const apiUrl = `${baseUrl}/api/v2/match`;

    // 添加超時控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 10秒超時

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileName }),
        signal: controller.signal,
        keepalive: true,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      return NextResponse.json(data);
    } catch (fetchError) {
      clearTimeout(timeoutId);

      // 如果是超時錯誤，返回更友好的錯誤信息
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        throw new Error('彈幕服務器請求超時，請稍後重試');
      }

      throw fetchError;
    }
  } catch (error) {
    console.error('自動匹配代理錯誤:', error);
    return NextResponse.json(
      {
        errorCode: -1,
        success: false,
        errorMessage: error instanceof Error ? error.message : '匹配失敗',
        isMatched: false,
        matches: [],
      },
      { status: 500 }
    );
  }
}
