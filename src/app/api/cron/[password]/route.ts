/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { checkAnimeSubscriptions } from '@/lib/anime-subscription';
import { getConfig, refineConfig } from '@/lib/config';
import { db, getStorage } from '@/lib/db';
import { EmailService } from '@/lib/email.service';
import {
  FavoriteUpdate,
  getBatchFavoriteUpdateEmailTemplate,
  getBatchMangaUpdateEmailTemplate,
  MangaShelfUpdate,
} from '@/lib/email.templates';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import {
  getLastGlobalLiveRefreshTime,
  getLiveRefreshIntervalHours,
  refreshLiveChannels,
  setLastGlobalLiveRefreshTime,
} from '@/lib/live';
import { MangaChapter, MangaShelfItem } from '@/lib/manga.types';
import { startOpenListRefresh } from '@/lib/openlist-refresh';
import { getSuwayomiConfig, loginWithSimpleAuth, SuwayomiClient } from '@/lib/suwayomi.client';
import { SearchResult } from '@/lib/types';

export const runtime = 'nodejs';
const MAX_INLINE_MANGA_COVERS = 3;
const MAX_INLINE_MANGA_COVER_BYTES = 350 * 1024;
const TARGET_INLINE_MANGA_COVER_WIDTH = 480;

function buildSuwayomiBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

