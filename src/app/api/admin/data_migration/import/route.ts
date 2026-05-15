/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gunzip } from 'zlib';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { configSelfCheck, setCachedConfig } from '@/lib/config';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';
import { updateProgress, clearProgress } from '@/lib/data-migration-progress';

export const runtime = 'nodejs';

const gunzipAsync = promisify(gunzip);

export async function POST(req: NextRequest) {
  try {
    // 檢查存儲類型
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return NextResponse.json(
        { error: '不支持本地存儲進行數據遷移' },
        { status: 400 }
      );
    }

    // 驗證身份和權限
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未登錄' }, { status: 401 });
    }

    // 檢查用戶權限（只有站長可以導入數據）
    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json({ error: '權限不足，只有站長可以導入數據' }, { status: 401 });
    }

    const username = authInfo.username; // 存儲到局部變量以便 TypeScript 類型推斷

    // 解析表單數據
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const password = formData.get('password') as string;

    if (!file) {
      return NextResponse.json({ error: '請選擇備份文件' }, { status: 400 });
    }

    if (!password) {
      return NextResponse.json({ error: '請提供解密密碼' }, { status: 400 });
    }

    // 讀取文件內容
    const encryptedData = await file.text();

    // 解密數據
    let decryptedData: string;
    try {
      decryptedData = SimpleCrypto.decrypt(encryptedData, password);
    } catch (error) {
      return NextResponse.json({ error: '解密失敗，請檢查密碼是否正確' }, { status: 400 });
    }

    // 解壓縮數據
    const compressedBuffer = Buffer.from(decryptedData, 'base64');
    const decompressedBuffer = await gunzipAsync(compressedBuffer);
    const decompressedData = decompressedBuffer.toString();

    // 解析JSON數據
    let importData: any;
    try {
      importData = JSON.parse(decompressedData);
    } catch (error) {
      return NextResponse.json({ error: '備份文件格式錯誤' }, { status: 400 });
    }

    // 驗證數據格式
    if (!importData.data || !importData.data.adminConfig || !importData.data.userData) {
      return NextResponse.json({ error: '備份文件格式無效' }, { status: 400 });
    }

    const importUsernames = Object.keys(importData.data.userData || {});
    const backupHasMangaData = importUsernames.some((name) => Object.prototype.hasOwnProperty.call(importData.data.userData?.[name] || {}, 'mangaData'));
    const backupHasBookData = importUsernames.some((name) => Object.prototype.hasOwnProperty.call(importData.data.userData?.[name] || {}, 'bookData'));
    const preserveMangaData = !backupHasMangaData;
    const preserveBookData = !backupHasBookData;

    const preservedMangaData = preserveMangaData
      ? Object.fromEntries(await Promise.all(importUsernames.map(async (name) => ([
          name,
          {
            mangaShelf: await db.getAllMangaShelf(name),
            mangaReadRecords: await db.getAllMangaReadRecords(name),
          },
        ]))))
      : {};

    const preservedBookData = preserveBookData
      ? Object.fromEntries(await Promise.all(importUsernames.map(async (name) => ([
          name,
          {
            bookShelf: await db.getAllBookShelf(name),
            bookReadRecords: await db.getAllBookReadRecords(name),
          },
        ]))))
      : {};

    // 開始導入數據 - 先清空現有數據
    updateProgress(username, 'import', 'clearing', 0, 1, '正在清空現有數據...');
    await db.clearAllData();

    // 額外清除所有V2用戶（clearAllData可能只清除舊版用戶）
    const existingUsers = await db.getUserListV2(0, 1000000, process.env.USERNAME);
    for (const user of existingUsers.users) {
      await db.deleteUserV2(user.username);
    }
    console.log(`已清除 ${existingUsers.users.length} 個現有V2用戶`);

    // 導入管理員配置
    importData.data.adminConfig = configSelfCheck(importData.data.adminConfig);
    await db.saveAdminConfig(importData.data.adminConfig);
    await setCachedConfig(importData.data.adminConfig);

    // 清除短劇視頻源緩存（因為導入的配置可能包含不同的視頻源）
    try {
      await db.deleteGlobalValue('duanju');
      console.log('已清除短劇視頻源緩存');
    } catch (error) {
      console.error('清除短劇視頻源緩存失敗:', error);
      // 不影響主流程，繼續執行
    }

    // 導入用戶數據和user:info
    const userData = importData.data.userData;
    const storage = (db as any).storage;
    // 使用前面已聲明的 storageType 變量
    const usersV2Map = new Map((importData.data.usersV2 || []).map((u: any) => [u.username, u]));

    const userCount = Object.keys(userData).length;
    console.log(`準備導入 ${userCount} 個用戶的數據`);
    updateProgress(username, 'import', 'importing', 0, userCount, '開始導入用戶數據...');

    // 分塊處理用戶，每批處理數量可通過環境變量配置
    const CHUNK_SIZE = parseInt(process.env.DATA_MIGRATION_CHUNK_SIZE || '10', 10);
    const usernames = Object.keys(userData);
    let importedCount = 0;

    for (let i = 0; i < usernames.length; i += CHUNK_SIZE) {
      const chunk = usernames.slice(i, i + CHUNK_SIZE);
      console.log(`處理第 ${Math.floor(i / CHUNK_SIZE) + 1} 批用戶 (${chunk.length} 個)`);
      updateProgress(
        username,
        'import',
        'importing',
        importedCount,
        userCount,
        `正在導入用戶數據 (${importedCount}/${userCount})...`
      );

      // 並行導入當前批次的用戶
      const importPromises = chunk.map(async (username) => {
        try {
          const user = userData[username];
          // 數據批處理大小（用於播放記錄、收藏夾等）
          const DATA_BATCH_SIZE = parseInt(process.env.DATA_MIGRATION_CHUNK_SIZE || '10', 10);

          // 為所有有passwordV2的用戶創建user:info
          if (user.passwordV2) {
            const userV2 = usersV2Map.get(username) as any;

            // 確定角色：站長為owner，其他用戶從usersV2獲取或默認為user
            let role: 'owner' | 'admin' | 'user' = 'user';
            if (username === process.env.USERNAME) {
              role = 'owner';
            } else if (userV2) {
              role = userV2.role === 'owner' ? 'user' : userV2.role;
            }

            const createdAt = userV2?.created_at || Date.now();

            // 根據存儲類型使用不同的導入方法
            if (storageType === 'd1') {
              // D1 存儲：使用 createUserWithHashedPassword 方法
              if (typeof storage.createUserWithHashedPassword === 'function') {
                await storage.createUserWithHashedPassword(
                  username,
                  user.passwordV2,
                  role,
                  createdAt,
                  userV2?.tags,
                  userV2?.oidcSub,
                  userV2?.enabledApis,
                  userV2?.banned
                );
                console.log(`用戶 ${username} 導入成功 (D1)`);
              } else {
                console.error(`D1 storage 缺少 createUserWithHashedPassword 方法`);
                return false;
              }
            } else if (storageType === 'postgres') {
              // Postgres 存儲：使用 createUserWithHashedPassword 方法
              if (typeof storage.createUserWithHashedPassword === 'function') {
                await storage.createUserWithHashedPassword(
                  username,
                  user.passwordV2,
                  role,
                  createdAt,
                  userV2?.tags,
                  userV2?.oidcSub,
                  userV2?.enabledApis,
                  userV2?.banned
                );
                console.log(`用戶 ${username} 導入成功 (Postgres)`);
              } else {
                console.error(`Postgres storage 缺少 createUserWithHashedPassword 方法`);
                return false;
              }
            } else {
              // Redis 存儲：直接設置用戶信息
              const userInfoKey = `user:${username}:info`;
              const userInfo: Record<string, string> = {
                role,
                banned: String(userV2?.banned || false),
                password: user.passwordV2,
                created_at: createdAt.toString(),
              };

              if (userV2?.tags && userV2.tags.length > 0) {
                userInfo.tags = JSON.stringify(userV2.tags);
              }

              if (userV2?.oidcSub) {
                userInfo.oidcSub = userV2.oidcSub;
              }

              if (userV2?.enabledApis && userV2.enabledApis.length > 0) {
                userInfo.enabledApis = JSON.stringify(userV2.enabledApis);
              }

              await storage.withRetry(() => storage.client.hSet(userInfoKey, userInfo));
              await storage.withRetry(() => storage.client.zAdd('user:list', {
                score: createdAt,
                value: username,
              }));

              if (userV2?.oidcSub) {
                const oidcSubKey = `oidc:sub:${userV2.oidcSub}`;
                await storage.withRetry(() => storage.client.set(oidcSubKey, username));
              }

              console.log(`用戶 ${username} 導入成功 (Redis)`);
            }
          } else {
            console.log(`跳過用戶 ${username}：沒有passwordV2`);
            return false;
          }

          // 並行導入用戶的各類數據
          await Promise.all([
            // 導入播放記錄（批量）
            (async () => {
              if (user.playRecords) {
                const entries = Object.entries(user.playRecords);
                // 使用配置的批處理大小
                for (let j = 0; j < entries.length; j += DATA_BATCH_SIZE) {
                  const batch = entries.slice(j, j + DATA_BATCH_SIZE);
                  await Promise.all(
                    batch.map(([key, record]) =>
                      (db as any).storage.setPlayRecord(username, key, record)
                    )
                  );
                }
              }
            })(),

            // 導入收藏夾（批量）
            (async () => {
              if (user.favorites) {
                const entries = Object.entries(user.favorites);
                for (let j = 0; j < entries.length; j += DATA_BATCH_SIZE) {
                  const batch = entries.slice(j, j + DATA_BATCH_SIZE);
                  await Promise.all(
                    batch.map(([key, favorite]) =>
                      (db as any).storage.setFavorite(username, key, favorite)
                    )
                  );
                }
              }
            })(),

            // 導入搜索歷史（批量）
            (async () => {
              if (user.searchHistory && Array.isArray(user.searchHistory)) {
                const reversed = user.searchHistory.reverse();
                for (let j = 0; j < reversed.length; j += DATA_BATCH_SIZE) {
                  const batch = reversed.slice(j, j + DATA_BATCH_SIZE);
                  await Promise.all(
                    batch.map((keyword: string) => db.addSearchHistory(username, keyword))
                  );
                }
              }
            })(),

            // 導入跳過片頭片尾配置（批量）
            (async () => {
              if (user.skipConfigs) {
                const entries = Object.entries(user.skipConfigs);
                for (let j = 0; j < entries.length; j += DATA_BATCH_SIZE) {
                  const batch = entries.slice(j, j + DATA_BATCH_SIZE);
                  await Promise.all(
                    batch.map(([key, skipConfig]) => {
                      const [source, id] = key.split('+');
                      if (source && id) {
                        return db.setSkipConfig(username, source, id, skipConfig as any);
                      }
                      return Promise.resolve();
                    })
                  );
                }
              }
            })(),

            // 導入音樂 V2 播放記錄（批量）
            (async () => {
              const historyRecords = Array.isArray(user.musicV2History)
                ? user.musicV2History
                : [];

              if (historyRecords.length > 0) {
                for (let j = 0; j < historyRecords.length; j += DATA_BATCH_SIZE) {
                  const batch = historyRecords.slice(j, j + DATA_BATCH_SIZE);
                  await db.batchUpsertMusicV2History(
                    username,
                    batch.map((record: any) => ({
                      ...record,
                      source: record.source,
                      songId: record.songId,
                      name: record.name,
                      artist: record.artist,
                      playProgressSec: record.playProgressSec || 0,
                      lastPlayedAt: record.lastPlayedAt || Date.now(),
                      playCount: record.playCount || 1,
                      createdAt: record.createdAt || Date.now(),
                      updatedAt: record.updatedAt || Date.now(),
                    }))
                  );
                }
              }
            })(),

            // 導入音樂 V2 歌單
            (async () => {
              const playlists = Array.isArray(user.musicV2Playlists)
                ? user.musicV2Playlists
                : [];

              if (playlists.length > 0) {
                for (const playlist of playlists) {
                  await db.createMusicV2Playlist(username, {
                    id: playlist.id,
                    name: playlist.name,
                    description: playlist.description,
                    cover: playlist.cover,
                  });

                  // 批量導入歌單中的歌曲
                  if (playlist.songs && Array.isArray(playlist.songs)) {
                    for (let j = 0; j < playlist.songs.length; j += DATA_BATCH_SIZE) {
                      const batch = playlist.songs.slice(j, j + DATA_BATCH_SIZE);
                      await Promise.all(
                        batch.map((song: any, index: number) =>
                          db.addMusicV2PlaylistItem(playlist.id, {
                            playlistId: playlist.id,
                            songId: song.songId || song.id,
                            source: song.source || song.platform,
                            songmid: song.songmid,
                            name: song.name,
                            artist: song.artist,
                            album: song.album,
                            cover: song.cover || song.pic,
                            durationSec: song.durationSec || song.duration || 0,
                            durationText: song.durationText,
                            hash: song.hash,
                            copyrightId: song.copyrightId,
                            albumId: song.albumId,
                            lrcUrl: song.lrcUrl,
                            mrcUrl: song.mrcUrl,
                            trcUrl: song.trcUrl,
                            sortOrder: song.sortOrder ?? (j + index),
                            addedAt: song.addedAt || Date.now(),
                            updatedAt: song.updatedAt || Date.now(),
                          })
                        )
                      );
                    }
                  }
                }
              }
            })(),

            // 導入漫畫書架 / 閱讀記錄
            (async () => {
              if (!backupHasMangaData) return;
              const mangaShelfEntries = Object.entries((user.mangaData?.shelf || preservedMangaData[username]?.mangaShelf || {}));
              for (let j = 0; j < mangaShelfEntries.length; j += DATA_BATCH_SIZE) {
                const batch = mangaShelfEntries.slice(j, j + DATA_BATCH_SIZE);
                await Promise.all(
                  batch.map(([, item]: [string, any]) => db.saveMangaShelf(username, item.sourceId, item.mangaId, item))
                );
              }

              const mangaReadEntries = Object.entries((user.mangaData?.readRecords || preservedMangaData[username]?.mangaReadRecords || {}));
              for (let j = 0; j < mangaReadEntries.length; j += DATA_BATCH_SIZE) {
                const batch = mangaReadEntries.slice(j, j + DATA_BATCH_SIZE);
                await Promise.all(
                  batch.map(([, record]: [string, any]) => db.saveMangaReadRecord(username, record.sourceId, record.mangaId, record))
                );
              }
            })(),

            // 導入電子書書架 / 閱讀記錄
            (async () => {
              if (!backupHasBookData) return;
              const bookShelfEntries = Object.entries((user.bookData?.shelf || preservedBookData[username]?.bookShelf || {}));
              for (let j = 0; j < bookShelfEntries.length; j += DATA_BATCH_SIZE) {
                const batch = bookShelfEntries.slice(j, j + DATA_BATCH_SIZE);
                await Promise.all(
                  batch.map(([, item]: [string, any]) => db.saveBookShelf(username, item.sourceId, item.bookId, item))
                );
              }

              const bookReadEntries = Object.entries((user.bookData?.readRecords || preservedBookData[username]?.bookReadRecords || {}));
              for (let j = 0; j < bookReadEntries.length; j += DATA_BATCH_SIZE) {
                const batch = bookReadEntries.slice(j, j + DATA_BATCH_SIZE);
                await Promise.all(
                  batch.map(([, record]: [string, any]) => db.saveBookReadRecord(username, record.sourceId, record.bookId, record))
                );
              }
            })()
          ]);

          return true;
        } catch (error) {
          console.error(`導入用戶 ${username} 失敗:`, error);
          return false;
        }
      });

      // 等待當前批次完成
      const results = await Promise.all(importPromises);
      importedCount += results.filter(r => r).length;

      console.log(`已完成 ${importedCount}/${userCount} 個用戶`);
      updateProgress(
        username,
        'import',
        'importing',
        importedCount,
        userCount,
        `已導入 ${importedCount}/${userCount} 個用戶`
      );
    }

    console.log(`成功導入 ${importedCount} 個用戶的user:info`);
    updateProgress(username, 'import', 'completed', importedCount, userCount, '導入完成！');
    setTimeout(() => clearProgress(username, 'import'), 3000);

    return NextResponse.json({
      message: '數據導入成功',
      importedUsers: Object.keys(userData).length,
      importedUsersV2: importData.data.usersV2?.length || 0,
      importedMangaData: backupHasMangaData,
      importedBookData: backupHasBookData,
      timestamp: importData.timestamp,
      serverVersion: typeof importData.serverVersion === 'string' ? importData.serverVersion : '未知版本'
    });

  } catch (error) {
    console.error('數據導入失敗:', error);
    // 清除進度信息
    const authInfo = getAuthInfoFromCookie(req);
    if (authInfo?.username) {
      clearProgress(authInfo.username, 'import');
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '導入失敗' },
      { status: 500 }
    );
  }
}
