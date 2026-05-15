/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';
import { db } from '@/lib/db';
import { OpenListClient } from '@/lib/openlist.client';
import {
  getCachedMetaInfo,
  MetaInfo,
  setCachedMetaInfo,
} from '@/lib/openlist-cache';
import { getTMDBImageUrl } from '@/lib/tmdb.search';

export const runtime = 'nodejs';

/**
 * GET /api/openlist/list?page=1&pageSize=20&includeFailed=false&noCache=false
 * 獲取私人影庫視頻列表
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
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const includeFailed = searchParams.get('includeFailed') === 'true';
    const noCache = searchParams.get('noCache') === 'true';

    const config = await getConfig();
    const openListConfig = config.OpenListConfig;

    if (
      !openListConfig ||
      !openListConfig.Enabled ||
      !openListConfig.URL ||
      !openListConfig.Username ||
      !openListConfig.Password
    ) {
      return NextResponse.json(
        { error: 'OpenList 未配置或未啟用', list: [], total: 0 },
        { status: 200 }
      );
    }

    const client = new OpenListClient(
      openListConfig.URL,
      openListConfig.Username,
      openListConfig.Password
    );

    // 讀取 metainfo (從數據庫或緩存)
    let metaInfo: MetaInfo | null = null;

    // 如果不使用緩存，直接從數據庫讀取
    if (noCache) {
      // noCache 模式：跳過緩存
    } else {
      metaInfo = getCachedMetaInfo();
    }

    if (!metaInfo) {
      try {
        const metainfoJson = await db.getGlobalValue('video.metainfo');

        if (metainfoJson) {
          try {
            metaInfo = JSON.parse(metainfoJson);

            // 驗證數據結構
            if (!metaInfo || typeof metaInfo !== 'object') {
              throw new Error('metaInfo 不是有效對象');
            }
            if (!metaInfo.folders || typeof metaInfo.folders !== 'object') {
              throw new Error('metaInfo.folders 不存在或不是對象');
            }

            // 只有在不是 noCache 模式時才更新緩存
            if (!noCache) {
              setCachedMetaInfo(metaInfo);
            }
          } catch (parseError) {
            console.error('[OpenList List] JSON 解析或驗證失敗:', parseError);
            throw new Error(`JSON 解析失敗: ${(parseError as Error).message}`);
          }
        } else {
          throw new Error('數據庫中沒有 metainfo 數據');
        }
      } catch (error) {
        console.error('[OpenList List] 從數據庫讀取 metainfo 失敗:', error);
        return NextResponse.json(
          {
            error: 'metainfo 讀取失敗',
            details: (error as Error).message,
            list: [],
            total: 0,
          },
          { status: 200 }
        );
      }
    }

    if (!metaInfo) {
      return NextResponse.json(
        { error: '無數據', list: [], total: 0 },
        { status: 200 }
      );
    }

    // 驗證 metaInfo 結構
    if (!metaInfo.folders || typeof metaInfo.folders !== 'object') {
      return NextResponse.json(
        { error: 'metainfo.json 結構無效', list: [], total: 0 },
        { status: 200 }
      );
    }

    // 轉換為數組並分頁
    const allVideos = Object.entries(metaInfo.folders)
      .filter(([, info]) => includeFailed || !info.failed) // 根據參數過濾失敗的視頻
      .map(
        ([key, info]) => {
          return {
            id: key,
            folder: info.folderName,
            tmdbId: info.tmdb_id,
            title: info.title,
            poster: getTMDBImageUrl(info.poster_path),
            releaseDate: info.release_date,
            overview: info.overview,
            voteAverage: info.vote_average,
            mediaType: info.media_type,
            lastUpdated: info.last_updated,
            failed: info.failed || false,
            seasonNumber: info.season_number,
            seasonName: info.season_name,
          };
        }
      );

    // 按更新時間倒序排序
    allVideos.sort((a, b) => b.lastUpdated - a.lastUpdated);

    const total = allVideos.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const list = allVideos.slice(start, end);

    return NextResponse.json({
      success: true,
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error('獲取視頻列表失敗:', error);
    return NextResponse.json(
      { error: '獲取失敗', details: (error as Error).message, list: [], total: 0 },
      { status: 500 }
    );
  }
}
