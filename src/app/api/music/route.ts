/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';
import { OpenListClient } from '@/lib/openlist.client';

export const runtime = 'nodejs';

// 檢測是否為 Cloudflare 環境
const isCloudflare = process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare';

// 服務器端內存緩存
const serverCache = {
  methodConfigs: new Map<string, { data: any; timestamp: number }>(),
  proxyRequests: new Map<string, { data: any; timestamp: number }>(),
  CACHE_DURATION: 24 * 60 * 60 * 1000, // 24小時緩存
};

// 正在下載的音頻任務追蹤（防止重複下載）
const downloadingTasks = new Map<string, Promise<void>>();

// 獲取音樂服務配置
async function getMusicServiceConfig() {
  const config = await getConfig();
  const musicConfig = config?.MusicConfig;

  const enabled = musicConfig?.Enabled ?? false;
  const baseUrl =
    musicConfig?.BaseUrl ||
    process.env.MUSIC_V2_BASE_URL ||
    '';
  const token = musicConfig?.Token || process.env.MUSIC_V2_TOKEN || '';

  return { enabled, baseUrl, token, musicConfig };
}

// 獲取 OpenList 客戶端
async function getOpenListClient(): Promise<OpenListClient | null> {
  const config = await getConfig();
  const musicConfig = config?.MusicConfig;

  if (!musicConfig?.OpenListCacheEnabled) {
    return null;
  }

  const url = musicConfig.OpenListCacheURL;
  const username = musicConfig.OpenListCacheUsername;
  const password = musicConfig.OpenListCachePassword;

  if (!url || !username || !password) {
    return null;
  }

  return new OpenListClient(url, username, password);
}

// 異步下載音頻文件並上傳到 OpenList
async function cacheAudioToOpenList(
  openListClient: OpenListClient,
  audioUrl: string,
  platform: string,
  songId: string,
  quality: string,
  cachePath: string
): Promise<void> {
  const taskKey = `${platform}-${songId}-${quality}`;

  // 檢查是否已經有任務在下載
  const existingTask = downloadingTasks.get(taskKey);
  if (existingTask) {
    return existingTask;
  }

  // 創建下載任務
  const downloadTask = (async () => {
    try {
      const audioPath = `${cachePath}/${platform}/audio/${songId}-${quality}.mp3`;

      const audioResponse = await fetch(audioUrl);

      if (!audioResponse.ok) {
        console.error('[Music Cache] 下載音頻失敗:', audioResponse.status);
        return;
      }

      const audioBuffer = await audioResponse.arrayBuffer();
      const audioBlob = Buffer.from(audioBuffer);

      const token = await (openListClient as any).getToken();

      const uploadResponse = await fetch(`${(openListClient as any).baseURL}/api/fs/put`, {
        method: 'PUT',
        headers: {
          'Authorization': token,
          'Content-Type': 'audio/mpeg',
          'File-Path': encodeURIComponent(audioPath),
          'As-Task': 'false',
        },
        body: audioBlob,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('[Music Cache] 上傳音頻失敗:', uploadResponse.status, errorText);
        return;
      }
    } catch (error) {
      console.error('[Music Cache] 緩存音頻到 OpenList 失敗:', error);
    } finally {
      downloadingTasks.delete(taskKey);
    }
  })();

  downloadingTasks.set(taskKey, downloadTask);

  return downloadTask;
}

// 檢查並替換音頻 URL 為 OpenList URL
async function replaceAudioUrlsWithOpenList(
  data: any,
  openListClient: OpenListClient | null,
  platform: string,
  quality: string,
  cachePath: string
): Promise<any> {
  // 獲取配置，檢查是否啟用 OpenList 緩存
  const config = await getConfig();
  const cacheEnabled = config?.MusicConfig?.OpenListCacheEnabled ?? false;
  const cacheProxyEnabled = config?.MusicConfig?.OpenListCacheProxyEnabled ?? true;

  // 如果沒有啟用 OpenList 緩存，直接返回原數據
  if (!cacheEnabled || !openListClient || !data?.data) {
    return data;
  }

  // 音樂服務返回的數據結構是 { code: 0, data: { data: [...], total: 1 } }
  // 需要提取內層的 data 數組
  const songsData = data.data.data || data.data;
  const songs = Array.isArray(songsData) ? songsData : [songsData];

  for (const song of songs) {
    if (!song?.id || !song?.url) {
      continue;
    }

    const audioPath = `${cachePath}/${platform}/audio/${song.id}-${quality}.mp3`;

    // 如果緩存中已經標記為已緩存，且使用代理模式，直接返回代理URL
    if (song.cached === true && cacheProxyEnabled) {
      song.url = `/api/music/audio-proxy?platform=${platform}&id=${song.id}&quality=${quality}`;
      continue;
    }

    try {
      // 只有在未確認緩存狀態時才調用 getFile()
      const fileResponse = await openListClient.getFile(audioPath);

      if (fileResponse.code === 200 && fileResponse.data?.raw_url) {
        // 如果啟用緩存代理，返回代理URL；否則返回直接URL
        if (cacheProxyEnabled) {
          // 使用代理URL，通過我們的服務器代理OpenList的音頻
          song.url = `/api/music/audio-proxy?platform=${platform}&id=${song.id}&quality=${quality}`;
        } else {
          // 直接使用OpenList的raw_url
          song.url = fileResponse.data.raw_url;
        }
        song.cached = true;
      } else {
        song.cached = false;

        cacheAudioToOpenList(openListClient, song.url, platform, song.id, quality, cachePath)
          .catch(error => {
            console.error('[Music Cache] 異步緩存音頻失敗:', error);
          });
      }
    } catch (error) {
      song.cached = false;

      cacheAudioToOpenList(openListClient, song.url, platform, song.id, quality, cachePath)
        .catch(err => {
          console.error('[Music Cache] 異步緩存音頻失敗:', err);
        });
    }
  }

  return data;
}

// 通用請求處理函數
async function proxyRequest(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    return response;
  } catch (error) {
    console.error('Music API 請求失敗:', error);
    throw error;
  }
}

