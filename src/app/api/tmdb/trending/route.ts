/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import { getTMDBTrendingContent, getTMDBVideos } from '@/lib/tmdb.client';

// 緩存配置 - 服務器內存緩存3小時
const CACHE_DURATION = 3 * 60 * 60 * 1000; // 3小時

// 為不同數據源分別維護緩存
let tmdbCache: { data: any; timestamp: number } | null = null;
let txCache: { data: any; timestamp: number } | null = null;
let doubanCache: { data: any; timestamp: number } | null = null;

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 獲取配置
    const config = await getConfig();
    const bannerDataSource = config.SiteConfig?.BannerDataSource || 'Douban';

    // 根據數據源選擇對應的緩存
    const cache = bannerDataSource === 'TX' ? txCache : bannerDataSource === 'Douban' ? doubanCache : tmdbCache;

    // 檢查緩存
    if (cache && Date.now() - cache.timestamp < CACHE_DURATION) {
      return NextResponse.json(cache.data);
    }

    let result: any;

    // 根據配置的數據源獲取數據
    if (bannerDataSource === 'Douban') {
      // 使用豆瓣數據源
      result = await getDoubanBannerContent();
      // 添加數據源標識
      result.source = 'Douban';
      // 更新豆瓣緩存
      doubanCache = {
        data: result,
        timestamp: Date.now(),
      };
    } else if (bannerDataSource === 'TX') {
      // 使用TX數據源
      result = await getTXBannerContent();
      // 添加數據源標識
      result.source = 'TX';
      // 更新TX緩存
      txCache = {
        data: result,
        timestamp: Date.now(),
      };
    } else {
      // 使用TMDB數據源（默認）
      const apiKey = config.SiteConfig?.TMDBApiKey;
      const proxy = config.SiteConfig?.TMDBProxy;
      const reverseProxy = config.SiteConfig?.TMDBReverseProxy;

      if (!apiKey) {
        return NextResponse.json(
          { code: 400, message: 'TMDB API Key 未配置' },
          { status: 400 }
        );
      }

      // 獲取热门內容
      result = await getTMDBTrendingContent(apiKey, proxy, reverseProxy);

      // 為每個項目獲取視頻數據
      if (result.code === 200 && result.list) {
        const itemsWithVideos = await Promise.all(
          result.list.map(async (item: any) => {
            const videoKey = await getTMDBVideos(apiKey, item.media_type, item.id, proxy, reverseProxy);
            return { ...item, video_key: videoKey };
          })
        );
        result.list = itemsWithVideos;
      }

      // 添加數據源標識
      result.source = 'TMDB';
      // 更新TMDB緩存
      tmdbCache = {
        data: result,
        timestamp: Date.now(),
      };
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('獲取热门內容失敗:', error);
    return NextResponse.json(
      { code: 500, message: '獲取热门內容失敗' },
      { status: 500 }
    );
  }
}

/**
 * 獲取TX輪播圖內容
 */
