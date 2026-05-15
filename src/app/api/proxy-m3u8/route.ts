import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { validateProxyUrlServerSide } from '@/lib/server/ssrf';

export const runtime = 'nodejs';

export const maxDuration = 60; // 設置最大執行時間為 60 秒

/**
 * M3U8 代理接口
 * 用於外部播放器訪問,會執行去廣告邏輯並處理相對鏈接
 * GET /api/proxy-m3u8?url=<原始m3u8地址>&source=<播放源>&token=<鑑權token>
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const m3u8Url = searchParams.get('url');
    const source = searchParams.get('source') || '';
    const token = searchParams.get('token');

    // Token 鑑權：如果環境變量設置了 token，則必須驗證
    const envToken = process.env.NEXT_PUBLIC_PROXY_M3U8_TOKEN;
    if (envToken && envToken.trim() !== '') {
      if (!token || token !== envToken) {
        return NextResponse.json(
          { error: '無效的訪問令牌' },
          { status: 401 }
        );
      }
    }

    if (!m3u8Url) {
      return NextResponse.json(
        { error: '缺少必要參數: url' },
        { status: 400 }
      );
    }

    const DIRECT_PLAY_SOURCE = 'directplay';
    // 安全校驗：防 SSRF / 域名重綁定，只允許合法的公網 URL。對所有經過 proxy-m3u8 的請求強制校驗，不僅限於 directplay
    const isSafeUrl = await validateProxyUrlServerSide(m3u8Url);
    if (!isSafeUrl) {
      return NextResponse.json(
        { error: 'Proxy request to local or invalid network is forbidden' },
        { status: 403 }
      );
    }

    // 獲取當前請求的 origin
    // 優先級：SITE_BASE 環境變量 > 從請求頭構建
    let origin = process.env.SITE_BASE;
    if (!origin) {
      // 從請求頭中獲取 Host 和協議
      let host = request.headers.get('host') || request.headers.get('x-forwarded-host');

      // 安全校驗：防 Host 頭注入漏洞 (要求僅包含合法域名或 IP 格式字符)
      if (host && !/^[a-zA-Z0-9.-]+(:\d+)?$/.test(host)) {
        host = null;
      }

      // Fallback：如果以上 Header 無效或未提供，回退到 request.url 獲取
      if (!host) {
        try {
          host = new URL(request.url).host;
        } catch {
          return NextResponse.json({ error: 'Invalid Request Host' }, { status: 400 });
        }
      }

      const proto = request.headers.get('x-forwarded-proto') ||
        (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https');
      origin = `${proto}://${host}`;
    }

    // 獲取原始 m3u8 內容
    const m3u8UrlObj = new URL(m3u8Url);
    const response = await fetch(m3u8Url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': `${m3u8UrlObj.protocol}//${m3u8UrlObj.host}/`,
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: '獲取 m3u8 文件失敗' },
        { status: response.status }
      );
    }

    // 後端 MIME Sniffing: 防禦偽裝成 m3u8 的大文件二進制流
    // 使用白名單策略：只有明確屬於文本/m3u8 類型的才放行解析
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const isTextType = (
      contentType === '' ||                                        // 無 Content-Type 時保守放行（後續有內容校驗兜底）
      contentType.includes('application/vnd.apple.mpegurl') ||     // 標準 m3u8
      contentType.includes('application/x-mpegurl') ||             // 兼容 m3u8
      contentType.includes('audio/mpegurl') ||                     // 兼容 m3u8
      contentType.includes('text/') ||                             // text/plain 等
      contentType.includes('application/json')                     // 部分 API 返回 JSON 格式的錯誤
    );

    if (!isTextType) {
      if (source === DIRECT_PLAY_SOURCE) {
        console.log(`[Proxy-M3U8] 檢測到非文本媒體流 (Content-Type: ${contentType}), 針對 directplay 直鏈代理模式，直接透傳二進制流, URL: ${m3u8Url}`);
        // 構造一個新的 Response 對象用於二進制直接透傳，確保包含了支持跨域的 header
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');

        // 如果源站返回了跨站相關的禁止頭，儘量移除它們
        newHeaders.delete('X-Frame-Options');
        newHeaders.delete('Content-Security-Policy');

        return new NextResponse(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }

      console.warn(`[Proxy-M3U8] 攔截到非文本媒體流 (Content-Type: ${contentType}), 拒絕按文本解析, URL: ${m3u8Url}`);
      return NextResponse.json(
        {
          error: 'Unsupported Media Type',
          details: `The source returned Content-Type "${contentType}", which is not a text m3u8 playlist.`,
          fallbackToDirect: true,
          originalUrl: m3u8Url
        },
        { status: 415, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    let m3u8Content = await response.text();

    // 二次內容校驗：即使 Content-Type 通過了白名單，檢查實際內容是否為有效的 m3u8
    // 有些服務器返回 text/plain 但實際內容是 HTML 錯誤頁或其他格式
    const trimmedContent = m3u8Content.trimStart();
    if (trimmedContent.length > 0 && !trimmedContent.startsWith('#EXTM3U') && !trimmedContent.startsWith('#EXT')) {
      console.warn(`[Proxy-M3U8] 內容校驗失敗：響應體不以 #EXTM3U 或 #EXT 開頭, 可能非有效 m3u8, URL: ${m3u8Url}`);
      // 不直接拒絕（可能是不規範但仍可播放的 m3u8），僅打印警告繼續處理
    }

    // 執行去廣告邏輯
    const config = await getConfig();
    const customAdFilterCode = config.SiteConfig?.CustomAdFilterCode || '';

    if (customAdFilterCode && customAdFilterCode.trim()) {
      try {
        // 移除 TypeScript 類型註解,轉換為純 JavaScript
        const jsCode = customAdFilterCode
          .replace(/(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*([,)])/g, '$1$3')
          .replace(/\)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*\{/g, ') {')
          .replace(/(const|let|var)\s+(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*=/g, '$1 $2 =');

        // 創建並執行自定義函數
        const customFunction = new Function('type', 'm3u8Content',
          jsCode + '\nreturn filterAdsFromM3U8(type, m3u8Content);'
        );
        m3u8Content = customFunction(source, m3u8Content);
      } catch (err) {
        console.error('執行自定義去廣告代碼失敗,使用默認規則:', err);
        // 繼續使用默認規則
        m3u8Content = filterAdsFromM3U8Default(source, m3u8Content);
      }
    } else {
      // 使用默認去廣告規則
      m3u8Content = filterAdsFromM3U8Default(source, m3u8Content);
    }

    // 處理 m3u8 中的相對鏈接
    m3u8Content = resolveM3u8Links(m3u8Content, m3u8Url, source, origin, token || '');

    // 返回處理後的 m3u8 內容
    return new NextResponse(m3u8Content, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('代理 m3u8 失敗:', error);
    return NextResponse.json(
      { error: '代理失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * 默認去廣告規則（服務端版本）
 * 注意：前端 page.tsx 中的 filterAdsFromM3U8 是客戶端側的去廣告邏輯（用於直連模式下由 HLS.js 的自定義 loader 攔截）。
 * 本函數用於代理模式下，在服務端對 m3u8 內容進行去廣告處理後再返回給客戶端。
 * 兩套邏輯需要保持同步更新。
 */