// 獲取方法配置並執行請求
async function executeMethod(
  baseUrl: string,
  platform: string,
  func: string,
  variables: Record<string, string> = {}
): Promise<any> {
  // 1. 獲取方法配置
  const cacheKey = `method-config-${platform}-${func}`;
  let config: any;

  const cached = serverCache.methodConfigs.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
    config = cached.data.data;
  } else {
    const response = await proxyRequest(`${baseUrl}/v1/methods/${platform}/${func}`);
    const data = await response.json();
    serverCache.methodConfigs.set(cacheKey, { data, timestamp: Date.now() });
    config = data.data;
  }

  if (!config) {
    throw new Error('無法獲取方法配置');
  }

  // 2. 替換模板變量
  let url = config.url;
  const params: Record<string, string> = {};

  // 先將 variables 中的值轉換為可執行的變量
  const evalContext: Record<string, any> = {};
  for (const [key, value] of Object.entries(variables)) {
    // 嘗試將字符串轉換為數字（如果可能）
    const numValue = Number(value);
    evalContext[key] = isNaN(numValue) ? value : numValue;
  }

  // 遞歸處理對象中的模板變量
  function processTemplateValue(value: any): any {
    if (typeof value === 'string') {
      // 處理包含模板變量的表達式
      const expressionRegex = /\{\{(.+?)\}\}/g;
      return value.replace(expressionRegex, (match, expression) => {
        try {
          // 在 Cloudflare 環境下，使用簡單的表達式替換
          if (isCloudflare) {
            const expr = expression.trim();

            // 檢查是否是單個變量（沒有運算符）
            if (evalContext.hasOwnProperty(expr)) {
              // 直接返回變量值
              return String(evalContext[expr]);
            }

            // 處理包含運算的表達式（如 page - 1）
            let result: any = expr;

            // 替換變量為其值
            for (const [key, val] of Object.entries(evalContext)) {
              const regex = new RegExp(`\\b${key}\\b`, 'g');
              // 對於數字直接替換，對於字符串需要加引號以便 eval
              const replacement = typeof val === 'number' ? String(val) : `"${String(val).replace(/"/g, '\\"')}"`;
              result = result.replace(regex, replacement);
            }

            // 嘗試計算表達式
            try {
              // eslint-disable-next-line no-eval
              result = eval(result);
            } catch (err) {
              console.error(`[executeMethod] Cloudflare 環境執行表達式失敗: ${expr}`, err);
              // 如果計算失敗，嘗試直接返回替換後的結果（去掉可能的引號）
              result = result.replace(/^["']|["']$/g, '');
            }

            return String(result);
          } else {
            // 在 Node.js 環境下，使用 Function 構造器
            // eslint-disable-next-line no-new-func
            const func = new Function(...Object.keys(evalContext), `return ${expression}`);
            const result = func(...Object.values(evalContext));
            return String(result);
          }
        } catch (err) {
          console.error(`[executeMethod] 執行表達式失敗: ${expression}`, err);
          return '0'; // 默認值
        }
      });
    } else if (Array.isArray(value)) {
      return value.map(item => processTemplateValue(item));
    } else if (typeof value === 'object' && value !== null) {
      const result: any = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = processTemplateValue(v);
      }
      return result;
    }
    return value;
  }

  // 處理 URL 參數
  if (config.params) {
    for (const [key, value] of Object.entries(config.params)) {
      params[key] = processTemplateValue(value);
    }
  }

  // 處理 POST body
  let processedBody = config.body;
  if (config.body) {
    processedBody = processTemplateValue(config.body);
  }

  // 3. 構建完整 URL
  if (config.method === 'GET' && Object.keys(params).length > 0) {
    const urlObj = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      urlObj.searchParams.append(key, value);
    }
    url = urlObj.toString();
  }

  // 4. 發起請求
  const requestOptions: RequestInit = {
    method: config.method || 'GET',
    headers: config.headers || {},
  };

  if (config.method === 'POST' && processedBody) {
    requestOptions.body = JSON.stringify(processedBody);
    requestOptions.headers = {
      ...requestOptions.headers,
      'Content-Type': 'application/json',
    };
  }

  const response = await proxyRequest(url, requestOptions);
  let data = await response.json();

  // 5. 執行 transform 函數（如果有）
  if (config.transform) {
    // 在 Cloudflare 環境下，將 transform 函數返回給前端執行
    if (isCloudflare) {
      // 將 transform 函數字符串附加到響應數據中
      data.__transform = config.transform;
    } else {
      // 在 Node.js 環境下，直接執行 transform
      try {
        // eslint-disable-next-line no-eval
        const transformFn = eval(`(${config.transform})`);
        data = transformFn(data);
      } catch (err) {
        console.error('[executeMethod] Transform 函數執行失敗:', err);
      }
    }
  }

  // 6. 處理酷我音樂的圖片 URL（轉換為代理 URL）
  if (platform === 'kuwo') {
    const processKuwoImages = (obj: any): any => {
      if (typeof obj === 'string' && obj.startsWith('http://') && obj.includes('kwcdn.kuwo.cn')) {
        // 將 HTTP 圖片 URL 轉換為代理 URL
        return `/api/music/proxy?url=${encodeURIComponent(obj)}`;
      } else if (Array.isArray(obj)) {
        return obj.map(item => processKuwoImages(item));
      } else if (typeof obj === 'object' && obj !== null) {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = processKuwoImages(value);
        }
        return result;
      }
      return obj;
    };

    data = processKuwoImages(data);
  }

  return data;
}

