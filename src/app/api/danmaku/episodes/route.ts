// 獲取劇集列表 API 路由
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getDanmakuApiBaseUrl } from '@/lib/danmaku/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const animeId = searchParams.get('animeId');

    if (!animeId) {
      return NextResponse.json(
        {
          errorCode: -1,
          success: false,
          errorMessage: '缺少動漫ID參數',
          bangumi: {
            bangumiId: '',
            animeTitle: '',
            episodes: [],
          },
        },
        { status: 400 }
      );
    }

    // 從數據庫讀取彈幕配置
    const config = await getConfig();
    const baseUrl = getDanmakuApiBaseUrl(config.SiteConfig);

    const apiUrl = `${baseUrl}/api/v2/bangumi/${animeId}`;

    // 添加超時控制和重試機制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 10秒超時

    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        // 添加 keepalive 避免連接被重置
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
    console.error('獲取劇集列表代理錯誤:', error);
    return NextResponse.json(
      {
        errorCode: -1,
        success: false,
        errorMessage:
          error instanceof Error ? error.message : '獲取劇集列表失敗',
        bangumi: {
          bangumiId: '',
          animeTitle: '',
          episodes: [],
        },
      },
      { status: 500 }
    );
  }
}
