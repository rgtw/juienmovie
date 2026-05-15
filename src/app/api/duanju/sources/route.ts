/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { getDuanjuSources } from '@/lib/duanju';

export const runtime = 'nodejs';

/**
 * 獲取包含短劇分類的視頻源列表
 */
export async function GET() {
  try {
    const sources = await getDuanjuSources();
    const cacheTime = await getCacheTime();

    return NextResponse.json(
      {
        code: 200,
        message: '獲取成功',
        data: sources,
      },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        },
      }
    );
  } catch (error) {
    console.error('獲取短劇視頻源失敗:', error);
    return NextResponse.json(
      {
        code: 500,
        message: '獲取短劇視頻源失敗',
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
