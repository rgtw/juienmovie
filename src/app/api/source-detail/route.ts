/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { getDetailFromApiV2 } from '@/lib/downstream';
import { getProxyToken } from '@/lib/emby-token';
import {
  createBaiduNetdiskSession,
  getBaiduNetdiskSession,
  parseBaiduNetdiskId,
  refreshBaiduNetdiskSession,
} from '@/lib/netdisk/baidu-session-cache';
import {
  createMobileNetdiskSession,
  getMobileNetdiskSession,
  parseMobileNetdiskId,
  refreshMobileNetdiskSession,
} from '@/lib/netdisk/mobile-session-cache';
import {
  createPan123NetdiskSession,
  getPan123NetdiskSession,
  parsePan123NetdiskId,
  refreshPan123NetdiskSession,
} from '@/lib/netdisk/pan123-session-cache';
import {
  createPan115NetdiskSession,
  getPan115NetdiskSession,
  parsePan115NetdiskId,
  refreshPan115NetdiskSession,
} from '@/lib/netdisk/pan115-session-cache';
import {
  createQuarkNetdiskSession,
  getQuarkNetdiskSession,
  parseQuarkNetdiskId,
  refreshQuarkNetdiskSession,
} from '@/lib/netdisk/quark-session-cache';
import {
  LEGACY_QUARK_TEMP_SOURCE,
  NETDISK_115_SOURCE,
  NETDISK_123_SOURCE,
  NETDISK_BAIDU_SOURCE,
  NETDISK_MOBILE_SOURCE,
  NETDISK_QUARK_SOURCE,
  NETDISK_TIANYI_SOURCE,
  NETDISK_UC_SOURCE,
  normalizeNetdiskSource,
} from '@/lib/netdisk/source';
import {
  createTianyiNetdiskSession,
  getTianyiNetdiskSession,
  parseTianyiNetdiskId,
  refreshTianyiNetdiskSession,
} from '@/lib/netdisk/tianyi-session-cache';
import {
  createUCNetdiskSession,
  getUCNetdiskSession,
  parseUCNetdiskId,
  refreshUCNetdiskSession,
} from '@/lib/netdisk/uc-session-cache';
import {
  executeSavedSourceScript,
  normalizeScriptDetailResult,
  normalizeScriptSources,
  parseScriptSourceValue,
} from '@/lib/source-script';

export const runtime = 'nodejs';

function formatNetdiskEpisodeTitle(parsed: {
  season?: number;
  episode?: number;
}, fallback: string) {
  if (parsed.season && parsed.episode) {
    const season = String(Math.trunc(parsed.season)).padStart(2, '0');
    const episodeValue = parsed.episode;
    const episode =
      Number.isInteger(episodeValue)
        ? String(Math.trunc(episodeValue)).padStart(2, '0')
        : String(episodeValue);
    return `S${season}E${episode}`;
  }

  if (parsed.episode) {
    const episodeValue = parsed.episode;
    return Number.isInteger(episodeValue)
      ? `第${Math.trunc(episodeValue)}集`
      : `第${episodeValue}集`;
  }

  return fallback;
}