function filterAdsFromM3U8Default(type: string, m3u8Content: string): string {
  if (!m3u8Content) return '';

  // 廣告關鍵字列表
  const adKeywords = [
    'sponsor',
    '/ad/',
    '/ads/',
    'advert',
    'advertisement',
    '/adjump',
    'redtraffic'
  ];

  // 按行分割M3U8內容
  const lines = m3u8Content.split('\n');
  const filteredLines = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 跳過 #EXT-X-DISCONTINUITY 標識
    if (line.includes('#EXT-X-DISCONTINUITY')) {
      i++;
      continue;
    }

    // 如果是 EXTINF 行，檢查下一行 URL 是否包含廣告關鍵字
    if (line.includes('#EXTINF:')) {
      // 檢查下一行 URL 是否包含廣告關鍵字
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const containsAdKeyword = adKeywords.some(keyword =>
          nextLine.toLowerCase().includes(keyword.toLowerCase())
        );

        if (containsAdKeyword) {
          // 跳過 EXTINF 行和 URL 行
          i += 2;
          continue;
        }
      }
    }

    // 保留當前行
    filteredLines.push(line);
    i++;
  }

  return filteredLines.join('\n');
}

/**
 * 將 m3u8 中的相對鏈接轉換為絕對鏈接，並將子 m3u8 鏈接轉為代理鏈接。
 * 此函數僅在代理模式下由服務端調用。
 * - 子 m3u8 鏈接 → 指向 /api/proxy-m3u8（遞歸代理）
 * - ts 分片/密鑰 → directplay 模式指向 /api/proxy/vod/segment（解決 CORS）
 */
