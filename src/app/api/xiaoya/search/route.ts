/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * GET /api/xiaoya/search?keyword=<keyword>&type=<type>
 * 搜索小雅視頻（使用小雅的網頁搜索引擎）
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'xiaoya', '無權限訪問小雅');
    if (authResult instanceof NextResponse) return authResult;
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get('keyword');
    const type = searchParams.get('type') || 'video'; // video, music, ebook, all

    if (!keyword) {
      return NextResponse.json({ error: '缺少搜索關鍵詞' }, { status: 400 });
    }

    const config = await getConfig();
    const xiaoyaConfig = config.XiaoyaConfig;

    if (
      !xiaoyaConfig ||
      !xiaoyaConfig.Enabled ||
      !xiaoyaConfig.ServerURL
    ) {
      return NextResponse.json({ error: '小雅未配置或未啟用' }, { status: 400 });
    }

    // 使用小雅的搜索引擎
    const searchUrl = `${xiaoyaConfig.ServerURL}/search?box=${encodeURIComponent(keyword)}&type=${type}&url=`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`搜索請求失敗: ${response.status}`);
    }

    const html = await response.text();

    // 解析 HTML 中的鏈接
    // 格式: <a href=/path/to/file>path/to/file</a>
    const linkRegex = /<a href=([^>]+)>([^<]+)<\/a>/g;
    const results: Array<{ name: string; path: string }> = [];

    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      let path = match[1];
      const displayText = match[2];

      // 跳過返回首頁和頻道鏈接
      if (path === '/' || path.startsWith('http')) {
        continue;
      }

      // URL 解碼路徑
      try {
        path = decodeURIComponent(path);
      } catch (e) {
        console.error('URL 解碼失敗:', path, e);
      }

      // 提取文件名（路徑的最後一部分）
      const pathParts = displayText.split('/');
      const fileName = pathParts[pathParts.length - 1];

      results.push({
        name: fileName,
        path: path,
      });
    }

    return NextResponse.json({
      videos: results,
      total: results.length,
    });
  } catch (error) {
    console.error('小雅搜索失敗:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
