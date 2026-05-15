/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';
import { db } from '@/lib/db';
import { OpenListClient } from '@/lib/openlist.client';
import {
  getCachedMetaInfo,
  invalidateMetaInfoCache,
  MetaInfo,
  setCachedMetaInfo,
} from '@/lib/openlist-cache';

export const runtime = 'nodejs';

/**
 * POST /api/openlist/correct
 * 糾正視頻的TMDB映射
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireFeaturePermission(request, 'private_library', '無權限訪問私人影庫');
    if (authResult instanceof NextResponse) return authResult;
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const body = await request.json();
    const {
      key,
      tmdbId,
      doubanId,
      title,
      posterPath,
      releaseDate,
      overview,
      voteAverage,
      mediaType,
      seasonNumber,
      seasonName,
    } = body;

    // 只驗證 key 和 title 是必需的
    if (!key || !title) {
      return NextResponse.json(
        { error: '缺少必要參數 (key 或 title)' },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: 'OpenList 未配置或未啟用' },
        { status: 400 }
      );
    }

    const client = new OpenListClient(
      openListConfig.URL,
      openListConfig.Username,
      openListConfig.Password
    );

    // 讀取現有 metainfo (從數據庫或緩存)
    let metaInfo: MetaInfo | null = getCachedMetaInfo();

    if (!metaInfo) {
      try {
        console.log('[OpenList Correct] 嘗試從數據庫讀取 metainfo');
        const metainfoJson = await db.getGlobalValue('video.metainfo');

        if (metainfoJson) {
          metaInfo = JSON.parse(metainfoJson);
        }
      } catch (error) {
        console.error('[OpenList Correct] 從數據庫讀取 metainfo 失敗:', error);
        return NextResponse.json(
          { error: 'metainfo 讀取失敗' },
          { status: 500 }
        );
      }
    }

    if (!metaInfo) {
      return NextResponse.json(
        { error: 'metainfo.json 不存在' },
        { status: 404 }
      );
    }

    // 檢查 key 是否存在
    if (!metaInfo.folders[key]) {
      return NextResponse.json(
        { error: '視頻不存在' },
        { status: 404 }
      );
    }

    // 保留原始文件夾名稱
    const folderName = metaInfo.folders[key].folderName;

    // 更新視頻信息
    metaInfo.folders[key] = {
      folderName: folderName,
      tmdb_id: tmdbId || null,
      title: title,
      poster_path: posterPath,
      release_date: releaseDate || '',
      overview: overview || '',
      vote_average: voteAverage || 0,
      media_type: mediaType,
      last_updated: Date.now(),
      failed: false, // 糾錯後標記為成功
      season_number: seasonNumber, // 季度編號(可選)
      season_name: seasonName, // 季度名稱(可選)
    };

    // 保存 metainfo 到數據庫
    const metainfoContent = JSON.stringify(metaInfo);

    await db.setGlobalValue('video.metainfo', metainfoContent);

    // 更新緩存
    invalidateMetaInfoCache();
    setCachedMetaInfo(metaInfo);

    return NextResponse.json({
      success: true,
      message: '糾錯成功',
    });
  } catch (error) {
    console.error('視頻糾錯失敗:', error);
    return NextResponse.json(
      { error: '糾錯失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