/**
 * 根據 source 和 id 直接獲取視頻詳情
 * 這個API專門用於play頁面快速獲取當前源的詳情
 */
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const sourceCode = normalizeNetdiskSource(searchParams.get('source'));
  const fileName = searchParams.get('fileName'); // 小雅源：用戶點擊的文件名
  const title = searchParams.get('title');

  if (!id || !sourceCode) {
    return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
  }

  const parsedScriptSource = parseScriptSourceValue(sourceCode);
  if (parsedScriptSource) {
    try {
      const sourcesExecution = await executeSavedSourceScript({
        key: parsedScriptSource.scriptKey,
        hook: 'getSources',
        payload: {},
      });
      const sources = normalizeScriptSources(sourcesExecution.result);
      const sourceInfo =
        sources.find((item) => item.id === parsedScriptSource.sourceId) || {
          id: parsedScriptSource.sourceId,
          name: parsedScriptSource.sourceId,
        };

      const detailExecution = await executeSavedSourceScript({
        key: parsedScriptSource.scriptKey,
        hook: 'detail',
        payload: {
          id,
          sourceId: parsedScriptSource.sourceId,
        },
      });

      const normalized = normalizeScriptDetailResult({
        source: sourceCode,
        scriptKey: parsedScriptSource.scriptKey,
        scriptName: detailExecution.meta?.name || parsedScriptSource.scriptKey,
        sourceId: parsedScriptSource.sourceId,
        sourceName: sourceInfo.name,
        detailId: id,
        result: detailExecution.result,
      });

      return NextResponse.json(normalized);
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  // 特殊處理 emby 源（支持多源）
  if (sourceCode === 'emby' || sourceCode.startsWith('emby_')) {
    try {
      const config = await getConfig();

      // 檢查是否有啟用的 Emby 源
      if (!config.EmbyConfig?.Sources || config.EmbyConfig.Sources.length === 0) {
        throw new Error('Emby 未配置或未啟用');
      }

      // 解析 embyKey
      let embyKey: string | undefined;
      if (sourceCode.startsWith('emby_')) {
        embyKey = sourceCode.substring(5); // 'emby_'.length = 5
      }

      // 使用 EmbyManager 獲取客戶端和配置
      const { embyManager } = await import('@/lib/emby-manager');
      const sources = await embyManager.getEnabledSources();
      const sourceConfig = sources.find(s => s.key === embyKey);
      const sourceName = sourceConfig?.name || 'Emby';

      const client = await embyManager.getClient(embyKey);

      // 獲取代理 token（如果啟用了代理）
      const proxyToken = client.isProxyEnabled() ? await getProxyToken(request) : null;

      // 獲取媒體詳情
      const item = await client.getItem(id);

      // 根據類型處理
      if (item.Type === 'Movie') {
        // 電影
        const subtitles = client.getSubtitles(item);

        const result = {
          source: sourceCode, // 保持與請求一致（emby 或 emby_key）
          source_name: sourceName,
          id: item.Id,
          title: item.Name,
          poster: client.getImageUrl(item.Id, 'Primary', undefined, proxyToken || undefined),
          year: item.ProductionYear?.toString() || '',
          douban_id: 0,
          desc: item.Overview || '',
          episodes: [await client.getStreamUrl(item.Id)],
          episodes_titles: [item.Name],
          subtitles: subtitles.length > 0 ? [subtitles] : [],
          proxyMode: false,
        };

        return NextResponse.json(result);
      } else if (item.Type === 'Series') {
        // 劇集 - 獲取所有季和集
        const seasons = await client.getSeasons(item.Id);
        const allEpisodes: any[] = [];

        for (const season of seasons) {
          const episodes = await client.getEpisodes(item.Id, season.Id);
          allEpisodes.push(...episodes);
        }

        // 按季和集排序
        allEpisodes.sort((a, b) => {
          if (a.ParentIndexNumber !== b.ParentIndexNumber) {
            return (a.ParentIndexNumber || 0) - (b.ParentIndexNumber || 0);
          }
          return (a.IndexNumber || 0) - (b.IndexNumber || 0);
        });

        const result = {
          source: sourceCode, // 保持與請求一致（emby 或 emby_key）
          source_name: sourceName,
          id: item.Id,
          title: item.Name,
          poster: client.getImageUrl(item.Id, 'Primary', undefined, proxyToken || undefined),
          year: item.ProductionYear?.toString() || '',
          douban_id: 0,
          desc: item.Overview || '',
          episodes: await Promise.all(allEpisodes.map((ep) => client.getStreamUrl(ep.Id))),
          episodes_titles: allEpisodes.map((ep) => {
            const seasonNum = ep.ParentIndexNumber || 1;
            const episodeNum = ep.IndexNumber || 1;
            return `S${seasonNum.toString().padStart(2, '0')}E${episodeNum.toString().padStart(2, '0')}`;
          }),
          subtitles: allEpisodes.map((ep) => client.getSubtitles(ep)),
          proxyMode: false,
        };

        return NextResponse.json(result);
      } else {
        throw new Error('不支持的媒體類型');
      }
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  // 特殊處理 xiaoya 源
  if (sourceCode === 'xiaoya') {
    try {
      const config = await getConfig();
      const xiaoyaConfig = config.XiaoyaConfig;

      if (
        !xiaoyaConfig ||
        !xiaoyaConfig.Enabled ||
        !xiaoyaConfig.ServerURL
      ) {
        throw new Error('小雅未配置或未啟用');
      }

      const { XiaoyaClient } = await import('@/lib/xiaoya.client');
      const { getXiaoyaMetadata, getXiaoyaEpisodes } = await import('@/lib/xiaoya-metadata');
      const { base58Decode, base58Encode } = await import('@/lib/utils');

      const client = new XiaoyaClient(
        xiaoyaConfig.ServerURL,
        xiaoyaConfig.Username,
        xiaoyaConfig.Password,
        xiaoyaConfig.Token
      );

      // 對id進行base58解碼得到目錄路徑
      let decodedDirPath: string;
      try {
        decodedDirPath = base58Decode(id);
        console.log('[xiaoya] 解碼目錄路徑:', decodedDirPath);
      } catch (decodeError) {
        console.error('[xiaoya] Base58解碼失敗:', decodeError);
        throw new Error('無效的視頻ID');
      }

      // 驗證解碼後的路徑
      if (!decodedDirPath || decodedDirPath.trim() === '') {
        throw new Error('解碼後的路徑為空');
      }

      // 如果有fileName參數，拼接完整文件路徑
      let clickedFilePath: string | undefined;
      if (fileName) {
        // 拼接目錄路徑和文件名
        clickedFilePath = `${decodedDirPath}${decodedDirPath.endsWith('/') ? '' : '/'}${fileName}`;
        console.log('[xiaoya] 用戶點擊的文件路徑:', clickedFilePath);
      }

      // 獲取元數據（使用目錄路徑或點擊的文件路徑）
      const metadataPath = clickedFilePath || decodedDirPath;
      const metadata = await getXiaoyaMetadata(
        client,
        metadataPath,
        config.SiteConfig.TMDBApiKey,
        config.SiteConfig.TMDBProxy,
        config.SiteConfig.TMDBReverseProxy
      );

      // 獲取集數列表（使用目錄路徑或點擊的文件路徑）
      const episodes = await getXiaoyaEpisodes(client, metadataPath);

      // 如果有點擊的文件路徑，找到對應的集數索引
      let clickedFileIndex = -1;
      if (clickedFilePath) {
        clickedFileIndex = episodes.findIndex(ep => ep.path === clickedFilePath);
        console.log('[xiaoya] 文件在集數列表中的索引:', clickedFileIndex);
      }

      const result = {
        source: 'xiaoya',
        source_name: '小雅',
        id: id, // 保持編碼後的目錄id
        title: metadata.title,
        poster: metadata.poster || '',
        year: metadata.year || '',
        douban_id: 0,
        desc: metadata.plot || '',
        episodes: episodes.map(ep => `/api/xiaoya/play?path=${encodeURIComponent(base58Encode(ep.path))}`),
        episodes_titles: episodes.map(ep => ep.title),
        subtitles: [],
        proxyMode: false,
        // 返回用戶點擊的文件索引（如果找到的話）
        initialEpisodeIndex: clickedFileIndex >= 0 ? clickedFileIndex : undefined,
        // 返回元數據來源
        metadataSource: metadata.source,
      };

      return NextResponse.json(result);
    } catch (error) {
      console.error('[xiaoya] 獲取詳情失敗:', error);
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  if (sourceCode === NETDISK_MOBILE_SOURCE) {
    try {
      const config = await getConfig();
      const mobileConfig = config.NetDiskConfig?.Mobile;
      if (!mobileConfig?.Enabled || !mobileConfig.Authorization) {
        throw new Error('移動雲盤未配置或未啟用');
      }

      let session = refreshMobileNetdiskSession(id) || getMobileNetdiskSession(id);
      if (!session) {
        const payload = parseMobileNetdiskId(id);
        const { listMobileShareVideos } = await import('@/lib/netdisk/mobile.client');
        const result = await listMobileShareVideos(payload.shareUrl, mobileConfig.Authorization);
        session = createMobileNetdiskSession({
          title: title || result.title,
          shareUrl: payload.shareUrl,
          passcode: payload.passcode,
          files: result.files,
        });
      }
      if (!session) {
        throw new Error('移動雲盤播放信息恢復失敗');
      }
      const mobileSession = session;
      const { parseVideoFileName } = await import('@/lib/video-parser');
      const parsedFiles = mobileSession.files.map((file, index) => {
        const parsed = parseVideoFileName(file.name);
          return {
            ...file,
            originalIndex: index,
            sortEpisode: parsed.episode || index + 1,
            isOVA: parsed.isOVA,
            displayTitle: formatNetdiskEpisodeTitle(parsed, file.name),
          };
        }).sort((a, b) => {
        if (a.isOVA && !b.isOVA) return 1;
        if (!a.isOVA && b.isOVA) return -1;
        return a.sortEpisode !== b.sortEpisode
          ? a.sortEpisode - b.sortEpisode
          : a.name.localeCompare(b.name, 'zh-Hans-CN', {
              numeric: true,
              sensitivity: 'base',
            });
      });

      const episodes = parsedFiles.map((file) => (
        `/api/netdisk/mobile/play?id=${encodeURIComponent(mobileSession.id)}&episodeIndex=${file.originalIndex}`
      ));

      return NextResponse.json({
        source: NETDISK_MOBILE_SOURCE,
        source_name: '移動雲盤',
        id: mobileSession.id,
        title: title || mobileSession.title,
        poster: '',
        year: '',
        douban_id: 0,
        desc: `移動雲盤分享：${mobileSession.shareUrl}`,
        episodes,
        episodes_titles: parsedFiles.map((file) => file.displayTitle),
        proxyMode: false,
      });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  if (sourceCode === NETDISK_BAIDU_SOURCE) {
    try {
      const config = await getConfig();
      const baiduConfig = config.NetDiskConfig?.Baidu;
      if (!baiduConfig?.Enabled || !baiduConfig.Cookie) {
        throw new Error('百度網盤未配置或未啟用');
      }

      let session = refreshBaiduNetdiskSession(id) || getBaiduNetdiskSession(id);
      if (!session) {
        const payload = parseBaiduNetdiskId(id);
        const { listBaiduShareVideos } = await import('@/lib/netdisk/baidu.client');
        const result = await listBaiduShareVideos(payload.shareUrl, baiduConfig.Cookie, payload.passcode || '');
        session = createBaiduNetdiskSession({
          title: title || result.title,
          shareUrl: payload.shareUrl,
          passcode: payload.passcode,
          files: result.files,
          meta: result.meta,
          cookie: result.cookie,
        });
      }
      if (!session) {
        throw new Error('百度網盤播放信息恢復失敗');
      }
      const baiduSession = session;
      const { parseVideoFileName } = await import('@/lib/video-parser');
      const parsedFiles = baiduSession.files
        .map((file, index) => {
          const parsed = parseVideoFileName(file.name);
          return {
            ...file,
            originalIndex: index,
            sortEpisode: parsed.episode || index + 1,
            isOVA: parsed.isOVA,
            displayTitle: formatNetdiskEpisodeTitle(parsed, file.name),
          };
        })
        .sort((a, b) => {
          if (a.isOVA && !b.isOVA) return 1;
          if (!a.isOVA && b.isOVA) return -1;
          return a.sortEpisode !== b.sortEpisode
            ? a.sortEpisode - b.sortEpisode
            : a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
        });

      return NextResponse.json({
        source: NETDISK_BAIDU_SOURCE,
        source_name: '百度網盤',
        id: baiduSession.id,
        title: title || baiduSession.title,
        poster: '',
        year: '',
        douban_id: 0,
        desc: `百度網盤分享：${baiduSession.shareUrl}`,
        episodes: parsedFiles.map((file) => (
          `/api/netdisk/baidu/play?id=${encodeURIComponent(baiduSession.id)}&episodeIndex=${file.originalIndex}`
        )),
        episodes_titles: parsedFiles.map((file) => file.displayTitle),
        proxyMode: false,
      });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  if (sourceCode === NETDISK_TIANYI_SOURCE) {
    try {
      const config = await getConfig();
      const tianyiConfig = config.NetDiskConfig?.Tianyi;
      if (!tianyiConfig?.Enabled || !tianyiConfig.Account || !tianyiConfig.Password) {
        throw new Error('天翼雲盤未配置或未啟用');
      }

      let session = refreshTianyiNetdiskSession(id) || getTianyiNetdiskSession(id);
      if (!session) {
        const payload = parseTianyiNetdiskId(id);
        const { listTianyiShareVideos } = await import('@/lib/netdisk/tianyi.client');
        const result = await listTianyiShareVideos(
          payload.shareUrl,
          tianyiConfig.Account,
          tianyiConfig.Password,
          payload.passcode || ''
        );
        session = createTianyiNetdiskSession({
          title: title || result.title,
          shareUrl: payload.shareUrl,
          passcode: payload.passcode,
          shareId: result.shareId,
          shareMode: result.shareMode,
          isFolder: result.isFolder,
          accessCode: result.accessCode,
          files: result.files,
        });
      }
      if (!session) {
        throw new Error('天翼雲盤播放信息恢復失敗');
      }

      const tianyiSession = session;
      const { parseVideoFileName } = await import('@/lib/video-parser');
      const parsedFiles = tianyiSession.files
        .map((file, index) => {
          const parsed = parseVideoFileName(file.name);
          return {
            ...file,
            originalIndex: index,
            sortEpisode: parsed.episode || index + 1,
            isOVA: parsed.isOVA,
            displayTitle: formatNetdiskEpisodeTitle(parsed, file.name),
          };
        })
        .sort((a, b) => {
          if (a.isOVA && !b.isOVA) return 1;
          if (!a.isOVA && b.isOVA) return -1;
          return a.sortEpisode !== b.sortEpisode
            ? a.sortEpisode - b.sortEpisode
            : a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
        });

      return NextResponse.json({
        source: NETDISK_TIANYI_SOURCE,
        source_name: '天翼雲盤',
        id: tianyiSession.id,
        title: title || tianyiSession.title,
        poster: '',
        year: '',
        douban_id: 0,
        desc: `天翼雲盤分享：${tianyiSession.shareUrl}`,
        episodes: parsedFiles.map((file) => (
          `/api/netdisk/tianyi/play?id=${encodeURIComponent(tianyiSession.id)}&episodeIndex=${file.originalIndex}`
        )),
        episodes_titles: parsedFiles.map((file) => file.displayTitle),
        proxyMode: false,
      });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  if (sourceCode === NETDISK_123_SOURCE) {
    try {
      const config = await getConfig();
      const pan123Config = config.NetDiskConfig?.Pan123;
      if (!pan123Config?.Enabled || !pan123Config.Account || !pan123Config.Password) {
        throw new Error('123網盤未配置或未啟用');
      }

      let session = refreshPan123NetdiskSession(id) || getPan123NetdiskSession(id);
      if (!session) {
        const payload = parsePan123NetdiskId(id);
        const { listPan123ShareVideos } = await import('@/lib/netdisk/pan123.client');
        const result = await listPan123ShareVideos(payload.shareUrl, payload.passcode || '');
        session = createPan123NetdiskSession({
          title: title || result.title,
          shareUrl: payload.shareUrl,
          passcode: payload.passcode,
          files: result.files,
        });
      }
      if (!session) {
        throw new Error('123網盤播放信息恢復失敗');
      }

      const pan123Session = session;
      const { parseVideoFileName } = await import('@/lib/video-parser');
      const parsedFiles = pan123Session.files
        .map((file, index) => {
          const parsed = parseVideoFileName(file.fileName);
          return {
            ...file,
            originalIndex: index,
            sortEpisode: parsed.episode || index + 1,
            isOVA: parsed.isOVA,
            displayTitle: formatNetdiskEpisodeTitle(parsed, file.fileName),
          };
        })
        .sort((a, b) => {
          if (a.isOVA && !b.isOVA) return 1;
          if (!a.isOVA && b.isOVA) return -1;
          return a.sortEpisode !== b.sortEpisode
            ? a.sortEpisode - b.sortEpisode
            : a.fileName.localeCompare(b.fileName, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
        });

      return NextResponse.json({
        source: NETDISK_123_SOURCE,
        source_name: '123網盤',
        id: pan123Session.id,
        title: title || pan123Session.title,
        poster: '',
        year: '',
        douban_id: 0,
        desc: `123網盤分享：${pan123Session.shareUrl}`,
        episodes: parsedFiles.map((file) => (
          `/api/netdisk/123/play?id=${encodeURIComponent(pan123Session.id)}&episodeIndex=${file.originalIndex}`
        )),
        episodes_titles: parsedFiles.map((file) => file.displayTitle),
        proxyMode: false,
      });
    } catch (error) {
      console.error('[netdisk-123][source-detail] error', error);
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  if (sourceCode === NETDISK_115_SOURCE) {
    try {
      const config = await getConfig();
      const pan115Config = config.NetDiskConfig?.Pan115;
      if (!pan115Config?.Enabled || !pan115Config.Cookie) {
        throw new Error('115網盤未配置或未啟用');
      }

      let session = refreshPan115NetdiskSession(id) || getPan115NetdiskSession(id);
      if (!session) {
        const payload = parsePan115NetdiskId(id);
        const { listPan115ShareVideos } = await import('@/lib/netdisk/pan115.client');
        const result = await listPan115ShareVideos(payload.shareUrl, payload.passcode || '');
        session = createPan115NetdiskSession({
          title: title || result.title,
          shareUrl: payload.shareUrl,
          passcode: payload.passcode,
          files: result.files,
        });
      }
      if (!session) {
        throw new Error('115網盤播放信息恢復失敗');
      }

      const pan115Session = session;
      const { parseVideoFileName } = await import('@/lib/video-parser');
      const parsedFiles = pan115Session.files
        .map((file, index) => {
          const parsed = parseVideoFileName(file.name);
          return {
            ...file,
            originalIndex: index,
            sortEpisode: parsed.episode || index + 1,
            isOVA: parsed.isOVA,
            displayTitle: formatNetdiskEpisodeTitle(parsed, file.name),
          };
        })
        .sort((a, b) => {
          if (a.isOVA && !b.isOVA) return 1;
          if (!a.isOVA && b.isOVA) return -1;
          return a.sortEpisode !== b.sortEpisode
            ? a.sortEpisode - b.sortEpisode
            : a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
        });

      return NextResponse.json({
        source: NETDISK_115_SOURCE,
        source_name: '115網盤',
        id: pan115Session.id,
        title: title || pan115Session.title,
        poster: '',
        year: '',
        douban_id: 0,
        desc: `115網盤分享：${pan115Session.shareUrl}`,
        episodes: parsedFiles.map((file) => (
          `/api/netdisk/115/play?id=${encodeURIComponent(pan115Session.id)}&episodeIndex=${file.originalIndex}`
        )),
        episodes_titles: parsedFiles.map((file) => file.displayTitle),
        proxyMode: false,
      });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  if (sourceCode === NETDISK_QUARK_SOURCE || sourceCode === LEGACY_QUARK_TEMP_SOURCE) {
    try {
      const config = await getConfig();
      const quarkConfig = config.NetDiskConfig?.Quark;
      if (!quarkConfig?.Enabled || !quarkConfig.Cookie) {
        throw new Error('夸克網盤未配置或未啟用');
      }
      const { parseVideoFileName } = await import('@/lib/video-parser');

      let session = refreshQuarkNetdiskSession(id) || getQuarkNetdiskSession(id);
      if (!session) {
        const payload = parseQuarkNetdiskId(id);
        const { listQuarkShareVideos } = await import('@/lib/netdisk/quark.client');
        const result = await listQuarkShareVideos(payload.shareUrl, quarkConfig.Cookie, payload.passcode || '');
        session = createQuarkNetdiskSession({
          title: title || result.title,
          shareUrl: payload.shareUrl,
          passcode: payload.passcode,
          shareId: result.shareId,
          shareToken: result.shareToken,
          files: result.files,
        });
      }
      if (!session) {
        throw new Error('夸克網盤播放信息恢復失敗');
      }

      const quarkSession = session;
      const episodes = quarkSession.files
        .map((file, index) => {
          const parsed = parseVideoFileName(file.name);
          return {
            originalIndex: index,
            fileName: file.name,
            episode: parsed.episode || index + 1,
            title: formatNetdiskEpisodeTitle(parsed, file.name),
            isOVA: parsed.isOVA,
          };
        })
        .sort((a, b) => {
          if (a.isOVA && !b.isOVA) return 1;
          if (!a.isOVA && b.isOVA) return -1;
          return a.episode !== b.episode
            ? a.episode - b.episode
            : a.fileName.localeCompare(b.fileName);
        });

      return NextResponse.json({
        source: NETDISK_QUARK_SOURCE,
        source_name: '夸克網盤',
        id: quarkSession.id,
        title: title || quarkSession.title,
        poster: '',
        year: '',
        douban_id: 0,
        desc: `夸克網盤分享：${quarkSession.shareUrl}`,
        episodes: episodes.map((ep) => (
          `/api/netdisk/quark/play?id=${encodeURIComponent(quarkSession.id)}&episodeIndex=${ep.originalIndex}`
        )),
        episodes_titles: episodes.map((ep) => ep.title),
        proxyMode: false,
      });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  if (sourceCode === NETDISK_UC_SOURCE) {
    try {
      const config = await getConfig();
      const ucConfig = config.NetDiskConfig?.UC;
      if (!ucConfig?.Enabled || !ucConfig.Cookie) {
        throw new Error('UC網盤未配置或未啟用');
      }
      const { parseVideoFileName } = await import('@/lib/video-parser');

      let session = refreshUCNetdiskSession(id) || getUCNetdiskSession(id);
      if (!session) {
        const payload = parseUCNetdiskId(id);
        const { listUCShareVideos } = await import('@/lib/netdisk/uc.client');
        const result = await listUCShareVideos(payload.shareUrl, ucConfig.Cookie, payload.passcode || '');
        session = createUCNetdiskSession({
          title: title || result.title,
          shareUrl: payload.shareUrl,
          passcode: payload.passcode,
          shareId: result.shareId,
          shareToken: result.shareToken,
          files: result.files,
        });
      }
      if (!session) {
        throw new Error('UC網盤播放信息恢復失敗');
      }

      const ucSession = session;
      const episodes = ucSession.files
        .map((file, index) => {
          const parsed = parseVideoFileName(file.name);
          return {
            originalIndex: index,
            fileName: file.name,
            episode: parsed.episode || index + 1,
            title: formatNetdiskEpisodeTitle(parsed, file.name),
            isOVA: parsed.isOVA,
          };
        })
        .sort((a, b) => {
          if (a.isOVA && !b.isOVA) return 1;
          if (!a.isOVA && b.isOVA) return -1;
          return a.episode !== b.episode
            ? a.episode - b.episode
            : a.fileName.localeCompare(b.fileName);
        });

      return NextResponse.json({
        source: NETDISK_UC_SOURCE,
        source_name: 'UC網盤',
        id: ucSession.id,
        title: title || ucSession.title,
        poster: '',
        year: '',
        douban_id: 0,
        desc: `UC網盤分享：${ucSession.shareUrl}`,
        episodes: episodes.map((ep) => (
          `/api/netdisk/uc/play?id=${encodeURIComponent(ucSession.id)}&episodeIndex=${ep.originalIndex}`
        )),
        episodes_titles: episodes.map((ep) => ep.title),
        proxyMode: false,
      });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  // 特殊處理 openlist 源 - 直接調用 /api/detail
  if (sourceCode === 'openlist') {
    try {
      const config = await getConfig();
      const openListConfig = config.OpenListConfig;

      if (
        !openListConfig ||
        !openListConfig.Enabled ||
        !openListConfig.URL ||
        !openListConfig.Username ||
        !openListConfig.Password
      ) {
        throw new Error('OpenList 未配置或未啟用');
      }

      const rootPath = openListConfig.RootPath || '/';

      // 1. 讀取 metainfo 獲取元數據
      let metaInfo: any = null;
      let folderMeta: any = null;
      try {
        const { getCachedMetaInfo, setCachedMetaInfo } = await import('@/lib/openlist-cache');
        const { db } = await import('@/lib/db');

        metaInfo = getCachedMetaInfo();

        if (!metaInfo) {
          const metainfoJson = await db.getGlobalValue('video.metainfo');
          if (metainfoJson) {
            metaInfo = JSON.parse(metainfoJson);
            setCachedMetaInfo(metaInfo);
          }
        }

        // 使用 key 查找文件夾信息
        folderMeta = metaInfo?.folders?.[id];
        if (!folderMeta) {
          throw new Error('未找到該視頻信息');
        }
      } catch (error) {
        throw new Error('讀取視頻信息失敗: ' + (error as Error).message);
      }

      // 使用 folderName 構建實際路徑
      const folderName = folderMeta.folderName;
      const folderPath = `${rootPath}${rootPath.endsWith('/') ? '' : '/'}${folderName}`;

      // 2. 直接調用 OpenList 客戶端獲取視頻列表
      const { OpenListClient } = await import('@/lib/openlist.client');
      const { getCachedVideoInfo, setCachedVideoInfo } = await import('@/lib/openlist-cache');
      const { parseVideoFileName } = await import('@/lib/video-parser');

      const client = new OpenListClient(
        openListConfig.URL,
        openListConfig.Username,
        openListConfig.Password
      );

      let videoInfo = getCachedVideoInfo(folderPath);

      // 獲取所有分頁的視頻文件
      const allFiles: any[] = [];
      let currentPage = 1;
      const pageSize = 100;
      let total = 0;
      let hasMore = true;

      while (hasMore) {
        const listResponse = await client.listDirectory(folderPath, currentPage, pageSize);

        if (listResponse.code !== 200) {
          throw new Error('OpenList 列表獲取失敗4');
        }

        total = listResponse.data.total;
        allFiles.push(...listResponse.data.content);

        hasMore = allFiles.length < total;
        currentPage++;
      }

      const videoExtensions = ['.mp4', '.mkv', '.avi', '.m3u8', '.flv', '.ts', '.mov', '.wmv', '.webm', '.rmvb', '.rm', '.mpg', '.mpeg', '.3gp', '.f4v', '.m4v', '.vob'];
      const videoFiles = allFiles.filter((item) => {
        if (item.is_dir || item.name.startsWith('.') || item.name.endsWith('.json')) return false;
        return videoExtensions.some(ext => item.name.toLowerCase().endsWith(ext));
      });

      if (!videoInfo) {
        videoInfo = { episodes: {}, last_updated: Date.now() };
        videoFiles.sort((a, b) => a.name.localeCompare(b.name));
        for (let i = 0; i < videoFiles.length; i++) {
          const file = videoFiles[i];
          const parsed = parseVideoFileName(file.name);
          videoInfo.episodes[file.name] = {
            episode: parsed.episode || (i + 1),
            season: parsed.season,
            title: parsed.title,
            parsed_from: 'filename',
            isOVA: parsed.isOVA,
          };
        }
        setCachedVideoInfo(folderPath, videoInfo);
      }

      const episodes = videoFiles
        .map((file, index) => {
          const parsed = parseVideoFileName(file.name);
          let episodeInfo;
          if (parsed.episode) {
            episodeInfo = { episode: parsed.episode, season: parsed.season, title: parsed.title, parsed_from: 'filename', isOVA: parsed.isOVA };
          } else {
            episodeInfo = videoInfo!.episodes[file.name] || { episode: index + 1, season: undefined, title: undefined, parsed_from: 'filename' };
          }
          let displayTitle = episodeInfo.title;
          if (!displayTitle && episodeInfo.episode) {
            displayTitle = episodeInfo.isOVA ? `OVA ${episodeInfo.episode}` : `第${episodeInfo.episode}集`;
          }
          if (!displayTitle) {
            displayTitle = file.name;
          }
          return { fileName: file.name, episode: episodeInfo.episode || 0, season: episodeInfo.season, title: displayTitle, isOVA: episodeInfo.isOVA };
        })
        .sort((a, b) => {
          // OVA 排在最後
          if (a.isOVA && !b.isOVA) return 1;
          if (!a.isOVA && b.isOVA) return -1;
          // 都是 OVA 或都不是 OVA，按集數排序
          return a.episode !== b.episode ? a.episode - b.episode : a.fileName.localeCompare(b.fileName);
        });

      // 3. 從 metainfo 中獲取元數據
      const { getTMDBImageUrl } = await import('@/lib/tmdb.search');

      const result = {
        source: 'openlist',
        source_name: '私人影庫',
        id: id,
        title: folderMeta?.title || folderName,
        poster: folderMeta?.poster_path ? getTMDBImageUrl(folderMeta.poster_path) : '',
        year: folderMeta?.release_date ? folderMeta.release_date.split('-')[0] : '',
        douban_id: 0,
        desc: folderMeta?.overview || '',
        episodes: episodes.map((ep) => `/api/openlist/play?folder=${encodeURIComponent(folderName)}&fileName=${encodeURIComponent(ep.fileName)}`),
        episodes_titles: episodes.map((ep) => ep.title),
        proxyMode: false, // openlist 源不使用代理模式
      };

      return NextResponse.json(result);
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  if (!/^[\w-]+$/.test(id)) {
    return NextResponse.json({ error: '無效的視頻ID格式' }, { status: 400 });
  }

  // 對於其他採集源，直接按 id 獲取詳情。
  try {
    const apiSites = await getAvailableApiSites(authInfo.username);
    const apiSite = apiSites.find((site) => site.key === sourceCode);

    if (!apiSite) {
      return NextResponse.json({ error: '無效的API來源' }, { status: 400 });
    }

    const result = await getDetailFromApiV2(apiSite, id);

    // 添加 proxyMode 到返回結果
    const resultWithProxy = {
      ...result,
      proxyMode: apiSite.proxyMode || false,
    };

    const cacheTime = await getCacheTime();

    return NextResponse.json(resultWithProxy, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
