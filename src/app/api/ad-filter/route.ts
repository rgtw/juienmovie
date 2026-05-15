import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // 禁用緩存

/**
 * GET /api/ad-filter
 * 獲取自定義去廣告代碼配置（公開接口，無需認證）
 * 支持兩種模式：
 * - 不帶參數：只返回版本號，用於檢查更新
 * - ?full=true：返回完整代碼和版本號
 */
export async function GET(request: Request) {
  try {
    const config = await getConfig();
    const { searchParams } = new URL(request.url);
    const full = searchParams.get('full') === 'true';

    const version = config.SiteConfig?.CustomAdFilterVersion || 0;

    if (full) {
      // 返回完整代碼和版本號
      return NextResponse.json({
        code: config.SiteConfig?.CustomAdFilterCode || '',
        version,
      });
    } else {
      // 只返回版本號
      return NextResponse.json({
        version,
      });
    }
  } catch (error) {
    console.error('獲取去廣告代碼配置失敗:', error);
    return NextResponse.json(
      { error: '獲取配置失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
