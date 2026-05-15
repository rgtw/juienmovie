/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { hasFeaturePermission } from '@/lib/permissions';
import { yellowWords } from '@/lib/yellow';
import { getProxyToken } from '@/lib/emby-token';
import {
  executeSavedSourceScript,
  listEnabledSourceScripts,
  normalizeScriptSearchResults,
  normalizeScriptSources,
} from '@/lib/source-script';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return new Response(
      JSON.stringify({ error: '搜索關鍵詞不能為空' }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }

  const config = await getConfig();
  const apiSites = await getAvailableApiSites(authInfo.username);
  const [canAccessOpenList, canAccessEmby] = await Promise.all([
    hasFeaturePermission(authInfo.username, 'private_library'),
    hasFeaturePermission(authInfo.username, 'emby'),
  ]);

  // 創建權重映射表
  const weightMap = new Map<string, number>();
  config.SourceConfig.forEach(source => {
    weightMap.set(source.key, source.weight ?? 0);
  });

  // 按權重降序排序 apiSites
  const sortedApiSites = [...apiSites].sort((a, b) => {
    const weightA = weightMap.get(a.key) ?? 0;
    const weightB = weightMap.get(b.key) ?? 0;
    return weightB - weightA;
  });

  // 檢查是否配置了 OpenList
  const hasOpenList = !!(
    canAccessOpenList &&
    config.OpenListConfig?.Enabled &&
    config.OpenListConfig?.URL &&
    config.OpenListConfig?.Username &&
    config.OpenListConfig?.Password
  );

  // 檢查是否配置了 Emby（支持多源）
  const hasEmby = !!(
    canAccessEmby &&
    config.EmbyConfig?.Sources &&
    config.EmbyConfig.Sources.length > 0 &&
    config.EmbyConfig.Sources.some(s => s.enabled && s.ServerURL)
  );
  const enabledScripts = await listEnabledSourceScripts();

  // 共享狀態
  let streamClosed = false;

  // 創建可讀流
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // 輔助函數：安全地向控制器寫入數據
      const safeEnqueue = (data: Uint8Array) => {
        try {
          if (streamClosed || (!controller.desiredSize && controller.desiredSize !== 0)) {
            // 流已標記為關閉或控制器已關閉
            return false;
          }
          controller.enqueue(data);
          return true;
        } catch (error) {
          // 控制器已關閉或出現其他錯誤
          console.warn('Failed to enqueue data:', error);
          streamClosed = true;
          return false;
        }
      };

      // 獲取 Emby 源數量
      let embySourcesCount = 0;
      if (hasEmby) {
        try {
          const { embyManager } = await import('@/lib/emby-manager');
          const embySourcesMap = await embyManager.getAllClients();
          embySourcesCount = embySourcesMap.size;
        } catch (error) {
          console.error('[Search WS] 獲取 Emby 源數量失敗:', error);
        }
      }

      // 發送開始事件
      const startEvent = `data: ${JSON.stringify({
        type: 'start',
        query,
        totalSources: sortedApiSites.length + (hasOpenList ? 1 : 0) + embySourcesCount + enabledScripts.length,
        timestamp: Date.now()
      })}\n\n`;

      if (!safeEnqueue(encoder.encode(startEvent))) {
        return; // 連接已關閉，提前退出
      }

      // 記錄已完成的源數量
      let completedSources = 0;
      const allResults: any[] = [];

      // 搜索 Emby（如果配置了）- 異步帶超時，支持多源
      if (hasEmby) {
        (async () => {
          let embyCompletedCount = 0;
          try {
            const { embyManager } = await import('@/lib/emby-manager');
            const embySourcesMap = await embyManager.getAllClients();
            const embySources = Array.from(embySourcesMap.values());

            // 獲取代理 token（用於圖片代理）
            const proxyToken = await getProxyToken(request);

            // 為每個 Emby 源併發搜索，並單獨發送結果
            const embySearchPromises = embySources.map(async ({ client, config: embyConfig }) => {
              try {
                const searchResult = await client.getItems({
                  searchTerm: query,
                  IncludeItemTypes: 'Movie,Series',
                  Recursive: true,
                  Fields: 'Overview,ProductionYear',
                  Limit: 50,
                });

                const sourceValue = embySources.length === 1 ? 'emby' : `emby_${embyConfig.key}`;
                const sourceName = embySources.length === 1 ? 'Emby' : embyConfig.name;

                // 添加安全檢查，確保 Items 存在且是數組
                const items = Array.isArray(searchResult?.Items) ? searchResult.Items : [];
                const results = items.map((item) => ({
                  id: item.Id,
                  source: sourceValue,
                  source_name: sourceName,
                  weight: weightMap.get(sourceValue) ?? 0,
                  title: item.Name,
                  poster: client.getImageUrl(item.Id, 'Primary', undefined, client.isProxyEnabled() ? proxyToken || undefined : undefined),
                  episodes: [],
                  episodes_titles: [],
                  year: item.ProductionYear?.toString() || '',
                  desc: item.Overview || '',
                  type_name: item.Type === 'Movie' ? '電影' : '電視劇',
                  douban_id: 0,
                }));

                // 單獨發送每個源的結果
                embyCompletedCount++;
                completedSources++;
                if (!streamClosed) {
                  const sourceEvent = `data: ${JSON.stringify({
                    type: 'source_result',
                    source: sourceValue,
                    sourceName: sourceName,
                    results: results,
                    timestamp: Date.now()
                  })}\n\n`;
                  if (safeEnqueue(encoder.encode(sourceEvent))) {
                    if (results.length > 0) {
                      allResults.push(...results);
                    }
                  } else {
                    streamClosed = true;
                  }
                }

                return results;
              } catch (error) {
                console.error(`[Search WS] 搜索 ${embyConfig.name} 失敗:`, error);
                embyCompletedCount++;
                completedSources++;
                // 發送空結果
                if (!streamClosed) {
                  const sourceValue = embySources.length === 1 ? 'emby' : `emby_${embyConfig.key}`;
                  const sourceName = embySources.length === 1 ? 'Emby' : embyConfig.name;
                  const sourceEvent = `data: ${JSON.stringify({
                    type: 'source_result',
                    source: sourceValue,
                    sourceName: sourceName,
                    results: [],
                    timestamp: Date.now()
                  })}\n\n`;
                  safeEnqueue(encoder.encode(sourceEvent));
                }
                return [];
              }
            });

            await Promise.all(embySearchPromises);
          } catch (error) {
            console.error('[Search WS] 搜索 Emby 整體失敗:', error);
            // 如果整個 emby 搜索失敗，需要補齊未完成的源
            const remainingSources = embySourcesCount - embyCompletedCount;
            for (let i = 0; i < remainingSources; i++) {
              completedSources++;
              if (!streamClosed) {
                const sourceEvent = `data: ${JSON.stringify({
                  type: 'source_result',
                  source: 'emby',
                  sourceName: 'Emby',
                  results: [],
                  timestamp: Date.now()
                })}\n\n`;
                safeEnqueue(encoder.encode(sourceEvent));
              }
            }
          }
        })();
      }

      // 搜索 OpenList（如果配置了）- 異步帶超時
      if (hasOpenList) {
        Promise.race([
          (async () => {
            try {
              const { getCachedMetaInfo, setCachedMetaInfo } = await import('@/lib/openlist-cache');
              const { getTMDBImageUrl } = await import('@/lib/tmdb.search');
              const { db } = await import('@/lib/db');

              let metaInfo = getCachedMetaInfo();

              if (!metaInfo) {
                const metainfoJson = await db.getGlobalValue('video.metainfo');
                if (metainfoJson) {
                  metaInfo = JSON.parse(metainfoJson);
                  if (metaInfo) {
                    setCachedMetaInfo(metaInfo);
                  }
                }
              }

              if (metaInfo && metaInfo.folders) {
                return Object.entries(metaInfo.folders)
                  .filter(([key, info]: [string, any]) => {
                    const matchFolder = info.folderName.toLowerCase().includes(query.toLowerCase());
                    const matchTitle = info.title.toLowerCase().includes(query.toLowerCase());
                    return matchFolder || matchTitle;
                  })
                  .map(([key, info]: [string, any]) => ({
                    id: key,
                    source: 'openlist',
                    source_name: '私人影庫',
                    weight: weightMap.get('openlist') ?? 0,
                    title: info.title,
                    poster: getTMDBImageUrl(info.poster_path),
                    episodes: [],
                    episodes_titles: [],
                    year: info.release_date.split('-')[0] || '',
                    desc: info.overview,
                    type_name: info.media_type === 'movie' ? '電影' : '電視劇',
                    douban_id: 0,
                  }));
              }
              return [];
            } catch (error) {
              console.error('[Search WS] 搜索 OpenList 失敗:', error);
              return [];
            }
          })(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('OpenList timeout')), 20000)
          ),
        ])
          .then((openlistResults: any) => {
            completedSources++;
            if (!streamClosed) {
              // 添加安全檢查，確保結果是數組
              const safeResults = Array.isArray(openlistResults) ? openlistResults : [];
              const sourceEvent = `data: ${JSON.stringify({
                type: 'source_result',
                source: 'openlist',
                sourceName: '私人影庫',
                results: safeResults,
                timestamp: Date.now()
              })}\n\n`;
              if (!safeEnqueue(encoder.encode(sourceEvent))) {
                streamClosed = true;
                return;
              }
              if (safeResults.length > 0) {
                allResults.push(...safeResults);
              }
            }
          })
          .catch((error) => {
            console.error('[Search WS] 搜索 OpenList 超時:', error);
            completedSources++;
            if (!streamClosed) {
              const sourceEvent = `data: ${JSON.stringify({
                type: 'source_result',
                source: 'openlist',
                sourceName: '私人影庫',
                results: [],
                timestamp: Date.now()
              })}\n\n`;
              safeEnqueue(encoder.encode(sourceEvent));
            }
          });
      }

      // 為每個源創建搜索 Promise
      const searchPromises = sortedApiSites.map(async (site) => {
        try {
          // 添加超時控制
          const searchPromise = Promise.race([
            searchFromApi(site, query),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`${site.name} timeout`)), 20000)
            ),
          ]);

          const results = await searchPromise as any[];

          // 添加安全檢查，確保結果是數組
          const safeResults = Array.isArray(results) ? results : [];

          // 過濾黃色內容
          let filteredResults = safeResults;
          if (!config.SiteConfig.DisableYellowFilter) {
            filteredResults = safeResults.filter((result) => {
              const typeName = result.type_name || '';
              return !yellowWords.some((word: string) => typeName.includes(word));
            });
          }

          filteredResults = filteredResults.map((result) => ({
            ...result,
            weight: result.weight ?? (weightMap.get(result.source) ?? 0),
          }));

          // 發送該源的搜索結果
          completedSources++;

          if (!streamClosed) {
            const sourceEvent = `data: ${JSON.stringify({
              type: 'source_result',
              source: site.key,
              sourceName: site.name,
              results: filteredResults,
              timestamp: Date.now()
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(sourceEvent))) {
              streamClosed = true;
              return; // 連接已關閉，停止處理
            }
          }

          if (filteredResults.length > 0) {
            allResults.push(...filteredResults);
          }

        } catch (error) {
          console.warn(`搜索失敗 ${site.name}:`, error);

          // 發送源錯誤事件
          completedSources++;

          if (!streamClosed) {
            const errorEvent = `data: ${JSON.stringify({
              type: 'source_error',
              source: site.key,
              sourceName: site.name,
              error: error instanceof Error ? error.message : '搜索失敗',
              timestamp: Date.now()
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(errorEvent))) {
              streamClosed = true;
              return; // 連接已關閉，停止處理
            }
          }
        }

        // 檢查是否所有源都已完成
        if (completedSources === sortedApiSites.length + (hasOpenList ? 1 : 0) + embySourcesCount + enabledScripts.length) {
          if (!streamClosed) {
            // 發送最終完成事件
            const completeEvent = `data: ${JSON.stringify({
              type: 'complete',
              totalResults: allResults.length,
              completedSources,
              timestamp: Date.now()
            })}\n\n`;

            if (safeEnqueue(encoder.encode(completeEvent))) {
              // 只有在成功發送完成事件後才關閉流
              try {
                controller.close();
              } catch (error) {
                console.warn('Failed to close controller:', error);
              }
            }
          }
        }
      });

      const scriptPromises = enabledScripts.map(async (script) => {
        try {
          const sourcesExecution = await Promise.race([
            executeSavedSourceScript({
              key: script.key,
              hook: 'getSources',
              payload: {},
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`${script.name} timeout`)), 20000)
            ),
          ]);

          const sources = normalizeScriptSources((sourcesExecution as any).result);
          const sourceResults = await Promise.all(
            sources.map(async (source) => {
              const execution = await Promise.race([
                executeSavedSourceScript({
                  key: script.key,
                  hook: 'search',
                  payload: {
                    keyword: query,
                    page: 1,
                    sourceId: source.id,
                  },
                }),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error(`${script.name}/${source.name} timeout`)), 20000)
                ),
              ]);

              return normalizeScriptSearchResults({
                scriptKey: script.key,
                scriptName: script.name,
                sourceId: source.id,
                sourceName: source.name,
                result: (execution as any).result,
              });
            })
          );

          let filteredResults = sourceResults.flat();
          if (!config.SiteConfig.DisableYellowFilter) {
            filteredResults = filteredResults.filter((result) => {
              const typeName = result.type_name || '';
              return !yellowWords.some((word: string) => typeName.includes(word));
            });
          }

          completedSources++;

          if (!streamClosed) {
            const sourceEvent = `data: ${JSON.stringify({
              type: 'source_result',
              source: `script:${script.key}`,
              sourceName: script.name,
              results: filteredResults,
              timestamp: Date.now()
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(sourceEvent))) {
              streamClosed = true;
              return;
            }
          }

          if (filteredResults.length > 0) {
            allResults.push(...filteredResults);
          }
        } catch (error) {
          console.warn(`搜索腳本失敗 ${script.name}:`, error);

          completedSources++;

          if (!streamClosed) {
            const errorEvent = `data: ${JSON.stringify({
              type: 'source_error',
              source: `script:${script.key}`,
              sourceName: script.name,
              error: error instanceof Error ? error.message : '搜索失敗',
              timestamp: Date.now()
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(errorEvent))) {
              streamClosed = true;
              return;
            }
          }
        }

        if (completedSources === sortedApiSites.length + (hasOpenList ? 1 : 0) + embySourcesCount + enabledScripts.length) {
          if (!streamClosed) {
            const completeEvent = `data: ${JSON.stringify({
              type: 'complete',
              totalResults: allResults.length,
              completedSources,
              timestamp: Date.now()
            })}\n\n`;

            if (safeEnqueue(encoder.encode(completeEvent))) {
              try {
                controller.close();
              } catch (error) {
                console.warn('Failed to close controller:', error);
              }
            }
          }
        }
      });

      // 等待所有搜索完成
      await Promise.allSettled([...searchPromises, ...scriptPromises]);
    },

    cancel() {
      // 客戶端斷開連接時，標記流已關閉
      streamClosed = true;
      console.log('Client disconnected, cancelling search stream');
    },
  });

  // 返回流式響應
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
