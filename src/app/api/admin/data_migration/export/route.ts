/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gzip } from 'zlib';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';
import { CURRENT_VERSION } from '@/lib/version';
import { updateProgress, clearProgress } from '@/lib/data-migration-progress';

export const runtime = 'nodejs';

const gzipAsync = promisify(gzip);

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

    // 檢查用戶權限（只有站長可以導出數據）
    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json({ error: '權限不足，只有站長可以導出數據' }, { status: 401 });
    }

    const username = authInfo.username; // 存儲到局部變量以便 TypeScript 類型推斷

    const config = await db.getAdminConfig();
    if (!config) {
      return NextResponse.json({ error: '無法獲取配置' }, { status: 500 });
    }

    // 解析請求體獲取密碼
    const { password, includeMangaData = true, includeBookData = true } = await req.json();
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '請提供加密密碼' }, { status: 400 });
    }

    // 收集所有數據
    const exportData = {
      timestamp: new Date().toISOString(),
      serverVersion: CURRENT_VERSION,
      data: {
        // 管理員配置
        adminConfig: config,
        // 所有用戶數據
        userData: {} as { [username: string]: any },
        // V2用戶信息
        usersV2: [] as any[],
      }
    };

    // 獲取所有V2用戶
    const usersV2Result = await db.getUserListV2(0, 1000000, process.env.USERNAME);
    exportData.data.usersV2 = usersV2Result.users;
    console.log(`從getUserListV2獲取到 ${usersV2Result.users.length} 個用戶`);

    // 獲取所有用戶（getAllUsers返回的是V2用戶）
    let allUsers = await db.getAllUsers();
    allUsers.push(process.env.USERNAME); // 添加站長
    // 添加V2用戶列表中的用戶
    usersV2Result.users.forEach(user => {
      if (!allUsers.includes(user.username)) {
        allUsers.push(user.username);
      }
    });
    allUsers = Array.from(new Set(allUsers));
    console.log(`準備導出 ${allUsers.length} 個V2用戶（包括站長）`);

    // 為每個用戶收集數據（只導出V2用戶）- 使用並行處理
    console.log(`開始並行導出 ${allUsers.length} 個用戶的數據...`);
    updateProgress(username, 'export', 'collecting', 0, allUsers.length, '開始收集用戶數據...');

    // 分塊處理用戶，每批處理數量可通過環境變量配置
    const CHUNK_SIZE = parseInt(process.env.DATA_MIGRATION_CHUNK_SIZE || '10', 10);
    let exportedCount = 0;

    for (let i = 0; i < allUsers.length; i += CHUNK_SIZE) {
      const chunk = allUsers.slice(i, i + CHUNK_SIZE);
      console.log(`處理第 ${Math.floor(i / CHUNK_SIZE) + 1} 批用戶 (${chunk.length} 個)`);

      // 並行處理當前批次的用戶
      const userDataPromises = chunk.map(async (username) => {
        try {
          // 站長特殊處理：使用環境變量密碼
          let finalPasswordV2 = username === process.env.USERNAME ? process.env.PASSWORD : null;

          // 如果不是站長，獲取V2密碼
          if (!finalPasswordV2) {
            finalPasswordV2 = await getUserPasswordV2(username);
          }

          // 跳過沒有V2密碼的用戶
          if (!finalPasswordV2) {
            console.log(`跳過用戶 ${username}：沒有V2密碼`);
            return null;
          }

          // 並行獲取用戶的所有數據
          const [
            playRecords,
            favorites,
            searchHistory,
            skipConfigs,
            musicV2History,
            playlists,
            mangaShelf,
            mangaReadRecords,
            bookShelf,
            bookReadRecords
          ] = await Promise.all([
            db.getAllPlayRecords(username),
            db.getAllFavorites(username),
            db.getSearchHistory(username),
            db.getAllSkipConfigs(username),
            db.listMusicV2History(username),
            db.listMusicV2Playlists(username),
            includeMangaData ? db.getAllMangaShelf(username) : Promise.resolve({}),
            includeMangaData ? db.getAllMangaReadRecords(username) : Promise.resolve({}),
            includeBookData ? db.getAllBookShelf(username) : Promise.resolve({}),
            includeBookData ? db.getAllBookReadRecords(username) : Promise.resolve({})
          ]);

          // 並行獲取所有歌單的歌曲
          const playlistsWithSongs = await Promise.all(
            playlists.map(async (playlist) => {
              const songs = await db.listMusicV2PlaylistItems(playlist.id);
              return { ...playlist, songs };
            })
          );

          return {
            username,
            userData: {
              playRecords,
              favorites,
              searchHistory,
              skipConfigs,
              musicV2History,
              musicV2Playlists: playlistsWithSongs,
              ...(includeMangaData ? { mangaData: { shelf: mangaShelf, readRecords: mangaReadRecords } } : {}),
              ...(includeBookData ? { bookData: { shelf: bookShelf, readRecords: bookReadRecords } } : {}),
              passwordV2: finalPasswordV2
            }
          };
        } catch (error) {
          console.error(`導出用戶 ${username} 數據失敗:`, error);
          return null;
        }
      });

      // 等待當前批次完成
      const results = await Promise.all(userDataPromises);

      // 將結果添加到導出數據中，並實時更新進度
      for (const result of results) {
        if (result) {
          exportData.data.userData[result.username] = result.userData;
          exportedCount++;
          // 每處理完一個用戶就更新進度
          updateProgress(
            username,
            'export',
            'collecting',
            exportedCount,
            allUsers.length,
            `正在收集用戶數據 (${exportedCount}/${allUsers.length})...`
          );
        }
      }

      console.log(`已完成 ${exportedCount}/${allUsers.length} 個用戶`);
    }

    console.log(`成功導出 ${exportedCount} 個用戶的數據`);

    // 將數據轉換為JSON字符串
    updateProgress(username, 'export', 'serializing', exportedCount, exportedCount, '正在序列化數據...');
    const jsonData = JSON.stringify(exportData);

    // 先壓縮數據
    updateProgress(username, 'export', 'compressing', exportedCount, exportedCount, '正在壓縮數據...');
    const compressedData = await gzipAsync(jsonData);

    // 使用提供的密碼加密壓縮後的數據
    updateProgress(username, 'export', 'encrypting', exportedCount, exportedCount, '正在加密數據...');
    const encryptedData = SimpleCrypto.encrypt(compressedData.toString('base64'), password);

    // 生成文件名
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `moontv-backup-${timestamp}.dat`;

    // 清除進度信息
    updateProgress(username, 'export', 'completed', exportedCount, exportedCount, '導出完成！');
    setTimeout(() => clearProgress(username, 'export'), 3000);

    // 返回加密的數據作為文件下載
    return new NextResponse(encryptedData, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': encryptedData.length.toString(),
      },
    });

  } catch (error) {
    console.error('數據導出失敗:', error);
    // 清除進度信息
    const authInfo = getAuthInfoFromCookie(req);
    if (authInfo?.username) {
      clearProgress(authInfo.username, 'export');
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '導出失敗' },
      { status: 500 }
    );
  }
}

// 輔助函數：獲取V2用戶的加密密碼
async function getUserPasswordV2(username: string): Promise<string | null> {
  try {
    const storage = (db as any).storage;
    if (!storage) return null;

    // 檢查存儲類型
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

    // PostgreSQL 存儲：使用 getUserPasswordHash 方法
    if (storageType === 'postgres') {
      if (typeof storage.getUserPasswordHash === 'function') {
        return await storage.getUserPasswordHash(username);
      }
      return null;
    }

    // D1 存儲：使用 getUserPasswordHash 方法
    if (storageType === 'd1') {
      if (typeof storage.getUserPasswordHash === 'function') {
        return await storage.getUserPasswordHash(username);
      }
      return null;
    }

    // Redis 存儲：直接調用hGetAll獲取完整用戶信息（包括密碼）
    const userInfoKey = `user:${username}:info`;

    if (typeof storage.withRetry === 'function' && storage.client?.hgetall) {
      const userInfo = await storage.withRetry(() => storage.client.hgetall(userInfoKey));
      if (userInfo && userInfo.password) {
        return userInfo.password;
      }
    }

    return null;
  } catch (error) {
    console.error(`獲取用戶 ${username} V2密碼失敗:`, error);
    return null;
  }
}
