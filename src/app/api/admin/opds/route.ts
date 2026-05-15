import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { BookSource, BookSourceCapabilities } from '@/lib/book.types';
import { db } from '@/lib/db';
import { opdsClient } from '@/lib/opds.client';

export const runtime = 'nodejs';

interface TestSourceInput {
  id?: string;
  name?: string;
  url?: string;
  enabled?: boolean;
  authMode?: 'none' | 'basic' | 'header';
  username?: string;
  password?: string;
  headerName?: string;
  headerValue?: string;
  searchTemplate?: string;
  preferFormat?: Array<'epub' | 'pdf'>;
  language?: string;
}

async function ensureAdmin(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (authInfo.username !== process.env.USERNAME) {
    const userInfo = await db.getUserInfoV2(authInfo.username);
    if (!userInfo || (userInfo.role !== 'admin' && userInfo.role !== 'owner') || userInfo.banned) {
      return NextResponse.json({ error: '權限不足' }, { status: 401 });
    }
  }

  return authInfo.username;
}

async function detectCapabilitiesFromSource(source: BookSource): Promise<BookSourceCapabilities> {
  try {
    const result = await opdsClient.getCatalogFromSource(source);
    return {
      searchSupported: !!source.searchTemplate || result.searchHref !== undefined,
      catalogSupported: result.navigation.length > 0 || result.entries.length > 0,
      searchMode: result.searchHref ? 'opds' : source.searchTemplate ? 'template' : 'disabled',
      catalogMode: result.navigation.length > 0 ? 'navigation' : result.entries.length > 0 ? 'flat' : 'disabled',
      acquisitionTypes: Array.from(new Set(result.entries.flatMap((item) => item.acquisitionLinks.map((link) => link.type)))),
      lastCheckedAt: Date.now(),
    };
  } catch (error) {
    return {
      searchSupported: !!source.searchTemplate,
      catalogSupported: false,
      searchMode: source.searchTemplate ? 'template' : 'disabled',
      catalogMode: 'disabled',
      acquisitionTypes: [],
      lastCheckedAt: Date.now(),
      lastError: error instanceof Error ? error.message : '測試失敗',
    };
  }
}

export async function POST(request: NextRequest) {
  const ensured = await ensureAdmin(request);
  if (ensured instanceof NextResponse) return ensured;

  try {
    const body = await request.json();
    const inputSources = (body?.Sources || []) as TestSourceInput[];
    if (!Array.isArray(inputSources) || inputSources.length === 0) {
      return NextResponse.json({ success: false, message: '請至少填寫一個 OPDS 書源' }, { status: 400 });
    }

    const sources: BookSource[] = inputSources
      .filter((item) => item?.url?.trim())
      .map((item, index) => ({
        id: item.id?.trim() || `source_${index + 1}`,
        name: item.name?.trim() || `書源 ${index + 1}`,
        url: (item.url || '').trim(),
        enabled: item.enabled !== false,
        authMode: item.authMode || 'none',
        username: item.username?.trim() || '',
        password: item.password || '',
        headerName: item.headerName?.trim() || '',
        headerValue: item.headerValue || '',
        searchTemplate: item.searchTemplate?.trim() || '',
        preferFormat: item.preferFormat || ['epub', 'pdf'],
        language: item.language?.trim() || '',
      }));

    if (sources.length === 0) {
      return NextResponse.json({ success: false, message: '沒有可測試的有效書源地址' }, { status: 400 });
    }

    const results = await Promise.all(
      sources.map(async (source) => ({
        id: source.id,
        name: source.name,
        url: source.url,
        capability: await detectCapabilitiesFromSource(source),
      }))
    );

    const successCount = results.filter((item) => item.capability.catalogSupported || item.capability.searchSupported).length;
    return NextResponse.json({
      success: successCount > 0,
      message: `測試完成，${successCount}/${results.length} 個書源可用`,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : '測試連接失敗',
      },
      { status: 400 }
    );
  }
}
