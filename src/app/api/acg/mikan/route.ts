/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { parseStringPromise } from 'xml2js';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getMagnetBaseUrl, universalMagnetFetch } from '@/lib/magnet.client';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

const pickText = (value: any): string => {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value);
};

/**
 * POST /api/acg/mikan
 * 搜索 Mikan RSS（僅管理員和站長可用，不支持分頁）
 */
export async function POST(req: NextRequest) {
  try {
    // 檢查權限
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo?.username || !(await hasFeaturePermission(authInfo.username, 'magnet_search'))) {
      return NextResponse.json(
        { error: '無權限訪問' },
        { status: 403 }
      );
    }

    const { keyword, page = 1 } = await req.json();

    if (!keyword || typeof keyword !== 'string') {
      return NextResponse.json(
        { error: '搜索關鍵詞不能為空' },
        { status: 400 }
      );
    }

    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
      return NextResponse.json(
        { error: '搜索關鍵詞不能為空' },
        { status: 400 }
      );
    }

    // 驗證頁碼（Mikan RSS 不支持分頁，這裡仍接收 page 以保持接口一致）
    const pageNum = parseInt(String(page), 10);
    if (isNaN(pageNum) || pageNum < 1) {
      return NextResponse.json(
        { error: '頁碼必須是大於0的整數' },
        { status: 400 }
      );
    }

    if (pageNum > 1) {
      return NextResponse.json({
        keyword: trimmedKeyword,
        page: pageNum,
        total: 0,
        items: [],
      });
    }

    const config = await getConfig();
    const searchBaseUrl = getMagnetBaseUrl(
      'https://mikanani.me',
      config.SiteConfig.MagnetMikanReverseProxy
    );
    const searchUrl = `${searchBaseUrl}/RSS/Search?searchstr=${encodeURIComponent(trimmedKeyword)}`;

    const response = await universalMagnetFetch(searchUrl, config.SiteConfig.MagnetProxy, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Mikan API 請求失敗: ${response.status}`);
    }

    const xmlData = await response.text();
    const parsed = await parseStringPromise(xmlData);

    if (!parsed?.rss?.channel?.[0]?.item) {
      return NextResponse.json({
        keyword: trimmedKeyword,
        page: pageNum,
        total: 0,
        items: [],
      });
    }

    const items = parsed.rss.channel[0].item;

    const results = items.map((item: any) => {
      const title = pickText(item.title);
      const link = pickText(item.link);
      const guid = pickText(item.guid) || link || `${title}-${pickText(item.torrent?.[0]?.pubDate)}`;
      const pubDate =
        pickText(item.pubDate) ||
        pickText(item.torrent?.[0]?.pubDate) ||
        pickText(item['dc:date']);

      const description =
        pickText(item.description) ||
        pickText(item['content:encoded']) ||
        '';

      const torrentUrl =
        pickText(item.enclosure?.[0]?.$?.url) ||
        pickText(item.enclosure?.[0]?.$?.href) ||
        '';

      // 提取描述中的圖片（如果有）
      let images: string[] = [];
      if (description) {
        const imgMatches = description.match(/src="([^"]+)"/g);
        if (imgMatches) {
          images = imgMatches.map((match: string) => {
            const urlMatch = match.match(/src="([^"]+)"/);
            return urlMatch ? urlMatch[1] : '';
          }).filter(Boolean);
        }
      }

      return {
        title,
        link,
        guid,
        pubDate,
        torrentUrl,
        description,
        images,
      };
    });

    return NextResponse.json({
      keyword: trimmedKeyword,
      page: pageNum,
      total: results.length,
      items: results,
    });
  } catch (error: any) {
    console.error('Mikan 搜索失敗:', error);
    return NextResponse.json(
      { error: error.message || '搜索失敗' },
      { status: 500 }
    );
  }
}