async function getTXBannerContent(): Promise<{ code: number; list: any[] }> {
  try {
    // TX API 配置
    const txApiUrl = 'https://pbaccess.video.qq.com/trpc.vector_layout.page_view.PageService/getPage?video_appid=3000010&vversion_platform=2&vdevice_guid=a458b2024f8d6f14';
    const requestBody = {
      page_params: {
        page_type: 'channel',
        page_id: '100101',
        scene: 'channel',
        new_mark_label_enabled: '1',
        vl_to_mvl: '',
        free_watch_trans_info: '{"ad_frequency_control_time_list":{}}',
        ad_exp_ids: '',
        ams_cookies: 'lv_play_index=33; o_minduid=PBUiqKSklDHZsTs2JqmXhTsczQfz5uzY; appuser=CC19AC2067F39B71',
        ad_trans_data: '{"ad_request_id":"uglfjd6-26n6yw4-gs9tlvy-k19l366","game_sessions":[]}',
        skip_privacy_types: '0',
        support_click_scan: '1',
      },
      page_bypass_params: {
        params: {
          platform_id: '2',
          caller_id: '3000010',
          data_mode: 'default',
          user_mode: 'default',
          specified_strategy: '',
          page_type: 'channel',
          page_id: '100101',
          scene: 'channel',
          new_mark_label_enabled: '1',
        },
        scene: 'channel',
        app_version: '',
        abtest_bypass_id: 'a458b2024f8d6f14',
      },
      page_context: null,
    };

    // 發送請求到TX API
    const response = await fetch(txApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15000),
    });
	
    if (!response.ok) {
      console.error('TX API 請求失敗:', response.status, response.statusText);
      return { code: response.status, list: [] };
    }

    const data = await response.json();

    // 解析響應數據
    const bannerItems = parseTXBannerData(data);

    return {
      code: 200,
      list: bannerItems,
    };
  } catch (error) {
    console.error('獲取 TX 輪播圖數據失敗:', error);
    return { code: 500, list: [] };
  }
}

/**
 * 解析TX API響應數據，提取輪播圖信息
 */
function parseTXBannerData(data: any): any[] {
  try {
    const cardList = data?.data?.CardList;
    if (!Array.isArray(cardList)) {
      return [];
    }

    // 找到所有類型為 pc_shelves 的卡片
    const pcShelvesCards = cardList.filter((card: any) => card.type === 'pc_shelves');
    if (pcShelvesCards.length === 0) {
      return [];
    }

    // 嘗試每個 pc_shelves 卡片，直到找到有效數據
    for (let i = 0; i < pcShelvesCards.length; i++) {
      const pcShelvesCard = pcShelvesCards[i];

      const cards = pcShelvesCard?.children_list?.list?.cards;
      if (!Array.isArray(cards) || cards.length === 0) {
        continue;
      }

    // 轉換為統一格式
    const cardsWithParams = cards.filter((card: any) => card.params);

    const mappedItems = cardsWithParams.map((card: any, index: number) => {
        const params = card.params;

        // 獲取標題（優先使用title）
        const title = params.title || '';

        // 獲取子標題（優先使用priority_sub_title，其次rec_normal_reason）
        const subtitle = params.priority_sub_title || params.rec_normal_reason || '';

        // 獲取標籤（用"|"分割）
        const topicLabel = params.topic_label || '';
        const tags = topicLabel ? topicLabel.split('|').filter(Boolean) : [];

        // 獲取背景圖
        const backdropPath = params.priority_image_url || '';

        return {
          id: index + 1, // 使用索引作為ID
          title,
          subtitle,
          tags,
          backdrop_path: backdropPath,
          poster_path: backdropPath, // 使用相同的圖片
          release_date: '',
          overview: subtitle,
          vote_average: 0,
          media_type: 'tv',
          genre_ids: [],
        };
      });

      const bannerItems = mappedItems.filter((item: any) => {
        // 只保留有標題和背景圖的項目
        if (!item.title || !item.backdrop_path) return false;
        // 剔除標題包含"免費合集"的數據
        if (item.title.includes('免費合集')) return false;
        return true;
      });

      if (bannerItems.length > 0) {
        return bannerItems;
      }
    }

    // 所有 pc_shelves 卡片都沒有有效數據
    return [];
  } catch (error) {
    console.error('解析 TX 輪播圖數據失敗:', error);
    return [];
  }
}

/**
 * 獲取豆瓣輪播圖內容
 */