async function fetchMangaCoverAsDataUri(coverUrl?: string): Promise<string | undefined> {
  if (!coverUrl) return undefined;

  try {
    let requestUrl = coverUrl;
    let headers: HeadersInit | undefined;

    if (!/^https?:\/\//i.test(coverUrl)) {
      if (!coverUrl.startsWith('/api/manga/image?')) {
        return undefined;
      }

      const config = await getSuwayomiConfig();
      const parsedProxyUrl = new URL(`http://localhost${coverUrl}`);
      const rawPath = parsedProxyUrl.searchParams.get('path')?.trim();
      if (!rawPath) return undefined;

      if (/^https?:\/\//i.test(rawPath)) {
        const target = new URL(rawPath);
        const base = new URL(config.serverBaseUrl);
        if (target.origin !== base.origin) {
          return undefined;
        }
        requestUrl = target.toString();
      } else {
        requestUrl = `${config.serverBaseUrl}${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}`;
      }

      if (config.authMode === 'basic_auth') {
        if (!config.username || !config.password) return undefined;
        headers = new Headers({
          Authorization: buildSuwayomiBasicAuthHeader(config.username, config.password),
        });
      } else if (config.authMode === 'simple_login') {
        headers = new Headers({
          Cookie: await loginWithSimpleAuth(config),
        });
      }
    }

    const response = await fetch(requestUrl, {
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      return undefined;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return undefined;
    }

    let buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      return undefined;
    }

    let finalContentType = contentType;

    if (buffer.length > MAX_INLINE_MANGA_COVER_BYTES) {
      const sharp = (await import('sharp')).default;
      const transformer = sharp(buffer, { failOn: 'none' }).rotate().resize({
        width: TARGET_INLINE_MANGA_COVER_WIDTH,
        withoutEnlargement: true,
      });
      const metadata = await transformer.metadata();

      if (metadata.hasAlpha) {
        buffer = await transformer.png({
          compressionLevel: 9,
          palette: true,
          quality: 80,
          effort: 10,
        }).toBuffer();
        finalContentType = 'image/png';
      } else {
        const qualities = [72, 60, 48];
        let compressed: Buffer | null = null;
        for (const quality of qualities) {
          const next = await sharp(buffer, { failOn: 'none' })
            .rotate()
            .resize({
              width: TARGET_INLINE_MANGA_COVER_WIDTH,
              withoutEnlargement: true,
            })
            .jpeg({
              quality,
              mozjpeg: true,
            })
            .toBuffer();
          compressed = next;
          if (next.length <= MAX_INLINE_MANGA_COVER_BYTES) {
            break;
          }
        }
        buffer = compressed || buffer;
        finalContentType = 'image/jpeg';
      }
    }

    if (buffer.length > MAX_INLINE_MANGA_COVER_BYTES) {
      return undefined;
    }

    return `data:${finalContentType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.warn('漫畫封面轉 base64 失敗:', error);
    return undefined;
  }
}

// 內存中記錄最後執行時間（毫秒時間戳）
let lastExecutionTime = 0;
const COOLDOWN_MS = 10 * 60 * 1000; // 10分鐘冷卻時間

export async function GET(
  request: NextRequest,
  { params }: { params: { password: string } }
) {
  console.log(request.url);

  const cronPassword = process.env.CRON_PASSWORD || 'mtvpls';
  if (params.password !== cronPassword) {
    return NextResponse.json(
      { success: false, message: 'Unauthorized' },
      { status: 401 }
    );
  }

  // 檢查冷卻時間
  const now = Date.now();
  const timeSinceLastExecution = now - lastExecutionTime;

  if (lastExecutionTime > 0 && timeSinceLastExecution < COOLDOWN_MS) {
    const remainingSeconds = Math.ceil((COOLDOWN_MS - timeSinceLastExecution) / 1000);
    const remainingMinutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;

    console.log(`Cron job skipped: cooldown period active. Remaining: ${remainingMinutes}m ${seconds}s`);

    return NextResponse.json({
      success: false,
      message: 'Cron job is in cooldown period',
      remainingSeconds,
      nextAvailableTime: new Date(lastExecutionTime + COOLDOWN_MS).toISOString(),
      timestamp: new Date().toISOString(),
    }, { status: 429 });
  }

  try {
    console.log('Cron job triggered:', new Date().toISOString());

    // 更新最後執行時間
    lastExecutionTime = now;

    // 環境變量控制是否等待定時任務完全結束後再返回響應（默認 false）
    // 用於防止 Vercel 等平臺殺後臺進程
    const waitForCompletion = process.env.CRON_WAIT_FOR_COMPLETION === 'true';

    if (waitForCompletion) {
      // 等待定時任務完成後再返回 200
      await cronJob();
      return NextResponse.json({
        success: true,
        message: 'Cron job executed successfully',
        timestamp: new Date().toISOString(),
      });
    } else {
      // 立即返回 202，定時任務在後臺執行
      cronJob();
      return NextResponse.json({
        success: true,
        message: 'Cron job accepted and running in background',
        timestamp: new Date().toISOString(),
      }, { status: 202 });
    }
  } catch (error) {
    console.error('Cron job failed:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Cron job failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

async function cronJob() {
  // 先刷新配置，確保其他任務使用最新配置
  await refreshConfig();

  // 其餘任務並行執行
  await Promise.all([
    refreshAllLiveChannels(),
    refreshOpenList(),
    refreshRecordAndFavorites(),
    checkAnimeSubscriptions(),
  ]);
}

async function refreshAllLiveChannels() {
  const config = await getConfig();
  const refreshIntervalHours = getLiveRefreshIntervalHours(config.LiveRefreshIntervalHours);
  const lastRefreshTime = getLastGlobalLiveRefreshTime();
  const now = Date.now();
  const intervalMs = refreshIntervalHours * 60 * 60 * 1000;
  const timeSinceLastRefresh = now - lastRefreshTime;

  if (lastRefreshTime > 0 && timeSinceLastRefresh < intervalMs) {
    const remainingHours = Math.ceil((intervalMs - timeSinceLastRefresh) / (60 * 60 * 1000));
    console.log(`跳過刷新電視直播：距離上次刷新僅 ${Math.floor(timeSinceLastRefresh / (60 * 60 * 1000))} 小時，還需等待 ${remainingHours} 小時`);
    return;
  }

  // 併發刷新所有啟用的直播源
  const refreshPromises = (config.LiveConfig || [])
    .filter(liveInfo => !liveInfo.disabled)
    .map(async (liveInfo) => {
      try {
        const nums = await refreshLiveChannels(liveInfo);
        liveInfo.channelNumber = nums;
      } catch (error) {
        console.error(`刷新直播源失敗 [${liveInfo.name || liveInfo.key}]:`, error);
        liveInfo.channelNumber = 0;
      }
    });

  // 等待所有刷新任務完成
  await Promise.all(refreshPromises);

  setLastGlobalLiveRefreshTime(Date.now());

  // 保存配置
  await db.saveAdminConfig(config);
}

async function refreshConfig() {
  let config = await getConfig();
  if (config && config.ConfigSubscribtion && config.ConfigSubscribtion.URL && config.ConfigSubscribtion.AutoUpdate) {
    try {
      const response = await fetch(config.ConfigSubscribtion.URL);

      if (!response.ok) {
        throw new Error(`請求失敗: ${response.status} ${response.statusText}`);
      }

      const configContent = await response.text();

      // 對 configContent 進行 base58 解碼
      let decodedContent;
      try {
        const bs58 = (await import('bs58')).default;
        const decodedBytes = bs58.decode(configContent);
        decodedContent = new TextDecoder().decode(decodedBytes);
      } catch (decodeError) {
        console.warn('Base58 解碼失敗:', decodeError);
        throw decodeError;
      }

      try {
        JSON.parse(decodedContent);
      } catch (e) {
        throw new Error('配置文件格式錯誤，請檢查 JSON 語法');
      }
      config.ConfigFile = decodedContent;
      config.ConfigSubscribtion.LastCheck = new Date().toISOString();
      config = refineConfig(config);
      await db.saveAdminConfig(config);

      // 清除短劇視頻源緩存（因為配置文件可能包含新的視頻源）
      try {
        await db.deleteGlobalValue('duanju');
        console.log('已清除短劇視頻源緩存');
      } catch (error) {
        console.error('清除短劇視頻源緩存失敗:', error);
        // 不影響主流程，繼續執行
      }
    } catch (e) {
      console.error('刷新配置失敗:', e);
    }
  } else {
    console.log('跳過刷新：未配置訂閱地址或自動更新');
  }
}

async function refreshRecordAndFavorites() {
  try {
    const users = await db.getAllUsers();
    if (process.env.USERNAME && !users.includes(process.env.USERNAME)) {
      users.push(process.env.USERNAME);
    }

    // 環境變量控制是否跳過特定源（默認為 false，即默認跳過）
    const includeSpecialSources = process.env.CRON_INCLUDE_SPECIAL_SOURCES === 'true';

    // 檢查是否應該跳過該源
    const shouldSkipSource = (source: string): boolean => {
      if (includeSpecialSources) {
        return false; // 如果開啟了包含特殊源，則不跳過任何源
      }
      // 默認跳過 emby 開頭、openlist、xiaoya 和 live 開頭的源
      return source.startsWith('emby') || source === 'openlist' || source === 'xiaoya' || source.startsWith('live');
    };

    // 函數級緩存：key 為 `${source}+${id}`，值為 Promise<VideoDetail | null>
    const detailCache = new Map<string, Promise<SearchResult | null>>();
    const mangaDetailCache = new Map<
      string,
      Promise<{ chapters: MangaChapter[]; shelfItem: Partial<MangaShelfItem> } | null>
    >();
    const suwayomiClient = new SuwayomiClient();

    // 獲取詳情 Promise（帶緩存和錯誤處理）
    const getDetail = async (
      source: string,
      id: string,
      fallbackTitle: string
    ): Promise<SearchResult | null> => {
      const key = `${source}+${id}`;
      let promise = detailCache.get(key);
      if (!promise) {
        // 立即緩存Promise，避免併發時的競態條件
        promise = fetchVideoDetail({
          source,
          id,
          fallbackTitle: fallbackTitle.trim(),
        })
          .then((detail) => {
            return detail;
          })
          .catch((err) => {
            console.error(`獲取視頻詳情失敗 (${source}+${id}):`, err);
            // 失敗時從緩存中移除，下次可以重試
            detailCache.delete(key);
            return null;
          });
        detailCache.set(key, promise);
      }
      return promise;
    };

    const getMangaDetail = async (
      item: MangaShelfItem
    ): Promise<{ chapters: MangaChapter[]; shelfItem: Partial<MangaShelfItem> } | null> => {
      const key = `${item.sourceId}+${item.mangaId}`;
      let promise = mangaDetailCache.get(key);
      if (!promise) {
        promise = suwayomiClient
          .getMangaDetail({
            mangaId: item.mangaId,
            sourceId: item.sourceId,
            title: item.title,
            cover: item.cover,
            sourceName: item.sourceName,
            description: item.description,
            author: item.author,
            status: item.status,
          })
          .then((detail) => {
            const chapters = [...(detail.chapters || [])].sort((a, b) => {
              const diff = (a.chapterNumber || 0) - (b.chapterNumber || 0);
              if (diff !== 0) return diff;
              return a.id.localeCompare(b.id);
            });

            const latestChapter = chapters[chapters.length - 1];
            return {
              chapters,
              shelfItem: {
                title: detail.title || item.title,
                cover: detail.cover || item.cover,
                description: detail.description || item.description,
                author: detail.author || item.author,
                status: detail.status || item.status,
                latestChapterId: latestChapter?.id,
                latestChapterName: latestChapter?.name,
                latestChapterCount: chapters.length,
              },
            };
          })
          .catch((err) => {
            console.error(`獲取漫畫詳情失敗 (${key}):`, err);
            mangaDetailCache.delete(key);
            return null;
          });
        mangaDetailCache.set(key, promise);
      }
      return promise;
    };

    // 處理單個用戶的函數
    const processUser = async (user: string) => {
      console.log(`開始處理用戶: ${user}`);
      const storage = getStorage();

      // 播放記錄
      try {
        const playRecords = await db.getAllPlayRecords(user);
        const totalRecords = Object.keys(playRecords).length;
        let processedRecords = 0;

        for (const [key, record] of Object.entries(playRecords)) {
          try {
            const [source, id] = key.split('+');
            if (!source || !id) {
              console.warn(`跳過無效的播放記錄鍵: ${key}`);
              continue;
            }

            // 檢查是否應該跳過該源
            if (shouldSkipSource(source)) {
              console.log(`跳過播放記錄 (源被過濾): ${key}`);
              processedRecords++;
              continue;
            }

            const detail = await getDetail(source, id, record.title);
            if (!detail) {
              console.warn(`跳過無法獲取詳情的播放記錄: ${key}`);
              continue;
            }

            const episodeCount = detail.episodes?.length || 0;
            if (episodeCount > 0 && episodeCount !== record.total_episodes) {
              // 計算新增的劇集數量
              const newEpisodesCount = episodeCount > record.total_episodes
                ? episodeCount - record.total_episodes
                : 0;

              // 如果有新增劇集，累加到現有的 new_episodes 字段
              const updatedNewEpisodes = (record.new_episodes || 0) + newEpisodesCount;

              await db.savePlayRecord(user, source, id, {
                title: detail.title || record.title,
                source_name: record.source_name,
                cover: detail.poster || record.cover,
                index: record.index,
                total_episodes: episodeCount,
                play_time: record.play_time,
                year: detail.year || record.year,
                total_time: record.total_time,
                save_time: record.save_time,
                search_title: record.search_title,
                new_episodes: updatedNewEpisodes > 0 ? updatedNewEpisodes : undefined,
              });
              console.log(
                `更新播放記錄: ${record.title} (${record.total_episodes} -> ${episodeCount}, 新增 ${newEpisodesCount} 集)`
              );
            }

            processedRecords++;
          } catch (err) {
            console.error(`處理播放記錄失敗 (${key}):`, err);
            // 繼續處理下一個記錄
          }
        }

        console.log(`播放記錄處理完成: ${processedRecords}/${totalRecords}`);
      } catch (err) {
        console.error(`獲取用戶播放記錄失敗 (${user}):`, err);
      }

      // 收藏
      try {
        let favorites = await db.getAllFavorites(user);
        favorites = Object.fromEntries(
          Object.entries(favorites).filter(([_, fav]) => fav.origin !== 'live')
        );
        const totalFavorites = Object.keys(favorites).length;
        let processedFavorites = 0;
        const now = Date.now();
        const userUpdates: FavoriteUpdate[] = []; // 收集該用戶的所有更新

        for (const [key, fav] of Object.entries(favorites)) {
          try {
            const [source, id] = key.split('+');
            if (!source || !id) {
              console.warn(`跳過無效的收藏鍵: ${key}`);
              continue;
            }

            // 檢查是否應該跳過該源
            if (shouldSkipSource(source)) {
              console.log(`跳過收藏 (源被過濾): ${key}`);
              processedFavorites++;
              continue;
            }

            const favDetail = await getDetail(source, id, fav.title);
            if (!favDetail) {
              console.warn(`跳過無法獲取詳情的收藏: ${key}`);
              continue;
            }

            const favEpisodeCount = favDetail.episodes?.length || 0;
            if (favEpisodeCount > 0 && favEpisodeCount !== fav.total_episodes) {
              await db.saveFavorite(user, source, id, {
                title: favDetail.title || fav.title,
                source_name: fav.source_name,
                cover: favDetail.poster || fav.cover,
                year: favDetail.year || fav.year,
                total_episodes: favEpisodeCount,
                save_time: fav.save_time,
                search_title: fav.search_title,
              });
              console.log(
                `更新收藏: ${fav.title} (${fav.total_episodes} -> ${favEpisodeCount})`
              );

              // 創建通知
              const notification = {
                id: `fav_update_${source}_${id}_${now}`,
                type: 'favorite_update' as const,
                title: '收藏更新',
                message: `《${fav.title}》有新集數更新！從 ${fav.total_episodes} 集更新到 ${favEpisodeCount} 集`,
                timestamp: now,
                read: false,
                metadata: {
                  source,
                  id,
                  title: fav.title,
                  old_episodes: fav.total_episodes,
                  new_episodes: favEpisodeCount,
                },
              };

              await storage.addNotification(user, notification);
              console.log(`已為用戶 ${user} 創建收藏更新通知: ${fav.title}`);

              // 收集更新信息用於郵件
              const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
              const playUrl = `${siteUrl}/play?source=${source}&id=${id}&title=${encodeURIComponent(fav.title)}`;
              userUpdates.push({
                title: fav.title,
                oldEpisodes: fav.total_episodes,
                newEpisodes: favEpisodeCount,
                url: playUrl,
                cover: favDetail.poster || fav.cover,
              });
            }

            processedFavorites++;
          } catch (err) {
            console.error(`處理收藏失敗 (${key}):`, err);
            // 繼續處理下一個收藏
          }
        }

        console.log(`收藏處理完成: ${processedFavorites}/${totalFavorites}`);

        // 如果有更新，異步發送彙總郵件（不阻塞主流程）
        if (userUpdates.length > 0) {
          (async () => {
            try {
              const userEmail = storage.getUserEmail ? await storage.getUserEmail(user) : null;
              const emailNotifications = storage.getEmailNotificationPreference
                ? await storage.getEmailNotificationPreference(user)
                : false;

              if (userEmail && emailNotifications) {
                const config = await getConfig();
                const emailConfig = config?.EmailConfig;

                if (emailConfig?.enabled) {
                  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
                  const siteName = config?.SiteConfig?.SiteName || 'MoonTVPlus';

                  await EmailService.send(emailConfig, {
                    to: userEmail,
                    subject: `📺 收藏更新彙總 - ${userUpdates.length} 部影片有更新`,
                    html: getBatchFavoriteUpdateEmailTemplate(
                      user,
                      userUpdates,
                      siteUrl,
                      siteName
                    ),
                  });

                  console.log(`郵件彙總已發送至: ${userEmail} (${userUpdates.length} 個更新)`);
                }
              }
            } catch (emailError) {
              console.error(`發送郵件彙總失敗 (${user}):`, emailError);
            }
          })().catch(err => console.error(`郵件發送異步任務失敗 (${user}):`, err));
        }
      } catch (err) {
        console.error(`獲取用戶收藏失敗 (${user}):`, err);
      }

      // 漫畫書架
      try {
        const shelf = await db.getAllMangaShelf(user);
        const totalShelfItems = Object.keys(shelf).length;
        let processedShelfItems = 0;
        const now = Date.now();
        const mangaUpdates: MangaShelfUpdate[] = [];
        let inlinedCoverCount = 0;

        for (const [key, item] of Object.entries(shelf)) {
          try {
            const detail = await getMangaDetail(item);
            if (!detail) {
              continue;
            }

            const latestChapterCount = detail.chapters.length;
            const previousChapterCount = item.latestChapterCount;
            const latestChapterId = detail.shelfItem.latestChapterId;
            const latestChapterName = detail.shelfItem.latestChapterName;
            const baseItem: MangaShelfItem = {
              ...item,
              ...detail.shelfItem,
            };

            if (!latestChapterId || latestChapterCount <= 0) {
              await db.saveMangaShelf(user, item.sourceId, item.mangaId, {
                ...baseItem,
                unreadChapterCount: item.unreadChapterCount ?? 0,
              });
              processedShelfItems++;
              continue;
            }

            // 首次為老數據補齊基線，不觸發通知
            if (!previousChapterCount || !item.latestChapterId) {
              await db.saveMangaShelf(user, item.sourceId, item.mangaId, {
                ...baseItem,
                latestChapterId,
                latestChapterName,
                latestChapterCount,
                unreadChapterCount: item.unreadChapterCount ?? 0,
              });
              processedShelfItems++;
              continue;
            }

            const addedChapters = latestChapterCount - previousChapterCount;
            const hasNewChapters = addedChapters > 0 && latestChapterId !== item.latestChapterId;
            const nextUnreadChapterCount = hasNewChapters
              ? Math.max((item.unreadChapterCount || 0) + addedChapters, 0)
              : item.unreadChapterCount ?? 0;

            const nextItem: MangaShelfItem = {
              ...baseItem,
              latestChapterId,
              latestChapterName,
              latestChapterCount,
              unreadChapterCount: nextUnreadChapterCount,
            };

            if (hasNewChapters) {
              await storage.addNotification(user, {
                id: `manga_update_${item.sourceId}_${item.mangaId}_${now}`,
                type: 'manga_update',
                title: '漫畫更新',
                message: `《${item.title}》新增 ${addedChapters} 話，已更新至 ${latestChapterName || '最新章節'}`,
                timestamp: now,
                read: false,
                metadata: {
                  sourceId: item.sourceId,
                  mangaId: item.mangaId,
                  title: item.title,
                  cover: detail.shelfItem.cover || item.cover,
                  sourceName: item.sourceName,
                  latestChapterId,
                  latestChapterName,
                  unreadChapterCount: nextUnreadChapterCount,
                },
              });

              const inlineCover =
                inlinedCoverCount < MAX_INLINE_MANGA_COVERS
                  ? await fetchMangaCoverAsDataUri(detail.shelfItem.cover || item.cover)
                  : undefined;
              if (inlineCover) {
                inlinedCoverCount++;
              }

              mangaUpdates.push({
                title: item.title,
                previousChapterCount,
                latestChapterCount,
                latestChapterName,
                url: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/manga/detail?mangaId=${encodeURIComponent(item.mangaId)}&sourceId=${encodeURIComponent(item.sourceId)}&title=${encodeURIComponent(item.title)}&cover=${encodeURIComponent(detail.shelfItem.cover || item.cover || '')}&sourceName=${encodeURIComponent(item.sourceName)}`,
                cover: inlineCover,
              });
            }

            await db.saveMangaShelf(user, item.sourceId, item.mangaId, nextItem);
            processedShelfItems++;
          } catch (err) {
            console.error(`處理漫畫書架失敗 (${key}):`, err);
          }
        }

        console.log(`漫畫書架處理完成: ${processedShelfItems}/${totalShelfItems}`);

        if (mangaUpdates.length > 0) {
          (async () => {
            try {
              const userEmail = storage.getUserEmail ? await storage.getUserEmail(user) : null;
              const emailNotifications = storage.getEmailNotificationPreference
                ? await storage.getEmailNotificationPreference(user)
                : false;

              if (userEmail && emailNotifications) {
                const config = await getConfig();
                const emailConfig = config?.EmailConfig;

                if (emailConfig?.enabled) {
                  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
                  const siteName = config?.SiteConfig?.SiteName || 'MoonTVPlus';

                  await EmailService.send(emailConfig, {
                    to: userEmail,
                    subject: `漫畫書架更新彙總 - ${mangaUpdates.length} 部漫畫有新章節`,
                    html: getBatchMangaUpdateEmailTemplate(
                      user,
                      mangaUpdates,
                      siteUrl,
                      siteName
                    ),
                  });
                }
              }
            } catch (emailError) {
              console.error(`發送漫畫更新郵件失敗 (${user}):`, emailError);
            }
          })().catch((err) => console.error(`漫畫更新郵件異步任務失敗 (${user}):`, err));
        }
      } catch (err) {
        console.error(`獲取用戶漫畫書架失敗 (${user}):`, err);
      }
    };

    // 分批並行處理用戶，避免併發過高
    // 可通過環境變量 CRON_USER_BATCH_SIZE 配置批處理大小，默認為 3
    const BATCH_SIZE = parseInt(process.env.CRON_USER_BATCH_SIZE || '3', 10);
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      console.log(`處理用戶批次 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(users.length / BATCH_SIZE)}: ${batch.join(', ')}`);
      await Promise.all(batch.map(user => processUser(user)));
    }

    console.log('刷新播放記錄/收藏任務完成');
  } catch (err) {
    console.error('刷新播放記錄/收藏任務啟動失敗', err);
  }
}