// GET 請求處理
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'music', '無權限訪問音樂功能');
    if (authResult instanceof NextResponse) return authResult;
    const { enabled, baseUrl } = await getMusicServiceConfig();

    if (!enabled) {
      return NextResponse.json(
        { error: '音樂功能未開啟' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (!action) {
      return NextResponse.json(
        { error: '缺少 action 參數' },
        { status: 400 }
      );
    }

    // 處理不同的 action
    switch (action) {
      case 'toplists': {
        // 獲取排行榜列表
        const platform = searchParams.get('platform');
        if (!platform) {
          return NextResponse.json(
            { error: '缺少 platform 參數' },
            { status: 400 }
          );
        }

        const cacheKey = `toplists-${platform}`;
        const cached = serverCache.proxyRequests.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          return NextResponse.json(cached.data);
        }

        const data = await executeMethod(baseUrl, platform, 'toplists');
        serverCache.proxyRequests.set(cacheKey, { data, timestamp: Date.now() });

        return NextResponse.json(data);
      }

      case 'toplist': {
        // 獲取排行榜詳情
        const platform = searchParams.get('platform');
        const id = searchParams.get('id');

        if (!platform || !id) {
          return NextResponse.json(
            { error: '缺少 platform 或 id 參數' },
            { status: 400 }
          );
        }

        const cacheKey = `toplist-${platform}-${id}`;
        const cached = serverCache.proxyRequests.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          return NextResponse.json(cached.data);
        }

        const data = await executeMethod(baseUrl, platform, 'toplist', { id });
        serverCache.proxyRequests.set(cacheKey, { data, timestamp: Date.now() });

        return NextResponse.json(data);
      }

      case 'playlist': {
        // 獲取歌單詳情
        const platform = searchParams.get('platform');
        const id = searchParams.get('id');

        if (!platform || !id) {
          return NextResponse.json(
            { error: '缺少 platform 或 id 參數' },
            { status: 400 }
          );
        }

        const cacheKey = `playlist-${platform}-${id}`;
        const cached = serverCache.proxyRequests.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          return NextResponse.json(cached.data);
        }

        const data = await executeMethod(baseUrl, platform, 'playlist', { id });
        serverCache.proxyRequests.set(cacheKey, { data, timestamp: Date.now() });

        return NextResponse.json(data);
      }

      case 'search': {
        // 搜索歌曲
        const platform = searchParams.get('platform');
        const keyword = searchParams.get('keyword');
        const page = searchParams.get('page') || '1';
        const pageSize = searchParams.get('pageSize') || '20';

        if (!platform || !keyword) {
          return NextResponse.json(
            { error: '缺少 platform 或 keyword 參數' },
            { status: 400 }
          );
        }

        const cacheKey = `search-${platform}-${keyword}-${page}-${pageSize}`;
        const cached = serverCache.proxyRequests.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          return NextResponse.json(cached.data);
        }

        // 注意：不同平臺可能使用不同的變量名
        // 統一傳遞 keyword, page, pageSize, limit (limit = pageSize)
        const data = await executeMethod(baseUrl, platform, 'search', {
          keyword,
          page,
          pageSize,
          limit: pageSize, // 有些平臺使用 limit 而不是 pageSize
        });

        serverCache.proxyRequests.set(cacheKey, { data, timestamp: Date.now() });

        return NextResponse.json(data);
      }

      default:
        return NextResponse.json(
          { error: '不支持的 action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('音樂 API 錯誤:', error);
    return NextResponse.json(
      {
        error: '請求失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

// POST 請求處理（用於解析歌曲）
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'music', '無權限訪問音樂功能');
    if (authResult instanceof NextResponse) return authResult;
    const { enabled, baseUrl, token } = await getMusicServiceConfig();

    if (!enabled) {
      return NextResponse.json(
        { error: '音樂功能未開啟' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json(
        { error: '缺少 action 參數' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'parse': {
        // 解析歌曲（需要 Token）
        if (!token) {
          return NextResponse.json(
            {
              code: -1,
              error: '未配置音樂服務 Token',
              message: '未配置音樂服務 Token'
            },
            { status: 403 }
          );
        }

        const { platform, ids, quality } = body;
        if (!platform || !ids) {
          return NextResponse.json(
            {
              code: -1,
              error: '缺少 platform 或 ids 參數',
              message: '缺少 platform 或 ids 參數'
            },
            { status: 400 }
          );
        }

        // 添加緩存支持
        const qualityKey = quality || '320k';
        const idsKey = Array.isArray(ids) ? ids.join(',') : ids;
        const cacheKey = `parse-${platform}-${idsKey}-${qualityKey}`;

        // 1. 獲取 OpenList 配置
        const openListClient = await getOpenListClient();
        const config = await getConfig();
        const cachePath = config?.MusicConfig?.OpenListCachePath || '/music-cache';

        // 2. 檢查內存緩存
        const cached = serverCache.proxyRequests.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < serverCache.CACHE_DURATION) {
          // 如果啟用了 OpenList，需要檢查並替換音頻 URL
          if (openListClient) {
            const updatedData = await replaceAudioUrlsWithOpenList(
              cached.data,
              openListClient,
              platform,
              qualityKey,
              cachePath
            );

            // 更新內存緩存
            serverCache.proxyRequests.set(cacheKey, { data: updatedData, timestamp: Date.now() });

            return NextResponse.json(updatedData);
          } else {
            // 沒有 OpenList 配置，直接返回內存緩存
            return NextResponse.json(cached.data);
          }
        }

        // 3. 檢查 OpenList JSON 緩存
        if (openListClient) {
          try {
            const openListPath = `${cachePath}/${platform}/${idsKey}-${qualityKey}.json`;

            const fileResponse = await openListClient.getFile(openListPath);
            if (fileResponse.code === 200 && fileResponse.data?.raw_url) {
              // 下載緩存文件
              const cacheResponse = await fetch(fileResponse.data.raw_url);
              if (cacheResponse.ok) {
                const cachedData = await cacheResponse.json();

                // 檢查並替換音頻 URL
                const updatedData = await replaceAudioUrlsWithOpenList(
                  cachedData,
                  openListClient,
                  platform,
                  qualityKey,
                  cachePath
                );

                // 更新內存緩存
                serverCache.proxyRequests.set(cacheKey, { data: updatedData, timestamp: Date.now() });

                return NextResponse.json(updatedData);
              }
            }
          } catch (error) {
            // OpenList 緩存未命中，繼續調用音樂服務
          }
        }

        // 4. 調用音樂服務解析
        try {
          const response = await proxyRequest(`${baseUrl}/v1/parse`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': token,
            },
            body: JSON.stringify({
              platform,
              ids,
              quality: qualityKey,
            }),
          });

          const data = await response.json();

          // 如果音樂服務返回錯誤，包裝成統一格式
          if (!response.ok || data.code !== 0) {
            return NextResponse.json({
              code: data.code || -1,
              message: data.message || data.error || '解析失敗',
              error: data.error || data.message || '解析失敗',
            });
          }

          // 5. 緩存成功的解析結果到內存
          serverCache.proxyRequests.set(cacheKey, { data, timestamp: Date.now() });

          // 6. 檢查並替換音頻 URL 為 OpenList URL（如果已緩存）
          // 同時異步下載未緩存的音頻
          const finalData = await replaceAudioUrlsWithOpenList(
            data,
            openListClient,
            platform,
            qualityKey,
            cachePath
          );

          // 7. 緩存解析結果到 OpenList（異步，不阻塞響應）
          if (openListClient) {
            const jsonPath = `${cachePath}/${platform}/${idsKey}-${qualityKey}.json`;
            openListClient.uploadFile(jsonPath, JSON.stringify(finalData, null, 2))
              .catch((error) => {
                console.error('[Music Cache] 緩存解析結果到 OpenList 失敗:', error);
              });
          }

          return NextResponse.json(finalData);
        } catch (error) {
          console.error('解析歌曲失敗:', error);
          return NextResponse.json({
            code: -1,
            message: '解析請求失敗',
            error: (error as Error).message,
          });
        }
      }

      default:
        return NextResponse.json(
          { error: '不支持的 action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('音樂 API 錯誤:', error);
    return NextResponse.json(
      {
        error: '請求失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