async function getDoubanBannerContent(): Promise<{ code: number; list: any[] }> {
  try {
    // 獲取豆瓣热门電影
    const hotMoviesUrl = 'https://m.douban.com/rexxar/api/v2/subject/recent_hot/movie?start=0&limit=10&category=热门&type=全部';

    interface DoubanHotMovie {
      id: string;
      title: string;
      card_subtitle?: string;
      pic?: {
        large: string;
        normal: string;
      };
      rating?: {
        value: number;
      };
    }

    interface DoubanHotMoviesResponse {
      items: DoubanHotMovie[];
    }

    const hotMoviesData = await fetchDoubanData<DoubanHotMoviesResponse>(hotMoviesUrl);

    if (!hotMoviesData.items || hotMoviesData.items.length === 0) {
      return { code: 200, list: [] };
    }

    // 取前5個電影
    const topMovies = hotMoviesData.items.slice(0, 5);

    // 為每個電影獲取詳情信息
    const bannerItems = await Promise.all(
      topMovies.map(async (movie) => {
        try {
          const detailUrl = `https://m.douban.com/rexxar/api/v2/subject/${movie.id}`;

          interface DoubanDetailResponse {
            id: string;
            title: string;
            original_title?: string;
            year: string;
            rating?: {
              value: number;
            };
            intro?: string;
            genres?: string[];
            cover_url?: string;
            trailers?: Array<{
              video_url?: string;
              [key: string]: any;
            }>;
            [key: string]: any;
          }

          const detail = await fetchDoubanData<DoubanDetailResponse>(detailUrl);

          // 獲取橫屏圖片
          const backdropPath = detail.cover_url || movie.pic?.large || movie.pic?.normal || '';

          // 提取年份
          const year = detail.year || movie.card_subtitle?.match(/(\d{4})/)?.[1] || '';

          // 從card_subtitle提取標籤（只讀取第二個部分，通過空格分割）
          let tags: string[] = [];
          if (movie.card_subtitle) {
            const parts = movie.card_subtitle.split('/').map(s => s.trim());
            // 過濾掉年份（純數字）和空字符串
            const filteredParts = parts.filter(part =>
              part && !/^\d{4}$/.test(part)
            );
            // 取第二個部分（類型），通過空格分割
            if (filteredParts.length >= 2) {
              tags = filteredParts[1].split(/\s+/).filter(t => t);
            }
          }

          return {
            id: movie.id,
            title: detail.title,
            backdrop_path: backdropPath,
            poster_path: backdropPath,
            release_date: year,
            overview: detail.intro || '',
            vote_average: detail.rating?.value || movie.rating?.value || 0,
            media_type: 'movie',
            genre_ids: [],
            genres: tags, // 使用從card_subtitle提取的標籤
            video_key: null, // 豆瓣不使用YouTube key
          };
        } catch (error) {
          console.error(`獲取豆瓣電影 ${movie.id} 詳情失敗:`, error);

          // 從card_subtitle提取標籤（只讀取第二個部分，通過空格分割）
          let tags: string[] = [];
          if (movie.card_subtitle) {
            const parts = movie.card_subtitle.split('/').map(s => s.trim());
            // 過濾掉年份（純數字）和空字符串
            const filteredParts = parts.filter(part =>
              part && !/^\d{4}$/.test(part)
            );
            // 取第二個部分（類型），通過空格分割
            if (filteredParts.length >= 2) {
              tags = filteredParts[1].split(/\s+/).filter(t => t);
            }
          }

          // 如果獲取詳情失敗，使用基本信息
          return {
            id: movie.id,
            title: movie.title,
            backdrop_path: movie.pic?.large || movie.pic?.normal || '',
            poster_path: movie.pic?.large || movie.pic?.normal || '',
            release_date: movie.card_subtitle?.match(/(\d{4})/)?.[1] || '',
            overview: '',
            vote_average: movie.rating?.value || 0,
            media_type: 'movie',
            genre_ids: [],
            genres: tags, // 使用從card_subtitle提取的標籤
            video_key: null,
          };
        }
      })
    );

    // 過濾掉沒有圖片的項目
    const validBannerItems = bannerItems.filter(item => item.backdrop_path);

    return {
      code: 200,
      list: validBannerItems,
    };
  } catch (error) {
    console.error('獲取豆瓣輪播圖數據失敗:', error);
    return { code: 500, list: [] };
  }
}
