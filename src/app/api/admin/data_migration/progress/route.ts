/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getProgress } from '@/lib/data-migration-progress';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  // 驗證身份和權限
  const authInfo = getAuthInfoFromCookie(req);
  if (!authInfo || !authInfo.username) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (authInfo.username !== process.env.USERNAME) {
    return new Response('Forbidden', { status: 403 });
  }

  const username = authInfo.username; // 存儲到局部變量以便 TypeScript 類型推斷

  const { searchParams } = new URL(req.url);
  const operation = searchParams.get('operation'); // 'export' or 'import'

  if (!operation) {
    return new Response('Missing operation parameter', { status: 400 });
  }

  // 創建 SSE 響應
  const encoder = new TextEncoder();
  let interval: NodeJS.Timeout | null = null;
  let timeout: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const sendProgress = () => {
        try {
          const progress = getProgress(username, operation as 'export' | 'import');
          if (progress) {
            const data = JSON.stringify(progress);
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
        } catch (error) {
          // 如果控制器已關閉，清理定時器
          if (interval) clearInterval(interval);
          if (timeout) clearTimeout(timeout);
        }
      };

      // 立即發送一次
      sendProgress();

      // 每秒發送一次進度更新
      interval = setInterval(sendProgress, 1000);

      // 30秒後自動關閉連接
      timeout = setTimeout(() => {
        if (interval) clearInterval(interval);
        try {
          controller.close();
        } catch (error) {
          // 控制器可能已經關閉
        }
      }, 30000);
    },
    cancel() {
      // 當客戶端斷開連接時清理
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
