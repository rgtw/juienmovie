/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { requireFeaturePermission } from '@/lib/permissions';
import { OpenListClient } from '@/lib/openlist.client';

export const runtime = 'nodejs';

/**
 * 使用 HEAD 請求跟隨重定向獲取最終 URL（直連方法 - 降級使用）
 */
async function getFinalUrl(url: string, maxRedirects = 5): Promise<string> {
  let currentUrl = url;
  let redirectCount = 0;

  while (redirectCount < maxRedirects) {
    try {
      const response = await fetch(currentUrl, {
        method: 'HEAD',
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return currentUrl;
        }

        if (location.startsWith('http://') || location.startsWith('https://')) {
          currentUrl = location;
        } else if (location.startsWith('/')) {
          const urlObj = new URL(currentUrl);
          currentUrl = `${urlObj.protocol}//${urlObj.host}${location}`;
        } else {
          const urlObj = new URL(currentUrl);
          const pathParts = urlObj.pathname.split('/');
          pathParts.pop();
          pathParts.push(location);
          currentUrl = `${urlObj.protocol}//${urlObj.host}${pathParts.join('/')}`;
        }

        redirectCount++;
      } else {
        return currentUrl;
      }
    } catch (error) {
      console.error('[openlist/play] 獲取最終 URL 失敗:', error);
      return currentUrl;
    }
  }

  return currentUrl;
}

/**
 * GET /api/openlist/play?folder=xxx&fileName=xxx&format=json
 * 獲取單個視頻文件的播放鏈接（優先使用視頻預覽流，失敗時降級到直連）
 * format=json: 返回 JSON 格式（用於 play 頁面）
 * 默認: 返回重定向（用於 tvbox 等）
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
    const fileName = searchParams.get('fileName');
    const format = searchParams.get('format'); // 新增 format 參數

    if (!folderName || !fileName) {
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
    const filePath = `${folderPath}/${fileName}`;

    const client = new OpenListClient(
      openListConfig.URL,
      openListConfig.Username,
      openListConfig.Password
    );

    // 如果啟用了禁用預覽視頻，直接使用直連方法
    if (openListConfig.DisableVideoPreview) {
      const fileResponse = await client.getFile(filePath);

      if (fileResponse.code !== 200 || !fileResponse.data.raw_url) {
        console.error('[OpenList Play] 獲取播放URL失敗:', {
          fileName,
          code: fileResponse.code,
          message: fileResponse.message,
        });
        return NextResponse.json(
          { error: '獲取播放鏈接失敗' },
          { status: 500 }
        );
      }

      // 如果指定了 format=json，使用 getFinalUrl 並返回 JSON
      if (format === 'json') {
        const finalUrl = await getFinalUrl(fileResponse.data.raw_url);

        // 檢查URL是否為空
        if (!finalUrl || finalUrl.trim() === '') {
          throw new Error('獲取到的播放鏈接為空');
        }

        return NextResponse.json({ url: finalUrl });
      }

      // 檢查URL是否為空
      if (!fileResponse.data.raw_url || fileResponse.data.raw_url.trim() === '') {
        throw new Error('獲取到的播放鏈接為空');
      }

      // 默認返回重定向（用於 tvbox）
      return NextResponse.redirect(fileResponse.data.raw_url);
    }

    // 優先嚐試視頻預覽流方法
    try {
      const data = await client.getVideoPreview(filePath);

      const taskList = data.data?.video_preview_play_info?.live_transcoding_task_list;
      if (!taskList || taskList.length === 0) {
        throw new Error('未找到可用的播放鏈接');
      }

      const qualityOrder: Record<string, number> = {
        'FHD': 1,
        'HD': 2,
        'LD': 3,
        'SD': 4,
      };

      const qualities = taskList
        .filter((task: any) => task.status === 'finished')
        .map((task: any) => ({
          name: task.template_id,
          url: task.url,
        }))
        .filter((quality: any) => quality.url && quality.url.trim() !== '') // 過濾空URL
        .sort((a: any, b: any) => (qualityOrder[a.name] || 999) - (qualityOrder[b.name] || 999));

      if (qualities.length === 0) {
        throw new Error('未找到已完成的播放鏈接');
      }

      // 如果指定了 format=json，嘗試解析到最終直鏈後再返回 JSON
      if (format === 'json') {
        const resolvedQualities = await Promise.all(
          qualities.map(async (quality: any) => ({
            ...quality,
            url: await getFinalUrl(quality.url),
          }))
        );

        return NextResponse.json({
          url: resolvedQualities[0].url,
          qualities: resolvedQualities,
        });
      }

      // 默認返回重定向（用於 tvbox）
      return NextResponse.redirect(qualities[0].url);
    } catch (error) {
      // 視頻預覽流失敗，降級到直連方法
      console.log('[openlist/play] 視頻預覽流失敗，降級到直連方法:', (error as Error).message);

      const fileResponse = await client.getFile(filePath);

      if (fileResponse.code !== 200 || !fileResponse.data.raw_url) {
        console.error('[OpenList Play] 獲取播放URL失敗:', {
          fileName,
          code: fileResponse.code,
          message: fileResponse.message,
        });
        return NextResponse.json(
          { error: '獲取播放鏈接失敗' },
          { status: 500 }
        );
      }

      // 如果指定了 format=json，使用 getFinalUrl 並返回 JSON
      if (format === 'json') {
        const finalUrl = await getFinalUrl(fileResponse.data.raw_url);

        // 檢查URL是否為空
        if (!finalUrl || finalUrl.trim() === '') {
          throw new Error('獲取到的播放鏈接為空');
        }

        return NextResponse.json({ url: finalUrl });
      }

      // 檢查URL是否為空
      if (!fileResponse.data.raw_url || fileResponse.data.raw_url.trim() === '') {
        throw new Error('獲取到的播放鏈接為空');
      }

      // 默認返回重定向（用於 tvbox）
      return NextResponse.redirect(fileResponse.data.raw_url);
    }
  } catch (error) {
    console.error('獲取播放鏈接失敗:', error);
    return NextResponse.json(
      { error: '獲取失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}