/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextResponse } from 'next/server';

import { API_CONFIG, getCacheTime } from '@/lib/config';
import { getDuanjuSources } from '@/lib/duanju';
import { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';

export const runtime = 'nodejs';

// 服務端內存緩存
let cachedRecommends: {
  timestamp: number;
  data: SearchResult[];
} | null = null;

interface ApiSearchItem {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_remarks?: string;
  vod_play_url?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
}

interface CmsClassResponse {
  class?: Array<{
    type_id: string | number;
    type_name: string;
  }>;
}

/**
 * 獲取熱播短劇推薦視頻
 */
export async function GET() {
  try {
    // 檢查內存緩存
    const now = Date.now();
    const CACHE_DURATION = 60 * 60 * 1000; // 1小時

    if (cachedRecommends && now - cachedRecommends.timestamp < CACHE_DURATION) {
      console.log('使用緩存的短劇推薦數據');
      const cacheTime = await getCacheTime();
      return NextResponse.json(
        {
          code: 200,
          message: '獲取成功',
          data: cachedRecommends.data,
        },
        {
          headers: {
            'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          },
        }
      );
    }

    // 獲取短劇視頻源列表
    const sources = await getDuanjuSources();

    if (!sources || sources.length === 0) {
      return NextResponse.json({
        code: 200,
        message: '暫無短劇視頻源',
        data: [],
      });
    }

    // 取第一個視頻源
    const firstSource = sources[0];
    console.log(`使用視頻源: ${firstSource.name}`);

    // 獲取該視頻源的分類列表，找到短劇分類的ID
    const classUrl = `${firstSource.api}?ac=list`;
    const classResponse = await fetch(classUrl, {
      headers: API_CONFIG.search.headers,
    });

    if (!classResponse.ok) {
      throw new Error('獲取分類列表失敗');
    }

    const classData: CmsClassResponse = await classResponse.json();

    // 找到短劇分類的ID
    let duanjuTypeId: string | number | null = null;
    if (classData.class && Array.isArray(classData.class)) {
      const duanjuClass = classData.class.find((item) => {
        const typeName = item.type_name?.toLowerCase() || '';
        return (
          typeName.includes('短劇') ||
          typeName.includes('短視頻') ||
          typeName.includes('微短劇')
        );
      });

      if (duanjuClass) {
        duanjuTypeId = duanjuClass.type_id;
      }
    }

    if (!duanjuTypeId) {
      return NextResponse.json({
        code: 200,
        message: '未找到短劇分類',
        data: [],
      });
    }

    console.log(`短劇分類ID: ${duanjuTypeId}`);

    // 請求該分類下的視頻列表
    const videoListUrl = `${firstSource.api}?ac=videolist&t=${duanjuTypeId}&pg=1`;
    const videoListResponse = await fetch(videoListUrl, {
      headers: API_CONFIG.search.headers,
    });

    if (!videoListResponse.ok) {
      throw new Error('獲取視頻列表失敗');
    }

    const videoListData = await videoListResponse.json();

    if (
      !videoListData ||
      !videoListData.list ||
      !Array.isArray(videoListData.list) ||
      videoListData.list.length === 0
    ) {
      return NextResponse.json({
        code: 200,
        message: '暫無短劇視頻',
        data: [],
      });
    }

    // 處理視頻數據
    const videos: SearchResult[] = videoListData.list.map((item: ApiSearchItem) => {
      let episodes: string[] = [];
      let titles: string[] = [];

      // 使用正則表達式從 vod_play_url 提取 m3u8 鏈接
      if (item.vod_play_url) {
        // 先用 $$$ 分割
        const vod_play_url_array = item.vod_play_url.split('$$$');
        // 分集之間#分割，標題和播放鏈接 $ 分割
        vod_play_url_array.forEach((url: string) => {
          const matchEpisodes: string[] = [];
          const matchTitles: string[] = [];
          const title_url_array = url.split('#');
          title_url_array.forEach((title_url: string) => {
            const episode_title_url = title_url.split('$');
            if (
              episode_title_url.length === 2 &&
              episode_title_url[1].endsWith('.m3u8')
            ) {
              matchTitles.push(episode_title_url[0]);
              matchEpisodes.push(episode_title_url[1]);
            }
          });
          if (matchEpisodes.length > episodes.length) {
            episodes = matchEpisodes;
            titles = matchTitles;
          }
        });
      }

      return {
        id: item.vod_id.toString(),
        title: item.vod_name.trim().replace(/\s+/g, ' '),
        poster: item.vod_pic,
        episodes,
        episodes_titles: titles,
        source: firstSource.key,
        source_name: firstSource.name,
        class: item.vod_class,
        year: item.vod_year ? item.vod_year.match(/\d{4}/)?.[0] || '' : 'unknown',
        desc: cleanHtmlTags(item.vod_content || ''),
        type_name: item.type_name,
        douban_id: item.vod_douban_id,
      };
    });

    // 過濾掉集數為 0 的結果，並限制返回數量
    const filteredVideos = videos
      .filter((video) => video.episodes.length > 0)
      .slice(0, 20);

    console.log(`返回 ${filteredVideos.length} 個短劇視頻`);

    // 保存到內存緩存
    cachedRecommends = {
      timestamp: Date.now(),
      data: filteredVideos,
    };

    const cacheTime = await getCacheTime();
    return NextResponse.json(
      {
        code: 200,
        message: '獲取成功',
        data: filteredVideos,
      },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        },
      }
    );
  } catch (error) {
    console.error('獲取熱播短劇推薦失敗:', error);
    return NextResponse.json(
      {
        code: 500,
        message: '獲取熱播短劇推薦失敗',
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
