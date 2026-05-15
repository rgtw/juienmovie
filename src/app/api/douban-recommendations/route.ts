import * as cheerio from 'cheerio/slim';
import { NextRequest, NextResponse } from 'next/server';

import { fetchDoubanData } from '@/lib/douban';
import { fetchDoubanWithVerification } from '@/lib/douban-anti-crawler';

export const runtime = 'nodejs';

interface DoubanRecommendation {
  doubanId: string;
  title: string;
  poster: string;
  rating: string;
}

interface DoubanDetailApiResponse {
  id: string;
  title: string;
  [key: string]: any;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const doubanId = searchParams.get('id');

  if (!doubanId) {
    return NextResponse.json({ error: 'Missing douban ID' }, { status: 400 });
  }

  try {
    // 請求豆瓣電影頁面（使用反爬驗證）
    const url = `https://movie.douban.com/subject/${doubanId}/`;

    const response = await fetchDoubanWithVerification(url);

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch douban page' },
        { status: response.status }
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const recommendations: DoubanRecommendation[] = [];

    console.log('開始解析豆瓣推薦');

    // 解析推薦模塊
    $('.recommendations-bd dl').each((index, element) => {
      const $dl = $(element);

      // 提取鏈接和豆瓣ID
      const $link = $dl.find('dt a');
      const href = $link.attr('href') || '';
      const doubanIdMatch = href.match(/subject\/(\d+)/);
      const recDoubanId = doubanIdMatch ? doubanIdMatch[1] : '';

      // 提取圖片 - 返回原始豆瓣URL，由客戶端processImageUrl根據配置處理
      const poster = $link.find('img').attr('src') || '';

      // 提取標題
      const title = $dl.find('dd a').first().text().trim();

      // 提取評分
      const rating = $dl.find('dd .subject-rate').text().trim();

      if (recDoubanId && title) {
        recommendations.push({
          doubanId: recDoubanId,
          title,
          poster,
          rating,
        });
      }
    });

    console.log('解析到推薦數:', recommendations.length);

    // 處理標題截斷問題
    const processedRecommendations: DoubanRecommendation[] = [];

    for (const rec of recommendations) {
      // 檢查標題是否被截斷（包含三個點）
      if (rec.title.includes('...')) {
        console.log(`檢測到截斷標題: ${rec.title}, ID: ${rec.doubanId}`);

        try {
          // 調用豆瓣詳情接口獲取完整名稱
          const detailUrl = `https://m.douban.com/rexxar/api/v2/subject/${rec.doubanId}`;
          const detailData = await fetchDoubanData<DoubanDetailApiResponse>(detailUrl);

          if (detailData && detailData.title) {
            console.log(`成功獲取完整標題: ${detailData.title}`);
            processedRecommendations.push({
              ...rec,
              title: detailData.title,
            });
          } else {
            console.log(`詳情接口未返回標題，移除該視頻: ${rec.doubanId}`);
            // 補充失敗，不添加到結果中
          }
        } catch (error) {
          console.error(`獲取完整標題失敗，移除該視頻: ${rec.doubanId}`, error);
          // 補充失敗，不添加到結果中
        }
      } else {
        // 標題正常，直接添加
        processedRecommendations.push(rec);
      }
    }

    console.log('處理後的推薦數:', processedRecommendations.length);

    return NextResponse.json(
      {
        recommendations: processedRecommendations,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      }
    );
  } catch (error) {
    console.error('Douban recommendations fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to parse douban recommendations' },
      { status: 500 }
    );
  }
}
