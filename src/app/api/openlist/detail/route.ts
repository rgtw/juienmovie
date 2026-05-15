/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';
import { OpenListClient } from '@/lib/openlist.client';
import {
  getCachedVideoInfo,
  setCachedVideoInfo,
  VideoInfo,
} from '@/lib/openlist-cache';
import { parseVideoFileName } from '@/lib/video-parser';

export const runtime = 'nodejs';

/**
 * GET /api/openlist/detail?folder=xxx
 * 獲取視頻文件夾的詳細信息
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'private_library', '無權限訪問私人影庫');
    if (authResult instanceof NextResponse) return authResult;
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const folderName = searchParams.get('folder');

    if (!folderName) {
      return NextResponse.json({ error: '缺少參數' }, { status: 400 });
    }

    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    if (
      !openListConfig ||
      !openListConfig.Enabled ||
      !openListConfig.URL ||
      !openListConfig.Username ||
      !openListConfig.Password
    ) {
      return NextResponse.json({ error: 'OpenList 未配置或未啟用' }, { status: 400 });
    }

    // folderName 已經是完整路徑，直接使用
    const folderPath = folderName;
    const client = new OpenListClient(
      openListConfig.URL,
      openListConfig.Username,
      openListConfig.Password
    );

    // 1. 嘗試讀取緩存的 videoinfo.json
    let videoInfo: VideoInfo | null = getCachedVideoInfo(folderPath);

    if (!videoInfo) {
      // 2. 嘗試從 OpenList 讀取 videoinfo.json
      try {
        const videoinfoPath = `${folderPath}/videoinfo.json`;
        const fileResponse = await client.getFile(videoinfoPath);

        if (fileResponse.code === 200 && fileResponse.data.raw_url) {
          const downloadUrl = fileResponse.data.raw_url;
          const contentResponse = await fetch(downloadUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': '*/*',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
          });
          const content = await contentResponse.text();
          videoInfo = JSON.parse(content);

          // 緩存
          if (videoInfo) {
            setCachedVideoInfo(folderPath, videoInfo);
          }
        }
      } catch (error) {
        console.log('videoinfo.json 不存在，將解析文件名');
      }
    }

    // 3. 如果沒有 videoinfo.json，列出文件夾並解析
    if (!videoInfo) {
      const listResponse = await client.listDirectory(folderPath);

      if (listResponse.code !== 200) {
        return NextResponse.json(
          { error: 'OpenList 列表獲取失敗3' },
          { status: 500 }
        );
      }

      // 過濾視頻文件
      const videoFiles = listResponse.data.content.filter(
        (item) =>
          !item.is_dir &&
          !item.name.endsWith('.json') && // 排除 JSON 文件
          !item.name.startsWith('.') && // 排除隱藏文件
          (item.name.endsWith('.mp4') ||
            item.name.endsWith('.mkv') ||
            item.name.endsWith('.avi') ||
            item.name.endsWith('.m3u8') ||
            item.name.endsWith('.flv') ||
            item.name.endsWith('.ts'))
      );

      videoInfo = {
        episodes: {},
        last_updated: Date.now(),
      };

      // 按文件名排序，確保順序一致
      videoFiles.sort((a, b) => a.name.localeCompare(b.name));

      // 解析文件名
      for (let i = 0; i < videoFiles.length; i++) {
        const file = videoFiles[i];
        const parsed = parseVideoFileName(file.name);

        videoInfo.episodes[file.name] = {
          episode: parsed.episode || (i + 1), // 如果解析失敗，使用索引+1作為集數
          season: parsed.season,
          title: parsed.title,
          parsed_from: 'filename',
          isOVA: parsed.isOVA,
        };
      }

      // 僅緩存到內存，不再持久化到 OpenList
      setCachedVideoInfo(folderPath, videoInfo);
    }

    // 4. 獲取視頻文件列表（不獲取播放鏈接，使用懶加載）
    const listResponse = await client.listDirectory(folderPath);

    // 定義視頻文件擴展名（不區分大小寫）
    const videoExtensions = [
      '.mp4', '.mkv', '.avi', '.m3u8', '.flv', '.ts',
      '.mov', '.wmv', '.webm', '.rmvb', '.rm', '.mpg',
      '.mpeg', '.3gp', '.f4v', '.m4v', '.vob'
    ];

    const videoFiles = listResponse.data.content.filter((item) => {
      // 排除文件夾
      if (item.is_dir) return false;

      // 排除隱藏文件
      if (item.name.startsWith('.')) return false;

      // 排除 JSON 文件
      if (item.name.endsWith('.json')) return false;

      // 檢查是否是視頻文件（不區分大小寫）
      const lowerName = item.name.toLowerCase();
      return videoExtensions.some(ext => lowerName.endsWith(ext));
    });

    // 5. 構建集數信息（不包含播放鏈接）
    // 確保所有視頻文件都被顯示，即使 videoInfo 中沒有記錄
    const episodes = videoFiles
      .map((file, index) => {
        // 總是重新解析文件名，確保使用最新的解析邏輯
        const parsed = parseVideoFileName(file.name);

        // 如果解析成功，使用解析結果；否則使用 videoInfo 中的記錄或索引
        let episodeInfo;
        if (parsed.episode) {
          episodeInfo = {
            episode: parsed.episode,
            season: parsed.season,
            title: parsed.title,
            parsed_from: 'filename',
            isOVA: parsed.isOVA,
          };
        } else {
          // 如果解析失敗，嘗試從 videoInfo 獲取
          episodeInfo = videoInfo!.episodes[file.name];
          if (!episodeInfo) {
            // 如果 videoInfo 中也沒有，使用索引
            episodeInfo = {
              episode: index + 1,
              season: undefined,
              title: undefined,
              parsed_from: 'filename',
            };
          }
        }

        // 優先使用解析出的標題，其次是"第X集"格式，最後才是文件名
        let displayTitle = episodeInfo.title;
        if (!displayTitle && episodeInfo.episode) {
          displayTitle = episodeInfo.isOVA ? `OVA ${episodeInfo.episode}` : `第${episodeInfo.episode}集`;
        }
        if (!displayTitle) {
          displayTitle = file.name;
        }

        return {
          fileName: file.name,
          episode: episodeInfo.episode || 0,
          season: episodeInfo.season,
          title: displayTitle,
          size: file.size,
          isOVA: episodeInfo.isOVA,
        };
      })
      .sort((a, b) => {
        // OVA 排在最後
        if (a.isOVA && !b.isOVA) return 1;
        if (!a.isOVA && b.isOVA) return -1;
        // 確保排序穩定，即使 episode 相同也按文件名排序
        if (a.episode !== b.episode) {
          return a.episode - b.episode;
        }
        return a.fileName.localeCompare(b.fileName);
      });

    return NextResponse.json({
      success: true,
      folder: folderName,
      episodes,
      videoInfo,
    });
  } catch (error) {
    console.error('獲取視頻詳情失敗:', error);
    return NextResponse.json(
      { error: '獲取失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
