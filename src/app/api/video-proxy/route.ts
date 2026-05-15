import { NextResponse } from 'next/server';
import { validateProxyUrlServerSide } from '@/lib/server/ssrf';

export const runtime = 'nodejs';

// 視頻代理接口，支持Range請求
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoUrl = searchParams.get('url');

  if (!videoUrl) {
    return NextResponse.json({ error: 'Missing video URL' }, { status: 400 });
  }

  // 安全校驗：防 SSRF，只允許合法的公網 URL
  const isSafeUrl = await validateProxyUrlServerSide(videoUrl);
  if (!isSafeUrl) {
    return NextResponse.json({ error: 'Proxy request to local or invalid network is forbidden' }, { status: 403 });
  }

  try {
    // 獲取客戶端的Range請求頭
    const range = request.headers.get('range');

    const fetchHeaders: HeadersInit = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8',
      Referer: 'https://movie.douban.com/',
    };

    // 如果客戶端發送了Range請求，轉發給源服務器
    if (range) {
      fetchHeaders['Range'] = range;
    }

    const videoResponse = await fetch(videoUrl, {
      headers: fetchHeaders,
    });

    if (!videoResponse.ok) {
      return NextResponse.json(
        { error: videoResponse.statusText },
        { status: videoResponse.status }
      );
    }

    if (!videoResponse.body) {
      return NextResponse.json(
        { error: 'Video response has no body' },
        { status: 500 }
      );
    }

    // 創建響應頭
    const headers = new Headers();

    // 複製重要的響應頭
    const contentType = videoResponse.headers.get('content-type');
    if (contentType) {
      headers.set('Content-Type', contentType);
    }

    const contentLength = videoResponse.headers.get('content-length');
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }

    const contentRange = videoResponse.headers.get('content-range');
    if (contentRange) {
      headers.set('Content-Range', contentRange);
    }

    const acceptRanges = videoResponse.headers.get('accept-ranges');
    if (acceptRanges) {
      headers.set('Accept-Ranges', acceptRanges);
    }

    // 設置緩存頭
    headers.set('Cache-Control', 'public, max-age=31536000, s-maxage=31536000'); // 緩存1年
    headers.set('CDN-Cache-Control', 'public, s-maxage=31536000');
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=31536000');

    // 返回視頻流，狀態碼根據是否有Range請求決定
    const status = range && contentRange ? 206 : 200;

    return new Response(videoResponse.body, {
      status,
      headers,
    });
  } catch (error) {
    console.error('Error proxying video:', error);
    return NextResponse.json(
      { error: 'Error fetching video' },
      { status: 500 }
    );
  }
}