async function refreshOpenList() {
  try {
    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    // 檢查功能是否啟用
    if (!openListConfig || !openListConfig.Enabled) {
      console.log('跳過 OpenList 掃描：功能未啟用');
      return;
    }

    // 檢查是否配置了 OpenList 和定時掃描
    if (!openListConfig.URL || !openListConfig.Username || !openListConfig.Password) {
      console.log('跳過 OpenList 掃描：未配置');
      return;
    }

    const scanInterval = openListConfig.ScanInterval || 0;
    if (scanInterval === 0) {
      console.log('跳過 OpenList 掃描：定時掃描已關閉');
      return;
    }

    // 檢查間隔時間是否滿足最低要求（60分鐘）
    if (scanInterval < 60) {
      console.log(`跳過 OpenList 掃描：間隔時間 ${scanInterval} 分鐘小於最低要求 60 分鐘`);
      return;
    }

    // 檢查上次掃描時間
    const lastRefreshTime = openListConfig.LastRefreshTime || 0;
    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshTime;
    const intervalMs = scanInterval * 60 * 1000;

    if (timeSinceLastRefresh < intervalMs) {
      const remainingMinutes = Math.ceil((intervalMs - timeSinceLastRefresh) / 60000);
      console.log(`跳過 OpenList 掃描：距離上次掃描僅 ${Math.floor(timeSinceLastRefresh / 60000)} 分鐘，還需等待 ${remainingMinutes} 分鐘`);
      return;
    }

    console.log(`開始 OpenList 定時掃描（間隔: ${scanInterval} 分鐘）`);

    // 直接調用掃描函數（立即掃描模式，不清空 metainfo）
    const { taskId } = await startOpenListRefresh(false);
    console.log('OpenList 定時掃描已啟動，任務ID:', taskId);
  } catch (err) {
    console.error('OpenList 定時掃描失敗:', err);
  }
}