function resolveM3u8Links(m3u8Content: string, baseUrl: string, source: string, proxyOrigin: string, token: string): string {
  const lines = m3u8Content.split('\n');
  const resolvedLines = [];

  // 解析基礎URL
  const base = new URL(baseUrl);
  const baseDir = base.href.substring(0, base.href.lastIndexOf('/') + 1);

  let isNextLineUrl = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 處理 EXT-X-KEY 標籤中的 URI
    if (line.startsWith('#EXT-X-KEY:')) {
      // 提取 URI 部分
      const uriMatch = line.match(/URI="([^"]+)"/);
      if (uriMatch && uriMatch[1]) {
        let keyUri = uriMatch[1];

        // 轉換為絕對路徑
        if (!keyUri.startsWith('http://') && !keyUri.startsWith('https://')) {
          if (keyUri.startsWith('/')) {
            keyUri = `${base.protocol}//${base.host}${keyUri}`;
          } else {
            keyUri = new URL(keyUri, baseDir).href;
          }
        }

        // 直鏈播放模式：通過代理訪問密鑰，避免 CORS 問題
        if (source === 'directplay') {
          keyUri = `${proxyOrigin}/api/proxy/vod/segment?url=${encodeURIComponent(keyUri)}&source=directplay`;
        }

        // 替換原來的 URI
        line = line.replace(/URI="[^"]+"/, `URI="${keyUri}"`);
      }
      resolvedLines.push(line);
      continue;
    }

    // 註釋行直接保留
    if (line.startsWith('#')) {
      resolvedLines.push(line);
      // 檢查是否是 EXT-X-STREAM-INF，下一行將是子 m3u8
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        isNextLineUrl = true;
      }
      continue;
    }

    // 空行直接保留
    if (line.trim() === '') {
      resolvedLines.push(line);
      continue;
    }

    // 處理 URL 行
    let url = line.trim();

    // 1. 先轉換為絕對 URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.startsWith('/')) {
        // 以 / 開頭，相對於域名根目錄
        url = `${base.protocol}//${base.host}${url}`;
      } else {
        // 相對於當前目錄
        url = new URL(url, baseDir).href;
      }
    }

    // 2. 檢查是否是子 m3u8，如果是，轉換為代理鏈接
    const isM3u8 = url.includes('.m3u8') || isNextLineUrl;
    if (isM3u8) {
      const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
      url = `${proxyOrigin}/api/proxy-m3u8?url=${encodeURIComponent(url)}${source ? `&source=${encodeURIComponent(source)}` : ''}${tokenParam}`;
    } else if (source === 'directplay') {
      // 直鏈播放模式：通過代理訪問媒體分片（ts/jpeg/png 等），避免 CORS 問題
      url = `${proxyOrigin}/api/proxy/vod/segment?url=${encodeURIComponent(url)}&source=directplay`;
    }

    resolvedLines.push(url);
    isNextLineUrl = false;
  }

  return resolvedLines.join('\n');
}
