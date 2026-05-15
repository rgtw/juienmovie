import { nanoid } from 'nanoid';
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getStorage } from '@/lib/db';
import { MovieRequest } from '@/lib/types';

export const runtime = 'nodejs';

// GET: 獲取求片列表
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as 'pending' | 'fulfilled' | null;
    const detail = searchParams.get('detail') !== 'false';
    const myRequests = searchParams.get('my') === 'true';

    const storage = getStorage();

    if (myRequests) {
      // 獲取用戶自己的求片
      const requestIds = await storage.getUserMovieRequests(authInfo.username);
      const requests = await Promise.all(
        requestIds.map(id => storage.getMovieRequest(id))
      );
      const filtered = requests.filter(r => r !== null) as MovieRequest[];
      return NextResponse.json({ requests: filtered });
    }

    // 獲取所有求片
    let requests = await storage.getAllMovieRequests();

    // 按狀態篩選
    if (status) {
      requests = requests.filter(r => r.status === status);
    }

    // 列表頁不返回 requestedBy
    if (!detail) {
      requests = requests.map(r => ({ ...r, requestedBy: [] }));
    }

    // 按求片人數和時間排序
    requests.sort((a, b) => {
      if (b.requestCount !== a.requestCount) {
        return b.requestCount - a.requestCount;
      }
      return b.createdAt - a.createdAt;
    });

    return NextResponse.json({ requests });
  } catch (error) {
    console.error('獲取求片列表失敗:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

// POST: 創建或加入求片
export async function POST(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 檢查求片功能是否啟用並獲取冷卻時間
    const { getConfig } = await import('@/lib/config');
    const config = await getConfig();

    if (config.SiteConfig.EnableMovieRequest === false) {
      return NextResponse.json({ error: '求片功能已關閉' }, { status: 403 });
    }

    const body = await request.json();
    const { tmdbId, title, year, mediaType, season, poster, overview } = body;

    if (!title || !mediaType) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    const storage = getStorage();

    // 檢查頻率限制 - 使用配置中的冷卻時間
    const cooldownSeconds = config.SiteConfig.MovieRequestCooldown ?? 3600;
    const rateLimit = cooldownSeconds * 1000;

    if (storage.getUserInfoV2) {
      const userInfo = await storage.getUserInfoV2(authInfo.username);
      if (userInfo?.last_movie_request_time) {
        const elapsed = Date.now() - userInfo.last_movie_request_time;
        if (elapsed < rateLimit) {
          const remaining = Math.ceil((rateLimit - elapsed) / 60000);
          return NextResponse.json(
            { error: `操作太頻繁，請${remaining}分鐘後再試` },
            { status: 429 }
          );
        }
      }
    }

    // 查重（劇集需要匹配季度）
    const allRequests = await storage.getAllMovieRequests();
    const existing = allRequests.find(r =>
      (tmdbId && r.tmdbId === tmdbId && r.season === season) ||
      (r.title === title && r.year === year && r.season === season)
    );

    if (existing) {
      // 如果已上架，不允許再求
      if (existing.status === 'fulfilled') {
        return NextResponse.json({ error: '該影片已上架' }, { status: 400 });
      }

      // 檢查用戶是否已經求過
      if (existing.requestedBy.includes(authInfo.username)) {
        return NextResponse.json({ error: '您已經求過這部影片了' }, { status: 400 });
      }

      // 加入求片
      existing.requestedBy.push(authInfo.username);
      existing.requestCount++;
      existing.updatedAt = Date.now();
      await storage.updateMovieRequest(existing.id, existing);
      await storage.addUserMovieRequest(authInfo.username, existing.id);

      // 給站長髮送通知
      const ownerUsername = process.env.USERNAME;
      if (ownerUsername) {
        await storage.addNotification(ownerUsername, {
          id: `movie_request_join_${existing.id}_${Date.now()}`,
          type: 'movie_request',
          title: '求片人數增加',
          message: `${authInfo.username} 也想看：${existing.title}${existing.season ? ` 第${existing.season}季` : ''} (${existing.requestCount}人)`,
          timestamp: Date.now(),
          read: false,
          metadata: {
            requestId: existing.id,
            username: authInfo.username,
          },
        });
      }

      return NextResponse.json({
        message: '已加入求片',
        request: existing
      });
    }

    // 創建新求片
    const newRequest: MovieRequest = {
      id: nanoid(),
      tmdbId,
      title,
      year,
      mediaType,
      season,
      poster,
      overview,
      requestedBy: [authInfo.username],
      requestCount: 1,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await storage.createMovieRequest(newRequest);
    await storage.addUserMovieRequest(authInfo.username, newRequest.id);

    // 更新頻率限制 - 使用抽象方法兼容所有存儲類型
    if (storage.updateLastMovieRequestTime) {
      await storage.updateLastMovieRequestTime(authInfo.username, Date.now());

      // 清除用戶信息緩存，確保下次讀取到最新數據
      const { userInfoCache } = await import('@/lib/user-cache');
      userInfoCache?.delete(authInfo.username);
    }

    // 給站長髮送通知
    const ownerUsername = process.env.USERNAME;
    if (ownerUsername) {
      await storage.addNotification(ownerUsername, {
        id: `movie_request_${newRequest.id}_${Date.now()}`,
        type: 'movie_request',
        title: '新求片請求',
        message: `${authInfo.username} 求片：${title}${season ? ` 第${season}季` : ''}`,
        timestamp: Date.now(),
        read: false,
        metadata: {
          requestId: newRequest.id,
          username: authInfo.username,
        },
      });
    }

    return NextResponse.json({
      message: '求片成功',
      request: newRequest
    });
  } catch (error) {
    console.error('創建求片失敗:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
