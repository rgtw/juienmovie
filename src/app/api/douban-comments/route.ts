import * as cheerio from 'cheerio/slim';
import { NextRequest, NextResponse } from 'next/server';

import { fetchDoubanWithVerification } from '@/lib/douban-anti-crawler';

export const runtime = 'nodejs';

interface DoubanComment {
  id: string;
  userName: string;
  userAvatar: string;
  userUrl: string;
  rating: number | null; // 1-5 星，null 表示未評分
  content: string;
  time: string;
  votes: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const doubanId = searchParams.get('id');
  const start = searchParams.get('start') || '0';
  const limit = searchParams.get('limit') || '20';

  if (!doubanId) {
    return NextResponse.json({ error: 'Missing douban ID' }, { status: 400 });
  }

  try {
    // 請求豆瓣短評頁面（使用反爬驗證）
    const url = `https://movie.douban.com/subject/${doubanId}/comments?start=${start}&limit=${limit}&status=P&sort=new_score`;

    const response = await fetchDoubanWithVerification(url);

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch douban page' },
        { status: response.status }
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const comments: DoubanComment[] = [];

    console.log('開始解析豆瓣評論，start:', start, 'limit:', limit);

    // 解析每條短評
    $('.comment-item').each((index, element) => {
      const $comment = $(element);

      // 提取評論 ID
      const commentId = $comment.attr('data-cid') || '';

      // 提取用戶信息
      const $avatar = $comment.find('.avatar');
      const userUrl = $avatar.find('a').attr('href') || '';
      const userAvatar = $avatar.find('img').attr('src') || '';
      const userName = $avatar.find('a').attr('title') || '';

      // 提取評分（星級）
      const ratingClass = $comment.find('.rating').attr('class') || '';
      let rating: number | null = null;
      const ratingMatch = ratingClass.match(/allstar(\d)0/);
      if (ratingMatch) {
        rating = parseInt(ratingMatch[1]);
      }

      // 提取短評內容
      const $content = $comment.find('.short');
      const content = $content.text().trim();

      // 提取時間
      const $commentInfo = $comment.find('.comment-info');
      const time = $commentInfo.find('.comment-time').attr('title') || '';

      // 提取有用數
      const votesText = $comment.find('.votes.vote-count').text().trim();
      const votes = parseInt(votesText) || 0;

      if (commentId && content) {
        comments.push({
          id: commentId,
          userName,
          userAvatar,
          userUrl,
          rating,
          content,
          time,
          votes,
        });
      }
    });

    console.log('解析到評論數:', comments.length);

    // 獲取總評論數 - 嘗試多種方式
    let total = 0;

    // 方式1: 從標題獲取 "全部 XXX 條"
    const titleText = $('.mod-hd h2, h2, .section-title').text();
    const titleMatch = titleText.match(/全部\s*(\d+)\s*條/);
    if (titleMatch) {
      total = parseInt(titleMatch[1]);
    }

    // 方式2: 從導航標籤獲取 "看過(XXX)"
    if (total === 0) {
      const navText = $('.tabs, .nav-tabs, a').text();
      const navMatch = navText.match(/看過\s*\((\d+)\)/);
      if (navMatch) {
        total = parseInt(navMatch[1]);
      }
    }

    // 方式3: 從頁面所有文本查找
    if (total === 0) {
      const bodyText = $('body').text();
      const bodyMatch = bodyText.match(/全部\s*(\d+)\s*條|看過\s*\((\d+)\)/);
      if (bodyMatch) {
        total = parseInt(bodyMatch[1] || bodyMatch[2]);
      }
    }

    // 方式4: 如果有評論但 total 為 0，至少設置為當前評論數，並假設有更多
    if (total === 0 && comments.length > 0) {
      total = parseInt(start) + comments.length;
      // 如果本次獲取了完整的 limit 數量，可能還有更多
      if (comments.length >= parseInt(limit)) {
        total += 1; // 暫定有更多
      }
    }

    console.log('豆瓣評論統計:', {
      total,
      commentsCount: comments.length,
      start,
      limit,
      hasMore: parseInt(start) + comments.length < total || (total === 0 && comments.length >= parseInt(limit)),
    });

    return NextResponse.json(
      {
        comments,
        total,
        start: parseInt(start),
        limit: parseInt(limit),
        // 如果知道總數，就用總數判斷；否則如果獲取了完整頁，假設還有更多
        hasMore: total > 0
          ? parseInt(start) + comments.length < total
          : comments.length >= parseInt(limit),
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=600, s-maxage=600',
        },
      }
    );
  } catch (error) {
    console.error('Douban comments fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to parse douban comments' },
      { status: 500 }
    );
  }
}
