import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { API_CONFIG, getAvailableApiSites, getConfig } from '@/lib/config';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

interface CmsClassResponse {
  class?: Array<{
    type_id: string | number;
    type_name: string;
  }>;
}

/**
 * 獲取指定視頻源的分類列表
 */
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sourceKey = searchParams.get('source');

  if (!sourceKey) {
    return NextResponse.json(
      { error: '缺少參數: source' },
      { status: 400 }
    );
  }

  try {
    const config = await getConfig();
    const apiSites = await getAvailableApiSites(authInfo.username);
    const targetSite = apiSites.find((site) => site.key === sourceKey);

    if (!targetSite) {
      return NextResponse.json(
        { error: `未找到指定的視頻源: ${sourceKey}` },
        { status: 404 }
      );
    }

    // 請求分類列表
    const classUrl = `${targetSite.api}?ac=list`;
    const classResponse = await fetch(classUrl, {
      headers: API_CONFIG.search.headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!classResponse.ok) {
      throw new Error('獲取分類列表失敗');
    }

    const classData: CmsClassResponse = await classResponse.json();

    if (!classData.class || !Array.isArray(classData.class)) {
      return NextResponse.json({
        categories: [],
      });
    }

    // 應用黃色過濾器規則
    let filteredCategories = classData.class;
    if (!config.SiteConfig.DisableYellowFilter) {
      filteredCategories = classData.class.filter((item) => {
        const typeName = item.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }

    return NextResponse.json({
      categories: filteredCategories.map((item) => ({
        id: item.type_id.toString(),
        name: item.type_name,
      })),
    });
  } catch (error) {
    console.error('Failed to get categories:', error);
    return NextResponse.json(
      { error: '獲取分類列表失敗' },
      { status: 500 }
    );
  }
}
