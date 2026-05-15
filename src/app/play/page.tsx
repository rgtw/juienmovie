/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import { AlertCircle, Cloud, Heart, Loader2, Router, Sparkles, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import {
  clearDanmakuCacheByTitle,
  convertDanmakuFormat,
  getDanmakuById,
  getDanmakuFromCache,
  getEpisodes,
  initDanmakuModule,
  loadDanmakuDisplayState,
  loadDanmakuSettings,
  saveDanmakuDisplayState,
  saveDanmakuSettings,
  searchAnime,
} from '@/lib/danmaku/api';
import {
  getDanmakuAnimeId,
  getDanmakuSearchKeyword,
  getDanmakuSourceIndex,
  getManualDanmakuSelection,
  saveDanmakuAnimeId,
  saveDanmakuSearchKeyword,
  saveDanmakuSourceIndex,
  saveManualDanmakuSelection,
} from '@/lib/danmaku/selection-memory';
import type { DanmakuAnime, DanmakuComment, DanmakuSelection, DanmakuSettings } from '@/lib/danmaku/types';
import {
  deleteFavorite,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getDanmakuFilterConfig,
  getEpisodeFilterConfig,
  getSkipConfig,
  isFavorited,
  migratePlayRecord,
  saveFavorite,
  savePlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanDetail } from '@/lib/douban.client';
import { isEpisodeHiddenByFilter, normalizeEpisodeFilterConfig } from '@/lib/episode-filter';
import {
  buildEpisodeProgressContentKey,
  loadLocalEpisodeProgress,
  pruneLocalEpisodeProgressStorage,
  saveLocalEpisodeProgress,
} from '@/lib/episode-progress';
import { isNetdiskSource, normalizeNetdiskSource } from '@/lib/netdisk/source';
import {
  getRecommendationCache,
  recommendationCacheKeys,
  setRecommendationCache,
} from '@/lib/recommendations/cache';
import { getTMDBImageUrl } from '@/lib/tmdb.search';
import { DanmakuFilterConfig, EpisodeFilterConfig, SearchResult } from '@/lib/types';
import { base58Decode, getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';
import { useEnableAIComments } from '@/hooks/useEnableAIComments';
import { useEnableComments } from '@/hooks/useEnableComments';
import { usePlaySync } from '@/hooks/usePlaySync';

import AIChatPanel from '@/components/AIChatPanel';
import AIComments from '@/components/AIComments';
import CorrectDialog from '@/components/CorrectDialog';
import DanmakuFilterSettings from '@/components/DanmakuFilterSettings';
import DetailPanel from '@/components/DetailPanel';
import DoubanComments from '@/components/DoubanComments';
import DownloadEpisodeSelector from '@/components/DownloadEpisodeSelector';
import Drawer from '@/components/Drawer';
import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';
import PansouSearch from '@/components/PansouSearch';
import ProxyImage from '@/components/ProxyImage';
import { useSite } from '@/components/SiteProvider';
import SmartRecommendations from '@/components/SmartRecommendations';
import Toast, { ToastProps } from '@/components/Toast';
import VideoCard from '@/components/VideoCard';

import { useDownload } from '@/contexts/DownloadContext';

// 擴展 HTMLVideoElement 類型以支持 hls 屬性
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

// Wake Lock API 類型聲明
interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

interface PlayFallbackRecommendation {
  key: string;
  item: SearchResult;
  episodes?: number;
  sourceNames: string[];
  doubanId?: number;
}

function PlayPageClient() {
  const LOCAL_TRANSCODER_BASE_URL = 'http://localhost:19080';
  const router = useRouter();
  const searchParams = useSearchParams();
  const enableComments = useEnableComments();
  const enableAIComments = useEnableAIComments();
  const { addDownloadTask } = useDownload();
  const { siteName } = useSite();

  // 獲取 Proxy M3U8 Token
  const proxyToken = typeof window !== 'undefined' ? process.env.NEXT_PUBLIC_PROXY_M3U8_TOKEN || '' : '';

  // 獲取用戶認證信息
  const authInfo = typeof window !== 'undefined' ? getAuthInfoFromBrowserCookie() : null;

  // 離線下載功能配置
  const enableOfflineDownload = typeof window !== 'undefined'
    ? (window as any).RUNTIME_CONFIG?.ENABLE_OFFLINE_DOWNLOAD || false
    : false;
  const hasOfflinePermission = authInfo?.role === 'owner' || authInfo?.role === 'admin';

  // -----------------------------------------------------------------------------
  // 狀態變量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  // TMDB背景圖
  const [tmdbBackdrop, setTmdbBackdrop] = useState<string | null>(null);

  // 收藏狀態
  const [favorited, setFavorited] = useState(false);

  // 網盤搜索彈窗狀態
  const [showPansouDialog, setShowPansouDialog] = useState(false);
  const [netdiskSearchEnabled, setNetdiskSearchEnabled] = useState(false);

  // AI問片狀態
  const [showAIChat, setShowAIChat] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiDefaultMessageWithVideo, setAiDefaultMessageWithVideo] = useState('');

  // 糾錯彈窗狀態
  const [showCorrectDialog, setShowCorrectDialog] = useState(false);

  // 詳情面板狀態
  const [showDetailPanel, setShowDetailPanel] = useState(false);

  // 大屏設備檢測（判斷選集面板是否在右側）
  const [isLargeScreen, setIsLargeScreen] = useState(false);

  // 檢測是否為大屏設備
  useEffect(() => {
    const checkScreenSize = () => {
      setIsLargeScreen(window.innerWidth >= 768); // md斷點
    };

    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // 抽屜管理：打開指定抽屜時關閉其他抽屜
  const openDrawer = (drawerName: 'pansou' | 'aiChat' | 'correct' | 'detail') => {
    if (!isLargeScreen) {
      // 小屏設備不需要互斥
      switch (drawerName) {
        case 'pansou':
          setShowPansouDialog(true);
          break;
        case 'aiChat':
          setShowAIChat(true);
          break;
        case 'correct':
          setShowCorrectDialog(true);
          break;
        case 'detail':
          setShowDetailPanel(true);
          break;
      }
      return;
    }

    // 大屏設備：關閉其他抽屜
    setShowPansouDialog(drawerName === 'pansou');
    setShowAIChat(drawerName === 'aiChat');
    setShowCorrectDialog(drawerName === 'correct');
    setShowDetailPanel(drawerName === 'detail');
  };

  // 檢查AI功能是否啟用
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const enabled =
        (window as any).RUNTIME_CONFIG?.AI_ENABLED &&
        (window as any).RUNTIME_CONFIG?.AI_ENABLE_PLAYPAGE_ENTRY;
      setAiEnabled(enabled);

      // 加載AI默認消息配置
      const defaultMsg = (window as any).RUNTIME_CONFIG?.AI_DEFAULT_MESSAGE_WITH_VIDEO;
      if (defaultMsg) {
        setAiDefaultMessageWithVideo(defaultMsg);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setNetdiskSearchEnabled(
        !!(window as any).RUNTIME_CONFIG?.NETDISK_SEARCH_ENABLED
      );
    }
  }, []);

  // 網頁全屏狀態 - 控制導航欄的顯示隱藏
  const [isWebFullscreen, setIsWebFullscreen] = useState(false);
  // 原生全屏狀態
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);

  // 監聽瀏覽器原生全屏事件
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = !!document.fullscreenElement;
      setIsNativeFullscreen(isFullscreen);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  // 組件卸載時清理定時器
  useEffect(() => {
    return () => {
      clearRefreshTimer();
    };
  }, []);

  // 跳過片頭片尾配置
  const [skipConfig, setSkipConfig] = useState<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [
    skipConfig,
    skipConfig.enable,
    skipConfig.intro_time,
    skipConfig.outro_time,
  ]);

  // 跳過檢查的時間間隔控制
  const lastSkipCheckRef = useRef(0);

  // 去廣告開關（從 localStorage 繼承，默認 true）
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  // 外部播放器去廣告開關（獨立狀態，默認 false）
  const [externalPlayerAdBlock, setExternalPlayerAdBlock] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('external_player_adblock');
      if (v !== null) return v === 'true';
    }
    return false;
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('external_player_adblock', String(externalPlayerAdBlock));
    }
  }, [externalPlayerAdBlock]);

  // 自定義去廣告代碼（從服務器獲取並緩存）
  const customAdFilterCodeRef = useRef<string>('');

  // 初始化時獲取自定義去廣告代碼
  useEffect(() => {
    const fetchAdFilterCode = async () => {
      if (typeof window === 'undefined') return;

      try {
        // 先從 localStorage 獲取緩存的代碼，立即可用
        const cachedCode = localStorage.getItem('custom_ad_filter_code_cache');
        const cachedVersion = localStorage.getItem('custom_ad_filter_version_cache');

        if (cachedCode) {
          customAdFilterCodeRef.current = cachedCode;
          console.log('使用緩存的去廣告代碼');
        }

        // 從 window.RUNTIME_CONFIG 獲取版本號
        const version = (window as any).RUNTIME_CONFIG?.CUSTOM_AD_FILTER_VERSION || 0;

        // 如果版本號為 0，說明去廣告未設置，清空緩存並跳過
        if (version === 0) {
          console.log('去廣告代碼未設置（版本 0），清空緩存');
          localStorage.removeItem('custom_ad_filter_code_cache');
          localStorage.removeItem('custom_ad_filter_version_cache');
          customAdFilterCodeRef.current = '';
          return;
        }

        // 如果版本號不一致或沒有緩存，才獲取完整代碼
        if (!cachedVersion || parseInt(cachedVersion) !== version) {
          console.log('檢測到去廣告代碼更新（版本 ' + version + '），獲取最新代碼');

          // 獲取完整代碼
          const fullResponse = await fetch('/api/ad-filter?full=true');
          if (!fullResponse.ok) {
            console.warn('獲取完整去廣告代碼失敗，使用緩存');
            return;
          }

          const { code } = await fullResponse.json();

          if (code) {
            localStorage.setItem('custom_ad_filter_code_cache', code);
            localStorage.setItem('custom_ad_filter_version_cache', version.toString());
            customAdFilterCodeRef.current = code;
          } else if (!cachedCode) {
            // 如果服務器沒有代碼且本地也沒有緩存，清空緩存
            localStorage.removeItem('custom_ad_filter_code_cache');
            localStorage.removeItem('custom_ad_filter_version_cache');
          }
        } else {
          console.log('去廣告代碼已是最新版本（版本 ' + version + '）');
        }
      } catch (error) {
        console.error('獲取去廣告代碼配置失敗:', error);
        // 失敗時已經使用了緩存，無需額外處理
      }
    };

    fetchAdFilterCode();
  }, []);

  // Anime4K超分相關狀態
  const [webGPUSupported, setWebGPUSupported] = useState<boolean>(false);
  const [anime4kEnabled, setAnime4kEnabled] = useState<boolean>(false);
  const [anime4kMode, setAnime4kMode] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('anime4k_mode');
      if (v !== null) return v;
    }
    return 'ModeA';
  });
  const [anime4kScale, setAnime4kScale] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('anime4k_scale');
      if (v !== null) return parseFloat(v);
    }
    return 2.0;
  });
  const anime4kRef = useRef<any>(null);
  const anime4kEnabledRef = useRef(anime4kEnabled);
  const anime4kModeRef = useRef(anime4kMode);
  const anime4kScaleRef = useRef(anime4kScale);
  useEffect(() => {
    anime4kEnabledRef.current = anime4kEnabled;
    anime4kModeRef.current = anime4kMode;
    anime4kScaleRef.current = anime4kScale;
  }, [anime4kEnabled, anime4kMode, anime4kScale]);

  // 檢測WebGPU支持
  useEffect(() => {
    const checkWebGPUSupport = async () => {
      if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
        setWebGPUSupported(false);
        console.log('WebGPU不支持：瀏覽器不支持WebGPU API');
        return;
      }

      try {
        // 修復anime4k-webgpu庫的buffer size限制問題
        // 在全局層面patch requestAdapter，確保所有adapter都有正確的limits
        const originalRequestAdapter = (navigator as any).gpu.requestAdapter.bind((navigator as any).gpu);

        (navigator as any).gpu.requestAdapter = async (options?: any) => {
          const adapter = await originalRequestAdapter(options);
          if (!adapter) return adapter;

          // 保存原始的requestDevice方法
          const originalRequestDevice = adapter.requestDevice.bind(adapter);

          // 重寫requestDevice方法，添加必要的buffer size限制
          adapter.requestDevice = async (descriptor?: any) => {
            const adapterLimits = adapter.limits;

            // 合併用戶提供的descriptor和我們需要的limits
            const enhancedDescriptor = {
              ...descriptor,
              requiredLimits: {
                ...descriptor?.requiredLimits,
                // 使用adapter支持的最大值，但不超過2GB
                maxBufferSize: Math.min(adapterLimits.maxBufferSize || 2147483648, 2147483648),
                maxStorageBufferBindingSize: Math.min(adapterLimits.maxStorageBufferBindingSize || 1073741824, 1073741824),
              }
            };

            console.log('WebGPU設備請求配置:', enhancedDescriptor.requiredLimits);
            return originalRequestDevice(enhancedDescriptor);
          };

          return adapter;
        };

        const adapter = await (navigator as any).gpu.requestAdapter();
        if (!adapter) {
          setWebGPUSupported(false);
          console.log('WebGPU不支持：無法獲取GPU適配器');
          return;
        }

        setWebGPUSupported(true);
        console.log('WebGPU支持檢測：✅ 支持');
        console.log('Adapter limits:', {
          maxBufferSize: adapter.limits.maxBufferSize,
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize
        });
      } catch (err) {
        setWebGPUSupported(false);
        console.log('WebGPU不支持：', err);
      }
    };

    checkWebGPUSupport();
  }, []);

  // 彈幕相關狀態
  const [danmakuSettings, setDanmakuSettings] = useState<DanmakuSettings>(
    loadDanmakuSettings()
  );
  const [danmakuFilterConfig, setDanmakuFilterConfig] = useState<DanmakuFilterConfig | null>(null);
  const danmakuFilterConfigRef = useRef<DanmakuFilterConfig | null>(null);
  const [episodeFilterConfig, setEpisodeFilterConfig] = useState<EpisodeFilterConfig | null>(null);
  const episodeFilterConfigRef = useRef<EpisodeFilterConfig | null>(null);
  const [currentDanmakuSelection, setCurrentDanmakuSelection] =
    useState<DanmakuSelection | null>(null);
  const [danmakuEpisodesList, setDanmakuEpisodesList] = useState<
    Array<{ episodeId: number; episodeTitle: string }>
  >([]);
  const [danmakuLoading, setDanmakuLoading] = useState(false);
  const [danmakuCount, setDanmakuCount] = useState(0);
  const [danmakuOriginalCount, setDanmakuOriginalCount] = useState(0);
  const danmakuPluginRef = useRef<any>(null);
  const danmakuSettingsRef = useRef(danmakuSettings);

  // 彈幕顯示狀態的 ref，初始化時從 localStorage 讀取
  const danmakuDisplayStateRef = useRef<boolean>(
    (() => {
      const saved = loadDanmakuDisplayState();
      return saved !== false; // null 或 true 都返回 true
    })()
  );

  // 彈幕熱力圖完全禁用開關（默認不禁用，即啟用熱力圖功能）
  const [danmakuHeatmapDisabled, setDanmakuHeatmapDisabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('danmaku_heatmap_disabled');
      if (v !== null) return v === 'true';
    }
    return false; // 默認不禁用
  });
  const danmakuHeatmapDisabledRef = useRef(danmakuHeatmapDisabled);
  useEffect(() => {
    danmakuHeatmapDisabledRef.current = danmakuHeatmapDisabled;
  }, [danmakuHeatmapDisabled]);

  // 彈幕熱力圖開關（默認開啟）
  const [danmakuHeatmapEnabled, setDanmakuHeatmapEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('danmaku_heatmap_enabled');
      if (v !== null) return v === 'true';
    }
    return true; // 默認開啟
  });
  const danmakuHeatmapEnabledRef = useRef(danmakuHeatmapEnabled);
  useEffect(() => {
    danmakuHeatmapEnabledRef.current = danmakuHeatmapEnabled;
  }, [danmakuHeatmapEnabled]);

  // 多條彈幕匹配結果
  const [danmakuMatches, setDanmakuMatches] = useState<DanmakuAnime[]>([]);
  const [showDanmakuSourceSelector, setShowDanmakuSourceSelector] = useState(false);
  const [showDanmakuFilterSettings, setShowDanmakuFilterSettings] = useState(false);
  const [currentSearchKeyword, setCurrentSearchKeyword] = useState<string>(''); // 當前搜索使用的關鍵詞
  const [toast, setToast] = useState<ToastProps | null>(null);
  const [isTranscoding, setIsTranscoding] = useState(false);

  useEffect(() => {
    danmakuSettingsRef.current = danmakuSettings;
  }, [danmakuSettings]);

  // 初始化彈幕模塊（清理過期緩存）
  useEffect(() => {
    initDanmakuModule();
  }, []);

  // 加載彈幕過濾配置
  useEffect(() => {
    const loadFilterConfig = async () => {
      try {
        const config = await getDanmakuFilterConfig();
        if (config) {
          setDanmakuFilterConfig(config);
          danmakuFilterConfigRef.current = config;
        } else {
          // 如果沒有配置，設置默認空配置
          const defaultConfig: DanmakuFilterConfig = { rules: [] };
          setDanmakuFilterConfig(defaultConfig);
          danmakuFilterConfigRef.current = defaultConfig;
        }

        // 加載集數過濾配置
        const episodeConfig = await getEpisodeFilterConfig();
        if (episodeConfig) {
          const normalizedEpisodeConfig = normalizeEpisodeFilterConfig(episodeConfig);
          setEpisodeFilterConfig(normalizedEpisodeConfig);
          episodeFilterConfigRef.current = normalizedEpisodeConfig;
        } else {
          const defaultEpisodeConfig: EpisodeFilterConfig = normalizeEpisodeFilterConfig();
          setEpisodeFilterConfig(defaultEpisodeConfig);
          episodeFilterConfigRef.current = defaultEpisodeConfig;
        }
      } catch (error) {
        console.error('加載過濾配置失敗:', error);
      }
    };
    loadFilterConfig();
  }, []);

  // 同步彈幕過濾配置到ref
  useEffect(() => {
    danmakuFilterConfigRef.current = danmakuFilterConfig;
  }, [danmakuFilterConfig]);

  // 同步集數過濾配置到ref
  useEffect(() => {
    episodeFilterConfigRef.current = episodeFilterConfig;
  }, [episodeFilterConfig]);

  // 視頻基本信息
  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  const [videoDoubanId, setVideoDoubanId] = useState(0);

  // 更新瀏覽器標題
  useEffect(() => {
    if (videoTitle) {
      document.title = `${siteName} - ${videoTitle}`;
    } else {
      document.title = siteName;
    }
  }, [videoTitle, siteName]);
  // 豆瓣評分數據
  const [doubanRating, setDoubanRating] = useState<{
    value: number;
    count: number;
    star_count: number;
  } | null>(null);
  // 豆瓣額外信息
  const [doubanCardSubtitle, setDoubanCardSubtitle] = useState<string>('');
  const [doubanAka, setDoubanAka] = useState<string[]>([]);
  const [doubanYear, setDoubanYear] = useState<string>(''); // 從 pubdate 提取的年份

  // 糾錯後的描述信息（用於顯示，不觸發 detail 更新）
  const [correctedDesc, setCorrectedDesc] = useState<string>('');
  const [netdiskTMDBMeta, setNetdiskTMDBMeta] = useState<{
    desc?: string;
    poster?: string;
    year?: string;
    tmdbId?: number;
  } | null>(null);
  const [pendingNetdiskTMDBData, setPendingNetdiskTMDBData] = useState<any | null>(null);

  // 當前源和ID - source 直接存儲完整格式（如 'emby_wumei' 或 'emby'）
  const [currentSource, setCurrentSource] = useState(normalizeNetdiskSource(searchParams.get('source')) || '');
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');
  const [fileName] = useState(searchParams.get('fileName') || ''); // 小雅源：用戶點擊的文件名
  const isDirectPlay = currentSource === 'directplay';

  useEffect(() => {
    setNetdiskTMDBMeta(null);
    setPendingNetdiskTMDBData(null);
  }, [currentSource, currentId]);

  // 解析 source 參數以獲取 embyKey（僅用於 API 調用）
  const parseSourceForApi = (source: string): { source: string; embyKey?: string } => {
    source = normalizeNetdiskSource(source);
    if (source.startsWith('emby_')) {
      const key = source.substring(5);
      return { source: 'emby', embyKey: key };
    }
    return { source };
  };

  const isLazyDetailSource = (source?: string) => {
    if (!source) return false;
    return (
      source === 'openlist' ||
      source === 'emby' ||
      source.startsWith('emby_') ||
      source.startsWith('script:')
    );
  };

  const isM3u8LikeUrl = (url?: string) => {
    if (!url) return false;
    const normalizedUrl = url.toLowerCase();
    return normalizedUrl.includes('.m3u8') || normalizedUrl.includes('/m3u8/');
  };

  const buildAbsoluteUrl = (url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  // 搜索所需信息
  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');
  const [initialEpisodeProgressTitle] = useState(
    searchTitle || searchParams.get('title') || ''
  );
  const [initialEpisodeProgressYear] = useState(
    searchParams.get('year') || ''
  );
  const episodeProgressContentKey = useMemo(
    () =>
      buildEpisodeProgressContentKey({
        doubanId: videoDoubanId || detail?.douban_id,
        tmdbId: detail?.tmdb_id,
        title: initialEpisodeProgressTitle,
        year: initialEpisodeProgressYear,
        searchType,
      }),
    [
      detail?.douban_id,
      detail?.tmdb_id,
      initialEpisodeProgressTitle,
      initialEpisodeProgressYear,
      searchType,
      videoDoubanId,
    ]
  );

  // 是否需要優選
  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true'
  );
  const needPreferRef = useRef(needPrefer);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);
  // 集數相關
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(() => {
    const episodeParam = searchParams.get('episode');
    if (episodeParam) {
      const episode = parseInt(episodeParam, 10);
      return episode > 0 ? episode - 1 : 0; // URL 中是 1-based，內部是 0-based
    }
    return 0;
  });

  // 監聽 URL 參數變化，更新集數索引（用於房員跟隨換集）
  useEffect(() => {
    const episodeParam = searchParams.get('episode');
    if (episodeParam) {
      const episode = parseInt(episodeParam, 10);
      const newIndex = episode > 0 ? episode - 1 : 0;
      console.log('[PlayPage] Checking episode from URL:', { urlEpisode: episode, currentIndex: currentEpisodeIndex, newIndex });
      if (newIndex !== currentEpisodeIndex) {
        console.log('[PlayPage] URL episode changed, updating index to:', newIndex);
        setCurrentEpisodeIndex(newIndex);
      }
    }
  }, [searchParams, currentEpisodeIndex]);

  // 監聽集數變化，移除已顯示的跳轉按鈕
  useEffect(() => {
    // 移除已顯示的跳轉按鈕
    if (playRecordJumpLayerRef.current && artPlayerRef.current) {
      try {
        artPlayerRef.current.layers.remove('play-record-jump');
        playRecordJumpLayerRef.current = null;
      } catch (err) {
        console.warn('[PlayRecordJump] 移除跳轉按鈕失敗:', err);
      }
    }

    // 切到新的一集後，重新允許檢查該集是否存在播放記錄。
    playRecordJumpInitialCheckRef.current = true;
    playRecordJumpDismissedRef.current = false;
  }, [currentEpisodeIndex]);

  // 監聽 URL 參數變化，當切換到不同視頻時重新加載頁面
  useEffect(() => {
    const urlTitle = searchParams.get('title') || '';
    const reloadParam = searchParams.get('_reload');

    // 只在有 _reload 參數且標題變化時才重新加載頁面
    // 這樣可以避免初始化、API返回、房間同步等場景的誤觸發
    // 只有用戶主動點擊推薦時才會添加 _reload 參數
    if (reloadParam && urlTitle && urlTitle !== videoTitle && !isSourceChangingRef.current) {
      console.log('[PlayPage] User clicked recommendation, reloading page');
      window.location.reload();
    }

    // 重置換源標記
    isSourceChangingRef.current = false;
  }, [searchParams, videoTitle]);

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);
  const isSourceChangingRef = useRef(false); // 標記是否正在換源

  // 同步最新值到 refs
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  // 當集數改變時，重置下集預緩存標記
  useEffect(() => {
    nextEpisodePreCacheTriggeredRef.current = false;
    nextEpisodeDanmakuPreloadTriggeredRef.current = false;
    // 清理之前的預緩存 HLS 實例
    if (nextEpisodePreCacheHlsRef.current) {
      try {
        nextEpisodePreCacheHlsRef.current.destroy();
      } catch (e) {
        console.error('清理預緩存 HLS 實例失敗:', e);
      }
      nextEpisodePreCacheHlsRef.current = null;
    }
  }, [currentEpisodeIndex]);

  // 監聽劇集切換，自動加載對應的彈幕
  const lastLoadedEpisodeIndexForDanmakuRef = useRef<number | null>(null);
  const loadingDanmakuEpisodeIdRef = useRef<number | null>(null);

  useEffect(() => {
    // 等待初始化完成（播放記錄恢復完成）
    if (loading) {
      return;
    }

    if (isDirectPlay) {
      return;
    }

    // 檢查是否禁用了自動加載彈幕
    if (isDanmakuAutoLoadDisabled()) {
      console.log('[彈幕] 已禁用自動加載彈幕，跳過自動加載');
      setShowDanmakuSourceSelector(false);
      setDanmakuLoading(false);
      return;
    }

    // 檢查集數是否有效且是否已改變
    if (currentEpisodeIndex < 0 || !videoTitle) {
      return;
    }

    // 如果集數已經加載過，跳過
    if (lastLoadedEpisodeIndexForDanmakuRef.current === currentEpisodeIndex) {
      return;
    }

    // 標記當前集數已加載
    lastLoadedEpisodeIndexForDanmakuRef.current = currentEpisodeIndex;

    console.log(`[彈幕] 劇集切換到第 ${currentEpisodeIndex + 1} 集，自動加載彈幕`);

    // 立即清空當前彈幕（使用 reset 方法，不觸發顯示/隱藏事件）
    if (danmakuPluginRef.current) {
      danmakuPluginRef.current.reset();
      setDanmakuCount(0);
    }

    // 自動加載彈幕的邏輯
    const loadDanmakuForCurrentEpisode = async () => {
      const title = videoTitleRef.current;
      if (!title) {
        console.warn('[彈幕] 視頻標題為空，無法加載彈幕');
        return;
      }

      const episodeIndex = currentEpisodeIndexRef.current;
      console.log(`[彈幕] 開始加載第 ${episodeIndex + 1} 集彈幕`);

      // 先嚐試從 IndexedDB 緩存加載
      try {
        const cachedData = await getDanmakuFromCache(title, episodeIndex);
        if (cachedData && cachedData.comments.length > 0) {
          console.log(`[彈幕] 使用緩存: title="${title}", episodeIndex=${episodeIndex}, 數量=${cachedData.comments.length}`);

          // 如果彈幕插件還未初始化，等待初始化
          if (!danmakuPluginRef.current) {
            console.log('[彈幕] 彈幕插件未初始化，等待初始化...');
            // 緩存命中但插件未初始化，不執行搜索，等待下次觸發
            return;
          }

          setDanmakuLoading(true);

          // 轉換彈幕格式
          let danmakuData = convertDanmakuFormat(cachedData.comments);

          // 手動應用過濾規則
          const filterConfig = danmakuFilterConfigRef.current;
          if (filterConfig && filterConfig.rules.length > 0) {
            const originalCount = danmakuData.length;
            danmakuData = danmakuData.filter((danmu) => {
              for (const rule of filterConfig.rules) {
                if (!rule.enabled) continue;
                try {
                  if (rule.type === 'normal') {
                    if (danmu.text.includes(rule.keyword)) {
                      return false;
                    }
                  } else if (rule.type === 'regex') {
                    if (new RegExp(rule.keyword).test(danmu.text)) {
                      return false;
                    }
                  }
                } catch (e) {
                  console.error('彈幕過濾規則錯誤:', e);
                }
              }
              return true;
            });
            const filteredCount = originalCount - danmakuData.length;
            if (filteredCount > 0) {
              console.log(`彈幕過濾: 原始 ${originalCount} 條，過濾 ${filteredCount} 條，剩餘 ${danmakuData.length} 條`);
            }
          }

          // 應用彈幕數量限制
          const maxCount = typeof window !== 'undefined' ? parseInt(localStorage.getItem('danmakuMaxCount') || '0', 10) : 0;
          let calculatedOriginalCount = 0;
          if (maxCount > 0 && danmakuData.length > maxCount) {
            const originalCount = danmakuData.length;
            const step = danmakuData.length / maxCount;
            const limitedData = [];
            for (let i = 0; i < maxCount; i++) {
              limitedData.push(danmakuData[Math.floor(i * step)]);
            }
            danmakuData = limitedData;
            calculatedOriginalCount = originalCount;
            setDanmakuOriginalCount(originalCount);
            console.log(`彈幕數量限制: 原始 ${originalCount} 條，限制到 ${danmakuData.length} 條`);
          } else {
            // 沒有應用限制，不顯示原始數量
            setDanmakuOriginalCount(0);
          }

          // 加載彈幕到插件
          const currentSettings = danmakuSettingsRef.current;
          danmakuPluginRef.current.config({
            danmuku: danmakuData,
            speed: currentSettings.speed,
            opacity: currentSettings.opacity,
            fontSize: currentSettings.fontSize,
            margin: [currentSettings.marginTop, currentSettings.marginBottom],
            synchronousPlayback: currentSettings.synchronousPlayback,
          });
          danmakuPluginRef.current.load();

          // 根據保存的顯示狀態來決定顯示或隱藏彈幕
          const savedDisplayState = loadDanmakuDisplayState();
          if (savedDisplayState === false) {
            danmakuPluginRef.current.hide();
          } else {
            danmakuPluginRef.current.show();
          }

          setDanmakuCount(danmakuData.length);
          console.log(`[彈幕] 緩存加載成功，共 ${danmakuData.length} 條`);

          // 更新當前選擇狀態（使用實時計算的數量）
          if (cachedData.metadata) {
            setCurrentDanmakuSelection({
              animeId: cachedData.metadata.animeId || 0,
              episodeId: cachedData.metadata.episodeId || 0,
              animeTitle: cachedData.metadata.animeTitle || '',
              episodeTitle: cachedData.metadata.episodeTitle || '',
              searchKeyword: cachedData.metadata.searchKeyword,
              danmakuCount: danmakuData.length,
              danmakuOriginalCount: calculatedOriginalCount > 0 ? calculatedOriginalCount : undefined,
            });
          }

          await new Promise((resolve) => setTimeout(resolve, 1500));
          setDanmakuLoading(false);

          return; // 使用緩存成功，直接返回
        }
      } catch (error) {
        console.error('[彈幕] 讀取緩存失敗:', error);
      }

      // 沒有緩存，先檢查是否有手動選擇的劇集 ID
      console.log(`[彈幕] 第 ${episodeIndex + 1} 集緩存未命中`);

      // 檢查是否有手動選擇的劇集 ID
      const manualEpisodeId = getManualDanmakuSelection(title, episodeIndex);
      if (manualEpisodeId) {
        console.log(`[彈幕記憶] 使用手動選擇的劇集 ID: ${manualEpisodeId}`);
        try {
          // 需要獲取完整的 selection 信息來調用 handleDanmakuSelect
          // 但這裡只有 episodeId，所以保持直接調用 loadDanmaku
          setDanmakuLoading(true);
          await loadDanmaku(manualEpisodeId);
          console.log('[彈幕記憶] 使用手動選擇的彈幕成功');
          return; // 使用手動選擇成功，直接返回
        } catch (error) {
          console.error('[彈幕記憶] 使用手動選擇的彈幕失敗:', error);
          // 繼續執行自動搜索
        }
      }

      // 嘗試使用保存的動漫ID自動匹配劇集
      const savedAnimeId = getDanmakuAnimeId(title);
      if (savedAnimeId) {
        console.log(`[彈幕記憶] 嘗試使用保存的動漫ID: ${savedAnimeId}`);
        setDanmakuLoading(true);
        try {
          const episodesResult = await getEpisodes(savedAnimeId);

          if (episodesResult.success && episodesResult.bangumi.episodes.length > 0) {
            // 根據當前集數選擇對應的彈幕
            const videoEpTitle = detailRef.current?.episodes_titles?.[episodeIndex];
            const episode = matchDanmakuEpisode(episodeIndex, episodesResult.bangumi.episodes, videoEpTitle);

            if (episode) {
              console.log(`[彈幕記憶] 使用保存的動漫ID匹配成功: ${episode.episodeTitle}`);

              const selection: DanmakuSelection = {
                animeId: savedAnimeId,
                episodeId: episode.episodeId,
                animeTitle: episodesResult.bangumi.animeTitle,
                episodeTitle: episode.episodeTitle,
              };

              setDanmakuEpisodesList(episodesResult.bangumi.episodes);

              // 通過統一的 handleDanmakuSelect 處理彈幕加載
              await handleDanmakuSelect(selection);
              return; // 匹配成功，直接返回
            } else {
              console.log('[彈幕記憶] 使用保存的動漫ID匹配失敗，降級到關鍵詞搜索');
            }
          }
        } catch (error) {
          console.error('[彈幕記憶] 使用保存的動漫ID失敗:', error);
        }
      }

      // 執行自動搜索彈幕（優先使用保存的關鍵詞）
      console.log(`[彈幕] 開始自動搜索`);
      setDanmakuLoading(true);

      // 優先使用保存的搜索關鍵詞，否則使用視頻標題
      const savedKeyword = getDanmakuSearchKeyword(title);
      const searchKeyword = savedKeyword || title;
      console.log(`[彈幕] 搜索關鍵詞: ${searchKeyword}${savedKeyword ? ' (使用保存的關鍵詞)' : ' (使用視頻標題)'}`);

      try {
        const searchResult = await searchAnime(searchKeyword);

        if (searchResult.success && searchResult.animes.length > 0) {
          // 應用智能過濾：優先匹配年份和標題
          const videoYear = detailRef.current?.year;
          const filteredAnimes = filterDanmakuSources(
            searchResult.animes,
            title,
            videoYear
          );

          // 如果有多個匹配結果，先檢查是否有記憶的選擇
          if (filteredAnimes.length > 1) {
            console.log(`找到 ${filteredAnimes.length} 個彈幕源`);

            // 檢查是否有上次選擇的下標
            const rememberedIndex = getDanmakuSourceIndex(title);
            if (rememberedIndex !== null && rememberedIndex < filteredAnimes.length) {
              console.log(`[彈幕記憶] 使用上次選擇的彈幕源，下標: ${rememberedIndex}`);
              const anime = filteredAnimes[rememberedIndex];

              // 獲取劇集列表
              const episodesResult = await getEpisodes(anime.animeId);

              if (
                episodesResult.success &&
                episodesResult.bangumi.episodes.length > 0
              ) {
                // 根據當前集數選擇對應的彈幕
                const currentEp = currentEpisodeIndexRef.current;
                const videoEpTitle = detailRef.current?.episodes_titles?.[currentEp];
                const episode = matchDanmakuEpisode(currentEp, episodesResult.bangumi.episodes, videoEpTitle);

                if (episode) {
                  const selection: DanmakuSelection = {
                    animeId: anime.animeId,
                    episodeId: episode.episodeId,
                    animeTitle: anime.animeTitle,
                    episodeTitle: episode.episodeTitle,
                  };

                  // 設置劇集列表
                  setDanmakuEpisodesList(episodesResult.bangumi.episodes);

                  console.log('使用記憶的彈幕源成功:', selection);

                  // 通過統一的 handleDanmakuSelect 處理彈幕加載
                  await handleDanmakuSelect(selection);
                  setDanmakuLoading(false);
                  return;
                }
              }
            }

            // 沒有記憶或記憶失效，讓用戶選擇
            console.log(`等待用戶選擇彈幕源`);
            setDanmakuMatches(filteredAnimes);
            setCurrentSearchKeyword(searchKeyword); // 保存當前搜索關鍵詞
            setShowDanmakuSourceSelector(true);
            setDanmakuLoading(false);
            if (artPlayerRef.current) {
              artPlayerRef.current.notice.show = `找到 ${filteredAnimes.length} 個彈幕源，請選擇`;
            }
            return;
          }

          // 只有一個結果，直接使用
          const anime = filteredAnimes[0];

          // 獲取劇集列表
          const episodesResult = await getEpisodes(anime.animeId);

          if (
            episodesResult.success &&
            episodesResult.bangumi.episodes.length > 0
          ) {
            // 根據當前集數選擇對應的彈幕
            const currentEp = currentEpisodeIndexRef.current;
            const videoEpTitle = detailRef.current?.episodes_titles?.[currentEp];
            const episode = matchDanmakuEpisode(currentEp, episodesResult.bangumi.episodes, videoEpTitle);

            if (episode) {
              const selection: DanmakuSelection = {
                animeId: anime.animeId,
                episodeId: episode.episodeId,
                animeTitle: anime.animeTitle,
                episodeTitle: episode.episodeTitle,
              };

              // 設置劇集列表
              setDanmakuEpisodesList(episodesResult.bangumi.episodes);

              console.log('自動搜索彈幕成功:', selection);

              // 通過統一的 handleDanmakuSelect 處理彈幕加載
              await handleDanmakuSelect(selection);
            }
          } else {
            console.warn('未找到劇集信息');
            if (artPlayerRef.current) {
              artPlayerRef.current.notice.show = '彈幕加載失敗：未找到劇集信息';
            }
          }
        } else {
          console.warn('未找到匹配的彈幕');
          if (artPlayerRef.current) {
            artPlayerRef.current.notice.show = '未找到匹配的彈幕，可在彈幕選項卡手動搜索';
          }
        }
      } catch (error) {
        console.error('自動搜索彈幕失敗:', error);
        if (artPlayerRef.current) {
          artPlayerRef.current.notice.show = '彈幕加載失敗，請檢查網絡或稍後重試';
        }
      } finally {
        setDanmakuLoading(false);
      }
    };

    loadDanmakuForCurrentEpisode();
  }, [currentEpisodeIndex, videoTitle, loading, isDirectPlay]);

  // 獲取豆瓣評分數據
  useEffect(() => {
    const fetchDoubanRating = async () => {
      if (isDirectPlay) {
        setDoubanRating(null);
        setDoubanCardSubtitle('');
        setDoubanAka([]);
        setDoubanYear('');
        return;
      }

      if (!videoDoubanId || videoDoubanId === 0) {
        setDoubanRating(null);
        setDoubanCardSubtitle('');
        setDoubanAka([]);
        setDoubanYear('');
        return;
      }

      try {
        const doubanData = await getDoubanDetail(videoDoubanId.toString());

        // 設置評分
        if (doubanData.rating) {
          setDoubanRating({
            value: doubanData.rating.value,
            count: doubanData.rating.count,
            star_count: doubanData.rating.star_count,
          });
        } else {
          setDoubanRating(null);
        }

        // 設置 card_subtitle
        if (doubanData.card_subtitle) {
          setDoubanCardSubtitle(doubanData.card_subtitle);
        }

        // 設置 aka（別名）
        if (doubanData.aka && doubanData.aka.length > 0) {
          setDoubanAka(doubanData.aka);
        }

        // 處理 pubdate 獲取年份
        if (doubanData.pubdate && doubanData.pubdate.length > 0) {
          const pubdateStr = doubanData.pubdate[0];
          // 刪除括號中的內容，包括括號
          const yearMatch = pubdateStr.replace(/\([^)]*\)/g, '').trim();
          if (yearMatch) {
            setDoubanYear(yearMatch);
          }
        }
      } catch (error) {
        console.error('獲取豆瓣評分失敗:', error);
        setDoubanRating(null);
        setDoubanCardSubtitle('');
        setDoubanAka([]);
        setDoubanYear('');
      }
    };

    fetchDoubanRating();
  }, [videoDoubanId, isDirectPlay]);

  // 獲取TMDB背景圖
  useEffect(() => {
    const fetchTMDBBackdrop = async () => {
      if (isDirectPlay) {
        setTmdbBackdrop(null);
        return;
      }

      // 檢查是否禁用背景圖
      if (typeof window !== 'undefined') {
        const disabled = localStorage.getItem('tmdb_backdrop_disabled');
        if (disabled === 'true') {
          setTmdbBackdrop(null);
          return;
        }
      }

      if (!videoTitle) {
        setTmdbBackdrop(null);
        return;
      }

      try {
        const mappingCacheKey = recommendationCacheKeys.tmdbTitleMapping(videoTitle);
        const cachedId = getRecommendationCache<string>(mappingCacheKey);

        if (cachedId) {
          console.log('使用緩存的TMDB ID映射');

          const detailsCacheKey = recommendationCacheKeys.tmdbDetails(cachedId);
          const detailsCache = getRecommendationCache<any>(detailsCacheKey);

          if (detailsCache) {
            if (detailsCache.backdrop) {
              setTmdbBackdrop(processImageUrl(detailsCache.backdrop));
            } else {
              setTmdbBackdrop(null);
            }

            if (!videoDoubanId || videoDoubanId === 0) {
              populateDoubanFieldsFromTMDB(detailsCache);
            }
            populatePlayMetadataFromTMDB(detailsCache);
            return;
          }
        }

        // 構建請求URL
        const url = cachedId
          ? `/api/tmdb-details?cachedId=${encodeURIComponent(cachedId)}`
          : `/api/tmdb-details?title=${encodeURIComponent(videoTitle)}`;

        const response = await fetch(url);

        if (!response.ok) {
          setTmdbBackdrop(null);
          return;
        }

        const result = await response.json();

        if (result.backdrop) {
          setTmdbBackdrop(processImageUrl(result.backdrop));
        } else {
          setTmdbBackdrop(null);
        }

        // 如果沒有豆瓣ID，使用TMDb數據補充
        if (!videoDoubanId || videoDoubanId === 0) {
          populateDoubanFieldsFromTMDB(result);
        }
        populatePlayMetadataFromTMDB(result);

        // 保存title到tmdbId的映射到localStorage（1個月）
        if (result.tmdbId) {
          try {
            setRecommendationCache(mappingCacheKey, String(result.tmdbId));

            const detailsCacheKey = recommendationCacheKeys.tmdbDetails(result.tmdbId);
            setRecommendationCache(detailsCacheKey, result);
          } catch (e) {
            console.error('保存緩存失敗:', e);
          }
        }
      } catch (error) {
        console.error('獲取TMDB背景圖失敗:', error);
        setTmdbBackdrop(null);
      }
    };

    const populatePlayMetadataFromTMDB = (tmdbData: any) => {
      const currentDetail = detailRef.current;
      if (!currentDetail || !isNetdiskSource(currentDetail.source)) {
        setPendingNetdiskTMDBData(tmdbData);
        return;
      }

      const tmdbYear = tmdbData.releaseDate?.split('-')[0] || '';
      const shouldReplaceDesc =
        !currentDetail.desc ||
        currentDetail.desc.startsWith('臨時播放目錄：') ||
        currentDetail.desc.startsWith('移動雲盤分享：');

      const resolvedTmdbId = typeof tmdbData.tmdbId === 'string'
        ? Number(String(tmdbData.tmdbId).split(':')[1] || 0)
        : tmdbData.tmdbId;

      setNetdiskTMDBMeta({
        desc: shouldReplaceDesc ? (tmdbData.overview || currentDetail.desc) : currentDetail.desc,
        poster: currentDetail.poster || tmdbData.poster || '',
        year: currentDetail.year || tmdbYear,
        tmdbId: currentDetail.tmdb_id || resolvedTmdbId,
      });

      setDetail((prev) => {
        if (!prev || !isNetdiskSource(prev.source)) {
          return prev;
        }

        return {
          ...prev,
          poster: prev.poster || tmdbData.poster || '',
          year: prev.year || tmdbYear,
          desc: shouldReplaceDesc ? (tmdbData.overview || prev.desc) : prev.desc,
          tmdb_id: prev.tmdb_id || resolvedTmdbId,
        };
      });

      if (tmdbData.overview && (!correctedDesc || currentDetail.desc?.startsWith('臨時播放目錄：'))) {
        setCorrectedDesc(tmdbData.overview);
      }

      if (tmdbData.poster && !currentDetail.poster) {
        setVideoCover(processImageUrl(tmdbData.poster));
      }

      if (tmdbYear && !currentDetail.year) {
        setVideoYear(tmdbYear);
      }
    };

    // 輔助函數：使用TMDb數據填充豆瓣字段
    const populateDoubanFieldsFromTMDB = (tmdbData: any) => {
      // 設置評分
      if (tmdbData.rating) {
        const ratingValue = parseFloat(tmdbData.rating);
        setDoubanRating({
          value: ratingValue,
          count: 0, // TMDb不提供評分人數
          star_count: Math.round(ratingValue / 2), // 轉換為5星制
        });
      }

      // 設置年份
      if (tmdbData.releaseDate) {
        const year = tmdbData.releaseDate.split('-')[0];
        setDoubanYear(year);
      }

      // 設置card_subtitle（優先使用genres標籤，否則使用年份和類型）
      if (tmdbData.genres && Array.isArray(tmdbData.genres) && tmdbData.genres.length > 0) {
        const genreNames = tmdbData.genres.map((g: any) => g.name).join(' / ');
        setDoubanCardSubtitle(genreNames);
      } else if (tmdbData.mediaType && tmdbData.releaseDate) {
        // 兜底：如果沒有genres，使用年份和類型
        const year = tmdbData.releaseDate.split('-')[0];
        const typeText = tmdbData.mediaType === 'movie' ? '電影' : '電視劇';
        setDoubanCardSubtitle(`${year} / ${typeText}`);
      }
    };

    fetchTMDBBackdrop();
  }, [videoTitle, videoDoubanId, isDirectPlay]);

  useEffect(() => {
    if (
      pendingNetdiskTMDBData &&
      isNetdiskSource(detail?.source)
    ) {
      const currentDetail = detail;
      if (!currentDetail) {
        return;
      }
      const pending = pendingNetdiskTMDBData;
      setPendingNetdiskTMDBData(null);
      const tmdbYear = pending.releaseDate?.split('-')[0] || '';
      const shouldReplaceDesc =
        !currentDetail.desc ||
        currentDetail.desc.startsWith('臨時播放目錄：') ||
        currentDetail.desc.startsWith('移動雲盤分享：');
      const resolvedTmdbId = typeof pending.tmdbId === 'string'
        ? Number(String(pending.tmdbId).split(':')[1] || 0)
        : pending.tmdbId;

      setNetdiskTMDBMeta({
        desc: shouldReplaceDesc ? (pending.overview || currentDetail.desc) : currentDetail.desc,
        poster: currentDetail.poster || pending.poster || '',
        year: currentDetail.year || tmdbYear,
        tmdbId: currentDetail.tmdb_id || resolvedTmdbId,
      });

      setDetail((prev) => prev && isNetdiskSource(prev.source) ? {
        ...prev,
        poster: prev.poster || pending.poster || '',
        year: prev.year || tmdbYear,
        desc: shouldReplaceDesc ? (pending.overview || prev.desc) : prev.desc,
        tmdb_id: prev.tmdb_id || resolvedTmdbId,
      } : prev);

      if (pending.poster && !currentDetail.poster) {
        setVideoCover(processImageUrl(pending.poster));
      }
      if (tmdbYear && !currentDetail.year) {
        setVideoYear(tmdbYear);
      }
      if (pending.overview) {
        setCorrectedDesc(pending.overview);
      }
    }
  }, [pendingNetdiskTMDBData, detail]);

  // 視頻播放地址
  const [videoUrl, setVideoUrl] = useState('');

  // 視頻清晰度列表
  const [videoQualities, setVideoQualities] = useState<Array<{ name: string, url: string }>>([]);

  // Xiaoya鏈接刷新相關狀態
  const [isRefreshingUrl, setIsRefreshingUrl] = useState(false); // 是否正在刷新鏈接
  const retryCountRef = useRef(0); // 重試計數
  const lastRefreshTimeRef = useRef(0); // 上次刷新時間
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null); // 14分鐘定時器
  const currentXiaoyaUrlRef = useRef<string>(''); // 當前xiaoya原始URL（用於刷新）
  const isInitialLoadRef = useRef(true); // 標記是否為首次加載

  // 視頻源代理模式狀態
  const [sourceProxyMode, setSourceProxyMode] = useState(false);

  const resolveCurrentExternalPlaybackUrl = async () => {
    let urlToUse = videoUrl;
    if (sourceProxyMode && detail?.episodes && currentEpisodeIndex < detail.episodes.length) {
      urlToUse = detail.episodes[currentEpisodeIndex];
    }

    if (!urlToUse) {
      return null;
    }

    return buildAbsoluteUrl(urlToUse);
  };

  const handleCreateTranscodeSession = async () => {
    if (isTranscoding) return;

    try {
      setIsTranscoding(true);
      const currentPlayTime = artPlayerRef.current?.currentTime || 0;

      const sourceUrl = await resolveCurrentExternalPlaybackUrl();
      if (!sourceUrl) {
        throw new Error('當前沒有可轉碼的播放鏈接');
      }

      const requestHeaders: Record<string, string> = {};
      if (sourceUrl.startsWith(window.location.origin)) {
        if (document.cookie) {
          requestHeaders.Cookie = document.cookie;
        }
        requestHeaders.Referer = `${window.location.origin}/`;
      }

      let response: Response;
      try {
        response = await fetch(`${LOCAL_TRANSCODER_BASE_URL}/v1/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: sourceUrl,
            headers: Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
            subtitle: {
              mode: 'burn_embedded',
              stream: 'auto',
            },
            refresh: false,
          }),
        });
      } catch {
        throw new Error('轉碼服務連接失敗');
      }

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || data?.message || `轉碼請求失敗 (${response.status})`);
      }

      const playUrl = data?.playlist_url || data?.play_url;
      if (!playUrl) {
        throw new Error('轉碼器未返回播放地址');
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));

      currentXiaoyaUrlRef.current = '';
      proxyAttemptedRef.current = false;
      resumeTimeRef.current = currentPlayTime > 0 ? currentPlayTime : null;
      setVideoQualities([]);
      setVideoError(null);
      setCorsFailedUrl(null);
      setIsVideoLoading(true);
      setVideoLoadingStage('sourceChanging');
      setVideoUrl(playUrl);
      setToast({
        message: '轉碼任務已創建，等待 3 秒後已切換到轉碼地址',
        type: 'success',
        onClose: () => setToast(null),
      });
    } catch (error) {
      console.error('創建轉碼任務失敗:', error);
      setToast({
        message: error instanceof Error ? error.message : '創建轉碼任務失敗',
        type: 'error',
        onClose: () => setToast(null),
      });
    } finally {
      setIsTranscoding(false);
    }
  };

  const showExternalTranscodeButton = Boolean(
    detail &&
    videoUrl &&
    !videoUrl.startsWith('blob:') &&
    !isM3u8LikeUrl(videoUrl) &&
    (
      detail.source === 'openlist' ||
      isNetdiskSource(detail.source) ||
      detail.source === 'xiaoya' ||
      detail.source.startsWith('emby')
    )
  );

  // 總集數
  const totalEpisodes = detail?.episodes?.length || 0;
  const directEpisodeLabel = detail?.episodes_titles?.[currentEpisodeIndex] || '直鏈';
  const shouldShowEpisodeLabel = totalEpisodes > 1 || isDirectPlay;
  const episodeLabel = isDirectPlay
    ? directEpisodeLabel
    : detail?.episodes_titles?.[currentEpisodeIndex] || `第 ${currentEpisodeIndex + 1} 集`;
  const playerEpisodeLabel = isDirectPlay
    ? directEpisodeLabel
    : `第${currentEpisodeIndex + 1}集`;

  const loadSavedPlaybackRate = () => {
    if (typeof window === 'undefined') {
      return 1.0;
    }

    const raw = localStorage.getItem('preferredPlaybackRate');
    const parsed = raw ? Number(raw) : 1;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1.0;
  };

  const persistPlaybackRate = (rate: number) => {
    if (typeof window === 'undefined' || !Number.isFinite(rate) || rate <= 0) {
      return;
    }

    localStorage.setItem('preferredPlaybackRate', String(rate));
  };

  const isDanmakuAutoLoadDisabled = () => {
    if (typeof window === 'undefined') {
      return false;
    }

    const saved = localStorage.getItem('disableAutoLoadDanmaku');
    if (saved !== null) {
      return saved === 'true';
    }

    return (window as any).RUNTIME_CONFIG?.DANMAKU_AUTO_LOAD_DEFAULT === false;
  };

  // 用於記錄是否需要在播放器 ready 後跳轉到指定進度
  const resumeTimeRef = useRef<number | null>(null);
  // 播放記錄跳轉按鈕狀態
  const playRecordJumpDismissedRef = useRef(false); // 記錄用戶是否已經關閉過跳轉按鈕
  const playRecordJumpLayerRef = useRef<any>(null); // 保存跳轉按鈕層的引用
  const playRecordJumpInitialCheckRef = useRef(true); // 記錄是否是首次檢查播放記錄
  // 上次使用的音量，默認 0.7
  const lastVolumeRef = useRef<number>(0.7);
  // 上次使用的播放速率，默認 1.0
  const lastPlaybackRateRef = useRef<number>(loadSavedPlaybackRate());
  // Safari 切集時會短暫把 playbackRate 重置為 1，這裡保留一段恢復窗口避免汙染記憶值
  const playbackRateRestoreWindowUntilRef = useRef<number>(0);

  // 換源相關狀態
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );
  const [fallbackRecommendations, setFallbackRecommendations] = useState<PlayFallbackRecommendation[]>([]);
  const [hasCompletedSearchRequest, setHasCompletedSearchRequest] = useState(false);
  const [backgroundSourcesLoading, setBackgroundSourcesLoading] = useState(false);
  const fallbackRecommendationsRowRef = useRef<HTMLDivElement>(null);
  const fallbackRecommendationsDraggingRef = useRef(false);
  const fallbackRecommendationsDragStartXRef = useRef(0);
  const fallbackRecommendationsDragStartScrollLeftRef = useRef(0);

  useEffect(() => {
    try {
      pruneLocalEpisodeProgressStorage();
    } catch (error) {
      console.warn('[Play] Failed to prune local episode progress:', error);
    }
  }, []);

  // 優選和測速開關
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  const [preferStrategy] = useState<'fast' | 'full'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('preferStrategy');
      if (saved === 'fast' || saved === 'full') {
        return saved;
      }
    }
    return 'fast';
  });

  // 保存優選時的測速結果，避免EpisodeSelector重複測速
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, { quality: string; loadSpeed: string; pingTime: number; bitrate: string }>
  >(new Map());

  // 當前源的視頻信息（用於標題旁邊顯示）
  const [currentSourceVideoInfo, setCurrentSourceVideoInfo] = useState<{
    quality: string;
    loadSpeed: string;
    pingTime: number;
    bitrate: string;
  } | null>(null);

  // 摺疊狀態（僅在 lg 及以上屏幕有效）
  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  // 下載選集面板顯示狀態
  const [showDownloadSelector, setShowDownloadSelector] = useState(false);

  // 換源加載狀態
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging' | 'episodeChanging'
  >('initing');
  const [videoError, setVideoError] = useState<string | null>(null);
  // 直鏈播放時 CORS 失敗的原始 URL，用於顯示"使用代理播放"按鈕
  const [corsFailedUrl, setCorsFailedUrl] = useState<string | null>(null);
  // 標記當前視頻是否已經嘗試過代理（防止 415→直連→失敗→代理 的無限循環）
  const proxyAttemptedRef = useRef(false);
  const videoUrlRequestSeqRef = useRef(0);
  const lastVideoRequestKeyRef = useRef<string | null>(null);

  // 直鏈代理域名記憶：檢查某個域名是否需要代理
  const isDirectplayDomainProxied = (url: string): boolean => {
    try {
      const domain = new URL(url).hostname;
      const domains: string[] = JSON.parse(localStorage.getItem('directplay_proxy_domains') || '[]');
      return domains.includes(domain);
    } catch { return false; }
  };
  // 將域名記錄到代理列表
  const addDirectplayProxyDomain = (url: string) => {
    try {
      const domain = new URL(url).hostname;
      const domains: string[] = JSON.parse(localStorage.getItem('directplay_proxy_domains') || '[]');
      if (!domains.includes(domain)) {
        domains.push(domain);
        localStorage.setItem('directplay_proxy_domains', JSON.stringify(domains));
      }
    } catch { /* ignore */ }
  };

  // 播放器就緒狀態（用於觸發 usePlaySync 的事件監聽器設置）
  const [playerReady, setPlayerReady] = useState(false);

  const handleFallbackRecommendationsWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const container = fallbackRecommendationsRowRef.current;
    if (!container) return;

    if (container.scrollWidth <= container.clientWidth + 1) return;

    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (delta === 0) return;

    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    const nextScrollLeft = container.scrollLeft + delta;
    const willScroll =
      (delta < 0 && container.scrollLeft > 0) ||
      (delta > 0 && container.scrollLeft < maxScrollLeft);

    if (!willScroll) return;

    e.preventDefault();
    container.scrollLeft = Math.max(0, Math.min(maxScrollLeft, nextScrollLeft));
  };

  const handleFallbackRecommendationsMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = fallbackRecommendationsRowRef.current;
    if (!container || container.scrollWidth <= container.clientWidth) return;
    if (e.button !== 0) return;

    fallbackRecommendationsDraggingRef.current = true;
    fallbackRecommendationsDragStartXRef.current = e.clientX;
    fallbackRecommendationsDragStartScrollLeftRef.current = container.scrollLeft;
  };

  const handleFallbackRecommendationsMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = fallbackRecommendationsRowRef.current;
    if (!container || !fallbackRecommendationsDraggingRef.current) return;

    const deltaX = e.clientX - fallbackRecommendationsDragStartXRef.current;
    container.scrollLeft = fallbackRecommendationsDragStartScrollLeftRef.current - deltaX;
  };

  const stopFallbackRecommendationsDragging = () => {
    fallbackRecommendationsDraggingRef.current = false;
  };

  // 播放進度保存相關
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  // 下集預緩存相關
  const nextEpisodePreCacheTriggeredRef = useRef<boolean>(false);
  const nextEpisodePreCacheHlsRef = useRef<any>(null);
  const nextEpisodeDanmakuPreloadTriggeredRef = useRef<boolean>(false);

  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);

  // Wake Lock 相關
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // 觀影室同步功能
  const playSync = usePlaySync({
    artPlayerRef,
    videoId: currentId || '',  // 使用 currentId 狀態而不是 searchParams
    videoName: videoTitle || detail?.title || '正在加載...',
    videoYear: videoYear || detail?.year || '',
    searchTitle: searchTitle || '',
    currentEpisode: currentEpisodeIndex + 1,
    currentSource: currentSource || '',
    videoUrl: videoUrl || '',
    playerReady: playerReady,  // 傳遞播放器就緒狀態
  });

  // -----------------------------------------------------------------------------
  // 工具函數（Utils）
  // -----------------------------------------------------------------------------

  // 判斷劇集狀態
  const getSeriesStatus = (detail: SearchResult | null): 'completed' | 'ongoing' | 'unknown' => {
    if (!detail) return 'unknown';

    // 方法1：通過 vod_remarks 判斷
    if (detail.vod_remarks) {
      const remarks = detail.vod_remarks.toLowerCase();
      // 判定為完結的關鍵詞
      const completedKeywords = ['全', '完結', '大結局', 'end', '完'];
      // 判定為連載的關鍵詞
      const ongoingKeywords = ['更新至', '連載', '第', '更新到'];

      // 如果包含連載關鍵詞，則為連載中
      if (ongoingKeywords.some(keyword => remarks.includes(keyword))) {
        return 'ongoing';
      }

      // 如果包含完結關鍵詞，則為已完結
      if (completedKeywords.some(keyword => remarks.includes(keyword))) {
        return 'completed';
      }
    }

    // 方法2：通過 vod_total 和實際集數對比判斷
    if (detail.vod_total && detail.vod_total > 0 && detail.episodes && detail.episodes.length > 0) {
      // 如果實際集數 >= 總集數，則為已完結
      if (detail.episodes.length >= detail.vod_total) {
        return 'completed';
      }
      // 如果實際集數 < 總集數，則為連載中
      return 'ongoing';
    }

    // 無法判斷，返回 unknown
    return 'unknown';
  };

  // 獲取當前源的視頻信息（分辨率和碼率）
  const fetchCurrentSourceVideoInfo = async () => {
    if (!detail || !detail.episodes || detail.episodes.length === 0) {
      return;
    }

    // 獲取當前集數的播放地址
    let episodeUrl = detail.episodes[currentEpisodeIndex];
    if (!episodeUrl) {
      return;
    }

    // 簡單的正則或者後綴判斷，如果明確不是 m3u8 (比如 mp4)，則不走 m3u8 代理
    const isM3u8 = episodeUrl.toLowerCase().includes('.m3u') || !episodeUrl.toLowerCase().match(/\.(mp4|flv|webm|mkv|avi|mov)(\?.*)?$/);

    if (currentSource === 'directplay' && isM3u8) {
      // 僅當 localStorage 記憶了該域名需要代理時才走代理
      if (isDirectplayDomainProxied(episodeUrl)) {
        const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
        episodeUrl = `/api/proxy-m3u8?url=${encodeURIComponent(episodeUrl)}&source=directplay${tokenParam}`;
      } else {
        // 直鏈模式且未走代理：跳過 HLS.js 探測。
        // getVideoResolutionFromM3u8 內部使用 HLS.js (XMLHttpRequest) 加載，
        // 而 XHR 受 CORS 限制，探測必然失敗。實際播放器通過 <video src> 加載不受 CORS 影響。
        console.log('[視頻信息] 直鏈直連模式，跳過分辨率探測（避免 CORS 誤報）');
        setCurrentSourceVideoInfo(null);
        return;
      }
    } else if (sourceProxyMode && isM3u8) {
      episodeUrl = `/api/proxy/vod/m3u8?url=${encodeURIComponent(episodeUrl)}&source=${encodeURIComponent(currentSource)}`;
    }

    try {
      const info = await getVideoResolutionFromM3u8(episodeUrl, 4000);
      setCurrentSourceVideoInfo(info);
    } catch (error) {
      console.error('獲取視頻信息失敗:', error);
      setCurrentSourceVideoInfo(null);
    }
  };

  // 播放源優選函數
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    if (sources.length === 1) return sources[0];

    type SourceTestResult = {
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number; bitrate: string };
    };
    type MaybeSourceTestResult = SourceTestResult | null;

    const sortedByWeight = [...sources].sort((a, b) => {
      const weightA = a.weight ?? 0;
      const weightB = b.weight ?? 0;
      return weightB - weightA;
    });

    const finalizeSelection = (
      completedResults: MaybeSourceTestResult[]
    ): SearchResult => {
      const newVideoInfoMap = new Map<
        string,
        {
          quality: string;
          loadSpeed: string;
          pingTime: number;
          bitrate: string;
        }
      >();
      completedResults.forEach((result) => {
        if (!result) return;
        const sourceKey = `${result.source.source}-${result.source.id}`;
        newVideoInfoMap.set(sourceKey, result.testResult);
      });
      setPrecomputedVideoInfo(newVideoInfoMap);

      const successfulResults = completedResults.filter(
        Boolean
      ) as SourceTestResult[];

      if (successfulResults.length === 0) {
        console.warn('所有播放源測速都失敗，按權重排序');
        return sortedByWeight[0];
      }

      const validSpeeds = successfulResults
        .map((result) => {
          const speedStr = result.testResult.loadSpeed;
          if (speedStr === '未知' || speedStr === '測量中...') return 0;

          const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
          if (!match) return 0;

          const value = parseFloat(match[1]);
          const unit = match[2];
          return unit === 'MB/s' ? value * 1024 : value;
        })
        .filter((speed) => speed > 0);

      const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024;

      const validPings = successfulResults
        .map((result) => result.testResult.pingTime)
        .filter((ping) => ping > 0);

      const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
      const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

      const resultsWithScore = successfulResults.map((result) => ({
        ...result,
        score: calculateSourceScore(
          result.testResult,
          maxSpeed,
          minPing,
          maxPing,
          result.source.weight ?? 0
        ),
      }));

      resultsWithScore.sort((a, b) => b.score - a.score);

      console.log('播放源評分排序結果:');
      resultsWithScore.forEach((result, index) => {
        console.log(
          `${index + 1}. ${result.source.source_name
          } - 評分: ${result.score.toFixed(2)} (${result.testResult.quality}, ${result.testResult.loadSpeed
          }, ${result.testResult.pingTime}ms)`
        );
      });

      return resultsWithScore[0].source;
    };

    const testSingleSource = async (
      source: SearchResult
    ): Promise<MaybeSourceTestResult> => {
      try {
        if (!source.episodes || source.episodes.length === 0) {
          console.warn(`播放源 ${source.source_name} 沒有可用的播放地址`);
          return null;
        }

        let episodeUrl =
          source.episodes.length > 1
            ? source.episodes[1]
            : source.episodes[0];

        const isM3u8 = episodeUrl.toLowerCase().includes('.m3u') || !episodeUrl.toLowerCase().match(/\.(mp4|flv|webm|mkv|avi|mov)(\?.*)?$/);
        if (source.source === 'directplay' && isM3u8) {
          if (isDirectplayDomainProxied(episodeUrl)) {
            const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
            episodeUrl = `/api/proxy-m3u8?url=${encodeURIComponent(episodeUrl)}&source=directplay${tokenParam}`;
          }
        } else if (source.proxyMode && isM3u8) {
          episodeUrl = `/api/proxy/vod/m3u8?url=${encodeURIComponent(episodeUrl)}&source=${encodeURIComponent(source.source)}`;
        }

        const testResult = await getVideoResolutionFromM3u8(episodeUrl);

        return {
          source,
          testResult,
        };
      } catch (error) {
        return null;
      }
    };

    const maxConcurrency = Math.ceil(sources.length / 2);

    const runAllWithSameConcurrency = async (): Promise<MaybeSourceTestResult[]> => {
      const results: MaybeSourceTestResult[] = new Array(sources.length);
      let nextIndex = 0;

      const worker = async () => {
        while (nextIndex < sources.length) {
          const currentIndex = nextIndex++;
          results[currentIndex] = await testSingleSource(sources[currentIndex]);
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(maxConcurrency, sources.length) }, () =>
          worker()
        )
      );

      return results;
    };

    if (preferStrategy === 'full' || sortedByWeight.length < 5) {
      const allResults = await runAllWithSameConcurrency();
      return finalizeSelection(allResults);
    }

    const topPriorityKeys = new Set(
      sortedByWeight
        .slice(0, 5)
        .map((source) => `${source.source}-${source.id}`)
    );

    const quickResults = await new Promise<MaybeSourceTestResult[]>((resolve) => {
      const results: Array<MaybeSourceTestResult | undefined> = new Array(sources.length);
      let nextIndex = 0;
      let activeCount = 0;
      let completedCount = 0;
      let topCompletedCount = 0;
      let topSuccessCount = 0;
      let settled = false;

      const maybeResolve = () => {
        if (settled) return;

        if (topCompletedCount === 5 && topSuccessCount > 0) {
          settled = true;
          resolve(
            results.filter((result) => result !== undefined) as MaybeSourceTestResult[]
          );
          return;
        }

        if (completedCount === sources.length) {
          settled = true;
          resolve(results as MaybeSourceTestResult[]);
          return;
        }

        while (!settled && activeCount < maxConcurrency && nextIndex < sources.length) {
          const currentIndex = nextIndex++;
          const currentSource = sources[currentIndex];
          const sourceKey = `${currentSource.source}-${currentSource.id}`;
          activeCount += 1;

          testSingleSource(currentSource)
            .then((result) => {
              results[currentIndex] = result;
              completedCount += 1;

              if (topPriorityKeys.has(sourceKey)) {
                topCompletedCount += 1;
                if (result) {
                  topSuccessCount += 1;
                }
              }
            })
            .finally(() => {
              activeCount -= 1;
              maybeResolve();
            });
        }
      };

      maybeResolve();
    });

    return finalizeSelection(quickResults);
  };

  // 計算播放源綜合評分
  const calculateSourceScore = (
    testResult: {
      quality: string;
      loadSpeed: string;
      pingTime: number;
    },
    maxSpeed: number,
    minPing: number,
    maxPing: number,
    weight = 0
  ): number => {
    let score = 0;

    // 分辨率評分 (40% 權重)
    const qualityScore = (() => {
      switch (testResult.quality) {
        case '4K':
          return 100;
        case '2K':
          return 85;
        case '1080p':
          return 75;
        case '720p':
          return 60;
        case '480p':
          return 40;
        case 'SD':
          return 20;
        default:
          return 0;
      }
    })();
    score += qualityScore * 0.4;

    // 下載速度評分 (40% 權重) - 基於最大速度線性映射
    const speedScore = (() => {
      const speedStr = testResult.loadSpeed;
      if (speedStr === '未知' || speedStr === '測量中...') return 30;

      // 解析速度值
      const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
      if (!match) return 30;

      const value = parseFloat(match[1]);
      const unit = match[2];
      const speedKBps = unit === 'MB/s' ? value * 1024 : value;

      // 基於最大速度線性映射，最高100分
      const speedRatio = speedKBps / maxSpeed;
      return Math.min(100, Math.max(0, speedRatio * 100));
    })();
    score += speedScore * 0.4;

    // 網絡延遲評分 (20% 權重) - 基於延遲範圍線性映射
    const pingScore = (() => {
      const ping = testResult.pingTime;
      if (ping <= 0) return 0; // 無效延遲給默認分

      // 如果所有延遲都相同，給滿分
      if (maxPing === minPing) return 100;

      // 線性映射：最低延遲=100分，最高延遲=0分
      const pingRatio = (maxPing - ping) / (maxPing - minPing);
      return Math.min(100, Math.max(0, pingRatio * 100));
    })();
    score += pingScore * 0.2;

    // 權重加分 - 直接加到總分上（0-100分）
    score += weight;

    return Math.round(score * 100) / 100; // 保留兩位小數
  };

  // 檢查是否有本地下載的視頻
  const checkLocalDownload = async (
    source: string,
    videoId: string,
    episodeIndex: number
  ): Promise<boolean> => {
    if (!enableOfflineDownload || !hasOfflinePermission) {
      return false;
    }

    try {
      const response = await fetch(
        `/api/offline-download?action=check&source=${encodeURIComponent(source)}&videoId=${encodeURIComponent(videoId)}&episodeIndex=${episodeIndex}`
      );

      if (response.ok) {
        const data = await response.json();
        return data.downloaded || false;
      }
    } catch (error) {
      console.error('檢查本地下載失敗:', error);
    }

    return false;
  };

  /**
   * 檢查 File System API 本地下載
   */
  const checkFileSystemDownload = async (
    title: string,
    source?: string,
    videoId?: string,
    episodeIndex?: number
  ): Promise<{ hasLocal: boolean; dirHandle?: FileSystemDirectoryHandle }> => {
    try {
      // 從 IndexedDB 讀取目錄句柄
      const dbName = 'MoonTVPlus';
      const storeName = 'dirHandles';

      return new Promise((resolve) => {
        const request = indexedDB.open(dbName, 2); // 使用版本 2

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // 創建 dirHandles 表（如果不存在）
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }

          // 創建 activeTasks 表（如果不存在）
          if (!db.objectStoreNames.contains('activeTasks')) {
            const activeStore = db.createObjectStore('activeTasks', { keyPath: 'id' });
            activeStore.createIndex('status', 'status', { unique: false });
            activeStore.createIndex('createdAt', 'createdAt', { unique: false });
          }

          // 創建 completedTasks 表（如果不存在）
          if (!db.objectStoreNames.contains('completedTasks')) {
            const completedStore = db.createObjectStore('completedTasks', { keyPath: 'id' });
            completedStore.createIndex('source', 'source', { unique: false });
            completedStore.createIndex('videoId', 'videoId', { unique: false });
            completedStore.createIndex('completedAt', 'completedAt', { unique: false });
            completedStore.createIndex('sourceVideoId', ['source', 'videoId'], { unique: false });
          }
        };

        request.onsuccess = async (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // 檢查 object store 是否存在
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve({ hasLocal: false });
            return;
          }

          const transaction = db.transaction([storeName], 'readonly');
          const store = transaction.objectStore(storeName);
          const getRequest = store.get('downloadDir');

          getRequest.onsuccess = async () => {
            const dirHandle = getRequest.result as FileSystemDirectoryHandle | undefined;
            if (!dirHandle) {
              resolve({ hasLocal: false });
              return;
            }

            try {
              // 請求讀權限
              const permission = await (dirHandle as any).queryPermission({ mode: 'read' });
              if (permission !== 'granted') {
                const requestPermission = await (dirHandle as any).requestPermission({ mode: 'read' });
                if (requestPermission !== 'granted') {
                  console.warn('未獲得讀權限');
                  resolve({ hasLocal: false });
                  return;
                }
              }

              // 如果有 source、videoId 和 episodeIndex，檢查子目錄
              if (source && videoId && episodeIndex !== undefined) {
                const sourceDirHandle = await dirHandle.getDirectoryHandle(source, { create: false });
                const videoIdDirHandle = await sourceDirHandle.getDirectoryHandle(videoId, { create: false });
                const epDirHandle = await videoIdDirHandle.getDirectoryHandle(`ep${episodeIndex + 1}`, { create: false });

                // 檢查是否存在 playlist.m3u8 文件
                await epDirHandle.getFileHandle('playlist.m3u8', { create: false });
                console.log('找到本地下載文件:', title, `(${source}/${videoId}/ep${episodeIndex + 1})`);
                resolve({ hasLocal: true, dirHandle: epDirHandle });
              } else {
                // 缺少必要參數
                resolve({ hasLocal: false });
              }
            } catch (error) {
              // 文件不存在
              console.error('檢查本地文件失敗:', error);
              resolve({ hasLocal: false });
            }
          };

          getRequest.onerror = () => {
            resolve({ hasLocal: false });
          };
        };

        request.onerror = () => {
          resolve({ hasLocal: false });
        };
      });
    } catch (error) {
      console.error('檢查 File System API 下載失敗:', error);
      return { hasLocal: false };
    }
  };

  /**
   * 刷新xiaoya鏈接（靜默刷新，不改變videoUrl狀態）
   * @param hls HLS實例
   * @param video 視頻元素
   * @param isScheduled 是否為定時刷新（true=定時，false=錯誤觸發）
   */
  const refreshXiaoyaUrl = async (
    hls: any,
    video: HTMLVideoElement,
    isScheduled = false
  ) => {
    // 防抖：距離上次刷新不足3秒則不刷新
    const now = Date.now();
    if (now - lastRefreshTimeRef.current < 3000) {
      console.log('[鏈接刷新] 防抖跳過');
      return false;
    }

    // 重試次數限制（僅對錯誤觸發的刷新）
    if (!isScheduled && retryCountRef.current >= 3) {
      console.error('[鏈接刷新] 重試次數已達上限');
      setVideoError('鏈接已過期且刷新失敗，請手動刷新頁面');
      hls.destroy();
      return false;
    }

    // 檢查是否有原始URL
    if (!currentXiaoyaUrlRef.current) {
      console.warn('[鏈接刷新] 無原始URL，跳過刷新');
      return false;
    }

    console.log(`[鏈接刷新] 開始刷新 (${isScheduled ? '定時' : '錯誤觸發'})`);
    setIsRefreshingUrl(true);

    if (!isScheduled) {
      retryCountRef.current++;
    }
    lastRefreshTimeRef.current = now;

    try {
      // 保存當前播放進度
      const currentTime = video.currentTime;
      const isPaused = video.paused;

      console.log(`[鏈接刷新] 開始刷新 (${isScheduled ? '定時' : '錯誤觸發'}), 當前時間:`, currentTime);

      // 重新獲取播放鏈接（添加時間戳避免緩存）
      const separator = currentXiaoyaUrlRef.current.includes('?') ? '&' : '?';
      const fetchUrl = `${currentXiaoyaUrlRef.current}${separator}format=json&t=${Date.now()}`;

      const response = await fetch(fetchUrl);
      const data = await response.json();

      if (!data.url) {
        throw new Error('未獲取到有效鏈接');
      }

      console.log('[鏈接刷新] 獲取到新鏈接');

      // 先停止HLS加載
      hls.stopLoad();

      // 使用HLS的loadSource方法直接加載新鏈接（不改變videoUrl狀態）
      hls.loadSource(data.url);

      // 監聽加載完成事件，恢復播放進度
      const onManifestParsed = () => {
        // 從指定位置開始加載
        hls.startLoad(currentTime);

        // 等待視頻可以seek
        const onLoadedData = () => {
          video.removeEventListener('loadeddata', onLoadedData);

          // 設置播放位置
          if (currentTime > 0) {
            video.currentTime = currentTime;

            // 等待seek完成
            const onSeeked = () => {
              console.log('[鏈接刷新] 刷新完成，恢復到:', video.currentTime);

              video.removeEventListener('seeked', onSeeked);

              // 恢復播放狀態
              if (!isPaused) {
                video.play().catch(err => {
                  console.warn('[鏈接刷新] 自動播放失敗:', err);
                });
              } else {
                // 確保暫停狀態
                video.pause();
              }

              setIsRefreshingUrl(false);

              // 顯示提示
              if (artPlayerRef.current) {
                artPlayerRef.current.notice.show = isScheduled
                  ? '鏈接已自動刷新'
                  : '鏈接已過期並自動刷新';
              }

              // 刷新成功，重置重試計數
              retryCountRef.current = 0;

              // 重新啟動14分鐘定時器
              startRefreshTimer(hls, video);
            };

            video.addEventListener('seeked', onSeeked, { once: true });
          } else {
            // 如果是從頭開始
            if (!isPaused) {
              video.play().catch(err => {
                console.warn('[鏈接刷新] 自動播放失敗:', err);
              });
            } else {
              // 確保暫停狀態
              video.pause();
            }

            setIsRefreshingUrl(false);

            if (artPlayerRef.current) {
              artPlayerRef.current.notice.show = isScheduled
                ? '鏈接已自動刷新'
                : '鏈接已過期並自動刷新';
            }

            retryCountRef.current = 0;
            startRefreshTimer(hls, video);
          }
        };

        video.addEventListener('loadeddata', onLoadedData, { once: true });
      };

      // 使用 hls.constructor.Events 訪問事件常量
      const HlsEvents = (hls.constructor as any).Events;
      hls.once(HlsEvents.MANIFEST_PARSED, onManifestParsed);

      // 添加超時保護（10秒內未加載完成則認為失敗）
      setTimeout(() => {
        hls.off(HlsEvents.MANIFEST_PARSED, onManifestParsed);
        if (isRefreshingUrl) {
          console.error('[鏈接刷新] 加載超時');
          setIsRefreshingUrl(false);
          throw new Error('加載超時');
        }
      }, 10000);

      return true;
    } catch (error) {
      console.error('[鏈接刷新] 刷新失敗:', error);
      setIsRefreshingUrl(false);

      // 如果是定時刷新失敗，不顯示錯誤（繼續使用舊鏈接）
      if (isScheduled) {
        console.warn('[鏈接刷新] 定時刷新失敗，繼續使用舊鏈接');
        // 5分鐘後再試一次
        setTimeout(() => {
          if (hls && video && currentXiaoyaUrlRef.current) {
            refreshXiaoyaUrl(hls, video, true);
          }
        }, 5 * 60 * 1000);
        return false;
      }

      // 錯誤觸發的刷新失敗，如果還有重試次數，延遲後再試
      if (retryCountRef.current < 3) {
        console.log(`[鏈接刷新] 2秒後重試 (${retryCountRef.current}/3)`);
        setTimeout(() => {
          if (hls && video && currentXiaoyaUrlRef.current) {
            refreshXiaoyaUrl(hls, video, false);
          }
        }, 2000);
      } else {
        setVideoError('鏈接刷新失敗，請手動刷新頁面');
        hls.destroy();
      }

      return false;
    }
  };

  /**
   * 啟動14分鐘定時刷新器
   */
  const startRefreshTimer = (hls: any, video: HTMLVideoElement) => {
    // 清除舊定時器
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    // 只對xiaoya源啟動定時器
    if (!currentXiaoyaUrlRef.current) {
      return;
    }

    console.log('[定時刷新] 啟動14分鐘定時器');

    // 14分鐘 = 840000毫秒
    refreshTimerRef.current = setTimeout(() => {
      console.log('[定時刷新] 14分鐘到期，開始刷新');
      if (hls && video && currentXiaoyaUrlRef.current) {
        refreshXiaoyaUrl(hls, video, true);
      }
    }, 14 * 60 * 1000);
  };

  /**
   * 清除刷新定時器
   */
  const clearRefreshTimer = () => {
    if (refreshTimerRef.current) {
      console.log('[定時刷新] 清除定時器');
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  };

  // 更新視頻地址
  const updateVideoUrl = async (
    detailData: SearchResult | null,
    episodeIndex: number
  ) => {
    // 重置刷新相關狀態
    retryCountRef.current = 0;
    lastRefreshTimeRef.current = 0;
    currentXiaoyaUrlRef.current = ''; // 清空舊的原始URL
    clearRefreshTimer(); // 清除舊的定時器
    isInitialLoadRef.current = true; // 重置為首次加載

    // 動態設置 referrer policy：不發送 Referer
    const existingMeta = document.querySelector('meta[name="referrer"]');
    if (!existingMeta) {
      const meta = document.createElement('meta');
      meta.name = 'referrer';
      meta.content = 'no-referrer';
      document.head.appendChild(meta);
    }

    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      // 這類源統一先走詳情懶加載，如果 episodes 為空則跳過
      if (isLazyDetailSource(detailData?.source) && (!detailData?.episodes || detailData.episodes.length === 0)) {
        return;
      }
      setVideoUrl('');
      return;
    }

    const requestKey = `${detailData.source}|${detailData.id}|${episodeIndex}`;
    const isEpisodeSwitchRequest = lastVideoRequestKeyRef.current !== requestKey;
    lastVideoRequestKeyRef.current = requestKey;
    const requestSeq = ++videoUrlRequestSeqRef.current;

    let newUrl = detailData?.episodes[episodeIndex] || '';
    const isXiaoyaLazyPlayUrl = newUrl.startsWith('/api/xiaoya/play');

    if (isEpisodeSwitchRequest && isXiaoyaLazyPlayUrl) {
      setVideoLoadingStage('episodeChanging');
      setIsVideoLoading(true);
      setVideoError(null);
      setCorsFailedUrl(null);

      if (artPlayerRef.current?.video) {
        try {
          const video = artPlayerRef.current.video as HTMLVideoElement;
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch (error) {
          console.warn('切集時清空舊視頻源失敗:', error);
        }
      }

      if (videoUrl) {
        setVideoUrl('');
      }
    }

    // 如果是小雅或 openlist 接口，先請求獲取真實 URL
    const isSpecialLazyPlayUrl =
      isXiaoyaLazyPlayUrl ||
      newUrl.startsWith('/api/openlist/play') ||
      newUrl.startsWith('/api/netdisk/115/play') ||
      newUrl.startsWith('/api/netdisk/123/play') ||
      newUrl.startsWith('/api/netdisk/quark/play') ||
      newUrl.startsWith('/api/netdisk/uc/play') ||
      newUrl.startsWith('/api/netdisk/baidu/play') ||
      newUrl.startsWith('/api/source-script/play');

    if (isSpecialLazyPlayUrl) {
      try {
        // 保存原始URL（用於後續刷新）
        if (newUrl.startsWith('/api/xiaoya/play') || newUrl.startsWith('/api/openlist/play')) {
          currentXiaoyaUrlRef.current = newUrl;
        }

        // 添加 format=json 參數
        const separator = newUrl.includes('?') ? '&' : '?';
        const fetchUrl = `${newUrl}${separator}format=json`;

        const response = await fetch(fetchUrl);
        const data = await response.json();
        if (requestSeq !== videoUrlRequestSeqRef.current) {
          return;
        }
        if (data.url) {
          newUrl = data.url;
          // 保存清晰度列表
          if (data.qualities && data.qualities.length > 0) {
            setVideoQualities(data.qualities);
          } else {
            setVideoQualities([]);
          }
        }
      } catch (error) {
        if (requestSeq !== videoUrlRequestSeqRef.current) {
          return;
        }
        console.error('獲取播放鏈接失敗:', error);
        setVideoQualities([]);
        currentXiaoyaUrlRef.current = ''; // 獲取失敗，清空
      }
    } else {
      // 非小雅/openlist 源，清空清晰度列表
      setVideoQualities([]);
    }

    // 檢查是否有 File System API 本地下載的文件
    const episodeTitle = detailData?.episodes_titles?.[episodeIndex] || `第${episodeIndex + 1}集`;
    const fileSystemCheck = await checkFileSystemDownload(
      episodeTitle,
      currentSource || undefined,
      currentId || undefined,
      episodeIndex
    );
    if (requestSeq !== videoUrlRequestSeqRef.current) {
      return;
    }

    if (fileSystemCheck.hasLocal && fileSystemCheck.dirHandle) {
      // 使用本地文件播放
      try {
        // 讀取 m3u8 文件
        const fileHandle = await fileSystemCheck.dirHandle.getFileHandle('playlist.m3u8', { create: false });
        const file = await fileHandle.getFile();
        const content = await file.text();

        // 解析 m3u8 文件，為每個 ts 文件創建 Blob URL
        const lines = content.split('\n');
        const modifiedLines: string[] = [];
        const blobUrls: string[] = []; // 保存 Blob URL 以便後續清理

        for (const line of lines) {
          const trimmedLine = line.trim();

          // 如果是 ts 文件
          if (trimmedLine.endsWith('.ts')) {
            try {
              // 讀取 ts 文件
              const tsFileHandle = await fileSystemCheck.dirHandle.getFileHandle(trimmedLine, { create: false });
              const tsFile = await tsFileHandle.getFile();

              // 創建 Blob URL
              const blobUrl = URL.createObjectURL(tsFile);
              blobUrls.push(blobUrl);

              // 替換為 Blob URL
              modifiedLines.push(line.replace(trimmedLine, blobUrl));
            } catch (error) {
              console.error(`讀取 ts 文件失敗: ${trimmedLine}`, error);
              modifiedLines.push(line);
            }
          }
          // 如果是加密密鑰
          else if (trimmedLine.includes('key.key')) {
            try {
              const keyFileHandle = await fileSystemCheck.dirHandle.getFileHandle('key.key', { create: false });
              const keyFile = await keyFileHandle.getFile();
              const keyBlobUrl = URL.createObjectURL(keyFile);
              blobUrls.push(keyBlobUrl);
              modifiedLines.push(line.replace('key.key', keyBlobUrl));
            } catch (error) {
              console.error('讀取密鑰文件失敗:', error);
              modifiedLines.push(line);
            }
          }
          else {
            modifiedLines.push(line);
          }
        }

        // 創建修改後的 m3u8 的 Blob URL
        const modifiedContent = modifiedLines.join('\n');
        const m3u8Blob = new Blob([modifiedContent], { type: 'application/vnd.apple.mpegurl' });
        newUrl = URL.createObjectURL(m3u8Blob);

        // 保存 Blob URLs 到 window，以便在切換視頻時清理
        (window as any).__localFileBlobUrls = blobUrls;

        console.log('使用 File System API 本地文件播放（Blob URL 模式）:', episodeTitle);
      } catch (error) {
        console.error('讀取本地文件失敗:', error);
      }
    }

    // 如果沒有 File System API 本地文件，檢查服務器端本地下載
    if (!fileSystemCheck.hasLocal) {
      const hasLocalFile = await checkLocalDownload(currentSource, currentId, episodeIndex);
      if (requestSeq !== videoUrlRequestSeqRef.current) {
        return;
      }

      if (hasLocalFile) {
        // 使用本地代理接口,URL以.m3u8結尾以便Artplayer自動識別
        newUrl = `/api/offline-download/local/${currentSource}/${currentId}/${episodeIndex}/playlist.m3u8`;
        console.log('使用服務器端本地下載文件播放:', newUrl);
      } else {
        const isM3u8 = newUrl.toLowerCase().includes('.m3u') || !newUrl.toLowerCase().match(/\.(mp4|flv|webm|mkv|avi|mov)(\?.*)?$/);

        if (sourceProxyMode && newUrl && isM3u8) {
          // 如果視頻源啟用了代理模式,且不是本地下載,則通過代理播放
          newUrl = `/api/proxy/vod/m3u8?url=${encodeURIComponent(newUrl)}&source=${encodeURIComponent(currentSource)}`;
          console.log('使用代理模式播放:', newUrl);
        } else if (currentSource === 'directplay' && newUrl && isM3u8) {
          // 直鏈播放模式：檢查 localStorage 是否記錄了該域名需要代理
          if (isDirectplayDomainProxied(newUrl)) {
            const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
            newUrl = `/api/proxy-m3u8?url=${encodeURIComponent(newUrl)}&source=directplay${tokenParam}`;
            console.log('直鏈播放（域名已記憶）使用代理模式:', newUrl);
          } else {
            console.log('直鏈播放默認直連模式，不使用代理:', newUrl);
          }
        } else if (!isM3u8) {
          console.log('非 m3u8 格式，豁免代理框架，直接播放原始URL:', newUrl);
        }
      }
    }

    if (isEpisodeSwitchRequest || newUrl !== videoUrl) {
      if (requestSeq !== videoUrlRequestSeqRef.current) {
        return;
      }
      setVideoUrl(newUrl);
    }
  };

  // 處理下載指定集數（支持批量下載）
  const handleDownloadEpisode = async (episodeIndexes: number[], offlineMode = false) => {
    if (!detail || !detail.episodes || episodeIndexes.length === 0) {
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = '無法獲取視頻地址';
      }
      return;
    }

    const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
    const origin = `${window.location.protocol}//${window.location.host}`;

    let successCount = 0;
    let failCount = 0;

    // 批量處理下載
    for (const episodeIndex of episodeIndexes) {
      if (episodeIndex >= detail.episodes.length) {
        failCount++;
        continue;
      }

      const episodeUrl = detail.episodes[episodeIndex];

      // 離線下載模式：無論是否開啟去廣告，都走非去廣告邏輯
      const proxyUrl = offlineMode
        ? episodeUrl  // 離線下載不使用代理，直接使用原始URL
        : (externalPlayerAdBlock
          ? `${origin}/api/proxy-m3u8?url=${encodeURIComponent(episodeUrl)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
          : episodeUrl);

      const isM3u8 = episodeUrl.toLowerCase().includes('.m3u8') || episodeUrl.toLowerCase().includes('/m3u8/');

      if (offlineMode && isM3u8) {
        // 離線下載模式 - 調用服務器API
        try {
          const downloadTitle = `${videoTitle}_第${episodeIndex + 1}集`;
          const response = await fetch('/api/offline-download', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              source: currentSource,
              videoId: currentId,
              episodeIndex,
              title: downloadTitle,
              m3u8Url: proxyUrl,
              metadata: detail ? {
                videoTitle: detail.title,
                cover: detail.poster,
                description: detail.desc,
                year: detail.year,
                rating: undefined, // SearchResult 沒有 rating 字段
                totalEpisodes: detail.episodes?.length,
              } : undefined,
            }),
          });

          const data = await response.json();

          if (response.ok) {
            successCount++;
          } else {
            console.error(`離線下載任務創建失敗 (第${episodeIndex + 1}集):`, data.error);
            failCount++;
          }
        } catch (error) {
          console.error(`離線下載任務創建失敗 (第${episodeIndex + 1}集):`, error);
          failCount++;
        }
      } else if (isM3u8) {
        // M3U8格式 - 使用新的下載器，TS 格式
        try {
          const downloadTitle = `${videoTitle}_第${episodeIndex + 1}集`;
          await addDownloadTask(proxyUrl, downloadTitle, 'TS', {
            source: currentSource || undefined,
            videoId: currentId || undefined,
            episodeIndex,
          });
          successCount++;
        } catch (error) {
          console.error(`添加下載任務失敗 (第${episodeIndex + 1}集):`, error);
          failCount++;
        }
      } else {
        // 普通視頻格式 - 直接下載
        try {
          const a = document.createElement('a');
          a.href = proxyUrl;
          a.download = `${videoTitle}_第${episodeIndex + 1}集.mp4`;
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          successCount++;
          // 添加延遲避免瀏覽器阻止多個下載
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error) {
          console.error(`下載失敗 (第${episodeIndex + 1}集):`, error);
          failCount++;
        }
      }
    }

    // 顯示結果通知
    if (artPlayerRef.current) {
      if (failCount === 0) {
        artPlayerRef.current.notice.show = offlineMode
          ? `已創建 ${successCount} 個離線下載任務！`
          : `已添加 ${successCount} 個下載任務！`;
      } else if (successCount === 0) {
        artPlayerRef.current.notice.show = '下載失敗，請重試';
      } else {
        artPlayerRef.current.notice.show = `成功 ${successCount} 個，失敗 ${failCount} 個`;
      }
    }
  };

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const isHlsJsActive = !!(video as any).hls;
    const isHlsLikeSource =
      /\.m3u8?($|\?)/i.test(url) ||
      url.includes('/api/proxy-m3u8') ||
      url.includes('/api/proxy/vod/m3u8');

    if (isHlsJsActive && isHlsLikeSource) {
      // HLS 由 hls.js 接管時，不能再給 <video> 塞原始 m3u8 source，
      // 否則 Safari 可能切回原生 HLS，和 MSE/hls.js 搶同一個播放器。
      sources.forEach((s) => s.remove());
    } else {
      const existed = sources.some((s) => s.src === url);
      if (!existed) {
        // 移除舊的 source，保持唯一
        sources.forEach((s) => s.remove());
        const sourceEl = document.createElement('source');
        sourceEl.src = url;
        video.appendChild(sourceEl);
      }
    }

    // 始終允許遠程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾經有禁用屬性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }

    // 確保 playsinline 屬性存在（iOS 兼容性）
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    // 使用 property 方式也設置一次，確保兼容性
    (video as any).playsInline = true;
    (video as any).webkitPlaysInline = true;
  };

  // Wake Lock 相關函數
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request(
          'screen'
        );
        console.log('Wake Lock 已啟用');
      }
    } catch (err) {
      console.warn('Wake Lock 請求失敗:', err);
    }
  };

  const releaseWakeLock = async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('Wake Lock 已釋放');
      }
    } catch (err) {
      console.warn('Wake Lock 釋放失敗:', err);
    }
  };

  // 清理播放器資源的統一函數
  const cleanupPlayer = async () => {
    // 清除刷新定時器
    clearRefreshTimer();

    // 先清理Anime4K，避免GPU紋理錯誤
    await cleanupAnime4K();

    if (artPlayerRef.current) {
      try {
        // 在銷燬前先移除彈幕顯示/隱藏事件監聽器，避免 destroy 時觸發 hide 事件導致狀態被錯誤保存
        if (artPlayerRef.current) {
          artPlayerRef.current.off('artplayerPluginDanmuku:show');
          artPlayerRef.current.off('artplayerPluginDanmuku:hide');
        }

        // 在銷燬前從彈幕插件讀取最新配置並保存
        if (danmakuPluginRef.current?.option && artPlayerRef.current.storage) {
          // 獲取當前彈幕設置的快照，避免循環引用
          const currentDanmakuSettings = danmakuSettingsRef.current;
          const danmakuPluginOption = danmakuPluginRef.current.option;

          const currentSettings = {
            ...currentDanmakuSettings,
            opacity: danmakuPluginOption.opacity || currentDanmakuSettings.opacity,
            fontSize: danmakuPluginOption.fontSize || currentDanmakuSettings.fontSize,
            speed: danmakuPluginOption.speed || currentDanmakuSettings.speed,
            marginTop: (danmakuPluginOption.margin && danmakuPluginOption.margin[0]) ?? currentDanmakuSettings.marginTop,
            marginBottom: (danmakuPluginOption.margin && danmakuPluginOption.margin[1]) ?? currentDanmakuSettings.marginBottom,
          };

          // 保存到 localStorage 和 art.storage
          saveDanmakuSettings(currentSettings);
          artPlayerRef.current.storage.set('danmaku_settings', currentSettings);

          console.log('播放器銷燬前保存彈幕設置:', currentSettings);
        }

        // 銷燬 HLS 實例
        if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
          artPlayerRef.current.video.hls.destroy();
        }

        // 銷燬 ArtPlayer 實例
        artPlayerRef.current.destroy();
        artPlayerRef.current = null;

        // 清空 DOM 容器，確保沒有殘留元素
        if (artRef.current) {
          artRef.current.innerHTML = '';
        }

        console.log('播放器資源已清理');
      } catch (err) {
        console.warn('清理播放器資源時出錯:', err);
        artPlayerRef.current = null;
        // 即使出錯也要清空容器
        if (artRef.current) {
          artRef.current.innerHTML = '';
        }
      }
    }
  };

  // 初始化Anime4K超分
  const initAnime4K = async () => {
    if (!artPlayerRef.current?.video) return;

    let frameRequestId: number | null = null; // 在外層聲明，以便錯誤處理中使用
    let outputCanvas: HTMLCanvasElement | null = null; // 在外層聲明，以便錯誤處理中清理

    try {
      if (anime4kRef.current) {
        anime4kRef.current.controller?.stop?.();
        anime4kRef.current = null;
        // 等待舊實例完全停止，避免雙重渲染
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const video = artPlayerRef.current.video as HTMLVideoElement;

      // 等待視頻元數據加載完成
      if (!video.videoWidth || !video.videoHeight) {
        console.warn('視頻尺寸未就緒，等待loadedmetadata事件');
        await new Promise<void>((resolve) => {
          const handler = () => {
            video.removeEventListener('loadedmetadata', handler);
            resolve();
          };
          video.addEventListener('loadedmetadata', handler);
          // 如果已經加載過了，立即resolve
          if (video.videoWidth && video.videoHeight) {
            video.removeEventListener('loadedmetadata', handler);
            resolve();
          }
        });
      }

      // 再次檢查視頻尺寸
      if (!video.videoWidth || !video.videoHeight) {
        throw new Error('無法獲取視頻尺寸');
      }

      // 檢查視頻是否正在播放
      console.log('視頻播放狀態:', {
        paused: video.paused,
        ended: video.ended,
        readyState: video.readyState,
        currentTime: video.currentTime,
      });

      // 檢測是否為Firefox
      const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
      console.log('瀏覽器檢測:', isFirefox ? 'Firefox' : 'Chrome/Edge/其他');

      // 創建輸出canvas（顯示給用戶的）
      outputCanvas = document.createElement('canvas');
      const container = artPlayerRef.current.template.$video.parentElement;

      // 使用用戶選擇的超分倍數
      const scale = anime4kScaleRef.current;
      outputCanvas.width = Math.floor(video.videoWidth * scale);  // 確保是整數
      outputCanvas.height = Math.floor(video.videoHeight * scale);

      // 驗證outputCanvas尺寸
      console.log('outputCanvas尺寸:', outputCanvas.width, 'x', outputCanvas.height);
      if (!outputCanvas.width || !outputCanvas.height ||
        !isFinite(outputCanvas.width) || !isFinite(outputCanvas.height)) {
        throw new Error(`outputCanvas尺寸無效: ${outputCanvas.width}x${outputCanvas.height}, scale: ${scale}`);
      }

      outputCanvas.style.position = 'absolute';
      outputCanvas.style.top = '0';
      outputCanvas.style.left = '0';
      outputCanvas.style.width = '100%';
      outputCanvas.style.height = '100%';
      outputCanvas.style.objectFit = 'contain';
      outputCanvas.style.cursor = 'pointer';
      outputCanvas.style.zIndex = '1';
      // 確保canvas背景透明，避免Firefox中的渲染問題
      outputCanvas.style.backgroundColor = 'transparent';

      // Firefox兼容性處理：創建中間canvas
      let sourceCanvas: HTMLCanvasElement | null = null;
      let sourceCtx: CanvasRenderingContext2D | null = null;

      if (isFirefox) {
        // Firefox的WebGPU不支持直接使用HTMLVideoElement
        // 使用標準HTMLCanvasElement（更好的兼容性）
        sourceCanvas = document.createElement('canvas');

        // 獲取視頻尺寸並記錄
        const videoW = video.videoWidth;
        const videoH = video.videoHeight;
        console.log('Firefox：準備創建canvas - 視頻尺寸:', videoW, 'x', videoH);

        // 設置canvas尺寸
        const canvasW = Math.floor(videoW);
        const canvasH = Math.floor(videoH);
        console.log('Firefox：計算後的canvas尺寸:', canvasW, 'x', canvasH);

        sourceCanvas.width = canvasW;
        sourceCanvas.height = canvasH;

        // 立即驗證賦值結果
        console.log('Firefox：Canvas創建後立即檢查:');
        console.log('  - sourceCanvas.width:', sourceCanvas.width);
        console.log('  - sourceCanvas.height:', sourceCanvas.height);
        console.log('  - 賦值是否成功:', sourceCanvas.width === canvasW && sourceCanvas.height === canvasH);

        // 驗證sourceCanvas尺寸
        if (!sourceCanvas.width || !sourceCanvas.height ||
          !isFinite(sourceCanvas.width) || !isFinite(sourceCanvas.height)) {
          throw new Error(`sourceCanvas尺寸無效: ${sourceCanvas.width}x${sourceCanvas.height}`);
        }

        if (sourceCanvas.width !== canvasW || sourceCanvas.height !== canvasH) {
          throw new Error(`sourceCanvas尺寸賦值異常: 期望 ${canvasW}x${canvasH}, 實際 ${sourceCanvas.width}x${sourceCanvas.height}`);
        }

        sourceCtx = sourceCanvas.getContext('2d', {
          willReadFrequently: true,
          alpha: false  // 禁用alpha通道，提高性能
        });

        if (!sourceCtx) {
          throw new Error('無法創建2D上下文');
        }

        // 先繪製一幀到canvas，確保有內容
        if (video.readyState >= video.HAVE_CURRENT_DATA) {
          sourceCtx.drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);
          console.log('Firefox：已繪製初始幀到sourceCanvas');
        }

        console.log('Firefox檢測：使用HTMLCanvasElement中轉方案');
      }

      // 在outputCanvas上監聽點擊事件，觸發播放器的暫停/播放切換
      const handleCanvasClick = () => {
        if (artPlayerRef.current) {
          artPlayerRef.current.toggle();
        }
      };
      outputCanvas.addEventListener('click', handleCanvasClick);

      // 在outputCanvas上監聽雙擊事件，觸發全屏切換
      const handleCanvasDblClick = () => {
        if (artPlayerRef.current) {
          artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        }
      };
      outputCanvas.addEventListener('dblclick', handleCanvasDblClick);

      // 隱藏原始video元素（使用opacity而不是display:none以保持視頻解碼）
      // Firefox在display:none時可能會停止視頻解碼，導致黑屏
      video.style.opacity = '0';
      video.style.pointerEvents = 'none';
      video.style.position = 'absolute';
      video.style.zIndex = '-1';

      // 插入outputCanvas到容器
      container.insertBefore(outputCanvas, video);

      // Firefox兼容性：創建視頻幀捕獲循環
      if (isFirefox && sourceCtx && sourceCanvas) {
        const captureVideoFrame = () => {
          if (sourceCtx && sourceCanvas && video.readyState >= video.HAVE_CURRENT_DATA) {
            sourceCtx.drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);
          }
          frameRequestId = requestAnimationFrame(captureVideoFrame);
        };
        captureVideoFrame();
        console.log('Firefox：視頻幀捕獲循環已啟動');
      }

      // 動態導入 anime4k-webgpu 及對應的模式
      const { render: anime4kRender, ModeA, ModeB, ModeC, ModeAA, ModeBB, ModeCA } = await import('anime4k-webgpu');

      let ModeClass: any;
      const modeName = anime4kModeRef.current;

      switch (modeName) {
        case 'ModeA':
          ModeClass = ModeA;
          break;
        case 'ModeB':
          ModeClass = ModeB;
          break;
        case 'ModeC':
          ModeClass = ModeC;
          break;
        case 'ModeAA':
          ModeClass = ModeAA;
          break;
        case 'ModeBB':
          ModeClass = ModeBB;
          break;
        case 'ModeCA':
          ModeClass = ModeCA;
          break;
        default:
          ModeClass = ModeA;
      }

      // 使用anime4k-webgpu的render函數
      // Firefox使用sourceCanvas，其他瀏覽器直接使用video
      const renderConfig: any = {
        video: isFirefox ? sourceCanvas : video, // Firefox使用canvas中轉，其他瀏覽器直接使用video
        canvas: outputCanvas,
        pipelineBuilder: (device: GPUDevice, inputTexture: GPUTexture) => {
          if (!outputCanvas) {
            throw new Error('outputCanvas is null in pipelineBuilder');
          }
          const mode = new ModeClass({
            device,
            inputTexture,
            nativeDimensions: {
              width: Math.floor(video.videoWidth),  // 確保是整數
              height: Math.floor(video.videoHeight),
            },
            targetDimensions: {
              width: Math.floor(outputCanvas.width),  // 確保是整數
              height: Math.floor(outputCanvas.height),
            },
          });
          return [mode];
        },
      };

      console.log('開始初始化Anime4K渲染器...');
      console.log('輸入源:', isFirefox ? 'HTMLCanvasElement (Firefox兼容)' : 'video (原生)');
      console.log('視頻尺寸:', video.videoWidth, 'x', video.videoHeight);
      console.log('輸出Canvas尺寸:', outputCanvas.width, 'x', outputCanvas.height);
      console.log('nativeDimensions:', Math.floor(video.videoWidth), 'x', Math.floor(video.videoHeight));
      console.log('targetDimensions:', Math.floor(outputCanvas.width), 'x', Math.floor(outputCanvas.height));

      // Firefox調試：檢查sourceCanvas狀態
      if (isFirefox && sourceCanvas) {
        console.log('sourceCanvas詳細信息:');
        console.log('  - width:', sourceCanvas.width, 'height:', sourceCanvas.height);
        console.log('  - clientWidth:', sourceCanvas.clientWidth, 'clientHeight:', sourceCanvas.clientHeight);
        console.log('  - offsetWidth:', sourceCanvas.offsetWidth, 'offsetHeight:', sourceCanvas.offsetHeight);

        // 嘗試讀取一個像素，確認canvas有內容
        if (sourceCtx) {
          try {
            const imageData = sourceCtx.getImageData(0, 0, 1, 1);
            console.log('  - 像素數據可讀:', imageData.data.length > 0);
          } catch (err) {
            console.error('  - 無法讀取像素數據:', err);
          }
        }
      }

      const controller = await anime4kRender(renderConfig);
      console.log('Anime4K渲染器初始化成功');

      anime4kRef.current = {
        controller,
        canvas: outputCanvas,
        sourceCanvas: isFirefox ? sourceCanvas : null,
        frameRequestId: isFirefox ? frameRequestId : null,
        handleCanvasClick,
        handleCanvasDblClick,
      };

      console.log('Anime4K超分已啟用，模式:', anime4kModeRef.current, '倍數:', scale);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = `超分已啟用 (${anime4kModeRef.current}, ${scale}x)`;
      }
    } catch (err) {
      console.error('初始化Anime4K失敗:', err);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = '超分啟用失敗：' + (err instanceof Error ? err.message : '未知錯誤');
      }

      // 停止幀捕獲循環
      if (frameRequestId) {
        cancelAnimationFrame(frameRequestId);
      }

      // 移除outputCanvas（如果已創建）
      if (outputCanvas && outputCanvas.parentNode) {
        outputCanvas.parentNode.removeChild(outputCanvas);
      }

      // 恢復video顯示
      if (artPlayerRef.current?.video) {
        artPlayerRef.current.video.style.opacity = '1';
        artPlayerRef.current.video.style.pointerEvents = 'auto';
        artPlayerRef.current.video.style.position = '';
        artPlayerRef.current.video.style.zIndex = '';
      }
    }
  };

  // 清理Anime4K
  const cleanupAnime4K = async () => {
    if (anime4kRef.current) {
      try {
        // 停止幀捕獲循環（僅Firefox）
        if (anime4kRef.current.frameRequestId) {
          cancelAnimationFrame(anime4kRef.current.frameRequestId);
          console.log('Firefox：幀捕獲循環已停止');
        }

        // 停止渲染循環
        anime4kRef.current.controller?.stop?.();

        // 移除canvas事件監聽器
        if (anime4kRef.current.canvas) {
          if (anime4kRef.current.handleCanvasClick) {
            anime4kRef.current.canvas.removeEventListener('click', anime4kRef.current.handleCanvasClick);
          }
          if (anime4kRef.current.handleCanvasDblClick) {
            anime4kRef.current.canvas.removeEventListener('dblclick', anime4kRef.current.handleCanvasDblClick);
          }
        }

        // 移除canvas
        if (anime4kRef.current.canvas && anime4kRef.current.canvas.parentNode) {
          anime4kRef.current.canvas.parentNode.removeChild(anime4kRef.current.canvas);
        }

        // 清理sourceCanvas（僅Firefox）
        if (anime4kRef.current.sourceCanvas) {
          if (anime4kRef.current.sourceCanvas instanceof OffscreenCanvas) {
            // OffscreenCanvas的清理
            const ctx = anime4kRef.current.sourceCanvas.getContext('2d');
            if (ctx) {
              ctx.clearRect(0, 0, anime4kRef.current.sourceCanvas.width, anime4kRef.current.sourceCanvas.height);
            }
            console.log('Firefox：OffscreenCanvas已清理');
          } else {
            // HTMLCanvasElement的清理
            const ctx = anime4kRef.current.sourceCanvas.getContext('2d');
            if (ctx) {
              ctx.clearRect(0, 0, anime4kRef.current.sourceCanvas.width, anime4kRef.current.sourceCanvas.height);
            }
            console.log('Firefox：HTMLCanvasElement已清理');
          }
        }

        anime4kRef.current = null;

        // 恢復原始video顯示
        if (artPlayerRef.current?.video) {
          artPlayerRef.current.video.style.opacity = '1';
          artPlayerRef.current.video.style.pointerEvents = 'auto';
          artPlayerRef.current.video.style.position = '';
          artPlayerRef.current.video.style.zIndex = '';
        }

        console.log('Anime4K已清理');
      } catch (err) {
        console.warn('清理Anime4K時出錯:', err);
      }
    }
  };

  // 切換Anime4K狀態
  const toggleAnime4K = async (enabled: boolean) => {
    try {
      if (enabled) {
        await initAnime4K();
      } else {
        await cleanupAnime4K();
      }
      setAnime4kEnabled(enabled);
      localStorage.setItem('enable_anime4k', String(enabled));
    } catch (err) {
      console.error('切換超分狀態失敗:', err);
    }
  };

  // 更改Anime4K模式
  const changeAnime4KMode = async (mode: string) => {
    try {
      setAnime4kMode(mode);
      localStorage.setItem('anime4k_mode', mode);

      if (anime4kEnabledRef.current) {
        await cleanupAnime4K();
        await initAnime4K();
      }
    } catch (err) {
      console.error('更改超分模式失敗:', err);
    }
  };

  // 更改Anime4K分辨率倍數
  const changeAnime4KScale = async (scale: number) => {
    try {
      setAnime4kScale(scale);
      localStorage.setItem('anime4k_scale', scale.toString());

      if (anime4kEnabledRef.current) {
        await cleanupAnime4K();
        await initAnime4K();
      }
    } catch (err) {
      console.error('更改超分倍數失敗:', err);
    }
  };

  function filterAdsFromM3U8(type: string, m3u8Content: string): string {
    // 嘗試使用緩存的自定義去廣告代碼
    if (customAdFilterCodeRef.current && customAdFilterCodeRef.current.trim()) {
      try {
        // 移除 TypeScript 類型註解，轉換為純 JavaScript
        const jsCode = customAdFilterCodeRef.current
          // 移除函數參數的類型註解：name: type
          .replace(/(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*([,)])/g, '$1$3')
          // 移除函數返回值類型註解：): type {
          .replace(/\)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*\{/g, ') {')
          // 移除變量聲明的類型註解：const name: type =
          .replace(/(const|let|var)\s+(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*=/g, '$1 $2 =');

        // 創建並執行自定義函數
        const customFunction = new Function('type', 'm3u8Content',
          jsCode + '\nreturn filterAdsFromM3U8(type, m3u8Content);'
        );
        return customFunction(type, m3u8Content);
      } catch (err) {
        console.error('執行自定義去廣告代碼失敗，使用默認規則:', err);
        // 如果自定義代碼執行失敗，繼續使用默認規則
      }
    }

    // 默認去廣告規則
    if (!m3u8Content) return '';

    // 廣告關鍵字列表
    const adKeywords = [
      'sponsor',
      '/ad/',
      '/ads/',
      'advert',
      'advertisement',
      '/adjump',
      'redtraffic'
    ];

    // 按行分割M3U8內容
    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // 跳過 #EXT-X-DISCONTINUITY 標識
      if (line.includes('#EXT-X-DISCONTINUITY')) {
        i++;
        continue;
      }

      // 如果是 EXTINF 行，檢查下一行 URL 是否包含廣告關鍵字
      if (line.includes('#EXTINF:')) {
        // 檢查下一行 URL 是否包含廣告關鍵字
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const containsAdKeyword = adKeywords.some(keyword =>
            nextLine.toLowerCase().includes(keyword.toLowerCase())
          );

          if (containsAdKeyword) {
            // 跳過 EXTINF 行和 URL 行
            i += 2;
            continue;
          }
        }
      }

      // 保留當前行
      filteredLines.push(line);
      i++;
    }

    return filteredLines.join('\n');
  }

  // 跳過片頭片尾配置相關函數
  const handleSkipConfigChange = async (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;

    try {
      setSkipConfig(newConfig);
      if (!newConfig.enable && !newConfig.intro_time && !newConfig.outro_time) {
        await deleteSkipConfig(currentSourceRef.current, currentIdRef.current);

        // 安全地更新播放器設置，僅在播放器存在時執行
        if (artPlayerRef.current && artPlayerRef.current.setting) {
          try {
            artPlayerRef.current.setting.update({
              name: '跳過片頭片尾',
              html: '跳過片頭片尾',
              switch: skipConfigRef.current.enable,
              onSwitch: function (item: any) {
                const newConfig = {
                  ...skipConfigRef.current,
                  enable: !item.switch,
                };
                handleSkipConfigChange(newConfig);
                return !item.switch;
              },
            });
            artPlayerRef.current.setting.update({
              name: '跳過配置',
              html: '跳過配置',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
              tooltip:
                skipConfigRef.current.intro_time === 0 && skipConfigRef.current.outro_time === 0
                  ? '設置跳過配置'
                  : `片頭: ${formatTime(skipConfigRef.current.intro_time)} | 片尾: ${formatTime(Math.abs(skipConfigRef.current.outro_time))}`,
            });
          } catch (settingErr) {
            console.warn('更新播放器設置失敗:', settingErr);
          }
        }
      } else {
        await saveSkipConfig(
          currentSourceRef.current,
          currentIdRef.current,
          newConfig
        );
      }
      console.log('跳過片頭片尾配置已保存:', newConfig);
    } catch (err) {
      console.error('保存跳過片頭片尾配置失敗:', err);
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds === 0) return '00:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.round(seconds % 60);

    if (hours === 0) {
      // 不到一小時，格式為 00:00
      return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
        .toString()
        .padStart(2, '0')}`;
    } else {
      // 超過一小時，格式為 00:00:00
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  };

  // 創建自定義 HLS loader 的工廠函數
  const createCustomHlsLoader = (HlsLib: any) => {
    return class CustomHlsJsLoader extends HlsLib.DefaultConfig.loader {
      constructor(config: any) {
        super(config);
        const load = this.load.bind(this);
        this.load = function (context: any, config: any, callbacks: any) {
          // 攔截manifest和level請求
          if (
            (context as any).type === 'manifest' ||
            (context as any).type === 'level'
          ) {
            const onSuccess = callbacks.onSuccess;
            callbacks.onSuccess = function (
              response: any,
              stats: any,
              context: any
            ) {
              // 如果是m3u8文件，處理內容以移除廣告分段
              if (response.data && typeof response.data === 'string') {
                // 過濾掉廣告段 - 實現更精確的廣告過濾邏輯
                response.data = filterAdsFromM3U8(
                  currentSourceRef.current,
                  response.data
                );
              }
              return onSuccess(response, stats, context, null);
            };
          }
          // 執行原始load方法
          load(context, config, callbacks);
        };
      }
    };
  };

  // 當集數索引變化時自動更新視頻地址
  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex);
  }, [detail, currentEpisodeIndex]);

  // 進入頁面時直接獲取全部源信息
  useEffect(() => {
    const fetchSourceDetail = async (
      source: string,
      id: string,
      title: string,
      fileNameParam?: string
    ): Promise<SearchResult[]> => {
      try {
        let url = `/api/source-detail?source=${source}&id=${id}&title=${encodeURIComponent(title)}`;
        // 如果有fileName參數（小雅源），添加到URL
        if (fileNameParam) {
          url += `&fileName=${encodeURIComponent(fileNameParam)}`;
        }
        const detailResponse = await fetch(url);
        if (!detailResponse.ok) {
          throw new Error('獲取視頻詳情失敗');
        }
        const detailData = (await detailResponse.json()) as SearchResult;
        const sourcesWithCorrections = applyCorrectionsToSources([detailData]);
        setAvailableSources(sourcesWithCorrections);
        return sourcesWithCorrections;
      } catch (err) {
        console.error('獲取視頻詳情失敗:', err);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    // 規範化標題用於聚合（去除特殊符號、括號、空格和全角空格）
    const normalizeTitle = (title: string) => {
      return title
        .replace(/[\s\u3000]/g, '') // 去除空格和全角空格
        .replace(/[()（）[\]【】{}「」『』<>《》]/g, '') // 去除各種括號
        .replace(/[^\w\u4e00-\u9fa5]/g, ''); // 去除特殊符號，保留字母、數字、下劃線和中文
    };

    // 輔助函數：獲取視頻類型
    const getType = (item: SearchResult): 'movie' | 'tv' => {
      // 1. Emby 和 OpenList 源：使用 type_name（基於 TMDB，最可靠）
      if (item.source === 'emby' || item.source?.startsWith('emby_') || item.source === 'openlist') {
        return item.type_name === '電影' ? 'movie' : 'tv';
      }

      // 2. API 採集源：綜合判斷
      const typeName = item.type_name?.toLowerCase() || '';

      // 2.1 明確包含"電影"或"movie"或"片"的，判斷為電影
      if (typeName.includes('電影') || typeName.includes('movie') ||
        typeName.endsWith('片') && !typeName.includes('動漫')) {
        return 'movie';
      }

      // 2.2 包含"劇"、"動漫"、"綜藝"等關鍵詞的，判斷為劇集
      if (typeName.includes('劇') || typeName.includes('動漫') ||
        typeName.includes('綜藝') || typeName.includes('anime')) {
        return 'tv';
      }

      // 2.3 檢查 episodes_titles：如果包含"第X集"，判斷為劇集
      if (item.episodes_titles && item.episodes_titles.length > 0) {
        const firstTitle = item.episodes_titles[0] || '';
        if (/第\d+集|第\d+話|EP?\d+/i.test(firstTitle)) {
          return 'tv';
        }
      }

      // 2.4 兜底：使用 episodes.length（最不可靠）
      return item.episodes.length === 1 ? 'movie' : 'tv';
    };


    const buildFallbackRecommendations = (items: SearchResult[], query: string): PlayFallbackRecommendation[] => {
      const typedItems = searchType ? items.filter((item) => getType(item) === searchType) : items;
      const preliminaryMap = new Map<string, SearchResult[]>();

      typedItems.forEach((item) => {
        const preliminaryKey = `${normalizeTitle(item.title).toLowerCase()}-${getType(item)}`;
        const group = preliminaryMap.get(preliminaryKey) || [];
        group.push(item);
        preliminaryMap.set(preliminaryKey, group);
      });

      const finalRecommendations: PlayFallbackRecommendation[] = [];

      preliminaryMap.forEach((group, preliminaryKey) => {
        const withYear = new Map<string, SearchResult[]>();
        const withoutYear: SearchResult[] = [];

        group.forEach((item) => {
          if (item.year && item.year.trim() !== '' && item.year !== 'unknown' && /^\d{4}$/.test(item.year)) {
            const yearGroup = withYear.get(item.year) || [];
            yearGroup.push(item);
            withYear.set(item.year, yearGroup);
          } else {
            withoutYear.push(item);
          }
        });

        const emitGroup = (groupKey: string, mergedGroup: SearchResult[]) => {
          const sourceNames = Array.from(new Set(mergedGroup.map((item) => item.source_name).filter(Boolean)));
          const episodeCountMap = new Map<number, number>();
          const doubanCountMap = new Map<number, number>();

          mergedGroup.forEach((item) => {
            const episodeCount = item.episodes?.length || 0;
            if (episodeCount > 0) {
              episodeCountMap.set(episodeCount, (episodeCountMap.get(episodeCount) || 0) + 1);
            }
            if (item.douban_id && item.douban_id > 0) {
              doubanCountMap.set(item.douban_id, (doubanCountMap.get(item.douban_id) || 0) + 1);
            }
          });

          let episodes = 0;
          let episodeVotes = 0;
          episodeCountMap.forEach((votes, count) => {
            if (votes > episodeVotes) {
              episodeVotes = votes;
              episodes = count;
            }
          });

          let doubanId: number | undefined;
          let doubanVotes = 0;
          doubanCountMap.forEach((votes, id) => {
            if (votes > doubanVotes) {
              doubanVotes = votes;
              doubanId = id;
            }
          });

          const representative = mergedGroup.slice().sort((a, b) => {
            const aPoster = a.poster ? 1 : 0;
            const bPoster = b.poster ? 1 : 0;
            if (bPoster !== aPoster) return bPoster - aPoster;
            return (b.weight ?? 0) - (a.weight ?? 0);
          })[0];

          finalRecommendations.push({
            key: groupKey,
            item: representative,
            episodes: episodes || undefined,
            sourceNames,
            doubanId,
          });
        };

        if (withYear.size > 0) {
          withYear.forEach((yearGroup, year) => {
            emitGroup(`${preliminaryKey}-${year}`, [...yearGroup, ...withoutYear]);
          });
        } else if (withoutYear.length > 0) {
          emitGroup(`${preliminaryKey}-unknown`, withoutYear);
        }
      });

      const normalizedQuery = normalizeTitle(query).toLowerCase();

      return finalRecommendations
        .sort((a, b) => {
          const aContains = normalizeTitle(a.item.title).toLowerCase().includes(normalizedQuery) ? 1 : 0;
          const bContains = normalizeTitle(b.item.title).toLowerCase().includes(normalizedQuery) ? 1 : 0;
          if (bContains !== aContains) return bContains - aContains;
          if (b.sourceNames.length !== a.sourceNames.length) return b.sourceNames.length - a.sourceNames.length;
          return (b.item.weight ?? 0) - (a.item.weight ?? 0);
        })
        .slice(0, 12);
    };

    const fetchSourcesData = async (query: string): Promise<SearchResult[]> => {
      // 根據搜索詞獲取全部源信息
      setHasCompletedSearchRequest(false);
      setFallbackRecommendations([]);

      try {
        // 先檢查 sessionStorage 中是否有緩存
        const cacheKey = `search_cache_${query.trim()}`;
        let results: SearchResult[] = [];

        if (typeof window !== 'undefined') {
          try {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
              console.log('[Play] 使用 sessionStorage 緩存的搜索結果');
              const cachedData = JSON.parse(cached) as SearchResult[];

              setHasCompletedSearchRequest(true);
              setFallbackRecommendations(buildFallbackRecommendations(cachedData, query));

              // 處理緩存的搜索結果，根據規則過濾
              results = cachedData.filter(
                (result: SearchResult) =>
                  normalizeTitle(result.title).toLowerCase() ===
                  normalizeTitle(videoTitleRef.current).toLowerCase() &&
                  (videoYearRef.current
                    ? result.year.toLowerCase() === videoYearRef.current.toLowerCase() ||
                    !result.year ||
                    result.year.trim() === '' ||
                    result.year === 'unknown' ||
                    !/^\d{4}$/.test(result.year)
                    : true) &&
                  (searchType
                    ? getType(result) === searchType
                    : true)
              );

              setAvailableSources(applyCorrectionsToSources(results));
              return results;
            }
          } catch (error) {
            console.error('[Play] 讀取緩存失敗:', error);
            // 繼續執行 API 調用
          }
        }

        // 如果沒有緩存，調用 API
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`
        );
        if (!response.ok) {
          throw new Error('搜索失敗');
        }
        const data = await response.json();
        const allResults = (data.results || []) as SearchResult[];

        setHasCompletedSearchRequest(true);
        setFallbackRecommendations(buildFallbackRecommendations(allResults, query));

        // 處理搜索結果，根據規則過濾
        results = allResults.filter(
          (result: SearchResult) =>
            normalizeTitle(result.title).toLowerCase() ===
            normalizeTitle(videoTitleRef.current).toLowerCase() &&
            (videoYearRef.current
              ? result.year.toLowerCase() === videoYearRef.current.toLowerCase() ||
              !result.year ||
              result.year.trim() === '' ||
              result.year === 'unknown' ||
              !/^\d{4}$/.test(result.year)
              : true) &&
            (searchType
              ? getType(result) === searchType
              : true)
        );
        setAvailableSources(applyCorrectionsToSources(results));
        return results;
      } catch (err) {
        setSourceSearchError(err instanceof Error ? err.message : '搜索失敗');
        setAvailableSources([]);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const getCachedSourcesData = (query: string): SearchResult[] => {
      if (typeof window === 'undefined' || !query.trim()) {
        return [];
      }

      try {
        const cacheKey = `search_cache_${query.trim()}`;
        const cached = sessionStorage.getItem(cacheKey);
        if (!cached) {
          return [];
        }

        const cachedData = JSON.parse(cached);
        const results = cachedData.filter(
          (result: SearchResult) =>
            normalizeTitle(result.title).toLowerCase() ===
            normalizeTitle(videoTitleRef.current).toLowerCase() &&
            (videoYearRef.current
              ? result.year.toLowerCase() === videoYearRef.current.toLowerCase() ||
                !result.year ||
                result.year.trim() === '' ||
                result.year === 'unknown' ||
                !/^\d{4}$/.test(result.year)
              : true) &&
            (searchType
              ? getType(result) === searchType
              : true)
        );

        return applyCorrectionsToSources(results);
      } catch (error) {
        console.error('[Play] 讀取緩存失敗:', error);
        return [];
      }
    };

    const initAll = async () => {
      if (currentSource === 'directplay') {
        if (!currentId) {
          setError('缺少直鏈地址');
          setLoading(false);
          return;
        }

        setLoading(true);
        setLoadingStage('fetching');
        setLoadingMessage('🎬 正在準備直鏈播放...');

        let directUrl = '';
        try {
          directUrl = base58Decode(currentId);
        } catch (decodeError) {
          console.error('直鏈地址解析失敗:', decodeError);
          setError('直鏈地址解析失敗');
          setLoading(false);
          return;
        }

        const directDetail: SearchResult = {
          id: currentId,
          title: '直鏈播放',
          poster: '',
          episodes: [directUrl],
          episodes_titles: ['直鏈'],
          source: 'directplay',
          source_name: '直鏈',
          class: '',
          year: '',
          desc: '',
          type_name: '',
          douban_id: 0,
        };

        setNeedPrefer(false);
        setCurrentSource('directplay');
        setCurrentId(currentId);
        setVideoTitle('直鏈播放');
        setVideoYear('');
        setVideoCover('');
        setVideoDoubanId(0);
        setCorrectedDesc('');
        setDetail(directDetail);
        setSourceProxyMode(false);
        setAvailableSources([directDetail]);
        setCurrentEpisodeIndex(0);
        setSourceSearchError(null);
        setSourceSearchLoading(false);
        setBackgroundSourcesLoading(false);

        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('source', 'directplay');
        newUrl.searchParams.set('id', currentId);
        newUrl.searchParams.delete('prefer');
        newUrl.searchParams.delete('fileName');
        window.history.replaceState({}, '', newUrl.toString());

        setLoadingStage('ready');
        setLoadingMessage('✨ 準備就緒，即將開始播放...');
        setTimeout(() => {
          setLoading(false);
        }, 500);
        return;
      }

      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要參數');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId
          ? '🎬 正在獲取視頻詳情...'
          : '🔍 正在搜索播放源...'
      );

      // 如果已經有了source和id，優先通過單個詳情接口快速獲取
      let detailData: SearchResult | null = null;
      let sourcesInfo: SearchResult[] = [];

      if (currentSource && currentId) {
        const cachedSources = getCachedSourcesData(searchTitle || videoTitle);
        const cachedTarget = cachedSources.find(
          (source) => source.source === currentSource && source.id === currentId
        );

        if (cachedTarget?.episodes?.length) {
          detailData = cachedTarget;
          sourcesInfo = cachedSources;
          setAvailableSources(cachedSources);
          setSourceSearchLoading(false);
        } else {
          // 先快速獲取當前源的詳情
          try {
            // currentSource 已經是完整格式（如 'emby_wumei'）
            // 如果是小雅源且有fileName參數，傳遞給API
            const currentSourceDetail = await fetchSourceDetail(
              currentSource,
              currentId,
              searchTitle || videoTitle,
              currentSource === 'xiaoya' ? fileName : undefined
            );
            if (currentSourceDetail.length > 0) {
              detailData = currentSourceDetail[0];
              sourcesInfo = currentSourceDetail;
            }
          } catch (err) {
            console.error('獲取當前源詳情失敗:', err);
          }
        }

        // 異步獲取其他源信息，不阻塞播放
        setBackgroundSourcesLoading(true);
        fetchSourcesData(searchTitle || videoTitle).then((sources) => {
          // 合併當前源和搜索到的其他源
          const allSources = [...sourcesInfo];
          sources.forEach((source) => {
            // 避免重複添加當前源
            if (!(source.source === currentSource && source.id === currentId)) {
              allSources.push(source);
            }
          });
          setAvailableSources(applyCorrectionsToSources(allSources));
          setBackgroundSourcesLoading(false);
        }).catch((err) => {
          console.error('異步獲取其他源失敗:', err);
          setBackgroundSourcesLoading(false);
        });
      } else {
        // 沒有source和id，正常搜索流程
        sourcesInfo = await fetchSourcesData(searchTitle || videoTitle);
      }

      if (!detailData && sourcesInfo.length === 0) {
        setError('未找到匹配結果');
        setLoading(false);
        return;
      }

      if (!detailData) {
        detailData = sourcesInfo[0];
      }
      // 指定源和id且無需優選
      if (currentSource && currentId && !needPreferRef.current) {
        const target = sourcesInfo.find(
          (source) => source.source === currentSource && source.id === currentId
        );
        if (target) {
          detailData = target;

          // 這類源統一通過詳情接口補全播放數據
          if (isLazyDetailSource(detailData.source) && (!detailData.episodes || detailData.episodes.length === 0)) {
            console.log('[Play] Fetching lazy detail for selected source...');
            // currentSource 已經是完整格式
            const detailSources = await fetchSourceDetail(currentSource, currentId, searchTitle || videoTitle);
            if (detailSources.length > 0) {
              detailData = detailSources[0];
            }
          }
        } else {
          setError('未找到匹配結果');
          setLoading(false);
          return;
        }
      }

      // 未指定源和 id 或需要優選，且開啟優選開關
      if (
        (!currentSource || !currentId || needPreferRef.current) &&
        optimizationEnabled
      ) {
        setLoadingStage('preferring');
        setLoadingMessage('⚡ 正在優選最佳播放源...');

        // 過濾掉 openlist、所有 emby 源和 xiaoya 源，它們不參與測速
        const sourcesToTest = sourcesInfo.filter(s => {
          // 檢查是否為 openlist
          if (s.source === 'openlist') return false;

          // 檢查是否為 emby 源（包括 emby 和 emby_xxx 格式）
          if (s.source === 'emby' || s.source.startsWith('emby_')) return false;

          // 檢查是否為 xiaoya 源
          if (s.source === 'xiaoya') return false;

          // 腳本源詳情懶加載，不參與測速
          if (s.source.startsWith('script:')) return false;

          return true;
        });

        const excludedSources = sourcesInfo.filter(s =>
          s.source === 'openlist' ||
          s.source === 'emby' ||
          s.source.startsWith('emby_') ||
          s.source === 'xiaoya' ||
          s.source.startsWith('script:')
        );

        if (sourcesToTest.length > 0) {
          detailData = await preferBestSource(sourcesToTest);
        } else if (excludedSources.length > 0) {
          // 如果只有懶加載詳情的源，直接使用第一個
          detailData = excludedSources[0];
        } else {
          detailData = sourcesInfo[0];
        }
      }

      console.log(detailData.source, detailData.id);

      // 這類源統一通過詳情接口補全播放數據
      if (isLazyDetailSource(detailData.source) && (!detailData.episodes || detailData.episodes.length === 0)) {
        console.log('[Play] Fetching lazy detail after source selection...');
        const detailSources = await fetchSourceDetail(detailData.source, detailData.id, detailData.title || videoTitleRef.current);
        if (detailSources.length > 0) {
          detailData = detailSources[0];
        }
      }

      setNeedPrefer(false);
      // 直接使用 detailData.source（已經是完整格式）
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);

      // 如果是小雅源，檢查並應用糾錯信息
      if (detailData.source === 'xiaoya') {
        const correction = getXiaoyaCorrection(detailData.source, detailData.id);
        if (correction) {
          console.log('發現小雅源糾錯信息，正在應用...', correction);
          detailData = applyCorrection(detailData, correction);
          // 同時設置糾錯後的描述
          if (correction.overview) {
            setCorrectedDesc(correction.overview);
          }
        }
      }

      // 更新所有相關狀態（在應用糾錯信息之後）
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setVideoDoubanId(detailData.douban_id || 0);

      setDetail(detailData);
      setSourceProxyMode(detailData.proxyMode || false); // 從 detail 數據中讀取代理模式
      if (currentEpisodeIndex >= detailData.episodes.length) {
        setCurrentEpisodeIndex(0);
      }

      // 規範URL參數
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', detailData.year);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      // 只有當元數據不是從文件獲取時，才刪除fileName參數
      if (detailData.metadataSource !== 'file') {
        newUrl.searchParams.delete('fileName');
      }
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('✨ 準備就緒，即將開始播放...');

      // 加載播放記錄
      try {
        const detailEpisodeProgressContentKey = buildEpisodeProgressContentKey({
          doubanId: detailData.douban_id,
          tmdbId: detailData.tmdb_id,
          title: initialEpisodeProgressTitle,
          year: initialEpisodeProgressYear,
          searchType,
        });
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(detailData.source, detailData.id);
        const record = allRecords[key];

        // 確定初始集數索引
        let initialIndex = 0;
        let shouldResumeTime = false;

        if (record) {
          // 有播放記錄
          const recordIndex = record.index - 1;
          const recordTime = record.play_time;

          // 如果有initialEpisodeIndex（用戶從文件點擊進入）
          if (detailData.initialEpisodeIndex !== undefined) {
            // 如果播放記錄的集數和點擊的文件集數一致，則使用播放記錄的時間
            if (recordIndex === detailData.initialEpisodeIndex) {
              initialIndex = recordIndex;
              shouldResumeTime = true;
              resumeTimeRef.current = recordTime;
              console.log('[Play] 播放記錄集數與點擊文件一致，恢復播放進度:', recordTime);
            } else {
              // 否則使用點擊的文件集數，從頭開始播放
              initialIndex = detailData.initialEpisodeIndex;
              const localEpisodeTime = loadLocalEpisodeProgress(
                detailEpisodeProgressContentKey,
                initialIndex
              );
              resumeTimeRef.current = localEpisodeTime;
              console.log('[Play] 使用點擊的文件集數:', initialIndex);
            }
          } else {
            // 沒有initialEpisodeIndex，使用播放記錄
            initialIndex = recordIndex;
            shouldResumeTime = true;
            resumeTimeRef.current = recordTime;
            console.log('[Play] 使用播放記錄集數:', initialIndex);
          }
        } else {
          // 沒有播放記錄
          if (detailData.initialEpisodeIndex !== undefined) {
            // 使用點擊的文件集數
            initialIndex = detailData.initialEpisodeIndex;
            resumeTimeRef.current = loadLocalEpisodeProgress(
              detailEpisodeProgressContentKey,
              initialIndex
            );
            console.log('[Play] 沒有播放記錄，使用點擊的文件集數:', initialIndex);
          } else {
            // 默認從第0集開始
            initialIndex = 0;
            resumeTimeRef.current = loadLocalEpisodeProgress(
              detailEpisodeProgressContentKey,
              initialIndex
            );
            console.log('[Play] 沒有播放記錄，從第0集開始');
          }
        }

        // 更新當前選集索引
        if (initialIndex < detailData.episodes.length && initialIndex >= 0) {
          setCurrentEpisodeIndex(initialIndex);
          currentEpisodeIndexRef.current = initialIndex;
        }
      } catch (err) {
        console.error('讀取播放記錄失敗:', err);
      }

      // 短暫延遲讓用戶看到完成狀態
      setTimeout(() => {
        setLoading(false);
      }, 1000);
    };

    initAll();
  }, []);

  // 跳過片頭片尾配置處理
  useEffect(() => {
    // 僅在初次掛載時檢查跳過片頭片尾配置
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;

      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) {
          setSkipConfig(config);
        }
      } catch (err) {
        console.error('讀取跳過片頭片尾配置失敗:', err);
      }
    };

    initSkipConfig();
  }, []);

  // 監聽 URL 參數變化，處理換源和換視頻（用於房員跟隨房主操作）
  useEffect(() => {
    const urlSource = normalizeNetdiskSource(searchParams.get('source'));
    const urlId = searchParams.get('id');

    // 只在URL參數存在且與當前狀態不同時才處理
    if (urlSource && urlId && (urlSource !== currentSource || urlId !== currentId)) {
      // 檢查新的source和id是否在可用源列表中
      // 如果 availableSources 還是空的，說明數據還在加載中，不做處理
      if (availableSources.length === 0) {
        return;
      }

      const targetSource = availableSources.find(
        (source) => source.source === urlSource && source.id === urlId
      );

      if (targetSource) {
        // 記錄當前播放進度
        const currentPlayTime = artPlayerRef.current?.currentTime || 0;

        // 獲取URL中的episode參數
        const episodeParam = searchParams.get('episode');
        const targetEpisode = episodeParam ? parseInt(episodeParam, 10) - 1 : 0;

        // 更新視頻源信息（urlSource 已經是完整格式）
        setCurrentSource(urlSource);
        setCurrentId(urlId);
        setVideoTitle(targetSource.title);
        setVideoYear(targetSource.year);
        setVideoCover(targetSource.poster);
        setVideoDoubanId(targetSource.douban_id || 0);
        setDetail(targetSource);
        setSourceProxyMode(targetSource.proxyMode || false); // 從 detail 數據中讀取代理模式

        // 更新集數
        if (targetEpisode >= 0 && targetEpisode < targetSource.episodes.length) {
          setCurrentEpisodeIndex(targetEpisode);

          // 如果是同一集,保存播放進度以便恢復
          if (targetEpisode === currentEpisodeIndex && currentPlayTime > 1) {
            resumeTimeRef.current = currentPlayTime;
          } else {
            resumeTimeRef.current = null;
          }
        }
      } else {
        // 如果新源不在可用列表中,強制刷新頁面重新加載
        window.location.reload();
      }
    }
  }, [searchParams, currentSource, currentId, availableSources, currentEpisodeIndex]);

  // 監聽 detail 和 currentEpisodeIndex 變化，自動獲取視頻信息
  useEffect(() => {
    if (detail && detail.episodes && detail.episodes.length > 0) {
      fetchCurrentSourceVideoInfo();
    }
  }, [detail, currentEpisodeIndex]);

  // 監聽 detail 和 currentEpisodeIndex 變化，動態更新字幕
  useEffect(() => {
    if (!artPlayerRef.current || !detail) return;

    const currentSubtitles = detail.subtitles?.[currentEpisodeIndex] || [];
    const savedSubtitleSize = typeof window !== 'undefined' ? localStorage.getItem('subtitleSize') || '2em' : '2em';

    // 如果有字幕，更新播放器字幕
    if (currentSubtitles.length > 0) {
      artPlayerRef.current.subtitle.switch(currentSubtitles[0].url, {
        type: 'vtt',
        style: {
          color: '#fff',
          fontSize: savedSubtitleSize,
        },
        encoding: 'utf-8',
      });

      // 移除舊的字幕設置，添加新的
      try {
        artPlayerRef.current.setting.remove('subtitle-selector');
      } catch (e) {
        // 忽略錯誤，可能設置項不存在
      }

      const subtitleOptions = [
        { html: '關閉', url: '' },
        ...currentSubtitles.map((sub: any) => ({
          html: sub.label,
          url: sub.url,
        })),
      ];

      artPlayerRef.current.setting.add({
        name: 'subtitle-selector',
        html: '字幕',
        selector: subtitleOptions,
        onSelect: function (item: any) {
          if (artPlayerRef.current) {
            if (item.url === '') {
              artPlayerRef.current.subtitle.show = false;
            } else {
              artPlayerRef.current.subtitle.switch(item.url, {
                name: item.html,
              });
              artPlayerRef.current.subtitle.show = true;
            }
          }
          return item.html;
        },
      });
    } else {
      // 沒有字幕時，隱藏字幕並移除字幕設置
      artPlayerRef.current.subtitle.show = false;
      try {
        artPlayerRef.current.setting.remove('subtitle-selector');
      } catch (e) {
        // 忽略錯誤，可能設置項不存在
      }
    }
  }, [detail, currentEpisodeIndex]);

  const getSourceSwitchResumeTime = async (
    episodeIndex: number,
    currentPlayTime: number
  ): Promise<number | null> => {
    if (currentPlayTime > 1) {
      return currentPlayTime;
    }

    if (!currentSourceRef.current || !currentIdRef.current) {
      return null;
    }

    try {
      const allRecords = await getAllPlayRecords();
      const currentRecord = allRecords[
        generateStorageKey(currentSourceRef.current, currentIdRef.current)
      ];

      if (
        currentRecord &&
        currentRecord.index - 1 === episodeIndex &&
        currentRecord.play_time > 1
      ) {
        return currentRecord.play_time;
      }
    } catch (error) {
      console.warn('[Play] Failed to read source-switch play record:', error);
    }

    return loadLocalEpisodeProgress(
      episodeProgressContentKey,
      episodeIndex
    );
  };

  // 處理換源
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string
  ) => {
    try {
      // 標記正在換源，防止 title 變化觸發頁面刷新
      isSourceChangingRef.current = true;

      // 顯示換源加載狀態
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);
      setVideoError(null);
      setCorsFailedUrl(null);
      proxyAttemptedRef.current = false;

      // 記錄當前播放進度（僅在同一集數切換時恢復）
      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      console.log('換源前當前播放時間:', currentPlayTime);

      // 清除並設置下一個跳過片頭片尾配置
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deleteSkipConfig(
            currentSourceRef.current,
            currentIdRef.current
          );
          await saveSkipConfig(newSource, newId, skipConfigRef.current);
        } catch (err) {
          console.error('清除跳過片頭片尾配置失敗:', err);
        }
      }

      let newDetail: SearchResult | undefined = availableSources.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!newDetail) {
        setError('未找到匹配結果');
        return;
      }

      // 這類源統一通過詳情接口補全播放數據
      if (isLazyDetailSource(newDetail.source) && (!newDetail.episodes || newDetail.episodes.length === 0)) {
        try {
          const detailResponse = await fetch(`/api/source-detail?source=${newSource}&id=${newId}&title=${encodeURIComponent(newTitle)}`);
          if (detailResponse.ok) {
            const detailData = await detailResponse.json();
            if (!detailData) {
              throw new Error('獲取的詳情數據為空');
            }
            newDetail = detailData;
          } else {
            throw new Error('獲取視頻詳情失敗');
          }
        } catch (err) {
          console.error('獲取視頻詳情失敗:', err);
          setIsVideoLoading(false);
          setError('獲取視頻詳情失敗，請重試');
          return;
        }
      }

      // 再次確認 newDetail 不為空（類型守衛）
      if (!newDetail) {
        setError('視頻詳情數據無效');
        return;
      }

      const newEpisodeProgressContentKey = buildEpisodeProgressContentKey({
        doubanId: newDetail.douban_id,
        tmdbId: newDetail.tmdb_id,
        title: initialEpisodeProgressTitle,
        year: initialEpisodeProgressYear,
        searchType,
      });

      // 嘗試跳轉到當前正在播放的集數
      const previousEpisodeIndex = currentEpisodeIndexRef.current;
      const previousSource = currentSourceRef.current;
      const previousId = currentIdRef.current;
      let targetIndex = previousEpisodeIndex;

      // 如果新源的集數跟舊源的集數不一致，清除當前劇集的所有彈幕緩存
      const oldEpisodeCount = detail?.episodes?.length || 0;
      const newEpisodeCount = newDetail.episodes?.length || 0;
      if (oldEpisodeCount > 0 && newEpisodeCount > 0 && oldEpisodeCount !== newEpisodeCount) {
        const titleForCache = detail?.title || videoTitle;
        console.log(`換源集數不一致 (${oldEpisodeCount} -> ${newEpisodeCount})，清除彈幕緩存: ${titleForCache}`);
        clearDanmakuCacheByTitle(titleForCache).catch((err) => {
          console.error('清除彈幕緩存失敗:', err);
        });
      }

      // 如果當前集數超出新源的範圍，則跳轉到第一集
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }

      const isSameEpisodeSwitch = targetIndex === previousEpisodeIndex;
      const resumeTime = isSameEpisodeSwitch
        ? await getSourceSwitchResumeTime(previousEpisodeIndex, currentPlayTime)
        : loadLocalEpisodeProgress(
            newEpisodeProgressContentKey,
            targetIndex
          );
      resumeTimeRef.current = resumeTime;

      // 更新URL參數（不刷新頁面）
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      newUrl.searchParams.set('title', newDetail.title || newTitle);
      window.history.replaceState({}, '', newUrl.toString());

      // 如果是小雅源，檢查並應用糾錯信息
      let finalTitle = newDetail.title || newTitle;
      let finalCover = newDetail.poster;
      let finalDesc = '';

      if (newDetail.source === 'xiaoya') {
        const correction = getXiaoyaCorrection(newDetail.source, newDetail.id);
        if (correction) {
          console.log('換源到小雅源，發現糾錯信息，正在應用...', correction);
          if (correction.title) {
            finalTitle = correction.title;
          }
          if (correction.posterPath) {
            finalCover = processImageUrl(getTMDBImageUrl(correction.posterPath));
          }
          if (correction.overview) {
            finalDesc = correction.overview;
          }
          // 應用糾錯信息到 newDetail
          newDetail = applyCorrection(newDetail, correction);
        }
      }

      setVideoTitle(finalTitle);
      setVideoYear(newDetail.year);
      setVideoCover(finalCover);
      setCorrectedDesc(finalDesc);
      setVideoDoubanId(newDetail.douban_id || 0);

      if (isSameEpisodeSwitch && resumeTime && resumeTime > 1) {
        const currentDuration = artPlayerRef.current?.duration || 0;
        saveLocalEpisodeProgress(
          newEpisodeProgressContentKey,
          targetIndex,
          resumeTime,
          currentDuration
        );

        try {
          const migratedRecord = {
            title: finalTitle,
            source_name: newDetail.source_name || '',
            year: newDetail.year || '',
            cover: finalCover || '',
            index: targetIndex + 1,
            total_episodes: newDetail.episodes?.length || 1,
            play_time: Math.floor(resumeTime),
            total_time: Math.floor(currentDuration),
            save_time: Date.now(),
            search_title: searchTitle,
          };

          if (previousSource && previousId) {
            await migratePlayRecord(
              previousSource,
              previousId,
              newSource,
              newId,
              migratedRecord
            );
          } else {
            await savePlayRecord(newSource, newId, migratedRecord);
          }
        } catch (error) {
          console.warn('[Play] Failed to migrate source-switch play record:', error);
        }
      }

      // newSource 已經是完整格式
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setSourceProxyMode(newDetail.proxyMode || false); // 從 detail 數據中讀取代理模式
      setCurrentEpisodeIndex(targetIndex);
    } catch (err) {
      // 隱藏換源加載狀態
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '換源失敗');
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 集數切換
  // ---------------------------------------------------------------------------
  const primeEpisodeResumeState = async (targetEpisodeIndex: number) => {
    if (!currentSourceRef.current || !currentIdRef.current) {
      resumeTimeRef.current = null;
      return;
    }

    try {
      const allRecords = await getAllPlayRecords();
      const key = generateStorageKey(currentSourceRef.current, currentIdRef.current);
      const record = allRecords[key];

      if (record && record.index - 1 === targetEpisodeIndex && record.play_time > 1) {
        resumeTimeRef.current = record.play_time;
      } else {
        resumeTimeRef.current = loadLocalEpisodeProgress(
          episodeProgressContentKey,
          targetEpisodeIndex
        );
      }
    } catch (error) {
      console.warn('[Play] Failed to prime episode resume state:', error);
      if (currentSourceRef.current && currentIdRef.current) {
        resumeTimeRef.current = loadLocalEpisodeProgress(
          episodeProgressContentKey,
          targetEpisodeIndex
        );
      } else {
        resumeTimeRef.current = null;
      }
    }
  };

  const prepareEpisodeSwitch = async () => {
    if (artPlayerRef.current) {
      lastPlaybackRateRef.current =
        artPlayerRef.current.playbackRate || lastPlaybackRateRef.current;
      lastVolumeRef.current =
        artPlayerRef.current.volume || lastVolumeRef.current;
      playbackRateRestoreWindowUntilRef.current = Date.now() + 8000;

      await saveCurrentPlayProgress();
    }

    setVideoLoadingStage('episodeChanging');
    setIsVideoLoading(true);
    setVideoError(null);
  };

  // 處理集數切換
  const handleEpisodeChange = async (episodeNumber: number) => {
    if (episodeNumber < 0 || episodeNumber >= totalEpisodes) {
      return;
    }

    if (episodeNumber === currentEpisodeIndexRef.current) {
      return;
    }

    await prepareEpisodeSwitch();
    await primeEpisodeResumeState(episodeNumber);
    setCurrentEpisodeIndex(episodeNumber);
  };

  const handlePreviousEpisode = async () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      await prepareEpisodeSwitch();
      const targetIndex = idx - 1;
      await primeEpisodeResumeState(targetIndex);
      setCurrentEpisodeIndex(targetIndex);
    }
  };

  // 檢查集數是否被過濾
  const isEpisodeFilteredByTitle = (title: string): boolean => {
    return isEpisodeHiddenByFilter(title, episodeFilterConfigRef.current);
  };

  const handleNextEpisode = async () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;

    if (!d || !d.episodes || idx >= d.episodes.length - 1) {
      return;
    }

    // 查找下一個未被過濾的集數
    let nextIdx = idx + 1;
    while (nextIdx < d.episodes.length) {
      const episodeTitle = d.episodes_titles?.[nextIdx];
      const isFiltered = episodeTitle && isEpisodeFilteredByTitle(episodeTitle);

      if (!isFiltered) {
        await prepareEpisodeSwitch();
        await primeEpisodeResumeState(nextIdx);
        setCurrentEpisodeIndex(nextIdx);
        return;
      }
      nextIdx++;
    }

    // 所有後續集數都被屏蔽
    if (artPlayerRef.current) {
      artPlayerRef.current.notice.show = '後續集數均已屏蔽';
      artPlayerRef.current.pause();
    }
  };

  // ---------------------------------------------------------------------------
  // 彈幕處理函數
  // ---------------------------------------------------------------------------

  /**
   * 智能過濾彈幕源：優先匹配年份和標題完全相同的源
   * @param animes 所有搜索到的彈幕源
   * @param videoTitle 視頻標題
   * @param videoYear 視頻年份（如 "2024"）
   * @returns 過濾後的彈幕源列表
   */
  const filterDanmakuSources = (
    animes: DanmakuAnime[],
    videoTitle: string,
    videoYear?: string
  ): DanmakuAnime[] => {
    if (animes.length <= 1) return animes;

    // 標準化標題：移除空格、全角轉半角
    const normalizeTitle = (title: string): string => {
      return title
        .replace(/\s+/g, '')
        .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
        .toLowerCase();
    };

    // 從日期字符串中提取年份（如 "2024-01" -> "2024"）
    const extractYear = (dateStr?: string): string | null => {
      if (!dateStr) return null;
      const match = dateStr.match(/^(\d{4})/);
      return match ? match[1] : null;
    };

    const normalizedVideoTitle = normalizeTitle(videoTitle);

    // 第一步：嘗試同時匹配年份和標題
    if (videoYear) {
      const exactMatches = animes.filter((anime) => {
        const animeYear = extractYear(anime.startDate);
        const normalizedAnimeTitle = normalizeTitle(anime.animeTitle);
        return animeYear === videoYear && normalizedAnimeTitle === normalizedVideoTitle;
      });

      if (exactMatches.length > 0) {
        console.log(`[彈幕匹配] 找到 ${exactMatches.length} 個年份和標題完全匹配的源`);
        return exactMatches;
      }
    }

    // 第二步：如果沒有完全匹配，嘗試只匹配標題
    const titleMatches = animes.filter((anime) => {
      const normalizedAnimeTitle = normalizeTitle(anime.animeTitle);
      return normalizedAnimeTitle === normalizedVideoTitle;
    });

    if (titleMatches.length > 0) {
      console.log(`[彈幕匹配] 找到 ${titleMatches.length} 個標題完全匹配的源`);
      return titleMatches;
    }

    // 第三步：如果只匹配年份
    if (videoYear) {
      const yearMatches = animes.filter((anime) => {
        const animeYear = extractYear(anime.startDate);
        return animeYear === videoYear;
      });

      if (yearMatches.length > 0) {
        console.log(`[彈幕匹配] 找到 ${yearMatches.length} 個年份匹配的源`);
        return yearMatches;
      }
    }

    // 如果都沒有匹配，返回所有源
    console.log('[彈幕匹配] 未找到精確匹配，返回所有源');
    return animes;
  };

  // 匹配彈幕集數：優先根據集數標題中的數字匹配，降級到索引匹配
  const matchDanmakuEpisode = (
    currentEpisodeIndex: number,
    danmakuEpisodes: Array<{ episodeId: number; episodeTitle: string }>,
    videoEpisodeTitle?: string
  ) => {
    if (!danmakuEpisodes.length) return null;

    const extractEpisodeNumber = (title: string): number | null => {
      if (!title) return null;

      // 優先匹配 Emby 格式：S01E01, S02E09 等
      const embyMatch = title.match(/[Ss]\d+[Ee](\d+)/);
      if (embyMatch) {
        return parseInt(embyMatch[1], 10);
      }

      // 降級到原本的策略：純數字或"第X集/話"格式
      const match = title.match(/^(\d+)$|第?\s*(\d+)\s*[集話話]?/);
      return match ? parseInt(match[1] || match[2], 10) : null;
    };

    if (videoEpisodeTitle) {
      const episodeNum = extractEpisodeNumber(videoEpisodeTitle);
      if (episodeNum !== null) {
        for (const ep of danmakuEpisodes) {
          const danmakuNum = extractEpisodeNumber(ep.episodeTitle);
          if (danmakuNum === episodeNum) {
            console.log(`[彈幕匹配] 根據集數標題匹配: ${videoEpisodeTitle} -> ${ep.episodeTitle}`);
            return ep;
          }
        }
      }
    }

    const index = Math.min(currentEpisodeIndex, danmakuEpisodes.length - 1);
    console.log(`[彈幕匹配] 降級到索引匹配: 索引 ${currentEpisodeIndex} -> ${danmakuEpisodes[index].episodeTitle}`);
    return danmakuEpisodes[index];
  };

  // 加載彈幕到播放器
  const loadDanmaku = async (episodeId: number, metadata?: {
    animeId?: number;
    animeTitle?: string;
    episodeTitle?: string;
    searchKeyword?: string;
    danmakuCount?: number;
    bypassCache?: boolean;
  }) => {
    if (!danmakuPluginRef.current) {
      console.warn('彈幕插件未初始化');
      return;
    }

    // 防止重複加載同一個 episodeId
    if (loadingDanmakuEpisodeIdRef.current === episodeId) {
      console.log(`[彈幕加載] 跳過重複加載: episodeId=${episodeId}`);
      return;
    }

    loadingDanmakuEpisodeIdRef.current = episodeId;
    setDanmakuLoading(true);

    try {
      // 先清空當前彈幕（使用 reset 方法，不觸發顯示/隱藏事件）
      danmakuPluginRef.current.reset();
      // 強制清空屏幕上的彈幕
      danmakuPluginRef.current.config({ danmuku: [] });
      danmakuPluginRef.current.load();
      setDanmakuCount(0);

      // 獲取彈幕數據（使用 title + episodeIndex 緩存）
      const title = videoTitleRef.current;
      const episodeIndex = currentEpisodeIndex;

      console.log(`[彈幕加載] episodeId=${episodeId}, title="${title}", episodeIndex=${episodeIndex}`);

      const comments = await getDanmakuById(
        episodeId,
        title,
        episodeIndex,
        { bypassCache: metadata?.bypassCache === true },
        metadata
      );

      if (comments.length === 0) {
        console.warn('未獲取到彈幕數據');
        setDanmakuLoading(false);
        loadingDanmakuEpisodeIdRef.current = null;
        return;
      }

      // 轉換彈幕格式
      let danmakuData = convertDanmakuFormat(comments);

      // 手動應用過濾規則（因為緩存的彈幕不會經過播放器的 filter 函數）
      const filterConfig = danmakuFilterConfigRef.current;
      if (filterConfig && filterConfig.rules.length > 0) {
        const originalCount = danmakuData.length;
        danmakuData = danmakuData.filter((danmu) => {
          for (const rule of filterConfig.rules) {
            // 跳過未啟用的規則
            if (!rule.enabled) continue;

            try {
              if (rule.type === 'normal') {
                // 普通模式：字符串包含匹配
                if (danmu.text.includes(rule.keyword)) {
                  return false;
                }
              } else if (rule.type === 'regex') {
                // 正則模式：正則表達式匹配
                if (new RegExp(rule.keyword).test(danmu.text)) {
                  return false;
                }
              }
            } catch (e) {
              console.error('彈幕過濾規則錯誤:', e);
            }
          }
          return true;
        });
        const filteredCount = originalCount - danmakuData.length;
        if (filteredCount > 0) {
          console.log(`彈幕過濾: 原始 ${originalCount} 條，過濾 ${filteredCount} 條，剩餘 ${danmakuData.length} 條`);
        }
      }

      // 應用彈幕數量限制
      const maxCount = typeof window !== 'undefined' ? parseInt(localStorage.getItem('danmakuMaxCount') || '0', 10) : 0;
      let calculatedOriginalCount = 0;
      if (maxCount > 0 && danmakuData.length > maxCount) {
        const originalCount = danmakuData.length;
        const step = danmakuData.length / maxCount;
        const limitedData = [];
        for (let i = 0; i < maxCount; i++) {
          limitedData.push(danmakuData[Math.floor(i * step)]);
        }
        danmakuData = limitedData;
        calculatedOriginalCount = originalCount;
        setDanmakuOriginalCount(originalCount);
        console.log(`彈幕數量限制: 原始 ${originalCount} 條，限制到 ${danmakuData.length} 條`);
      } else {
        setDanmakuOriginalCount(0);
      }

      // 加載彈幕到插件，同時應用當前的彈幕設置
      const currentSettings = danmakuSettingsRef.current;
      danmakuPluginRef.current.config({
        danmuku: danmakuData,
        speed: currentSettings.speed,
        opacity: currentSettings.opacity,
        fontSize: currentSettings.fontSize,
        margin: [currentSettings.marginTop, currentSettings.marginBottom],
        synchronousPlayback: currentSettings.synchronousPlayback,
      });
      danmakuPluginRef.current.load();

      // 根據保存的顯示狀態來決定顯示或隱藏彈幕
      const savedDisplayState = loadDanmakuDisplayState();
      if (savedDisplayState === false) {
        danmakuPluginRef.current.hide();
      } else {
        danmakuPluginRef.current.show();
      }

      setDanmakuCount(danmakuData.length);
      console.log(`彈幕加載成功，共 ${danmakuData.length} 條`);

      // 更新當前選擇狀態，包含彈幕數量
      if (metadata) {
        setCurrentDanmakuSelection({
          animeId: metadata.animeId || 0,
          episodeId: episodeId,
          animeTitle: metadata.animeTitle || '',
          episodeTitle: metadata.episodeTitle || '',
          searchKeyword: metadata.searchKeyword,
          danmakuCount: danmakuData.length,
          danmakuOriginalCount: calculatedOriginalCount > 0 ? calculatedOriginalCount : undefined,
        });
      }

      // 延遲一下讓用戶看到彈幕數量
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (error) {
      console.error('加載彈幕失敗:', error);
      setDanmakuCount(0);
    } finally {
      setDanmakuLoading(false);
      loadingDanmakuEpisodeIdRef.current = null;
    }
  };

  // 預加載下一集彈幕（完全複製 loadDanmakuForCurrentEpisode 的邏輯）
  const preloadNextEpisodeDanmaku = async () => {
    try {
      if (isDirectPlay) return;
      if (isDanmakuAutoLoadDisabled()) return;

      const title = videoTitleRef.current;
      if (!title) {
        return;
      }

      const currentIdx = currentEpisodeIndexRef.current;
      const nextEpisodeIndex = currentIdx + 1;

      // 1. 檢查是否有下一集
      const episodes = detailRef.current?.episodes;
      if (!episodes || nextEpisodeIndex >= episodes.length) {
        return;
      }

      // 2. 檢查緩存是否已存在
      const cachedData = await getDanmakuFromCache(title, nextEpisodeIndex);
      if (cachedData && cachedData.comments.length > 0) {
        return;
      }

      // 3. 檢查是否有手動選擇的劇集 ID
      const manualEpisodeId = getManualDanmakuSelection(title, nextEpisodeIndex);
      if (manualEpisodeId) {
        try {
          await getDanmakuById(manualEpisodeId, title, nextEpisodeIndex);
          return;
        } catch (error) {
          // 繼續執行後續邏輯
        }
      }

      // 4. 嘗試使用保存的動漫ID自動匹配劇集
      const savedAnimeId = getDanmakuAnimeId(title);
      if (savedAnimeId) {
        try {
          const episodesResult = await getEpisodes(savedAnimeId);

          if (episodesResult.success && episodesResult.bangumi.episodes.length > 0) {
            const nextVideoEpTitle = detailRef.current?.episodes_titles?.[nextEpisodeIndex];
            const episode = matchDanmakuEpisode(nextEpisodeIndex, episodesResult.bangumi.episodes, nextVideoEpTitle);

            if (episode) {
              await getDanmakuById(
                episode.episodeId,
                title,
                nextEpisodeIndex,
                undefined,
                {
                  animeId: savedAnimeId,
                  animeTitle: episodesResult.bangumi.animeTitle,
                  episodeTitle: episode.episodeTitle,
                }
              );
              return;
            }
          }
        } catch (error) {
          // 繼續執行後續邏輯
        }
      }

      // 5. 執行自動搜索彈幕
      const savedKeyword = getDanmakuSearchKeyword(title);
      const searchKeyword = savedKeyword || title;

      const searchResult = await searchAnime(searchKeyword);
      if (!searchResult.success || searchResult.animes.length === 0) {
        return;
      }

      // 應用智能過濾
      const videoYear = detailRef.current?.year;
      const filteredAnimes = filterDanmakuSources(searchResult.animes, title, videoYear);

      if (filteredAnimes.length === 0) {
        return;
      }

      // 檢查是否有記憶的選擇
      let selectedAnime = filteredAnimes[0];
      if (filteredAnimes.length > 1) {
        const rememberedIndex = getDanmakuSourceIndex(title);
        if (rememberedIndex !== null && rememberedIndex < filteredAnimes.length) {
          selectedAnime = filteredAnimes[rememberedIndex];
        }
      }

      // 獲取劇集列表並匹配
      const episodesResult = await getEpisodes(selectedAnime.animeId);
      if (episodesResult.success && episodesResult.bangumi.episodes.length > 0) {
        const nextVideoEpTitle = detailRef.current?.episodes_titles?.[nextEpisodeIndex];
        const episode = matchDanmakuEpisode(nextEpisodeIndex, episodesResult.bangumi.episodes, nextVideoEpTitle);

        if (episode) {
          await getDanmakuById(
            episode.episodeId,
            title,
            nextEpisodeIndex,
            undefined,
            {
              animeId: selectedAnime.animeId,
              animeTitle: selectedAnime.animeTitle,
              episodeTitle: episode.episodeTitle,
              searchKeyword: searchKeyword,
            }
          );
        }
      }
    } catch (error) {
      // 靜默處理失敗
    }
  };

  // 處理上傳彈幕
  const handleUploadDanmaku = async (comments: DanmakuComment[]) => {
    setDanmakuLoading(true);

    try {
      // 緩存到IndexedDB
      const title = videoTitleRef.current;
      const episodeIndex = currentEpisodeIndexRef.current;
      if (title) {
        const { saveDanmakuToCache } = await import('@/lib/danmaku/cache');
        await saveDanmakuToCache(title, episodeIndex, comments);
      }

      // 轉換彈幕格式
      let danmakuData = convertDanmakuFormat(comments);

      // 應用過濾規則
      const filterConfig = danmakuFilterConfigRef.current;
      if (filterConfig && filterConfig.rules.length > 0) {
        danmakuData = danmakuData.filter((danmu) => {
          for (const rule of filterConfig.rules) {
            if (!rule.enabled) continue;
            try {
              if (rule.type === 'normal') {
                if (danmu.text.includes(rule.keyword)) return false;
              } else if (rule.type === 'regex') {
                if (new RegExp(rule.keyword).test(danmu.text)) return false;
              }
            } catch (e) {
              console.error('彈幕過濾規則錯誤:', e);
            }
          }
          return true;
        });
      }

      // 應用彈幕數量限制
      const maxCount = typeof window !== 'undefined' ? parseInt(localStorage.getItem('danmakuMaxCount') || '0', 10) : 0;
      if (maxCount > 0 && danmakuData.length > maxCount) {
        const originalCount = danmakuData.length;
        const step = danmakuData.length / maxCount;
        const limitedData = [];
        for (let i = 0; i < maxCount; i++) {
          limitedData.push(danmakuData[Math.floor(i * step)]);
        }
        danmakuData = limitedData;
        setDanmakuOriginalCount(originalCount);
        console.log(`彈幕數量限制: 原始 ${originalCount} 條，限制到 ${danmakuData.length} 條`);
      } else {
        setDanmakuOriginalCount(0);
      }

      // 加載彈幕到播放器（使用 reset 方法清空，不觸發顯示/隱藏事件）
      if (danmakuPluginRef.current) {
        danmakuPluginRef.current.reset();

        const currentSettings = danmakuSettingsRef.current;
        danmakuPluginRef.current.config({
          danmuku: danmakuData,
          speed: currentSettings.speed,
          opacity: currentSettings.opacity,
          fontSize: currentSettings.fontSize,
          margin: [currentSettings.marginTop, currentSettings.marginBottom],
          synchronousPlayback: currentSettings.synchronousPlayback,
        });
        danmakuPluginRef.current.load();

        // 觸發自定義事件通知熱力圖更新
        if (artPlayerRef.current) {
          artPlayerRef.current.emit('danmaku:loaded');
        }

        // 根據保存的顯示狀態來決定顯示或隱藏彈幕
        const savedDisplayState = loadDanmakuDisplayState();
        if (savedDisplayState === false) {
          danmakuPluginRef.current.hide();
        } else {
          danmakuPluginRef.current.show();
        }
      }

      setDanmakuCount(danmakuData.length);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = `上傳成功，共 ${danmakuData.length} 條彈幕`;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (error) {
      console.error('上傳彈幕失敗:', error);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = '彈幕加載失敗';
      }
    } finally {
      setDanmakuLoading(false);
    }
  };

  // 處理彈幕選擇
  const handleDanmakuSelect = async (selection: DanmakuSelection, isManual = false) => {
    console.log(`[彈幕選擇] isManual=${isManual}, selection:`, selection);
    setCurrentDanmakuSelection(selection);

    // 只有手動選擇時才保存到 sessionStorage
    if (isManual) {
      const title = videoTitleRef.current;
      const episodeIndex = currentEpisodeIndexRef.current;
      if (title && episodeIndex >= 0) {
        saveManualDanmakuSelection(title, episodeIndex, selection.episodeId);

        // 保存用戶手動選擇的動漫ID（用於換集時自動匹配）
        saveDanmakuAnimeId(title, selection.animeId);

        // 保存搜索關鍵詞（如果有的話）
        if (selection.searchKeyword) {
          saveDanmakuSearchKeyword(title, selection.searchKeyword);
          console.log(`[彈幕記憶] 保存手動搜索關鍵詞: ${selection.searchKeyword}`);
        }
      }
    }

    // 加載彈幕，傳遞元信息
    await loadDanmaku(selection.episodeId, {
      animeId: selection.animeId,
      animeTitle: selection.animeTitle,
      episodeTitle: selection.episodeTitle,
      searchKeyword: selection.searchKeyword,
      danmakuCount: selection.danmakuCount,
      bypassCache: isManual,
    });
  };

  // 處理用戶選擇彈幕源
  const handleDanmakuSourceSelect = async (selectedAnime: DanmakuAnime, selectedIndex?: number, isManualSearch = false) => {
    setShowDanmakuSourceSelector(false);

    try {
      const title = videoTitleRef.current;
      console.log('[彈幕] 用戶選擇彈幕源 - 視頻:', title, '彈幕源:', selectedAnime.animeTitle);

      // 如果提供了下標，保存到 sessionStorage
      if (selectedIndex !== undefined && title) {
        saveDanmakuSourceIndex(title, selectedIndex);
      }

      // 獲取劇集列表
      const episodesResult = await getEpisodes(selectedAnime.animeId);

      if (
        episodesResult.success &&
        episodesResult.bangumi.episodes.length > 0
      ) {
        // 根據當前集數選擇對應的彈幕
        const currentEp = currentEpisodeIndexRef.current;
        const videoEpTitle = detailRef.current?.episodes_titles?.[currentEp];
        const episode = matchDanmakuEpisode(currentEp, episodesResult.bangumi.episodes, videoEpTitle);

        if (episode) {
          const selection: DanmakuSelection = {
            animeId: selectedAnime.animeId,
            episodeId: episode.episodeId,
            animeTitle: selectedAnime.animeTitle,
            episodeTitle: episode.episodeTitle,
          };

          // 設置劇集列表
          setDanmakuEpisodesList(episodesResult.bangumi.episodes);

          console.log('用戶選擇彈幕源:', selection);

          // 通過統一的 handleDanmakuSelect 處理彈幕加載
          // 只有從彈幕面板手動搜索選擇時才標記為手動選擇
          await handleDanmakuSelect(selection, isManualSearch);
        }
      } else {
        console.warn('未找到劇集信息');
      }
    } catch (error) {
      console.error('加載彈幕失敗:', error);
    }
  };

  // 手動重新選擇彈幕源（忽略記憶）- 保留供將來使用
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleReselectDanmakuSource = async () => {
    const title = videoTitleRef.current;
    if (!title) {
      console.warn('視頻標題為空，無法搜索彈幕');
      return;
    }

    console.log('[彈幕] 用戶手動重新選擇彈幕源 - 視頻:', title);
    setDanmakuLoading(true);

    try {
      const searchResult = await searchAnime(title);

      if (searchResult.success && searchResult.animes.length > 0) {
        // 應用智能過濾：優先匹配年份和標題
        const videoYear = detailRef.current?.year;
        const filteredAnimes = filterDanmakuSources(
          searchResult.animes,
          title,
          videoYear
        );

        // 如果有多個匹配結果，讓用戶選擇
        if (filteredAnimes.length > 1) {
          console.log(`[彈幕] 找到 ${filteredAnimes.length} 個彈幕源`);
          setDanmakuMatches(filteredAnimes);
          setShowDanmakuSourceSelector(true);
          setDanmakuLoading(false);
          return;
        }

        // 只有一個結果，直接使用
        const anime = filteredAnimes[0];
        await handleDanmakuSourceSelect(anime);
      } else {
        console.warn('[彈幕] 未找到匹配的彈幕');
        if (artPlayerRef.current) {
          artPlayerRef.current.notice.show = '未找到匹配的彈幕源';
        }
        setDanmakuLoading(false);
      }
    } catch (error) {
      console.error('[彈幕] 搜索失敗:', error);
      setDanmakuLoading(false);
    }
  };

  // 自動搜索並加載彈幕
  const autoSearchDanmaku = async () => {
    if (isDirectPlay) return;
    const disableAutoLoad = isDanmakuAutoLoadDisabled();
    if (disableAutoLoad) return;

    const title = videoTitleRef.current;
    if (!title) {
      console.warn('視頻標題為空，無法自動搜索彈幕');
      return;
    }

    const currentEpisodeIndex = currentEpisodeIndexRef.current;
    console.log('[彈幕] 開始加載彈幕 - 視頻標題:', title, '集數:', currentEpisodeIndex);

    // 先嚐試從 IndexedDB 緩存加載
    try {
      const cachedData = await getDanmakuFromCache(title, currentEpisodeIndex);
      if (cachedData && cachedData.comments.length > 0) {
        console.log(`[彈幕] 使用緩存: title="${title}", episodeIndex=${currentEpisodeIndex}, 數量=${cachedData.comments.length}`);

        // 直接加載緩存的彈幕，不需要調用 API
        if (!danmakuPluginRef.current) {
          console.warn('彈幕插件未初始化');
          return;
        }

        setDanmakuLoading(true);

        // 轉換彈幕格式
        let danmakuData = convertDanmakuFormat(cachedData.comments);

        // 手動應用過濾規則
        const filterConfig = danmakuFilterConfigRef.current;
        if (filterConfig && filterConfig.rules.length > 0) {
          const originalCount = danmakuData.length;
          danmakuData = danmakuData.filter((danmu) => {
            for (const rule of filterConfig.rules) {
              if (!rule.enabled) continue;
              try {
                if (rule.type === 'normal') {
                  if (danmu.text.includes(rule.keyword)) {
                    return false;
                  }
                } else if (rule.type === 'regex') {
                  if (new RegExp(rule.keyword).test(danmu.text)) {
                    return false;
                  }
                }
              } catch (e) {
                console.error('彈幕過濾規則錯誤:', e);
              }
            }
            return true;
          });
          const filteredCount = originalCount - danmakuData.length;
          if (filteredCount > 0) {
            console.log(`彈幕過濾: 原始 ${originalCount} 條，過濾 ${filteredCount} 條，剩餘 ${danmakuData.length} 條`);
          }
        }

        // 應用彈幕數量限制
        const maxCount = typeof window !== 'undefined' ? parseInt(localStorage.getItem('danmakuMaxCount') || '0', 10) : 0;
        let calculatedOriginalCount = 0;
        if (maxCount > 0 && danmakuData.length > maxCount) {
          const originalCount = danmakuData.length;
          const step = danmakuData.length / maxCount;
          const limitedData = [];
          for (let i = 0; i < maxCount; i++) {
            limitedData.push(danmakuData[Math.floor(i * step)]);
          }
          danmakuData = limitedData;
          calculatedOriginalCount = originalCount;
          setDanmakuOriginalCount(originalCount);
          console.log(`彈幕數量限制: 原始 ${originalCount} 條，限制到 ${danmakuData.length} 條`);
        } else {
          // 沒有應用限制，不顯示原始數量
          setDanmakuOriginalCount(0);
        }

        // 加載彈幕到插件
        const currentSettings = danmakuSettingsRef.current;
        danmakuPluginRef.current.config({
          danmuku: danmakuData,
          speed: currentSettings.speed,
          opacity: currentSettings.opacity,
          fontSize: currentSettings.fontSize,
          margin: [currentSettings.marginTop, currentSettings.marginBottom],
          synchronousPlayback: currentSettings.synchronousPlayback,
        });
        danmakuPluginRef.current.load();

        // 觸發自定義事件通知熱力圖更新
        if (artPlayerRef.current) {
          artPlayerRef.current.emit('danmaku:loaded');
        }

        // 根據保存的顯示狀態來決定顯示或隱藏彈幕
        const savedDisplayState = loadDanmakuDisplayState();
        if (savedDisplayState === false) {
          danmakuPluginRef.current.hide();
        } else {
          danmakuPluginRef.current.show();
        }

        setDanmakuCount(danmakuData.length);
        console.log(`[彈幕] 緩存加載成功，共 ${danmakuData.length} 條`);

        // 更新當前選擇狀態（使用實時計算的數量）
        if (cachedData.metadata) {
          setCurrentDanmakuSelection({
            animeId: cachedData.metadata.animeId || 0,
            episodeId: cachedData.metadata.episodeId || 0,
            animeTitle: cachedData.metadata.animeTitle || '',
            episodeTitle: cachedData.metadata.episodeTitle || '',
            searchKeyword: cachedData.metadata.searchKeyword,
            danmakuCount: danmakuData.length,
            danmakuOriginalCount: calculatedOriginalCount > 0 ? calculatedOriginalCount : undefined,
          });
        }

        // 延遲一下讓用戶看到彈幕數量
        await new Promise((resolve) => setTimeout(resolve, 1500));
        setDanmakuLoading(false);

        return; // 使用緩存成功，直接返回
      }
    } catch (error) {
      console.error('[彈幕] 讀取緩存失敗:', error);
    }

    // 沒有緩存，執行自動搜索彈幕
    console.log('[彈幕] 緩存未命中，開始搜索');
    setDanmakuLoading(true);

    // 優先使用保存的搜索關鍵詞，否則使用視頻標題
    const savedKeyword = getDanmakuSearchKeyword(title);
    const searchKeyword = savedKeyword || title;
    console.log(`[彈幕] 搜索關鍵詞: ${searchKeyword}${savedKeyword ? ' (使用保存的關鍵詞)' : ' (使用視頻標題)'}`);

    try {
      const searchResult = await searchAnime(searchKeyword);

      if (searchResult.success && searchResult.animes.length > 0) {
        // 應用智能過濾：優先匹配年份和標題
        const videoYear = detailRef.current?.year;
        const filteredAnimes = filterDanmakuSources(
          searchResult.animes,
          title,
          videoYear
        );

        // 如果有多個匹配結果，讓用戶選擇
        if (filteredAnimes.length > 1) {
          console.log(`找到 ${filteredAnimes.length} 個彈幕源，等待用戶選擇`);
          setDanmakuMatches(filteredAnimes);
          setCurrentSearchKeyword(searchKeyword); // 保存當前搜索關鍵詞
          setShowDanmakuSourceSelector(true);
          setDanmakuLoading(false);
          if (artPlayerRef.current) {
            artPlayerRef.current.notice.show = `找到 ${filteredAnimes.length} 個彈幕源，請選擇`;
          }
          return;
        }

        // 只有一個結果，直接使用
        const anime = filteredAnimes[0];

        // 獲取劇集列表
        const episodesResult = await getEpisodes(anime.animeId);

        if (
          episodesResult.success &&
          episodesResult.bangumi.episodes.length > 0
        ) {
          // 根據當前集數選擇對應的彈幕
          const currentEp = currentEpisodeIndexRef.current;
          const videoEpTitle = detailRef.current?.episodes_titles?.[currentEp];
          const episode = matchDanmakuEpisode(currentEp, episodesResult.bangumi.episodes, videoEpTitle);

          if (episode) {
            const selection: DanmakuSelection = {
              animeId: anime.animeId,
              episodeId: episode.episodeId,
              animeTitle: anime.animeTitle,
              episodeTitle: episode.episodeTitle,
            };

            // 設置劇集列表
            setDanmakuEpisodesList(episodesResult.bangumi.episodes);

            console.log('自動搜索彈幕成功:', selection);

            // 通過統一的 handleDanmakuSelect 處理彈幕加載
            await handleDanmakuSelect(selection);
          }
        } else {
          console.warn('未找到劇集信息');
          if (artPlayerRef.current) {
            artPlayerRef.current.notice.show = '彈幕加載失敗：未找到劇集信息';
          }
        }
      } else {
        console.warn('未找到匹配的彈幕');
        if (artPlayerRef.current) {
          artPlayerRef.current.notice.show = '未找到匹配的彈幕，可在彈幕選項卡手動搜索';
        }
      }
    } catch (error) {
      console.error('自動搜索彈幕失敗:', error);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = '彈幕加載失敗，請檢查網絡或稍後重試';
      }
    } finally {
      setDanmakuLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 鍵盤快捷鍵
  // ---------------------------------------------------------------------------
  // 處理全局快捷鍵
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    // 忽略輸入框中的按鍵事件
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    // Alt + 左箭頭 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }

    // Alt + 右箭頭 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }

    // 左箭頭 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }

    // 右箭頭 = 快進
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }

    // 上箭頭 = 音量+
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 下箭頭 = 音量-
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 空格 = 播放/暫停
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }

    // f 鍵 = 切換全屏
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        e.preventDefault();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 播放記錄相關
  // ---------------------------------------------------------------------------
  // 保存播放進度
  const saveCurrentPlayProgress = async () => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    ) {
      return;
    }

    const player = artPlayerRef.current;
    const currentTime = player.currentTime || 0;
    const duration = player.duration || 0;

    // 如果播放時間太短（少於5秒）或者視頻時長無效，不保存
    if (currentTime < 1 || !duration) {
      return;
    }

    try {
      saveLocalEpisodeProgress(
        episodeProgressContentKey,
        currentEpisodeIndexRef.current,
        currentTime,
        duration
      );

      await savePlayRecord(currentSourceRef.current, currentIdRef.current, {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year,
        cover: detailRef.current?.poster || '',
        index: currentEpisodeIndexRef.current + 1, // 轉換為1基索引
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitle,
      });

      lastSaveTimeRef.current = Date.now();
      console.log('播放進度已保存:', {
        title: videoTitleRef.current,
        episode: currentEpisodeIndexRef.current + 1,
        year: detailRef.current?.year,
        progress: `${Math.floor(currentTime)}/${Math.floor(duration)}`,
      });
    } catch (err) {
      console.error('保存播放進度失敗:', err);
    }
  };

  useEffect(() => {
    // 頁面即將卸載時保存播放進度和清理資源
    const handleBeforeUnload = () => {
      saveCurrentPlayProgress();
      releaseWakeLock();
      cleanupPlayer();
    };

    // 頁面可見性變化時保存播放進度和釋放 Wake Lock
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
        releaseWakeLock();
      } else if (document.visibilityState === 'visible') {
        // 頁面重新可見時，如果正在播放則重新請求 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
      }
    };

    // 添加事件監聽器
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // 清理事件監聽器
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail]);

  // 清理定時器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 收藏相關
  // ---------------------------------------------------------------------------
  // 每當 source 或 id 變化時檢查收藏狀態
  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (err) {
        console.error('檢查收藏狀態失敗:', err);
      }
    })();
  }, [currentSource, currentId]);

  // 監聽收藏數據更新事件
  useEffect(() => {
    if (!currentSource || !currentId) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        const isFav = !!favorites[key];
        setFavorited(isFav);
      }
    );

    return unsubscribe;
  }, [currentSource, currentId]);

  // 切換收藏
  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        // 如果已收藏，刪除收藏
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        // 如果未收藏，添加收藏
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year || 'unknown',
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
          is_completed: getSeriesStatus(detailRef.current) === 'completed',
          vod_remarks: detailRef.current?.vod_remarks,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切換收藏失敗:', err);
    }
  };

  // 糾錯成功後的回調
  const handleCorrectSuccess = () => {
    if (!detail || detail.source !== 'xiaoya') return;

    // 從 localStorage 讀取糾錯信息
    const correction = getXiaoyaCorrection(detail.source, detail.id);
    if (correction) {
      console.log('應用糾錯信息:', correction);

      // 只更新顯示相關的狀態，不更新 detail（避免觸發其他 useEffect）
      if (correction.title) {
        setVideoTitle(correction.title);
      }
      if (correction.posterPath) {
        const fullPosterUrl = processImageUrl(getTMDBImageUrl(correction.posterPath));
        setVideoCover(fullPosterUrl);
      }
      if (correction.overview) {
        setCorrectedDesc(correction.overview);
      }
      if (correction.doubanId) {
        const doubanIdNum = typeof correction.doubanId === 'string'
          ? parseInt(correction.doubanId, 10)
          : correction.doubanId;
        setVideoDoubanId(doubanIdNum);
      }

      // 更新 detailRef，這樣其他地方使用 detailRef 時能獲取到最新信息
      if (detailRef.current) {
        detailRef.current = applyCorrection(detailRef.current, correction);
      }

      // 更新 availableSources 中的小雅源信息
      setAvailableSources(prevSources => applyCorrectionsToSources(prevSources));

      console.log('已應用糾錯信息');
    }
  };

  useEffect(() => {
    if (
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    // 這類源會先異步補全詳情，如果 episodes 為空則跳過
    if (isLazyDetailSource(currentSource || detail?.source) && (!detail || !detail.episodes || detail.episodes.length === 0)) {
      return;
    }

    // 確保選集索引有效
    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`選集索引無效，當前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('視頻地址無效');
      return;
    }
    console.log(videoUrl);

    // 檢測是否為WebKit瀏覽器
    const isWebkit =
      typeof window !== 'undefined' &&
      typeof (window as any).webkitConvertPointFromNodeToPage === 'function';

    // 檢測是否為 iOS 設備（iPhone、iPad、iPod）
    const isIOS = (() => {
      if (typeof window === 'undefined') return false;

      const ua = navigator.userAgent;

      // 排除 Windows Phone（它的 UA 中也包含 iPhone）
      if ((window as any).MSStream) return false;

      // 方法1：檢測 UA 中的 iOS 設備標識
      if (/iPad|iPhone|iPod/.test(ua)) {
        console.log('[設備檢測] iOS 設備（通過 UA）:', ua);
        return true;
      }

      // 方法2：檢測 iPad（iOS 13+ 桌面模式）
      // 條件：UA 包含 Mac + 支持觸摸 + 不是 Windows/Linux
      const isMacUA = ua.includes('Mac OS X');
      const hasTouch = 'ontouchend' in document;
      const isNotWindows = !ua.includes('Windows');
      const isNotLinux = !ua.includes('Linux');

      if (isMacUA && hasTouch && isNotWindows && isNotLinux) {
        console.log('[設備檢測] iPad 桌面模式:', { ua, hasTouch });
        return true;
      }

      console.log('[設備檢測] 非 iOS 設備:', { ua, hasTouch });
      return false;
    })();

    // 輔助函數：檢測代理 URL 是否需要顯式聲明 m3u8 類型
    // Artplayer 通過 URL 擴展名自動檢測類型，但代理 URL（如 /api/proxy-m3u8?url=...）沒有 .m3u8 擴展名
    const getVideoType = (url: string): string | undefined => {
      if (!url) return undefined;
      // 如果 URL 路徑中已包含 .m3u8 擴展名，Artplayer 可自動檢測，無需顯式設置
      const urlPath = url.split('?')[0];
      if (urlPath.includes('.m3u8')) return undefined;
      // 代理 URL 返回的是 m3u8 內容，需要顯式聲明類型
      if (url.includes('/api/proxy-m3u8') || url.includes('/api/proxy/vod/m3u8')) {
        return 'm3u8';
      }
      return undefined;
    };

    // 非WebKit瀏覽器且播放器已存在，使用switch方法切換
    if (!isWebkit && artPlayerRef.current) {
      // 顯式設置類型，確保代理 URL 能被 HLS.js 正確處理
      const videoType = getVideoType(videoUrl);
      if (videoType) {
        artPlayerRef.current.option.type = videoType;
      } else {
        artPlayerRef.current.option.type = '';
      }
      artPlayerRef.current.switch = videoUrl;
      artPlayerRef.current.title = `${videoTitle} - ${playerEpisodeLabel}`;
      artPlayerRef.current.poster = videoCover;
      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }
      return;
    }

    // WebKit瀏覽器或首次創建：銷燬之前的播放器實例並創建新的
    // 異步初始化播放器
    const initPlayer = async () => {
      try {
        // 先清理舊播放器實例
        if (artPlayerRef.current) {
          await cleanupPlayer();
        }

        // iOS需要等待DOM完全清理
        await new Promise(resolve => setTimeout(resolve, 100));

        // 雙重檢查：如果舊播放器仍然存在，再次清理
        if (artPlayerRef.current) {
          console.warn('舊播放器仍存在，再次清理');
          await cleanupPlayer();
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // 再次確保容器為空
        if (artRef.current) {
          artRef.current.innerHTML = '';
        }

        // 動態導入播放器庫
        const [ArtplayerModule, HlsModule, DanmukuPlugin] = await Promise.all([
          import('artplayer'),
          import('hls.js'),
          import('artplayer-plugin-danmuku'),
        ]);

        const Artplayer = ArtplayerModule.default;
        const Hls = HlsModule.default;
        const artplayerPluginDanmuku = DanmukuPlugin.default as any;
        const playerTimeouts = new Set<number>();
        const clearTrackedTimeout = (timeoutId: number | null) => {
          if (timeoutId == null) {
            return;
          }

          window.clearTimeout(timeoutId);
          playerTimeouts.delete(timeoutId);
        };
        const schedulePlayerTimeout = (callback: () => void, delay: number) => {
          const timeoutId = window.setTimeout(() => {
            playerTimeouts.delete(timeoutId);
            callback();
          }, delay);
          playerTimeouts.add(timeoutId);
          return timeoutId;
        };
        const clearPlayerTimeouts = () => {
          playerTimeouts.forEach((timeoutId) => {
            window.clearTimeout(timeoutId);
          });
          playerTimeouts.clear();
        };

        const syncPlaybackPitch = () => {
          if (!isWebkit || !artPlayerRef.current?.video) {
            return;
          }

          const video = artPlayerRef.current.video as HTMLVideoElement & {
            webkitPreservesPitch?: boolean;
          };
          const shouldPreservePitch = true;

          if ('preservesPitch' in video) {
            video.preservesPitch = shouldPreservePitch;
          }
          if ('webkitPreservesPitch' in video) {
            video.webkitPreservesPitch = shouldPreservePitch;
          }
        };

        const shouldRescueWebkitHls = (
          video: HTMLVideoElement & {
            hls?: {
              detachMedia?: () => void;
              attachMedia?: (video: HTMLVideoElement) => void;
              startLoad?: (startPosition?: number) => void;
              bufferController?: {
                mediaSource?: {
                  readyState?: string;
                };
              };
            };
          }
        ) => {
          const hls = video.hls;
          if (!hls) {
            return false;
          }

          let hasBufferedData = false;
          try {
            hasBufferedData = video.buffered.length > 0;
          } catch {
            hasBufferedData = false;
          }

          if (video.readyState > 0 || hasBufferedData) {
            return false;
          }

          const currentSrc = video.currentSrc || video.src || '';
          const mediaSourceState = hls.bufferController?.mediaSource?.readyState || '';
          const usingBlobMsePath = currentSrc.startsWith('blob:') && mediaSourceState !== 'closed';

          return !usingBlobMsePath;
        };

        const rescueWebkitHlsBootstrap = (
          reason: string,
          retryDelays: number[] = [1500, 3500, 6000]
        ) => {
          if (!isWebkit || !artPlayerRef.current?.video) {
            return;
          }

          const video = artPlayerRef.current.video as HTMLVideoElement & {
            hls?: {
              detachMedia?: () => void;
              attachMedia?: (video: HTMLVideoElement) => void;
              startLoad?: (startPosition?: number) => void;
            };
          };

          retryDelays.forEach((delay) => {
            schedulePlayerTimeout(() => {
              if (!artPlayerRef.current || artPlayerRef.current.video !== video) {
                return;
              }

              const hls = video.hls;
              if (!shouldRescueWebkitHls(video)) {
                return;
              }

              console.warn(
                `[HLS] Safari bootstrap rescue triggered (${reason}, ${delay}ms)`
              );

              try {
                hls.detachMedia?.();
                hls.attachMedia?.(video);
                hls.startLoad?.(-1);
                video.play().catch((error) => {
                  console.warn('[HLS] Safari rescue play failed:', error);
                });
              } catch (error) {
                console.warn('[HLS] Safari bootstrap rescue failed:', error);
              }
            }, delay);
          });
        };

        // 創建自定義 HLS loader
        const CustomHlsJsLoader = createCustomHlsLoader(Hls);

        // 創建新的播放器實例
        Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
        Artplayer.USE_RAF = true;

        // 獲取當前集的字幕
        const currentSubtitles = detailRef.current?.subtitles?.[currentEpisodeIndex] || [];
        const savedSubtitleSize = typeof window !== 'undefined' ? localStorage.getItem('subtitleSize') || '2em' : '2em';

        artPlayerRef.current = new Artplayer({
          container: artRef.current!,
          url: videoUrl,
          ...(getVideoType(videoUrl) ? { type: getVideoType(videoUrl) } : {}),
          poster: videoCover,
          volume: 0.7,
          isLive: false,
          muted: false,
          autoplay: true,
          pip: true,
          autoSize: false,
          autoMini: false,
          screenshot: true,
          setting: true,
          loop: false,
          flip: false,
          playbackRate: true,
          aspectRatio: false,
          fullscreen: !isIOS,  // iOS 禁用原生全屏按鈕，避免觸發系統播放器
          fullscreenWeb: true,  // 保留網頁全屏按鈕（所有平臺）
          ...(currentSubtitles.length > 0 ? {
            subtitle: {
              url: currentSubtitles[0].url,
              type: 'vtt',
              style: {
                color: '#fff',
                fontSize: savedSubtitleSize,
              },
              encoding: 'utf-8',
            }
          } : {}),
          subtitleOffset: false,
          miniProgressBar: false,
          mutex: true,
          playsInline: true,
          autoPlayback: false,
          airplay: true,
          theme: '#22c55e',
          lang: 'zh-cn',
          hotkey: false,
          fastForward: true,
          autoOrientation: true,
          lock: true,
          ...(videoQualities.length > 0 ? {
            quality: videoQualities.map((q, index) => ({
              default: index === 0,
              html: q.name,
              url: q.url,
            })),
          } : {}),
          moreVideoAttr: {
            playsInline: true,
            'webkit-playsinline': 'true',
            referrerpolicy: 'no-referrer',
          } as any,
          // HLS 支持配置
          customType: {
            m3u8: function (video: HTMLVideoElement, url: string) {
              if (!Hls) {
                console.error('HLS.js 未加載');
                return;
              }

              if (video.hls) {
                video.hls.destroy();
              }

              // 每次創建HLS實例時，都讀取最新的blockAdEnabled狀態
              const shouldUseCustomLoader = blockAdEnabledRef.current;

              // 從localStorage讀取緩衝策略
              const bufferStrategy = typeof window !== 'undefined'
                ? localStorage.getItem('bufferStrategy') || 'medium'
                : 'medium';

              // 根據緩衝策略配置不同的緩衝參數
              const getBufferConfig = (strategy: string) => {
                switch (strategy) {
                  case 'low':
                    return {
                      maxBufferLength: 15,
                      backBufferLength: 15,
                      maxBufferSize: 30 * 1000 * 1000, // ~30MB
                    };
                  case 'medium':
                    return {
                      maxBufferLength: 30,
                      backBufferLength: 30,
                      maxBufferSize: 60 * 1000 * 1000, // ~60MB
                    };
                  case 'high':
                    return {
                      maxBufferLength: 60,
                      backBufferLength: 40,
                      maxBufferSize: 120 * 1000 * 1000, // ~120MB
                    };
                  case 'ultra':
                    return {
                      maxBufferLength: 120,
                      backBufferLength: 60,
                      maxBufferSize: 240 * 1000 * 1000, // ~240MB
                    };
                  default:
                    return {
                      maxBufferLength: 30,
                      backBufferLength: 30,
                      maxBufferSize: 60 * 1000 * 1000,
                    };
                }
              };

              const bufferConfig = getBufferConfig(bufferStrategy);

              // 選擇合適的 Loader
              let loaderClass;
              if (shouldUseCustomLoader) {
                // 使用自定義廣告過濾 Loader
                loaderClass = CustomHlsJsLoader;
              } else {
                // 使用默認 Loader
                loaderClass = Hls.DefaultConfig.loader;
              }

              const hls = new Hls({
                debug: false, // 關閉日誌
                enableWorker: true, // WebWorker 解碼，降低主線程壓力
                // 點播播放不需要 LL-HLS，小緩衝在 Safari 高倍速下更容易抖動。
                lowLatencyMode: false,
                autoStartLoad: true,

                /* 緩衝/內存相關 - 根據用戶設置的緩衝策略動態調整 */
                maxBufferLength: bufferConfig.maxBufferLength, // 前向緩衝長度
                backBufferLength: bufferConfig.backBufferLength, // 已播放內容保留長度
                maxBufferSize: bufferConfig.maxBufferSize, // 最大緩衝大小

                /* 自定義loader */
                loader: loaderClass as any,
              });

              const kickStartHlsPlayback = () => {
                try {
                  hls.startLoad(-1);
                } catch (error) {
                  console.warn('[HLS] startLoad failed:', error);
                }

                if (!video.paused) {
                  video.play().catch((error) => {
                    console.warn('[HLS] play after attach failed:', error);
                  });
                }
              };

              hls.on(Hls.Events.MEDIA_ATTACHED, () => {
                kickStartHlsPlayback();
              });

              hls.loadSource(url);
              hls.attachMedia(video);
              video.hls = hls;

              if (isWebkit) {
                schedulePlayerTimeout(() => {
                  if (!shouldRescueWebkitHls(video)) {
                    return;
                  }

                  console.warn('[HLS] Safari attach watchdog triggered, forcing reattach');
                  try {
                    hls.detachMedia();
                    hls.attachMedia(video);
                    kickStartHlsPlayback();
                  } catch (error) {
                    console.warn('[HLS] Safari attach reattach failed:', error);
                  }
                }, 3000);
              }

              ensureVideoSource(video, url);

              // 額外確保 iOS 內聯播放屬性（防止全屏時使用系統播放器）
              video.setAttribute('playsinline', 'true');
              video.setAttribute('webkit-playsinline', 'true');
              (video as any).playsInline = true;
              (video as any).webkitPlaysInline = true;

              // 監聽Manifest加載完成事件，啟動xiaoya鏈接定時刷新
              hls.on(Hls.Events.MANIFEST_PARSED, () => {
                console.log('[HLS] Manifest解析完成');

                const player = artPlayerRef.current;
                if (video.paused && (player?.option.autoplay || player?.loading)) {
                  try {
                    Promise.resolve(player?.play?.()).catch((error) => {
                      console.warn('[HLS] play after manifest parsed failed:', error);
                    });
                  } catch (error) {
                    console.warn('[HLS] play after manifest parsed failed:', error);
                  }
                }

                // 只在首次加載時啟動定時器（後續刷新會在refreshXiaoyaUrl中啟動）
                if (isInitialLoadRef.current && currentXiaoyaUrlRef.current && url.includes('.m3u8')) {
                  isInitialLoadRef.current = false; // 標記已完成首次加載
                  startRefreshTimer(hls, video);
                }
              });

              hls.on(Hls.Events.ERROR, function (event: any, data: any) {
                console.error('HLS Error:', event, data);
                if (data.fatal) {
                  switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                      // 檢查是否是 manifest 加載錯誤（通常是 403/404/CORS 錯誤）
                      if (data.details === 'manifestLoadError') {
                        console.log('Manifest 加載失敗：可能是 403/404 或 CORS 錯誤');

                        const statusCode = data.response?.code || data.response?.status;

                        // 如果是403且是xiaoya源的m3u8，嘗試自動刷新
                        if (statusCode === 403 && currentXiaoyaUrlRef.current) {
                          const isM3u8 = url.includes('.m3u8') || url.includes('m3u8');
                          if (isM3u8) {
                            console.log('[HLS錯誤] 檢測到403，嘗試刷新鏈接');
                            refreshXiaoyaUrl(hls, video, false);
                            return; // 不執行後續的錯誤處理
                          }
                        }

                        // 原有的錯誤處理邏輯
                        hls.destroy();
                        if (statusCode === 403) {
                          setVideoError('訪問被拒絕 (403)');
                        } else if (statusCode === 404) {
                          setVideoError('視頻不存在 (404)');
                        } else if (statusCode === 415) {
                          setVideoError('視頻格式不兼容 (415)');
                        } else if (statusCode) {
                          setVideoError(`HTTP ${statusCode} 錯誤`);
                        } else {
                          // CORS 錯誤或其他網絡錯誤
                          // 如果是直鏈直連模式（URL 不含代理前綴），記錄原始 URL 以便用戶一鍵啟用代理
                          if (currentSourceRef.current === 'directplay' && !url.includes('/api/proxy-m3u8') && !url.includes('/api/proxy/vod/m3u8')) {
                            setCorsFailedUrl(url);
                          }
                          setVideoError('無法訪問視頻源（可能是跨域限制或訪問被拒絕）');
                        }
                        return;
                      }
                      // 檢查其他 HTTP 錯誤狀態碼
                      {
                        const statusCode = data.response?.code || data.response?.status;
                        if (statusCode && statusCode >= 400) {
                          console.log(`HTTP ${statusCode} 錯誤`);
                          hls.destroy();
                          setVideoError(`HTTP ${statusCode} 錯誤`);
                          return;
                        }
                      }
                      console.log('網絡錯誤，嘗試恢復...');
                      hls.startLoad();
                      break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                      console.log('媒體錯誤，嘗試恢復...');
                      hls.recoverMediaError();
                      break;
                    default:
                      console.log('無法恢復的錯誤');
                      hls.destroy();
                      setVideoError('視頻加載錯誤');
                      break;
                  }
                }
              });
            },
          },
          // 彈幕插件
          plugins: [
            artplayerPluginDanmuku({
              danmuku: [],
              speed: danmakuSettingsRef.current.speed,
              opacity: danmakuSettingsRef.current.opacity,
              fontSize: danmakuSettingsRef.current.fontSize,
              color: '#FFFFFF',
              mode: 0,
              margin: [danmakuSettingsRef.current.marginTop, danmakuSettingsRef.current.marginBottom],
              antiOverlap: true,
              synchronousPlayback: danmakuSettingsRef.current.synchronousPlayback,
              emitter: false,
              heatmap: false, // 禁用 artplayer 自帶熱力圖，使用自定義熱力圖
              // 主題
              theme: 'dark',
              // 根據保存的顯示狀態設置初始可見性
              visible: danmakuDisplayStateRef.current,
              filter: (danmu: any) => {
                // 應用過濾規則
                const filterConfig = danmakuFilterConfigRef.current;
                if (filterConfig && filterConfig.rules.length > 0) {
                  for (const rule of filterConfig.rules) {
                    // 跳過未啟用的規則
                    if (!rule.enabled) continue;

                    try {
                      if (rule.type === 'normal') {
                        // 普通模式：字符串包含匹配
                        if (danmu.text.includes(rule.keyword)) {
                          return false;
                        }
                      } else if (rule.type === 'regex') {
                        // 正則模式：正則表達式匹配
                        if (new RegExp(rule.keyword).test(danmu.text)) {
                          return false;
                        }
                      }
                    } catch (e) {
                      console.error('彈幕過濾規則錯誤:', e);
                    }
                  }
                }
                return true;
              },
            }),
          ],
          icons: {
            loading:
              '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
          },
          settings: [
            {
              html: '去廣告',
              icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
              tooltip: blockAdEnabled ? '已開啟' : '已關閉',
              onClick() {
                const newVal = !blockAdEnabled;
                try {
                  localStorage.setItem('enable_blockad', String(newVal));
                  if (artPlayerRef.current) {
                    resumeTimeRef.current = artPlayerRef.current.currentTime;
                    if (
                      artPlayerRef.current.video &&
                      artPlayerRef.current.video.hls
                    ) {
                      artPlayerRef.current.video.hls.destroy();
                    }
                    artPlayerRef.current.destroy();
                    artPlayerRef.current = null;
                  }
                  setBlockAdEnabled(newVal);
                } catch (_) {
                  // ignore
                }
                return newVal ? '當前開啟' : '當前關閉';
              },
            },
            {
              html: '彈幕過濾',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="#ffffff"/><path d="M8 12h8" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/></svg>',
              tooltip: '配置彈幕過濾規則',
              onClick() {
                // 如果播放器處於全屏狀態，先退出全屏
                if (artPlayerRef.current && artPlayerRef.current.fullscreen) {
                  artPlayerRef.current.fullscreen = false;
                  // 延遲一下再顯示彈窗，確保全屏退出動畫完成
                  setTimeout(() => {
                    setShowDanmakuFilterSettings(true);
                  }, 300);
                } else {
                  setShowDanmakuFilterSettings(true);
                }
                return '打開設置';
              },
            },
            // 熱力圖開關（僅在未禁用時顯示）
            ...(!danmakuHeatmapDisabledRef.current ? [{
              name: '彈幕熱力',
              html: '彈幕熱力',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" fill="#ffffff"/></svg>',
              switch: danmakuHeatmapEnabledRef.current,
              onSwitch: function (item: any) {
                const newVal = !item.switch;
                try {
                  localStorage.setItem('danmaku_heatmap_enabled', String(newVal));
                  setDanmakuHeatmapEnabled(newVal);
                  console.log('彈幕熱力已', newVal ? '開啟' : '關閉');
                } catch (err) {
                  console.error('切換彈幕熱力失敗:', err);
                }
                return newVal;
              },
            }] : []),
            ...(webGPUSupported ? [
              {
                name: 'Anime4K超分',
                html: 'Anime4K超分',
                icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 18c-4 0-7-3-7-7V9l7-3.5L19 9v4c0 4-3 7-7 7z" fill="#ffffff"/><path d="M10 12l2 2 4-4" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
                switch: anime4kEnabledRef.current,
                onSwitch: async function (item: any) {
                  const newVal = !item.switch;
                  await toggleAnime4K(newVal);
                  return newVal;
                },
              },
              {
                name: '超分模式',
                html: '超分模式',
                selector: [
                  {
                    html: 'ModeA (快速)',
                    value: 'ModeA',
                    default: anime4kModeRef.current === 'ModeA',
                  },
                  {
                    html: 'ModeB (平衡)',
                    value: 'ModeB',
                    default: anime4kModeRef.current === 'ModeB',
                  },
                  {
                    html: 'ModeC (質量)',
                    value: 'ModeC',
                    default: anime4kModeRef.current === 'ModeC',
                  },
                  {
                    html: 'ModeAA (增強快速)',
                    value: 'ModeAA',
                    default: anime4kModeRef.current === 'ModeAA',
                  },
                  {
                    html: 'ModeBB (增強平衡)',
                    value: 'ModeBB',
                    default: anime4kModeRef.current === 'ModeBB',
                  },
                  {
                    html: 'ModeCA (最高質量)',
                    value: 'ModeCA',
                    default: anime4kModeRef.current === 'ModeCA',
                  },
                ],
                onSelect: async function (item: any) {
                  await changeAnime4KMode(item.value);
                  return item.html;
                },
              },
              {
                name: '超分倍數',
                html: '超分倍數',
                selector: [
                  {
                    html: '1.5x',
                    value: '1.5',
                    default: anime4kScaleRef.current === 1.5,
                  },
                  {
                    html: '2.0x',
                    value: '2.0',
                    default: anime4kScaleRef.current === 2.0,
                  },
                  {
                    html: '3.0x',
                    value: '3.0',
                    default: anime4kScaleRef.current === 3.0,
                  },
                  {
                    html: '4.0x',
                    value: '4.0',
                    default: anime4kScaleRef.current === 4.0,
                  },
                ],
                onSelect: async function (item: any) {
                  await changeAnime4KScale(parseFloat(item.value));
                  return item.html;
                },
              }
            ] : []),
            {
              name: '跳過片頭片尾',
              html: '跳過片頭片尾',
              switch: skipConfigRef.current.enable,
              onSwitch: function (item) {
                const newConfig = {
                  ...skipConfigRef.current,
                  enable: !item.switch,
                };
                handleSkipConfigChange(newConfig);
                return !item.switch;
              },
            },
            {
              name: '跳過配置',
              html: '跳過配置',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
              tooltip:
                skipConfigRef.current.intro_time === 0 && skipConfigRef.current.outro_time === 0
                  ? '設置跳過配置'
                  : `片頭: ${formatTime(skipConfigRef.current.intro_time)} | 片尾: ${formatTime(Math.abs(skipConfigRef.current.outro_time))}`,
              onClick: async function () {
                const player = artPlayerRef.current;
                if (player) {
                  // 如果處於全屏狀態，先退出全屏
                  if (player.fullscreen) {
                    player.fullscreen = false;
                    // 等待全屏退出動畫完成
                    await new Promise(resolve => setTimeout(resolve, 300));
                  }

                  // 使用 ArtPlayer 的 prompt 功能創建輸入彈窗
                  const currentIntro = skipConfigRef.current.intro_time || 0;
                  const currentOutro = Math.abs(skipConfigRef.current.outro_time) || 0;

                  // 創建一個自定義的提示框
                  const container = document.createElement('div');
                  container.style.cssText = `
                  position: fixed;
                  top: 50%;
                  left: 50%;
                  transform: translate(-50%, -50%);
                  background: rgba(0, 0, 0, 0.9);
                  padding: 20px;
                  border-radius: 8px;
                  z-index: 9999;
                  min-width: 300px;
                  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
                `;

                  container.innerHTML = `
                  <div style="color: white; margin-bottom: 15px; font-size: 16px; font-weight: bold; border-bottom: 1px solid #444; padding-bottom: 10px;">
                    跳過配置
                  </div>
                  <div style="color: #aaa; font-size: 13px; margin-bottom: 15px; line-height: 1.5;">
                    設置片頭片尾跳過時間，到達時間自動跳過
                  </div>
                  <div style="margin-bottom: 10px;">
                    <label style="color: white; display: block; margin-bottom: 5px; font-size: 14px; font-weight: 500;">
                      片頭時間 (秒)
                      <span style="color: #888; font-size: 12px; font-weight: normal; margin-left: 8px;">從視頻開始跳過的時長</span>
                    </label>
                    <div style="display: flex; gap: 8px;">
                      <input id="intro-input" type="number" min="0" step="1" value="${currentIntro}" placeholder="如: 90"
                             style="flex: 1; padding: 8px; border-radius: 4px; border: 1px solid #444; background: #222; color: white; font-size: 14px;" />
                      <button id="set-intro-btn" style="padding: 8px 12px; border-radius: 4px; border: none; background: #007bff; color: white; cursor: pointer; font-size: 14px; white-space: nowrap;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 4px;">
                          <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2"/>
                          <path d="M12 6v6l4 4" stroke="white" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                        當前時間
                      </button>
                    </div>
                  </div>
                  <div style="margin-bottom: 15px;">
                    <label style="color: white; display: block; margin-bottom: 5px; font-size: 14px; font-weight: 500;">
                      片尾時間 (秒)
                      <span style="color: #888; font-size: 12px; font-weight: normal; margin-left: 8px;">從視頻結尾向前跳過的時長</span>
                    </label>
                    <div style="display: flex; gap: 8px;">
                      <input id="outro-input" type="number" min="0" step="1" value="${currentOutro}" placeholder="如: 120"
                             style="flex: 1; padding: 8px; border-radius: 4px; border: 1px solid #444; background: #222; color: white; font-size: 14px;" />
                      <button id="set-outro-btn" style="padding: 8px 12px; border-radius: 4px; border: none; background: #007bff; color: white; cursor: pointer; font-size: 14px; white-space: nowrap;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 4px;">
                          <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2"/>
                          <path d="M12 6v6l4 4" stroke="white" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                        當前時間
                      </button>
                    </div>
                  </div>
                  <div style="background: rgba(0, 123, 255, 0.1); border-left: 3px solid #007bff; padding: 10px; margin-bottom: 15px; border-radius: 4px;">
                    <div style="color: #88c0ff; font-size: 12px; line-height: 1.6;">
                      <div style="margin-bottom: 4px;">💡 <strong>提示：</strong></div>
                      <div>• 點擊"當前時間"可快速設置為播放位置</div>
                      <div>• 片頭90秒錶示跳過前1分30秒</div>
                      <div>• 片尾120秒錶示跳過最後2分鐘</div>
                    </div>
                  </div>
                  <div style="display: flex; gap: 10px; justify-content: flex-end; border-top: 1px solid #444; padding-top: 15px;">
                    <button id="cancel-btn" style="padding: 8px 16px; border-radius: 4px; border: none; background: #444; color: white; cursor: pointer; font-size: 14px; transition: background 0.2s;" onmouseover="this.style.background='#555'" onmouseout="this.style.background='#444'">取消</button>
                    <button id="clear-btn" style="padding: 8px 16px; border-radius: 4px; border: none; background: #d9534f; color: white; cursor: pointer; font-size: 14px; transition: background 0.2s;" onmouseover="this.style.background='#c9302c'" onmouseout="this.style.background='#d9534f'">清除</button>
                    <button id="confirm-btn" style="padding: 8px 16px; border-radius: 4px; border: none; background: #5cb85c; color: white; cursor: pointer; font-size: 14px; transition: background 0.2s;" onmouseover="this.style.background='#4cae4c'" onmouseout="this.style.background='#5cb85c'">確定</button>
                  </div>
                `;

                  document.body.appendChild(container);

                  const introInput = container.querySelector('#intro-input') as HTMLInputElement;
                  const outroInput = container.querySelector('#outro-input') as HTMLInputElement;
                  const setIntroBtn = container.querySelector('#set-intro-btn');
                  const setOutroBtn = container.querySelector('#set-outro-btn');
                  const cancelBtn = container.querySelector('#cancel-btn');
                  const clearBtn = container.querySelector('#clear-btn');
                  const confirmBtn = container.querySelector('#confirm-btn');

                  const cleanup = () => {
                    document.body.removeChild(container);
                  };

                  // 設置片頭為當前時間
                  setIntroBtn?.addEventListener('click', () => {
                    const currentTime = player.currentTime || 0;
                    if (currentTime > 0) {
                      introInput.value = Math.floor(currentTime).toString();
                    }
                  });

                  // 設置片尾為當前時間到結束的時長
                  setOutroBtn?.addEventListener('click', () => {
                    if (player.duration && player.currentTime) {
                      const outroTime = player.duration - player.currentTime;
                      if (outroTime > 0) {
                        outroInput.value = Math.floor(outroTime).toString();
                      }
                    }
                  });

                  cancelBtn?.addEventListener('click', cleanup);

                  clearBtn?.addEventListener('click', () => {
                    handleSkipConfigChange({
                      enable: false,
                      intro_time: 0,
                      outro_time: 0,
                    });
                    cleanup();
                  });

                  confirmBtn?.addEventListener('click', () => {
                    const introTime = parseFloat(introInput.value) || 0;
                    const outroTime = parseFloat(outroInput.value) || 0;

                    const newConfig = {
                      ...skipConfigRef.current,
                      intro_time: introTime,
                      outro_time: outroTime > 0 ? -outroTime : 0,
                    };

                    handleSkipConfigChange(newConfig);
                    cleanup();
                  });

                  // 支持 Enter 鍵確認
                  const handleEnter = (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                      confirmBtn?.dispatchEvent(new Event('click'));
                    } else if (e.key === 'Escape') {
                      cancelBtn?.dispatchEvent(new Event('click'));
                    }
                  };

                  introInput.addEventListener('keydown', handleEnter);
                  outroInput.addEventListener('keydown', handleEnter);
                }
                return '';
              },
            },
          ],
          // 控制欄配置
          controls: [
            {
              position: 'left',
              index: 13,
              html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
              tooltip: '播放下一集',
              click: function () {
                // 房員禁用下一集按鈕
                if (playSync.shouldDisableControls) {
                  if (artPlayerRef.current) {
                    artPlayerRef.current.notice.show = '房員無法切換集數，請等待房主操作';
                  }
                  return;
                }
                handleNextEpisode();
              },
            },
            // iOS 設備上添加自定義全屏按鈕（橫屏和豎屏都顯示）
            ...(isIOS ? [{
              position: 'right',
              index: 100,  // 大數字確保在設置按鈕右邊
              html: '<i class="art-icon ios-portrait-fullscreen"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" fill="currentColor"/></svg></i>',
              tooltip: '全屏',
              style: {
                color: '#fff',
              },
              mounted: function ($el: HTMLElement) {
                // 添加 CSS 樣式：橫屏和豎屏都顯示
                const style = document.createElement('style');
                style.textContent = `
                /* iOS 自定義全屏按鈕在所有方向都顯示 */
                .ios-portrait-fullscreen {
                  display: inline-flex !important;
                }
                /* iOS 全屏選擇對話框樣式（遵循項目統一風格） */
                .ios-fullscreen-dialog {
                  position: fixed;
                  top: 0;
                  left: 0;
                  right: 0;
                  bottom: 0;
                  background: rgba(0, 0, 0, 0.6);
                  backdrop-filter: blur(4px);
                  z-index: 1000;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 16px;
                }
                .ios-fullscreen-dialog-content {
                  background: white;
                  border-radius: 16px;
                  max-width: 480px;
                  width: 100%;
                  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                  overflow: hidden;
                }
                .dark .ios-fullscreen-dialog-content {
                  background: rgb(31, 41, 55);
                }

                /* 標題欄 */
                .ios-fullscreen-dialog-header {
                  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
                  padding: 20px 24px;
                }
                .ios-fullscreen-dialog-title {
                  font-size: 20px;
                  font-weight: 700;
                  color: white;
                  display: flex;
                  align-items: center;
                  gap: 10px;
                  margin-bottom: 6px;
                }
                .ios-fullscreen-dialog-title svg {
                  stroke: white;
                }
                .ios-fullscreen-dialog-subtitle {
                  font-size: 14px;
                  color: rgba(255, 255, 255, 0.9);
                  margin: 0;
                }

                /* 選項列表 */
                .ios-fullscreen-dialog-options {
                  padding: 16px;
                  display: flex;
                  flex-direction: column;
                  gap: 12px;
                }
                .ios-fullscreen-option {
                  display: flex;
                  align-items: center;
                  gap: 16px;
                  padding: 16px;
                  background: rgb(249, 250, 251);
                  border: 2px solid transparent;
                  border-radius: 12px;
                  cursor: pointer;
                  transition: all 0.2s;
                  text-align: left;
                }
                .dark .ios-fullscreen-option {
                  background: rgba(55, 65, 81, 0.5);
                }
                .ios-fullscreen-option:hover {
                  background: rgb(243, 244, 246);
                  border-color: #22c55e;
                  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.15);
                }
                .dark .ios-fullscreen-option:hover {
                  background: rgb(55, 65, 81);
                }
                .ios-fullscreen-option:active {
                  transform: scale(0.98);
                }

                /* 推薦選項 */
                .ios-fullscreen-option-recommended {
                  border-color: #22c55e;
                }

                /* 選項圖標 */
                .ios-fullscreen-option-icon {
                  flex-shrink: 0;
                  width: 48px;
                  height: 48px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  background: white;
                  border-radius: 10px;
                  color: #22c55e;
                }
                .dark .ios-fullscreen-option-icon {
                  background: rgb(31, 41, 55);
                }
                .ios-fullscreen-option-recommended .ios-fullscreen-option-icon {
                  background: #22c55e;
                  color: white;
                }

                /* 選項內容 */
                .ios-fullscreen-option-content {
                  flex: 1;
                }
                .ios-fullscreen-option-title {
                  font-size: 16px;
                  font-weight: 600;
                  color: rgb(17, 24, 39);
                  margin-bottom: 4px;
                  display: flex;
                  align-items: center;
                  gap: 8px;
                }
                .dark .ios-fullscreen-option-title {
                  color: white;
                }
                .ios-fullscreen-option-badge {
                  display: inline-block;
                  padding: 2px 8px;
                  background: #22c55e;
                  color: white;
                  font-size: 12px;
                  font-weight: 500;
                  border-radius: 4px;
                }
                .ios-fullscreen-option-desc {
                  font-size: 13px;
                  color: rgb(107, 114, 128);
                  line-height: 1.4;
                }
                .dark .ios-fullscreen-option-desc {
                  color: rgb(156, 163, 175);
                }

                /* 箭頭圖標 */
                .ios-fullscreen-option-arrow {
                  flex-shrink: 0;
                  color: rgb(209, 213, 219);
                  transition: transform 0.2s;
                }
                .dark .ios-fullscreen-option-arrow {
                  color: rgb(75, 85, 99);
                }
                .ios-fullscreen-option:hover .ios-fullscreen-option-arrow {
                  transform: translateX(4px);
                  color: #22c55e;
                }

                /* 底部提示 */
                .ios-fullscreen-dialog-footer {
                  padding: 16px 24px;
                  background: rgb(249, 250, 251);
                  border-top: 1px solid rgb(229, 231, 235);
                  display: flex;
                  align-items: flex-start;
                  gap: 10px;
                  font-size: 12px;
                  color: rgb(107, 114, 128);
                  line-height: 1.5;
                }
                .dark .ios-fullscreen-dialog-footer {
                  background: rgba(17, 24, 39, 0.5);
                  border-top-color: rgb(55, 65, 81);
                  color: rgb(156, 163, 175);
                }
                .ios-fullscreen-dialog-footer svg {
                  flex-shrink: 0;
                  margin-top: 2px;
                  stroke: currentColor;
                }
              `;
                document.head.appendChild(style);
              },
              click: function () {
                if (!artPlayerRef.current) return;

                // 檢測是否在 PWA 模式下
                const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                  window.matchMedia('(display-mode: fullscreen)').matches ||
                  (window.navigator as any).standalone === true;

                // 檢查是否已經在原生全屏狀態
                const isInNativeFullscreen = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);

                // 如果已經在原生全屏狀態，退出原生全屏
                if (isInNativeFullscreen) {
                  const exitFullscreen = (document as any).exitFullscreen ||
                    (document as any).webkitExitFullscreen ||
                    (document as any).mozCancelFullScreen ||
                    (document as any).msExitFullscreen;
                  if (exitFullscreen) {
                    try {
                      const result = exitFullscreen.call(document);
                      if (result && typeof result.catch === 'function') {
                        result.catch((err: Error) => console.error('退出全屏失敗:', err));
                      }
                    } catch (err) {
                      console.error('退出全屏失敗:', err);
                    }
                  }
                  return;
                }

                // 如果已經在網頁全屏狀態，退出網頁全屏
                if (artPlayerRef.current.fullscreenWeb) {
                  artPlayerRef.current.fullscreenWeb = false;
                  return;
                }

                // 如果在 PWA 模式下，直接使用容器全屏（可以隱藏狀態欄）
                if (isPWA) {
                  const container = artPlayerRef.current.template.$container;
                  if (container && container.webkitEnterFullscreen) {
                    container.webkitEnterFullscreen().catch((err: Error) => {
                      console.error('PWA 全屏失敗:', err);
                      // 如果失敗，降級使用網頁全屏
                      artPlayerRef.current.fullscreenWeb = true;
                    });
                  } else {
                    // 不支持原生全屏，使用網頁全屏
                    artPlayerRef.current.fullscreenWeb = true;
                  }
                  return;
                }

                // 非 PWA 模式：創建對話框（使用項目統一風格）
                const dialog = document.createElement('div');
                dialog.className = 'ios-fullscreen-dialog';
                dialog.innerHTML = `
                <div class="ios-fullscreen-dialog-content">
                  <!-- 標題欄 -->
                  <div class="ios-fullscreen-dialog-header">
                    <h3 class="ios-fullscreen-dialog-title">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" stroke="currentColor" stroke-width="2" fill="none"/>
                      </svg>
                      選擇全屏模式
                    </h3>
                    <p class="ios-fullscreen-dialog-subtitle">
                      由於 iOS 系統限制，原生全屏會使用系統播放器，將無法顯示彈幕及使用部分播放器功能。網頁全屏可能無法完全佔滿屏幕，但可保留所有功能。
                    </p>
                  </div>

                  <!-- 選項列表 -->
                  <div class="ios-fullscreen-dialog-options">
                    <!-- 網頁全屏選項 -->
                    <button class="ios-fullscreen-option ios-fullscreen-option-recommended" data-action="web">
                      <div class="ios-fullscreen-option-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
                          <path d="M7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z" fill="currentColor"/>
                        </svg>
                      </div>
                      <div class="ios-fullscreen-option-content">
                        <div class="ios-fullscreen-option-title">
                          網頁全屏
                          <span class="ios-fullscreen-option-badge">推薦</span>
                        </div>
                        <div class="ios-fullscreen-option-desc">
                          保留彈幕、控制欄等所有功能
                        </div>
                      </div>
                      <svg class="ios-fullscreen-option-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                      </svg>
                    </button>

                    <!-- 原生全屏選項 -->
                    <button class="ios-fullscreen-option" data-action="native">
                      <div class="ios-fullscreen-option-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" stroke="currentColor" stroke-width="2"/>
                        </svg>
                      </div>
                      <div class="ios-fullscreen-option-content">
                        <div class="ios-fullscreen-option-title">
                          原生全屏
                        </div>
                        <div class="ios-fullscreen-option-desc">
                          使用系統播放器，部分功能不可用
                        </div>
                      </div>
                      <svg class="ios-fullscreen-option-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                      </svg>
                    </button>
                  </div>

                  <!-- 底部提示 -->
                  <div class="ios-fullscreen-dialog-footer">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                      <path d="M12 16v-4m0-4h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    <span>將網站添加到主屏幕（PWA）後，網頁全屏可以完全全屏</span>
                  </div>
                </div>
              `;

                // 添加到頁面
                document.body.appendChild(dialog);

                // 點擊背景關閉
                dialog.addEventListener('click', (e) => {
                  if (e.target === dialog) {
                    document.body.removeChild(dialog);
                  }
                });

                // 按鈕點擊事件
                const buttons = dialog.querySelectorAll('.ios-fullscreen-option');
                buttons.forEach(button => {
                  button.addEventListener('click', () => {
                    const action = button.getAttribute('data-action');

                    if (action === 'web') {
                      // 網頁全屏
                      if (artPlayerRef.current) {
                        artPlayerRef.current.fullscreenWeb = true;
                      }
                    } else if (action === 'native') {
                      // 原生全屏（嘗試使用瀏覽器的全屏 API）
                      if (artPlayerRef.current && artPlayerRef.current.template.$video) {
                        const videoElement = artPlayerRef.current.template.$video;
                        if (videoElement.requestFullscreen) {
                          videoElement.requestFullscreen();
                        } else if ((videoElement as any).webkitEnterFullscreen) {
                          (videoElement as any).webkitEnterFullscreen();
                        }
                      }
                    }

                    // 關閉對話框
                    document.body.removeChild(dialog);
                  });
                });
              },
            }] : []),
          ],
        });

        artPlayerRef.current.on('destroy', () => {
          clearPlayerTimeouts();
        });

        // 監聽播放器事件
        artPlayerRef.current.on('ready', async () => {
          setError(null);

          rescueWebkitHlsBootstrap('player-ready');

          // 標記播放器已就緒，觸發 usePlaySync 設置事件監聽器
          setPlayerReady(true);
          console.log('[PlayPage] Player ready, triggering sync setup');

          // 應用進度條圖標配置 - 儘早執行
          const applyProgressThumbConfig = () => {
            try {
              const config = (window as any).RUNTIME_CONFIG;

              if (!config || config.PROGRESS_THUMB_TYPE === 'default') {
                // 使用默認樣式，移除自定義樣式
                const oldStyle = document.getElementById('custom-progress-thumb-style');
                if (oldStyle) oldStyle.remove();
                return;
              }

              let thumbUrl = '';
              let thumbColor = '#22c55e'; // 默認綠色

              if (config.PROGRESS_THUMB_TYPE === 'preset' && config.PROGRESS_THUMB_PRESET_ID) {
                const presetConfig: Record<string, { url: string; color: string }> = {
                  renako: { url: '/icons/q/renako.png', color: '#ec4899' }, // 粉色
                  irena: { url: '/icons/q/irena.png', color: '#f8fafc' }, // 雪白色
                  emilia: { url: '/icons/q/emilia.png', color: '#f8fafc' }, // 雪白色
                };
                const preset = presetConfig[config.PROGRESS_THUMB_PRESET_ID];
                if (preset) {
                  thumbUrl = preset.url;
                  thumbColor = preset.color;
                }
              } else if (config.PROGRESS_THUMB_TYPE === 'custom' && config.PROGRESS_THUMB_CUSTOM_URL) {
                thumbUrl = config.PROGRESS_THUMB_CUSTOM_URL;
              }

              // 修改 ArtPlayer 的主題色
              if (artPlayerRef.current) {
                artPlayerRef.current.theme = thumbColor;
              }

              if (thumbUrl) {
                // 根據預設ID確定尺寸
                let width = '30px';
                let height = '30px';
                let marginLeft = '-15px';

                // renako 圖標特殊處理（288x404比例，放大1.25倍）
                if (config.PROGRESS_THUMB_TYPE === 'preset' && config.PROGRESS_THUMB_PRESET_ID === 'renako') {
                  width = '26.875px'; // 21.5 * 1.25
                  height = '37.5px'; // 30 * 1.25
                  marginLeft = '-13.4375px'; // 10.75 * 1.25
                }

                // 動態設置背景圖片
                const style = document.createElement('style');
                style.id = 'custom-progress-thumb-style';
                style.textContent = `
                /* 替換默認的進度條圓點為自定義圖標 */
                .art-video-player .art-progress-indicator {
                  width: ${width} !important;
                  height: ${height} !important;
                  background-image: url('${thumbUrl}') !important;
                  background-size: contain !important;
                  background-repeat: no-repeat !important;
                  background-position: center !important;
                  background-color: transparent !important;
                  border-radius: 0 !important;
                  margin-left: ${marginLeft} !important;
                }
              `;

                // 移除舊樣式
                const oldStyle = document.getElementById('custom-progress-thumb-style');
                if (oldStyle) oldStyle.remove();

                document.head.appendChild(style);
              }
            } catch (error) {
              console.error('[進度條圖標] 應用配置失敗:', error);
            }
          };

          applyProgressThumbConfig();

          // 添加字幕切換功能
          const currentSubtitles = detailRef.current?.subtitles?.[currentEpisodeIndex] || [];
          if (currentSubtitles.length > 0 && artPlayerRef.current) {
            const subtitleOptions = [
              {
                html: '關閉',
                url: '',
              },
              ...currentSubtitles.map((sub: any) => ({
                html: sub.label,
                url: sub.url,
              })),
            ];

            artPlayerRef.current.setting.add({
              html: '字幕',
              selector: subtitleOptions,
              onSelect: function (item: any) {
                if (artPlayerRef.current) {
                  if (item.url === '') {
                    // 關閉字幕
                    artPlayerRef.current.subtitle.show = false;
                  } else {
                    // 切換字幕
                    artPlayerRef.current.subtitle.switch(item.url, {
                      name: item.html,
                    });
                    artPlayerRef.current.subtitle.show = true;
                  }
                }
                return item.html;
              },
            });
          }

          // 添加字幕大小設置
          if (artPlayerRef.current) {
            const savedSubtitleSize = typeof window !== 'undefined' ? localStorage.getItem('subtitleSize') || '2em' : '2em';
            const defaultOption = savedSubtitleSize === '1em' ? '小' : savedSubtitleSize === '3em' ? '大' : savedSubtitleSize === '4em' ? '超大' : '中';

            artPlayerRef.current.setting.add({
              html: '字幕大小',
              selector: [
                { html: '小', size: '1em' },
                { html: '中', size: '2em' },
                { html: '大', size: '3em' },
                { html: '超大', size: '4em' },
              ],
              onSelect: function (item: any) {
                if (artPlayerRef.current) {
                  artPlayerRef.current.subtitle.style({
                    fontSize: item.size,
                  });
                  // 保存到 localStorage
                  if (typeof window !== 'undefined') {
                    localStorage.setItem('subtitleSize', item.size);
                  }
                }
                return item.html;
              },
              default: defaultOption,
            });
          }

          // 控制截圖按鈕在小屏幕豎屏時隱藏
          const updateScreenshotVisibility = () => {
            const screenshotBtn = document.querySelector('.art-control-screenshot') as HTMLElement;
            if (screenshotBtn) {
              const isPortrait = window.innerHeight > window.innerWidth;
              const isSmallScreen = window.innerWidth < 768;
              screenshotBtn.style.display = (isPortrait && isSmallScreen) ? 'none' : '';
            }
          };
          updateScreenshotVisibility();
          window.addEventListener('resize', updateScreenshotVisibility);
          artPlayerRef.current.on('fullscreen', updateScreenshotVisibility);
          artPlayerRef.current.on('fullscreenWeb', updateScreenshotVisibility);

          // iOS 設備：動態調整彈幕設置面板位置，避免被遮擋
          if (isIOS && artPlayerRef.current) {
            // 使用 MutationObserver 監聽彈幕設置面板的顯示
            let isAdjusting = false; // 防止重複調整的標記
            const observer = new MutationObserver(() => {
              if (isAdjusting) return; // 如果正在調整，跳過

              const panel = document.querySelector('.apd-config-panel') as HTMLElement;
              if (panel && panel.style.display !== 'none') {
                // 獲取當前的 left 值
                const currentLeft = parseInt(panel.style.left || '0', 10);

                // 如果 left 值異常小（iOS 上只有 -5px），調整為正常值（-246px，比標準位置再往左 100px）
                if (currentLeft > -50) {
                  isAdjusting = true; // 設置標記，防止重複觸發
                  const adjustedLeft = -246;
                  panel.style.left = `${adjustedLeft}px`;
                  console.log('[iOS] 已調整彈幕設置面板位置: 從', currentLeft, '調整為', adjustedLeft);

                  // 延遲重置標記
                  setTimeout(() => {
                    isAdjusting = false;
                  }, 100);
                }
              }
            });

            // 監聽整個播放器容器的 DOM 變化
            if (artRef.current) {
              observer.observe(artRef.current, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class']
              });
            }

            // 清理函數
            artPlayerRef.current.on('destroy', () => {
              observer.disconnect();
            });
          }

          // iOS 設備：監聽屏幕方向變化，自動調整全屏狀態
          if (isIOS && artPlayerRef.current) {
            const handleOrientationChange = () => {
              if (!artPlayerRef.current) return;

              // 獲取當前屏幕方向
              const isLandscape = window.matchMedia('(orientation: landscape)').matches;
              const isPortrait = window.matchMedia('(orientation: portrait)').matches;

              console.log('[iOS] 屏幕方向變化:', {
                isLandscape,
                isPortrait,
                fullscreenWeb: artPlayerRef.current.fullscreenWeb
              });

              // 如果在網頁全屏狀態下旋轉到橫屏，切換到正常全屏
              if (artPlayerRef.current.fullscreenWeb && isLandscape) {
                console.log('[iOS] 橫屏模式：從網頁全屏切換到正常全屏');
                // 先退出網頁全屏
                artPlayerRef.current.fullscreenWeb = false;
                // 延遲一下再進入正常全屏，確保佈局已更新
                setTimeout(() => {
                  if (artPlayerRef.current) {
                    artPlayerRef.current.fullscreenWeb = true;
                  }
                }, 100);
              }
            };

            // 監聽屏幕方向變化
            window.addEventListener('orientationchange', handleOrientationChange);
            // 也監聽 resize 事件（某些設備上更可靠）
            window.addEventListener('resize', handleOrientationChange);

            // 清理函數
            artPlayerRef.current.on('destroy', () => {
              window.removeEventListener('orientationchange', handleOrientationChange);
              window.removeEventListener('resize', handleOrientationChange);
            });
          }

          // 從 art.storage 讀取彈幕設置並應用
          if (artPlayerRef.current) {
            const storedDanmakuSettings = artPlayerRef.current.storage.get('danmaku_settings');
            if (storedDanmakuSettings) {
              // 合併存儲的設置到當前設置
              const mergedSettings = {
                ...danmakuSettingsRef.current,
                ...storedDanmakuSettings,
              };
              setDanmakuSettings(mergedSettings);
              saveDanmakuSettings(mergedSettings);
            }
          }

          // 保存彈幕插件引用
          if (artPlayerRef.current?.plugins?.artplayerPluginDanmuku) {
            danmakuPluginRef.current = artPlayerRef.current.plugins.artplayerPluginDanmuku;

            // 監聽彈幕配置變化事件
            artPlayerRef.current.on('artplayerPluginDanmuku:config', () => {
              if (danmakuPluginRef.current?.option) {
                const newSettings = {
                  ...danmakuSettingsRef.current,
                  opacity: danmakuPluginRef.current.option.opacity || danmakuSettingsRef.current.opacity,
                  fontSize: danmakuPluginRef.current.option.fontSize || danmakuSettingsRef.current.fontSize,
                  speed: danmakuPluginRef.current.option.speed || danmakuSettingsRef.current.speed,
                  marginTop: (danmakuPluginRef.current.option.margin && danmakuPluginRef.current.option.margin[0]) ?? danmakuSettingsRef.current.marginTop,
                  marginBottom: (danmakuPluginRef.current.option.margin && danmakuPluginRef.current.option.margin[1]) ?? danmakuSettingsRef.current.marginBottom,
                };

                // 保存到 localStorage 和 art.storage
                setDanmakuSettings(newSettings);
                saveDanmakuSettings(newSettings);
                if (artPlayerRef.current?.storage) {
                  artPlayerRef.current.storage.set('danmaku_settings', newSettings);
                }

                console.log('彈幕設置已更新並保存:', newSettings);
              }
            });

            // 自動搜索並加載彈幕
            await autoSearchDanmaku();


            if (artPlayerRef.current) {
              // 監聽彈幕顯示/隱藏事件，保存開關狀態到 localStorage
              artPlayerRef.current.on('artplayerPluginDanmuku:show', () => {
                danmakuDisplayStateRef.current = true;
                saveDanmakuDisplayState(true);
              });

              artPlayerRef.current.on('artplayerPluginDanmuku:hide', () => {
                danmakuDisplayStateRef.current = false;
                saveDanmakuDisplayState(false);
              });
            }

          }

          // 播放器就緒後，如果正在播放則請求 Wake Lock
          if (artPlayerRef.current && !artPlayerRef.current.paused) {
            requestWakeLock();
          }
        });

        // 監聽播放狀態變化，控制 Wake Lock
        artPlayerRef.current.on('play', () => {
          requestWakeLock();
        });

        artPlayerRef.current.on('pause', () => {
          releaseWakeLock();
          saveCurrentPlayProgress();
        });

        artPlayerRef.current.on('video:ended', () => {
          releaseWakeLock();
        });

        // 如果播放器初始化時已經在播放狀態，則請求 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }

        artPlayerRef.current.on('video:volumechange', () => {
          lastVolumeRef.current = artPlayerRef.current.volume;
        });
        artPlayerRef.current.on('video:ratechange', () => {
          const currentRate = artPlayerRef.current.playbackRate;
          const shouldIgnoreSafariReset =
            isWebkit &&
            Date.now() < playbackRateRestoreWindowUntilRef.current &&
            Math.abs(currentRate - 1) < 0.01 &&
            lastPlaybackRateRef.current > 1;

          if (shouldIgnoreSafariReset) {
            // Safari 切集後可能偷偷回到 1x，這不是用戶真實選擇，不要覆蓋記憶值。
            schedulePlayerTimeout(() => {
              if (
                artPlayerRef.current &&
                Math.abs(
                  artPlayerRef.current.playbackRate - lastPlaybackRateRef.current
                ) > 0.01
              ) {
                artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
              }
            }, 0);
            syncPlaybackPitch();
            return;
          }

          lastPlaybackRateRef.current = currentRate;
          persistPlaybackRate(currentRate);
          syncPlaybackPitch();
        });
        artPlayerRef.current.on('video:playing', () => {
          if (
            isWebkit &&
            Date.now() < playbackRateRestoreWindowUntilRef.current &&
            Math.abs(
              artPlayerRef.current.playbackRate - lastPlaybackRateRef.current
            ) > 0.01
          ) {
            artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
          }
        });

        // 監聽網頁全屏事件，控制導航欄顯示隱藏
        artPlayerRef.current.on('fullscreenWeb', (isFullscreen: boolean) => {
          console.log('網頁全屏狀態變化:', isFullscreen);
          setIsWebFullscreen(isFullscreen);
        });

        // 添加自定義熱力圖到播放器控制層
        if (!danmakuHeatmapDisabledRef.current) {
          artPlayerRef.current.controls.add({
            name: 'custom-heatmap',
            position: 'top',
            html: '<canvas id="custom-heatmap-canvas" style="width: 100%; height: 100%; display: block;"></canvas>',
            style: {
              position: 'absolute',
              bottom: '5px',
              left: '0',
              height: '60px',
              pointerEvents: 'none',
              zIndex: '30',
              display: danmakuHeatmapEnabledRef.current ? 'block' : 'none',
            },
            mounted: ($el: HTMLElement) => {
              const canvas = $el.querySelector('#custom-heatmap-canvas') as HTMLCanvasElement;
              if (!canvas) {
                return;
              }

              // 根據實際顯示尺寸和設備像素比設置 canvas 分辨率
              const updateCanvasSize = () => {
                const rect = canvas.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;
                const newWidth = Math.round(rect.width * dpr);
                const newHeight = Math.round(rect.height * dpr);

                // 只在尺寸真正改變時才更新，避免閃爍
                if (canvas.width !== newWidth || canvas.height !== newHeight) {
                  canvas.width = newWidth;
                  canvas.height = newHeight;
                  return true; // 返回 true 表示尺寸已更新
                }
                return false; // 返回 false 表示尺寸未變化
              };

              // 動態獲取進度條的實際位置並調整熱力圖
              const adjustHeatmapPosition = () => {
                const progressBar = document.querySelector('.art-control-progress') as HTMLElement;

                if (!progressBar) {
                  return;
                }

                if (!$el.parentElement) {
                  return;
                }

                if (progressBar && $el.parentElement) {
                  const rect = progressBar.getBoundingClientRect();
                  const parentRect = $el.parentElement.getBoundingClientRect();

                  // 調整熱力圖位置以完全匹配進度條
                  $el.style.left = `${rect.left - parentRect.left}px`;
                  $el.style.bottom = `${parentRect.bottom - rect.bottom + 5}px`;
                  $el.style.width = `${rect.width}px`;

                  // 更新 canvas 分辨率
                  updateCanvasSize();
                }
              };

              // 初始調整
              setTimeout(adjustHeatmapPosition, 500);

              // 監聽進度條尺寸變化
              const progressBar = document.querySelector('.art-control-progress') as HTMLElement;
              let progressResizeObserver: ResizeObserver | null = null;
              if (progressBar && typeof ResizeObserver !== 'undefined') {
                progressResizeObserver = new ResizeObserver(() => {
                  adjustHeatmapPosition();
                  // 進度條長度變化時也需要重新計算和繪製熱力圖
                  setTimeout(updateHeatmapData, 100);
                });
                progressResizeObserver.observe(progressBar);
              }

              // 監聽全屏狀態變化
              if (artPlayerRef.current) {
                artPlayerRef.current.on('fullscreen', () => {
                  setTimeout(adjustHeatmapPosition, 300);
                });

                artPlayerRef.current.on('fullscreenWeb', () => {
                  setTimeout(adjustHeatmapPosition, 300);
                });
              }

              // 監聽窗口大小變化
              const resizeHandler = () => {
                adjustHeatmapPosition();
              };
              window.addEventListener('resize', resizeHandler);

              let heatmapData: number[] = [];
              let isHovering = false;
              let hoverTime = 0;
              let tooltipEl: HTMLElement | null = null;

              // 監聽熱力圖開關狀態變化
              let lastEnabled = localStorage.getItem('danmaku_heatmap_enabled') === 'true';
              const updateVisibility = () => {
                const enabled = localStorage.getItem('danmaku_heatmap_enabled') === 'true';

                // 只在狀態真正改變時才更新 DOM
                if (enabled !== lastEnabled) {
                  $el.style.display = enabled ? 'block' : 'none';

                  // 如果從關閉變為打開，重新調整位置和尺寸
                  if (enabled) {
                    setTimeout(() => {
                      adjustHeatmapPosition();
                      drawHeatmap();
                    }, 50);
                  }

                  lastEnabled = enabled;
                }
              };

              // 定期檢查開關狀態
              const visibilityInterval = setInterval(updateVisibility, 500);

              // 計算熱力圖數據（按視頻長度的5%分段，使熱力圖更平滑）
              const calculateHeatmapData = (danmakuList: any[], duration: number) => {
                if (!duration || duration <= 0 || danmakuList.length === 0) {
                  return [];
                }

                // 按視頻長度的5%分段，最少20段
                const segments = Math.max(20, Math.ceil(duration * 0.05));
                const segmentDuration = duration / segments;
                const heatData = new Array(segments).fill(0);

                danmakuList.forEach((danmaku: any) => {
                  const segmentIndex = Math.floor(danmaku.time / segmentDuration);
                  if (segmentIndex >= 0 && segmentIndex < segments) {
                    heatData[segmentIndex]++;
                  }
                });

                const maxCount = Math.max(...heatData, 1);
                return heatData.map((count: number) => count / maxCount);
              };

              // 繪製熱力圖
              const drawHeatmap = () => {
                // 檢查熱力圖是否啟用（與初始狀態邏輯保持一致）
                const storedValue = localStorage.getItem('danmaku_heatmap_enabled');
                const enabled = storedValue !== null ? storedValue === 'true' : true; // 默認開啟
                if (!enabled) {
                  // 熱力圖已關閉，跳過繪製
                  return;
                }

                if (!artPlayerRef.current) {
                  return;
                }

                if (heatmapData.length === 0) {
                  return;
                }

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                  return;
                }

                const dpr = window.devicePixelRatio || 1;
                const width = canvas.width / dpr;
                const height = canvas.height / dpr;
                const duration = artPlayerRef.current.duration || 0;
                const currentTime = artPlayerRef.current.currentTime || 0;

                ctx.save();
                ctx.scale(dpr, dpr);
                ctx.clearRect(0, 0, width, height);

                const progressRatio = duration > 0 ? currentTime / duration : 0;
                const progressX = progressRatio * width;

                // 繪製未播放部分的曲線
                ctx.beginPath();
                ctx.moveTo(0, height);

                heatmapData.forEach((value: number, index: number) => {
                  const x = (index / heatmapData.length) * width;
                  const y = height - (value * height);

                  if (index === 0) {
                    ctx.lineTo(x, y);
                  } else {
                    // 使用二次貝塞爾曲線使線條平滑
                    const prevX = ((index - 1) / heatmapData.length) * width;
                    const prevY = height - (heatmapData[index - 1] * height);
                    const cpX = (prevX + x) / 2;
                    const cpY = (prevY + y) / 2;
                    ctx.quadraticCurveTo(prevX, prevY, cpX, cpY);
                    ctx.lineTo(x, y);
                  }
                });

                ctx.lineTo(width, height);
                ctx.closePath();
                ctx.fillStyle = 'rgba(128, 128, 128, 0.3)';
                ctx.fill();

                // 繪製已播放部分的曲線（深色）
                if (progressRatio > 0) {
                  ctx.save();
                  ctx.beginPath();
                  ctx.rect(0, 0, progressX, height);
                  ctx.clip();

                  ctx.beginPath();
                  ctx.moveTo(0, height);

                  heatmapData.forEach((value: number, index: number) => {
                    const x = (index / heatmapData.length) * width;
                    const y = height - (value * height);

                    if (index === 0) {
                      ctx.lineTo(x, y);
                    } else {
                      const prevX = ((index - 1) / heatmapData.length) * width;
                      const prevY = height - (heatmapData[index - 1] * height);
                      const cpX = (prevX + x) / 2;
                      const cpY = (prevY + y) / 2;
                      ctx.quadraticCurveTo(prevX, prevY, cpX, cpY);
                      ctx.lineTo(x, y);
                    }
                  });

                  ctx.lineTo(width, height);
                  ctx.closePath();
                  ctx.fillStyle = 'rgba(128, 128, 128, 0.6)';
                  ctx.fill();

                  ctx.restore();
                }

                ctx.restore();
              };

              // 格式化時間
              const formatTime = (seconds: number): string => {
                const h = Math.floor(seconds / 3600);
                const m = Math.floor((seconds % 3600) / 60);
                const s = Math.floor(seconds % 60);

                if (h > 0) {
                  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                }
                return `${m}:${s.toString().padStart(2, '0')}`;
              };

              // 獲取彈幕密度
              const getDensity = (time: number): string => {
                if (heatmapData.length === 0 || !artPlayerRef.current) return '';
                const duration = artPlayerRef.current.duration || 0;
                if (duration <= 0) return '';

                // 按視頻長度的5%分段
                const segments = Math.max(20, Math.ceil(duration * 0.05));
                const segmentDuration = duration / segments;
                const segmentIndex = Math.floor(time / segmentDuration);

                if (segmentIndex >= 0 && segmentIndex < heatmapData.length) {
                  const density = heatmapData[segmentIndex];
                  if (density < 0.2) return '低';
                  if (density < 0.5) return '中';
                  if (density < 0.8) return '高';
                  return '極高';
                }
                return '';
              };

              // 鼠標移動事件
              canvas.addEventListener('mousemove', (e: MouseEvent) => {
                if (!artPlayerRef.current) return;

                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const percentage = x / rect.width;
                const duration = artPlayerRef.current.duration || 0;
                hoverTime = percentage * duration;
                isHovering = true;

                // 創建或更新提示框
                if (!tooltipEl) {
                  tooltipEl = document.createElement('div');
                  tooltipEl.style.cssText = `
                  position: absolute;
                  bottom: 100%;
                  transform: translateX(-50%);
                  margin-bottom: 8px;
                  padding: 4px 8px;
                  background: rgba(0, 0, 0, 0.8);
                  color: white;
                  font-size: 12px;
                  border-radius: 4px;
                  white-space: nowrap;
                  pointer-events: none;
                  z-index: 30;
                `;
                  $el.appendChild(tooltipEl);
                }

                tooltipEl.textContent = `${formatTime(hoverTime)} - 彈幕密度: ${getDensity(hoverTime)}`;
                tooltipEl.style.left = `${percentage * 100}%`;
                tooltipEl.style.display = 'block';
              });

              // 鼠標離開事件
              canvas.addEventListener('mouseleave', () => {
                isHovering = false;
                if (tooltipEl) {
                  tooltipEl.style.display = 'none';
                }
              });

              // 點擊跳轉
              canvas.addEventListener('click', (e: MouseEvent) => {
                if (!artPlayerRef.current) return;

                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const percentage = x / rect.width;
                const duration = artPlayerRef.current.duration || 0;
                const time = percentage * duration;

                artPlayerRef.current.currentTime = time;
              });

              // 監聽時間更新
              artPlayerRef.current.on('video:timeupdate', drawHeatmap);

              // 監聽彈幕數據更新
              const updateHeatmapData = () => {
                if (!artPlayerRef.current) {
                  return;
                }

                if (!danmakuPluginRef.current) {
                  return;
                }

                const duration = artPlayerRef.current.duration || 0;

                // 直接從彈幕插件獲取彈幕數據
                const danmakuList = danmakuPluginRef.current.option?.danmuku || [];

                if (danmakuList.length > 0 && duration > 0) {
                  heatmapData = calculateHeatmapData(danmakuList, duration);
                  // 立即繪製熱力圖
                  drawHeatmap();
                  // 強制再次繪製，確保顯示
                  setTimeout(drawHeatmap, 100);
                }
              };

              artPlayerRef.current.on('video:loadedmetadata', updateHeatmapData);

              // 監聽彈幕加載完成事件
              artPlayerRef.current.on('danmaku:loaded', () => {
                updateHeatmapData();
              });

              // 監聽彈幕插件的配置變化
              if (danmakuPluginRef.current) {
                const originalConfig = danmakuPluginRef.current.config;
                danmakuPluginRef.current.config = function (...args: any[]) {
                  const result = originalConfig.apply(this, args);
                  setTimeout(updateHeatmapData, 100);
                  return result;
                };
              }

              // 使用輪詢機制等待彈幕插件準備好（替代固定延遲）
              let pollAttempts = 0;
              const maxPollAttempts = 120; // 最多嘗試 120 次（60 秒）
              const pollInterval = 500; // 每 500ms 檢查一次

              const pollForDanmakuPlugin = () => {
                if (danmakuPluginRef.current && danmakuPluginRef.current.option?.danmuku) {
                  // 彈幕插件已準備好且有數據
                  updateHeatmapData();
                  return; // 成功，停止輪詢
                }

                pollAttempts++;
                if (pollAttempts < maxPollAttempts) {
                  // 繼續輪詢
                  setTimeout(pollForDanmakuPlugin, pollInterval);
                }
              };

              // 開始輪詢
              setTimeout(pollForDanmakuPlugin, 500);

              // 清理
              return () => {
                clearInterval(visibilityInterval);
                window.removeEventListener('resize', resizeHandler);
                if (progressResizeObserver) {
                  progressResizeObserver.disconnect();
                }
                if (tooltipEl && tooltipEl.parentNode) {
                  tooltipEl.parentNode.removeChild(tooltipEl);
                }
              };
            },
          });
        }

        // 添加全屏快進快退按鈕
        artPlayerRef.current.layers.add({
          name: 'seek-buttons',
          html: `
          <div class="seek-buttons-container" style="display: none;">
            <button class="seek-button seek-backward" style="position: fixed; left: 20px; top: 40%; transform: translateY(-50%); width: 48px; height: 48px; background: rgba(0,0,0,0.7); border: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 9999; transition: opacity 0.2s;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" fill="white"/>
              </svg>
            </button>
            <button class="seek-button seek-forward" style="position: fixed; right: 20px; top: 40%; transform: translateY(-50%); width: 48px; height: 48px; background: rgba(0,0,0,0.7); border: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 9999; transition: opacity 0.2s;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" fill="white"/>
              </svg>
            </button>
          </div>
        `,
          mounted: ($el: HTMLElement) => {
            const container = $el.querySelector('.seek-buttons-container') as HTMLElement;
            const backwardBtn = $el.querySelector('.seek-backward') as HTMLElement;
            const forwardBtn = $el.querySelector('.seek-forward') as HTMLElement;

            // 快退5秒
            backwardBtn.onclick = () => {
              if (artPlayerRef.current) {
                artPlayerRef.current.currentTime = Math.max(0, artPlayerRef.current.currentTime - 5);
              }
            };

            // 快進5秒
            forwardBtn.onclick = () => {
              if (artPlayerRef.current) {
                artPlayerRef.current.currentTime = Math.min(artPlayerRef.current.duration, artPlayerRef.current.currentTime + 5);
              }
            };

            // 監聽全屏狀態變化
            const updateVisibility = () => {
              const isFullscreen = artPlayerRef.current?.fullscreen || artPlayerRef.current?.fullscreenWeb || !!document.fullscreenElement;
              const isMobile = Math.min(window.innerWidth, window.innerHeight) < 768;
              const controlsVisible = !artPlayerRef.current?.template?.$player?.classList.contains('art-hide-cursor');

              if (container) {
                const shouldShow = isFullscreen && isMobile && controlsVisible;
                container.style.display = shouldShow ? 'block' : 'none';
              }
            };

            artPlayerRef.current.on('fullscreen', updateVisibility);
            artPlayerRef.current.on('fullscreenWeb', updateVisibility);
            document.addEventListener('fullscreenchange', updateVisibility);
            window.addEventListener('resize', updateVisibility);

            // 監聽鼠標移動和視頻事件來檢測控件顯示/隱藏
            artPlayerRef.current.on('video:timeupdate', updateVisibility);
            if (artPlayerRef.current.template?.$player) {
              const observer = new MutationObserver(updateVisibility);
              observer.observe(artPlayerRef.current.template.$player, {
                attributes: true,
                attributeFilter: ['class']
              });
            }

            updateVisibility();
          },
        });

        // 監聽視頻可播放事件，這時恢復播放進度更可靠
        artPlayerRef.current.on('video:canplay', () => {
          let restoredResumeTime = false;

          // 若存在需要恢復的播放進度，則跳轉
          if (resumeTimeRef.current && resumeTimeRef.current > 0) {
            try {
              const duration = artPlayerRef.current.duration || 0;
              let target = resumeTimeRef.current;
              if (duration && target >= duration - 2) {
                target = Math.max(0, duration - 5);
              }
              artPlayerRef.current.currentTime = target;
              restoredResumeTime = true;
              console.log('成功恢復播放進度到:', resumeTimeRef.current);
            } catch (err) {
              console.warn('恢復播放進度失敗:', err);
            }
          }
          resumeTimeRef.current = null;

          schedulePlayerTimeout(() => {
            if (!artPlayerRef.current) {
              return;
            }

            const restorePlaybackRate = () => {
              if (!artPlayerRef.current) {
                return;
              }

              if (
                Math.abs(
                  artPlayerRef.current.playbackRate - lastPlaybackRateRef.current
                ) > 0.01 &&
                isWebkit
              ) {
                artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
              }
            };

            if (
              Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) > 0.01
            ) {
              artPlayerRef.current.volume = lastVolumeRef.current;
            }

            // Safari 在 seek 剛發生時立刻恢復 3x，容易卡進持續 seeking 狀態。
            // 這裡等 seek 穩定後再恢復倍速，避免恢復進度和變速互相打架。
            if (restoredResumeTime && isWebkit && artPlayerRef.current?.video) {
              const video = artPlayerRef.current.video as HTMLVideoElement;
              const applyRateAfterSeek = () => {
                restorePlaybackRate();
              };

              if (video.seeking) {
                const handleSeeked = () => {
                  clearTrackedTimeout(seekedTimeout);
                  applyRateAfterSeek();
                };
                const seekedTimeout = schedulePlayerTimeout(() => {
                  video.removeEventListener('seeked', handleSeeked);
                  applyRateAfterSeek();
                }, 300);

                video.addEventListener(
                  'seeked',
                  handleSeeked,
                  { once: true }
                );
              } else {
                restorePlaybackRate();
              }
            } else {
              restorePlaybackRate();
            }
            syncPlaybackPitch();
            artPlayerRef.current.notice.show = '';
          }, 0);

          // 隱藏換源加載狀態
          setIsVideoLoading(false);
          setVideoError(null);
          setCorsFailedUrl(null);
        });

        // 監聽視頻播放事件，檢查是否需要顯示播放記錄跳轉按鈕
        artPlayerRef.current.on('video:playing', () => {
          // 檢查是否需要顯示播放記錄跳轉按鈕
          // 條件：當前播放時間 < 10秒 且 播放記錄時間 > 10秒
          const checkPlayRecordJump = async () => {
            try {
              // 僅在進入播放後的首次檢查時處理，避免本次會話新生成的記錄觸發恢復按鈕
              if (!playRecordJumpInitialCheckRef.current) {
                return;
              }

              // 如果用戶已經關閉過跳轉按鈕，不再顯示
              if (playRecordJumpDismissedRef.current) {
                return;
              }

              const currentTime = artPlayerRef.current?.currentTime || 0;

              // 如果當前播放時間已經大於等於10秒，不顯示跳轉按鈕
              if (currentTime >= 10) {
                // 標記已經進行過首次檢查，避免切集後再顯示
                playRecordJumpInitialCheckRef.current = false;
                if (playRecordJumpLayerRef.current) {
                  artPlayerRef.current.layers.remove('play-record-jump');
                  playRecordJumpLayerRef.current = null;
                }
                return;
              }

              // 獲取播放記錄
              const allRecords = await getAllPlayRecords();
              const key = generateStorageKey(
                currentSourceRef.current,
                currentIdRef.current
              );
              const record = allRecords[key];

              if (record) {
                const recordIndex = record.index - 1;
                const recordTime = record.play_time;

                // 檢查是否是當前集數且播放記錄時間大於10秒且當前時間小於10秒
                if (
                  recordIndex === currentEpisodeIndexRef.current &&
                  recordTime > 10 &&
                  currentTime < 10
                ) {
                  // 如果已經添加過，不重複添加
                  if (playRecordJumpLayerRef.current) {
                    return;
                  }

                  // 標記已經進行過首次檢查
                  playRecordJumpInitialCheckRef.current = false;

                  // 格式化時間顯示
                  const formatTime = (seconds: number): string => {
                    const h = Math.floor(seconds / 3600);
                    const m = Math.floor((seconds % 3600) / 60);
                    const s = Math.floor(seconds % 60);
                    if (h > 0) {
                      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                    }
                    return `${m}:${s.toString().padStart(2, '0')}`;
                  };

                  // 添加到播放器 layers
                  playRecordJumpLayerRef.current = artPlayerRef.current.layers.add({
                    name: 'play-record-jump',
                    html: `
                      <div id="play-record-jump-container" style="
                        position: absolute;
                        left: 16px;
                        bottom: 60px;
                        z-index: 20;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        padding: 8px 12px;
                        background-color: rgba(0, 0, 0, 0.75);
                        border-radius: 6px;
                        color: white;
                        font-size: 14px;
                        font-family: system-ui, -apple-system, sans-serif;
                        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
                        backdrop-filter: blur(4px);
                        pointer-events: auto;
                      ">
                        <span style="margin-right: 4px;">
                          上次播放到 ${formatTime(recordTime)}
                        </span>
                        <button id="play-record-jump-btn" style="
                          padding: 4px 12px;
                          background-color: rgba(255, 255, 255, 0.2);
                          border: 1px solid rgba(255, 255, 255, 0.3);
                          border-radius: 4px;
                          color: white;
                          font-size: 13px;
                          cursor: pointer;
                          transition: all 0.2s;
                          font-weight: 500;
                        ">
                          跳轉
                        </button>
                        <button id="play-record-dismiss-btn" style="
                          padding: 4px 8px;
                          background-color: transparent;
                          border: none;
                          color: rgba(255, 255, 255, 0.7);
                          font-size: 18px;
                          cursor: pointer;
                          line-height: 1;
                          transition: color 0.2s;
                        " title="關閉">
                          ×
                        </button>
                      </div>
                    `,
                    style: {
                      position: 'absolute',
                      left: 0,
                      bottom: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                    },
                  });

                  // 綁定事件
                  const jumpBtn = document.getElementById('play-record-jump-btn');
                  const dismissBtn = document.getElementById('play-record-dismiss-btn');

                  if (jumpBtn) {
                    jumpBtn.addEventListener('mouseenter', () => {
                      jumpBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.3)';
                    });
                    jumpBtn.addEventListener('mouseleave', () => {
                      jumpBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                    });
                    jumpBtn.addEventListener('click', () => {
                      if (artPlayerRef.current) {
                        artPlayerRef.current.currentTime = recordTime;
                        artPlayerRef.current.notice.show = `已跳轉到 ${formatTime(recordTime)}`;
                      }
                      playRecordJumpDismissedRef.current = true;
                      if (playRecordJumpLayerRef.current) {
                        artPlayerRef.current.layers.remove('play-record-jump');
                        playRecordJumpLayerRef.current = null;
                      }
                    });
                  }

                  if (dismissBtn) {
                    dismissBtn.addEventListener('mouseenter', () => {
                      dismissBtn.style.color = 'white';
                    });
                    dismissBtn.addEventListener('mouseleave', () => {
                      dismissBtn.style.color = 'rgba(255, 255, 255, 0.7)';
                    });
                    dismissBtn.addEventListener('click', () => {
                      playRecordJumpDismissedRef.current = true;
                      if (playRecordJumpLayerRef.current) {
                        artPlayerRef.current.layers.remove('play-record-jump');
                        playRecordJumpLayerRef.current = null;
                      }
                    });
                  }

                  console.log('[PlayRecordJump] 顯示跳轉按鈕，當前時間:', currentTime, '記錄時間:', recordTime);
                } else {
                  // 不滿足顯示條件，也標記為已檢查過
                  playRecordJumpInitialCheckRef.current = false;
                }
              } else {
                // 沒有播放記錄，也標記為已檢查過
                playRecordJumpInitialCheckRef.current = false;
              }
            } catch (err) {
              console.error('[PlayRecordJump] 檢查播放記錄失敗:', err);
              // 即使出錯也標記為已檢查過
              playRecordJumpInitialCheckRef.current = false;
            }
          };

          // 延遲檢查，確保播放器已經穩定
          setTimeout(checkPlayRecordJump, 500);
        });

        // 監聽視頻時間更新事件，實現跳過片頭片尾
        artPlayerRef.current.on('video:timeupdate', () => {
          if (!skipConfigRef.current.enable) return;

          const currentTime = artPlayerRef.current.currentTime || 0;
          const duration = artPlayerRef.current.duration || 0;
          const now = Date.now();

          // 限制跳過檢查頻率為1.5秒一次
          if (now - lastSkipCheckRef.current < 1500) return;
          lastSkipCheckRef.current = now;

          // 跳過片頭
          if (
            skipConfigRef.current.intro_time > 0 &&
            currentTime < skipConfigRef.current.intro_time
          ) {
            artPlayerRef.current.currentTime = skipConfigRef.current.intro_time;
            artPlayerRef.current.notice.show = `已跳過片頭 (${formatTime(
              skipConfigRef.current.intro_time
            )})`;
          }

          // 跳過片尾
          if (
            skipConfigRef.current.outro_time < 0 &&
            duration > 0 &&
            currentTime >
            artPlayerRef.current.duration + skipConfigRef.current.outro_time
          ) {
            if (
              currentEpisodeIndexRef.current <
              (detailRef.current?.episodes?.length || 1) - 1
            ) {
              handleNextEpisode();
            } else {
              artPlayerRef.current.pause();
            }
            artPlayerRef.current.notice.show = `已跳過片尾 (${formatTime(
              skipConfigRef.current.outro_time
            )})`;
          }
        });

        artPlayerRef.current.on('error', (err: any) => {
          console.error('播放器錯誤:', err);
          // 如果已經成功播放過一段時間，忽略後續錯誤（可能是短暫網絡波動）
          if (artPlayerRef.current && artPlayerRef.current.currentTime > 0) {
            return;
          }
          // 原生 <video> 播放失敗（非 HLS.js 管理的場景，如無後綴的直鏈）
          // 需要觸發播放失敗 UI，否則會永遠卡在"加載中"
          const currentUrl = artPlayerRef.current?.option?.url || videoUrl;
          const isUsingHls = currentUrl.includes('/api/proxy-m3u8') || currentUrl.includes('/api/proxy/vod/m3u8') || currentUrl.toLowerCase().includes('.m3u8') || currentUrl.toLowerCase().includes('.m3u');
          if (!isUsingHls) {
            // 非 HLS 場景下的原生視頻錯誤，顯示錯誤 UI
            if (proxyAttemptedRef.current) {
              // 代理已經嘗試過（走了 415→直連 的路徑），直連也失敗了，不再提供代理按鈕
              setVideoError('視頻無法在瀏覽器中播放（已嘗試代理，格式不兼容）');
            } else if (currentSourceRef.current === 'directplay' && !currentUrl.includes('/api/proxy-m3u8')) {
              setCorsFailedUrl(currentUrl);
              setVideoError('視頻播放失敗（格式不支持或跨域限制）');
            } else {
              setVideoError('視頻播放失敗（格式不支持或跨域限制）');
            }
          }
        });

        // 監聽視頻播放結束事件，自動播放下一集（房員禁用）
        artPlayerRef.current.on('video:ended', () => {
          // 房員禁用自動播放下一集
          if (playSync.shouldDisableControls) {
            console.log('[PlayPage] Member cannot auto-play next episode');
            if (artPlayerRef.current) {
              artPlayerRef.current.notice.show = '等待房主切換下一集';
            }
            return;
          }

          const d = detailRef.current;
          const idx = currentEpisodeIndexRef.current;

          if (!d || !d.episodes || idx >= d.episodes.length - 1) {
            return;
          }

          // 查找下一個未被過濾的集數
          let nextIdx = idx + 1;
          while (nextIdx < d.episodes.length) {
            const episodeTitle = d.episodes_titles?.[nextIdx];
            const isFiltered = episodeTitle && isEpisodeFilteredByTitle(episodeTitle);

            if (!isFiltered) {
              setTimeout(() => {
                setCurrentEpisodeIndex(nextIdx);
              }, 1000);
              return;
            }
            nextIdx++;
          }

          // 所有後續集數都被屏蔽
          if (artPlayerRef.current) {
            artPlayerRef.current.notice.show = '後續集數均已屏蔽，已自動停止';
          }
        });

        artPlayerRef.current.on('video:timeupdate', () => {
          const now = Date.now();
          let interval = 5000;
          if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'upstash') {
            interval = 20000;
          }
          if (now - lastSaveTimeRef.current > interval) {
            saveCurrentPlayProgress();
            lastSaveTimeRef.current = now;
          }

          // 下集預緩衝邏輯
          const nextEpisodePreCacheEnabled = typeof window !== 'undefined'
            ? localStorage.getItem('nextEpisodePreCache') === 'true'
            : false;

          if (nextEpisodePreCacheEnabled) {
            const currentTime = artPlayerRef.current?.currentTime || 0;
            const duration = artPlayerRef.current?.duration || 0;
            const progress = duration > 0 ? currentTime / duration : 0;

            // 檢查是否已經到達90%播放進度
            if (duration > 0 && progress >= 0.9 && !nextEpisodePreCacheTriggeredRef.current) {
              // 標記已觸發，防止重複執行
              nextEpisodePreCacheTriggeredRef.current = true;

              // 獲取下一集信息
              const currentIdx = currentEpisodeIndexRef.current;
              const episodes = detailRef.current?.episodes;

              if (!episodes || currentIdx >= episodes.length - 1) {
                return;
              }

              const nextEpisodeIndex = currentIdx + 1;
              const nextEpisodeUrl = episodes[nextEpisodeIndex];

              if (!nextEpisodeUrl) {
                return;
              }

              // 使用 fetch 預加載資源，利用瀏覽器緩存
              const preloadNextEpisode = async () => {
                try {
                  // 判斷是否是m3u8流
                  if (nextEpisodeUrl.includes('.m3u8') || nextEpisodeUrl.includes('m3u8')) {
                    // 1. 先fetch m3u8文件
                    const m3u8Response = await fetch(nextEpisodeUrl);
                    const m3u8Text = await m3u8Response.text();

                    // 2. 解析m3u8，提取ts分片URL
                    const lines = m3u8Text.split('\n');
                    const tsUrls: string[] = [];
                    const baseUrl = nextEpisodeUrl.substring(0, nextEpisodeUrl.lastIndexOf('/') + 1);

                    for (const line of lines) {
                      const trimmedLine = line.trim();
                      // 跳過註釋和空行
                      if (!trimmedLine || trimmedLine.startsWith('#')) {
                        continue;
                      }
                      // 構建完整的ts URL
                      const tsUrl = trimmedLine.startsWith('http')
                        ? trimmedLine
                        : baseUrl + trimmedLine;
                      tsUrls.push(tsUrl);
                    }

                    // 3. 預加載前20個ts分片
                    const maxFragmentsToPreload = Math.min(20, tsUrls.length);

                    for (let i = 0; i < maxFragmentsToPreload; i++) {
                      try {
                        await fetch(tsUrls[i]);
                      } catch (err) {
                        // 靜默處理分片加載失敗
                      }
                    }
                  }
                } catch (error) {
                  // 靜默處理預緩衝失敗
                }
              };

              // 異步執行預緩衝
              preloadNextEpisode();
            }
          }

          // 下集彈幕預加載邏輯
          const nextEpisodeDanmakuPreloadEnabled = typeof window !== 'undefined'
            ? localStorage.getItem('nextEpisodeDanmakuPreload') === 'true'
            : false;

          if (nextEpisodeDanmakuPreloadEnabled) {
            const currentTime = artPlayerRef.current?.currentTime || 0;
            const duration = artPlayerRef.current?.duration || 0;
            const progress = duration > 0 ? currentTime / duration : 0;

            // 檢查是否已經到達90%播放進度
            if (duration > 0 && progress >= 0.9 && !nextEpisodeDanmakuPreloadTriggeredRef.current) {
              // 標記已觸發，防止重複執行
              nextEpisodeDanmakuPreloadTriggeredRef.current = true;

              // 異步執行彈幕預加載
              preloadNextEpisodeDanmaku();
            }
          }
        });

        if (artPlayerRef.current?.video) {
          ensureVideoSource(
            artPlayerRef.current.video as HTMLVideoElement,
            videoUrl
          );
        }
      } catch (err) {
        console.error('創建播放器失敗:', err);
        setError('播放器初始化失敗');
      }
    };

    // 調用異步初始化函數
    initPlayer();
  }, [videoUrl, loading, blockAdEnabled]);

  // 當組件卸載時清理定時器、Wake Lock 和播放器資源
  useEffect(() => {
    return () => {
      // 清理定時器
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }

      // 釋放 Wake Lock
      releaseWakeLock();

      // 清理Anime4K
      cleanupAnime4K();

      // 銷燬播放器實例
      cleanupPlayer();
    };
  }, []);

  if (loading) {
    return (
      <PageLayout activePath='/play' hideNavigation={isWebFullscreen}>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 動畫影院圖標 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>
                  {loadingStage === 'searching' && '🔍'}
                  {loadingStage === 'preferring' && '⚡'}
                  {loadingStage === 'fetching' && '🎬'}
                  {loadingStage === 'ready' && '✨'}
                </div>
                {/* 旋轉光環 */}
                <div className='absolute -inset-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
              </div>

              {/* 浮動粒子效果 */}
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            {/* 進度指示器 */}
            <div className='mb-6 w-80 mx-auto'>
              <div className='flex justify-center space-x-2 mb-4'>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${loadingStage === 'searching' || loadingStage === 'fetching'
                    ? 'bg-green-500 scale-125'
                    : loadingStage === 'preferring' ||
                      loadingStage === 'ready'
                      ? 'bg-green-500'
                      : 'bg-gray-300'
                    }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${loadingStage === 'preferring'
                    ? 'bg-green-500 scale-125'
                    : loadingStage === 'ready'
                      ? 'bg-green-500'
                      : 'bg-gray-300'
                    }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${loadingStage === 'ready'
                    ? 'bg-green-500 scale-125'
                    : 'bg-gray-300'
                    }`}
                ></div>
              </div>

              {/* 進度條 */}
              <div className='w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden'>
                <div
                  className='h-full bg-gradient-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-1000 ease-out'
                  style={{
                    width:
                      loadingStage === 'searching' ||
                        loadingStage === 'fetching'
                        ? '33%'
                        : loadingStage === 'preferring'
                          ? '66%'
                          : '100%',
                  }}
                ></div>
              </div>
            </div>

            {/* 加載消息 */}
            <div className='space-y-2'>
              <p className='text-xl font-semibold text-gray-800 dark:text-gray-200 animate-pulse'>
                {loadingMessage}
              </p>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/play' hideNavigation={isWebFullscreen}>
        <div className='flex min-h-screen w-full items-center justify-center overflow-x-hidden bg-transparent px-4 py-6'>
          <div className='flex w-full flex-col items-center'>
            <div className='w-full max-w-md text-center'>
              {/* 錯誤圖標 */}
              <div className='relative mb-8'>
                <div className='relative mx-auto flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-r from-red-500 to-orange-500 shadow-2xl transition-transform duration-300 hover:scale-105'>
                  <div className='text-4xl text-white'>😵</div>
                  {/* 脈衝效果 */}
                  <div className='absolute -inset-2 animate-pulse rounded-2xl bg-gradient-to-r from-red-500 to-orange-500 opacity-20'></div>
                </div>

                {/* 浮動錯誤粒子 */}
                <div className='pointer-events-none absolute left-0 top-0 h-full w-full'>
                  <div className='absolute left-2 top-2 h-2 w-2 animate-bounce rounded-full bg-red-400'></div>
                  <div
                    className='absolute right-4 top-4 h-1.5 w-1.5 animate-bounce rounded-full bg-orange-400'
                    style={{ animationDelay: '0.5s' }}
                  ></div>
                  <div
                    className='absolute bottom-3 left-6 h-1 w-1 animate-bounce rounded-full bg-yellow-400'
                    style={{ animationDelay: '1s' }}
                  ></div>
                </div>
              </div>

              {/* 錯誤信息 */}
              <div className='mb-8 space-y-4'>
                <h2 className='text-2xl font-bold text-gray-800 dark:text-gray-200'>
                  哎呀，出現了一些問題
                </h2>
                <div className='rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20'>
                  <p className='font-medium text-red-600 dark:text-red-400'>
                    {error}
                  </p>
                </div>
                <p className='text-sm text-gray-500 dark:text-gray-400'>
                  請檢查網絡連接或嘗試刷新頁面
                </p>
              </div>

              {/* 操作按鈕 */}
              <div className='space-y-3'>
                <button
                  onClick={() =>
                    videoTitle
                      ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                      : router.back()
                  }
                  className='w-full rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 px-6 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:scale-105 hover:from-green-600 hover:to-emerald-700 hover:shadow-xl'
                >
                  {videoTitle ? '🔍 返回搜索' : '← 返回上頁'}
                </button>

                <button
                  onClick={() => window.location.reload()}
                  className='w-full rounded-xl bg-gray-100 px-6 py-3 font-medium text-gray-700 transition-colors duration-200 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                >
                  🔄 重新嘗試
                </button>
              </div>
            </div>

            {hasCompletedSearchRequest && fallbackRecommendations.length > 0 && (
              <div className='mt-4 w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gray-200 bg-white/70 p-3 text-left dark:border-gray-700 dark:bg-gray-800/70 sm:max-w-3xl lg:max-w-5xl'>
                <div className='mb-3 flex items-center gap-2'>
                  <Sparkles className='h-4 w-4 flex-shrink-0 text-amber-500' />
                  <h3 className='text-sm font-semibold text-gray-800 dark:text-gray-200'>
                    也許你想看
                  </h3>
                </div>
                <div
                  ref={fallbackRecommendationsRowRef}
                  className='w-full overflow-x-auto overflow-y-hidden pb-1 cursor-grab active:cursor-grabbing'
                  onWheel={handleFallbackRecommendationsWheel}
                  onMouseDown={handleFallbackRecommendationsMouseDown}
                  onMouseMove={handleFallbackRecommendationsMouseMove}
                  onMouseUp={stopFallbackRecommendationsDragging}
                  onMouseLeave={stopFallbackRecommendationsDragging}
                >
                  <div className='inline-flex gap-2.5 sm:gap-3'>
                    {fallbackRecommendations.map((recommendation) => (
                      <div
                        key={recommendation.key}
                        className='w-[118px] min-w-[118px] flex-shrink-0 sm:w-[150px] sm:min-w-[150px]'
                      >
                        <VideoCard
                          title={recommendation.item.title}
                          query={searchTitle || videoTitle}
                          poster={recommendation.item.poster}
                          episodes={recommendation.episodes}
                          source_names={recommendation.sourceNames}
                          year={recommendation.item.year}
                          douban_id={recommendation.doubanId}
                          from='search'
                          isAggregate
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </PageLayout>
    );
  }


  return (
    <PageLayout activePath='/play' hideNavigation={isWebFullscreen}>
      {/* TMDB背景圖 */}
      {tmdbBackdrop && (
        <div
          className='fixed inset-0 z-0'
          style={{
            backgroundImage: `url(${tmdbBackdrop})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            filter: 'blur(5px) brightness(0.7)',
          }}
        />
      )}
      {/* 彈幕源選擇對話框 */}
      {showDanmakuSourceSelector && danmakuMatches.length > 0 && (
        <div className='fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm'>
          <div className='relative w-full max-w-2xl max-h-[80vh] mx-4 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden'>
            {/* 標題欄 */}
            <div className='sticky top-0 z-10 bg-gradient-to-r from-green-500 to-emerald-600 px-6 py-4'>
              <h3 className='text-xl font-bold text-white flex items-center gap-2'>
                <svg className='w-6 h-6' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z' />
                </svg>
                選擇彈幕源
              </h3>
              <p className='text-sm text-white/90 mt-1'>
                找到 {danmakuMatches.length} 個匹配的彈幕源，請選擇一個
              </p>
            </div>

            {/* 列表區域 */}
            <div className='overflow-y-auto max-h-[60vh] p-4'>
              <div className='space-y-4'>
                {danmakuMatches.map((anime, index) => (
                  <button
                    key={anime.animeId}
                    onClick={() => handleDanmakuSourceSelect(anime, index)}
                    className='w-full flex flex-col p-5 bg-gray-50 dark:bg-gray-700/50
                             hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all
                             duration-200 text-left group border-2 border-transparent
                             hover:border-green-500 hover:shadow-lg'
                  >
                    {/* 頂部：序號和標題 */}
                    <div className='flex items-start gap-3 mb-3'>
                      {/* 序號 */}
                      <div className='flex-shrink-0 w-8 h-8 rounded-full bg-green-500 text-white
                                    flex items-center justify-center font-bold text-sm
                                    group-hover:bg-green-600 transition-colors duration-200'>
                        {index + 1}
                      </div>

                      {/* 標題 */}
                      <h4 className='flex-1 text-lg font-bold text-gray-900 dark:text-white
                                   group-hover:text-green-600 dark:group-hover:text-green-400
                                   transition-colors duration-200 leading-tight'>
                        {anime.animeTitle}
                      </h4>

                      {/* 選擇圖標 */}
                      <div className='flex-shrink-0'>
                        <svg className='w-6 h-6 text-gray-400 group-hover:text-green-500
                                      transition-colors duration-200'
                          fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                          <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2}
                            d='M9 5l7 7-7 7' />
                        </svg>
                      </div>
                    </div>

                    {/* 主體內容 */}
                    <div className='flex gap-4'>
                      {/* 封面 */}
                      {anime.imageUrl && (
                        <div className='flex-shrink-0 w-20 h-28 rounded-lg overflow-hidden shadow-md
                                      group-hover:shadow-xl transition-shadow duration-200'>
                          <img
                            src={anime.imageUrl}
                            alt={anime.animeTitle}
                            className='w-full h-full object-cover'
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        </div>
                      )}

                      {/* 詳細信息 */}
                      <div className='flex-1 space-y-2'>
                        {/* 基本信息標籤 */}
                        <div className='flex flex-wrap gap-2'>
                          {anime.typeDescription && (
                            <span className='inline-flex items-center px-2.5 py-1 rounded-md
                                           bg-blue-100 dark:bg-blue-900/30 text-blue-700
                                           dark:text-blue-300 text-sm font-medium'>
                              📺 {anime.typeDescription}
                            </span>
                          )}
                          {anime.episodeCount && (
                            <span className='inline-flex items-center px-2.5 py-1 rounded-md
                                           bg-purple-100 dark:bg-purple-900/30 text-purple-700
                                           dark:text-purple-300 text-sm font-medium'>
                              🎬 {anime.episodeCount} 集
                            </span>
                          )}
                          {anime.startDate && (
                            <span className='inline-flex items-center px-2.5 py-1 rounded-md
                                           bg-gray-100 dark:bg-gray-600 text-gray-700
                                           dark:text-gray-300 text-sm font-medium'>
                              📅 {anime.startDate}
                            </span>
                          )}
                        </div>

                        {/* 動漫ID */}
                        <div className='text-xs text-gray-500 dark:text-gray-400'>
                          彈幕庫 ID: {anime.animeId}
                        </div>

                        {/* 提示信息 */}
                        <div className='text-sm text-gray-600 dark:text-gray-300 pt-1
                                      opacity-0 group-hover:opacity-100 transition-opacity duration-200'>
                          點擊選擇此彈幕源
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 底部操作欄 */}
            <div className='sticky bottom-0 z-10 bg-white dark:bg-gray-800 border-t
                          border-gray-200 dark:border-gray-700 px-6 py-4'>
              <button
                onClick={() => {
                  setShowDanmakuSourceSelector(false);
                  setDanmakuMatches([]);
                }}
                className='w-full px-4 py-2.5 bg-gray-100 dark:bg-gray-700
                         hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700
                         dark:text-gray-300 rounded-lg font-medium transition-colors
                         duration-200'
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <div className='relative z-10 flex flex-col gap-3 py-4 px-5 lg:px-[3rem] 2xl:px-20'>
        {/* 第一行：影片標題 */}
        <div className='py-1'>
          <h1 className={`text-xl font-semibold flex items-center gap-2 flex-wrap ${tmdbBackdrop ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
            <span>
              {videoTitle || '影片標題'}
              {shouldShowEpisodeLabel && (
                <span className={tmdbBackdrop ? 'text-white opacity-80' : 'text-gray-500 dark:text-gray-400'}>
                  {` > ${episodeLabel}`}
                </span>
              )}
            </span>
            {/* 完結狀態標識 */}
            {detail && totalEpisodes > 1 && (() => {
              const status = getSeriesStatus(detail);
              if (status === 'unknown') return null;

              return (
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status === 'completed'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                    }`}
                >
                  {status === 'completed' ? '已完結' : '連載中'}
                </span>
              );
            })()}
          </h1>
        </div>
        {/* 第二行：播放器和選集 */}
        <div className='space-y-2'>
          {/* 摺疊控制 - 僅在 lg 及以上屏幕顯示 */}
          <div className='hidden lg:flex justify-end'>
            <button
              onClick={() =>
                setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
              }
              className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-800 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-all duration-200'
              title={
                isEpisodeSelectorCollapsed ? '顯示選集面板' : '隱藏選集面板'
              }
            >
              <svg
                className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isEpisodeSelectorCollapsed ? 'rotate-180' : 'rotate-0'
                  }`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M9 5l7 7-7 7'
                />
              </svg>
              <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                {isEpisodeSelectorCollapsed ? '顯示' : '隱藏'}
              </span>

              {/* 精緻的狀態指示點 */}
              <div
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${isEpisodeSelectorCollapsed
                  ? 'bg-orange-400 animate-pulse'
                  : 'bg-green-400'
                  }`}
              ></div>
            </button>
          </div>

          <div
            className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${isEpisodeSelectorCollapsed
              ? 'grid-cols-1'
              : 'grid-cols-1 md:grid-cols-4'
              }`}
          >
            {/* 播放器 */}
            <div
              className={`transition-all duration-300 ease-in-out rounded-xl border border-white/0 dark:border-white/30 flex flex-col ${isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
                }`}
            >
              {/* 播放器容器 */}
              <div className='relative w-full h-[300px] lg:flex-1 lg:min-h-0'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg'
                ></div>

                {/* 換源加載蒙層 */}
                {(isVideoLoading || videoError) && (
                  <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl flex items-center justify-center z-[500] transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      {videoError ? (
                        // 錯誤顯示
                        <>
                          {/* 錯誤圖標 */}
                          <div className='relative mb-8'>
                            <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-red-500 to-rose-600 rounded-2xl shadow-2xl flex items-center justify-center'>
                              <div className='text-white text-4xl'>⚠️</div>
                            </div>
                          </div>

                          {/* 錯誤消息 */}
                          <div className='space-y-4'>
                            <p className='text-xl font-semibold text-white'>
                              播放失敗
                            </p>
                            <p className='text-base text-gray-300'>
                              {videoError}
                            </p>
                            <button
                              onClick={() => {
                                setVideoError(null);
                                setIsVideoLoading(true);
                                // 重新加載視頻
                                if (artPlayerRef.current) {
                                  artPlayerRef.current.url = videoUrl;
                                }
                              }}
                              className='mt-4 px-6 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all duration-200'
                            >
                              重試
                            </button>
                            {/* 直鏈播放 CORS 失敗時，顯示"使用代理播放"按鈕 */}
                            {!proxyAttemptedRef.current && (corsFailedUrl || (isDirectPlay && videoUrl && !videoUrl.includes('/api/proxy-m3u8'))) && (
                              <button
                                onClick={() => {
                                  const originalUrl = corsFailedUrl || videoUrl;
                                  // 記憶域名到 localStorage
                                  addDirectplayProxyDomain(originalUrl);
                                  // 構建代理 URL
                                  const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                                  const proxyUrl = `/api/proxy-m3u8?url=${encodeURIComponent(originalUrl)}&source=directplay${tokenParam}`;
                                  // 清除錯誤狀態並重新播放
                                  setVideoError(null);
                                  setCorsFailedUrl(null);
                                  setIsVideoLoading(true);
                                  proxyAttemptedRef.current = true;
                                  setVideoUrl(proxyUrl);
                                }}
                                className='mt-4 ml-3 px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all duration-200'
                              >
                                使用代理播放
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        // 加載顯示
                        <>
                          {/* 動畫影院圖標 */}
                          <div className='relative mb-8'>
                            <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                              <div className='text-white text-4xl'>🎬</div>
                              {/* 旋轉光環 */}
                              <div className='absolute -inset-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
                            </div>

                            {/* 浮動粒子效果 */}
                            <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                              <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                              <div
                                className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                                style={{ animationDelay: '0.5s' }}
                              ></div>
                              <div
                                className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                                style={{ animationDelay: '1s' }}
                              ></div>
                            </div>
                          </div>

                          {/* 換源消息 */}
                          <div className='space-y-2'>
                            <p className='text-xl font-semibold text-white animate-pulse'>
                              {videoLoadingStage === 'sourceChanging'
                                ? '🔄 切換播放源...'
                                : '🔄 視頻加載中...'}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* 鏈接刷新提示 */}
                {isRefreshingUrl && (
                  <div className='absolute inset-0 flex items-center justify-center bg-black/50 z-50 pointer-events-none'>
                    <div className='bg-black/80 text-white px-6 py-3 rounded-lg flex items-center gap-3 backdrop-blur-sm border border-green-500/30'>
                      <svg className='animate-spin h-5 w-5' viewBox='0 0 24 24'>
                        <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' fill='none' />
                        <path className='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z' />
                      </svg>
                      <span>正在刷新鏈接...</span>
                    </div>
                  </div>
                )}

                {/* 彈幕加載蒙層 */}
                {danmakuLoading && (
                  <div className='absolute top-0 right-0 m-4 bg-black/80 backdrop-blur-sm rounded-lg px-4 py-2 z-[600] flex items-center gap-2 border border-green-500/30'>
                    {danmakuCount > 0 ? (
                      <>
                        <svg
                          className='w-4 h-4 text-green-500'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M5 13l4 4L19 7'
                          />
                        </svg>
                        <span className='text-sm font-medium text-green-400'>
                          {danmakuOriginalCount > 0
                            ? `已加載 ${danmakuCount} 條彈幕（原始 ${danmakuOriginalCount} 條）`
                            : `已加載 ${danmakuCount} 條彈幕`
                          }
                        </span>
                      </>
                    ) : (
                      <>
                        <div className='w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin'></div>
                        <span className='text-sm font-medium text-green-400'>
                          加載彈幕中...
                        </span>
                      </>
                    )}
                  </div>
                )}

              </div>

              {/* 第三方應用打開按鈕 - 觀影室同步狀態下隱藏 */}
              {videoUrl && !playSync.isInRoom && (
                <div className='mt-3 px-2 lg:flex-shrink-0'>
                  <div className='bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-lg p-2 border border-gray-200/50 dark:border-gray-700/50 w-full lg:w-auto overflow-x-auto'>
                    <div className='flex gap-1.5 flex-nowrap lg:flex-wrap items-center'>
                      <div className='flex gap-1.5 flex-nowrap lg:flex-wrap lg:justify-end lg:flex-1'>
                        {/* 下載按鈕 */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            setShowDownloadSelector(true);
                          }}
                          className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-green-400 flex-shrink-0'
                          title='下載視頻'
                        >
                          <svg
                            className='w-4 h-4 flex-shrink-0 text-white'
                            fill='none'
                            stroke='currentColor'
                            viewBox='0 0 24 24'
                          >
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth='2'
                              d='M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4'
                            />
                          </svg>
                          <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-white'>
                            下載
                          </span>
                        </button>

                        {/* 複製視頻鏈接按鈕 */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            // 如果當前是代理播放模式，使用原始 URL；否則使用當前 videoUrl
                            let urlToUse = videoUrl;
                            if (sourceProxyMode && detail?.episodes && currentEpisodeIndex < detail.episodes.length) {
                              urlToUse = detail.episodes[currentEpisodeIndex];
                            }
                            // 使用代理 URL（與外部播放器邏輯一致）
                            const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                            const proxyUrl = externalPlayerAdBlock
                              ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(urlToUse)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                              : urlToUse;

                            // 如果鏈接是相對路徑，補充完整的 base URL
                            let finalUrl = proxyUrl;
                            if (proxyUrl && !proxyUrl.startsWith('http://') && !proxyUrl.startsWith('https://')) {
                              finalUrl = `${window.location.origin}${proxyUrl.startsWith('/') ? '' : '/'}${proxyUrl}`;
                            }

                            // 複製到剪貼板
                            navigator.clipboard.writeText(finalUrl).then(() => {
                              setToast({
                                message: '視頻鏈接已複製到剪貼板',
                                type: 'success',
                                onClose: () => setToast(null),
                              });
                            }).catch((err) => {
                              console.error('複製失敗:', err);
                              setToast({
                                message: '複製失敗，請重試',
                                type: 'error',
                                onClose: () => setToast(null),
                              });
                            });
                          }}
                          className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-blue-400 flex-shrink-0'
                          title='複製視頻鏈接'
                        >
                          <svg
                            className='w-4 h-4 flex-shrink-0 text-white'
                            fill='none'
                            stroke='currentColor'
                            viewBox='0 0 24 24'
                          >
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth='2'
                              d='M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z'
                            />
                          </svg>
                          <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-white'>
                            複製鏈接
                          </span>
                        </button>

                        {/* App打開 */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            // 獲取當前瀏覽器URL去除域名部分，並去除開頭的/
                            const currentPath = (window.location.pathname + window.location.search).replace(/^\//, '');
                            // 打開moontvplus協議
                            window.open(`moontvplus://${currentPath}`, '_blank');
                          }}
                          className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-blue-600 dark:border-blue-700 flex-shrink-0'
                          title='App打開'
                        >
                          <svg
                            className='w-4 h-4 flex-shrink-0 text-white'
                            fill='none'
                            stroke='currentColor'
                            viewBox='0 0 24 24'
                            xmlns='http://www.w3.org/2000/svg'
                          >
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth={2}
                              d='M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z'
                            />
                          </svg>
                          <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-white'>
                            App打開
                          </span>
                        </button>

                        {showExternalTranscodeButton && (
                          <button
                            onClick={async (e) => {
                              e.preventDefault();
                              await handleCreateTranscodeSession();
                            }}
                            disabled={isTranscoding}
                            className={`group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md overflow-hidden border flex-shrink-0 ${
                              isTranscoding
                                ? 'bg-amber-400 text-white border-amber-400 cursor-wait'
                                : 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500 cursor-pointer'
                            }`}
                            title='轉碼播放'
                          >
                            {isTranscoding ? (
                              <Loader2 className='w-4 h-4 flex-shrink-0 text-white animate-spin' />
                            ) : (
                              <Router className='w-4 h-4 flex-shrink-0 text-white' />
                            )}
                            <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-white'>
                              {isTranscoding ? '轉碼中' : '轉碼'}
                            </span>
                          </button>
                        )}

                        {/* PotPlayer */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            // 如果當前是代理播放模式，使用原始 URL；否則使用當前 videoUrl
                            let urlToUse = videoUrl;
                            if (sourceProxyMode && detail?.episodes && currentEpisodeIndex < detail.episodes.length) {
                              urlToUse = detail.episodes[currentEpisodeIndex];
                            }
                            // 使用代理 URL
                            const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                            const proxyUrl = externalPlayerAdBlock
                              ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(urlToUse)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                              : urlToUse;
                            // URL encode 避免冒號被吃掉
                            window.open(`potplayer://${proxyUrl}`, '_blank');
                          }}
                          className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 flex-shrink-0'
                          title='PotPlayer'
                        >
                          <img
                            src='/players/potplayer.png'
                            alt='PotPlayer'
                            className='w-4 h-4 flex-shrink-0'
                          />
                          <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                            PotPlayer
                          </span>
                        </button>

                        {/* VLC */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            // 如果當前是代理播放模式，使用原始 URL；否則使用當前 videoUrl
                            let urlToUse = videoUrl;
                            if (sourceProxyMode && detail?.episodes && currentEpisodeIndex < detail.episodes.length) {
                              urlToUse = detail.episodes[currentEpisodeIndex];
                            }
                            // 使用代理 URL
                            const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                            const proxyUrl = externalPlayerAdBlock
                              ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(urlToUse)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                              : urlToUse;
                            // URL encode 避免冒號被吃掉
                            window.open(`vlc://${proxyUrl}`, '_blank');
                          }}
                          className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 flex-shrink-0'
                          title='VLC'
                        >
                          <img
                            src='/players/vlc.png'
                            alt='VLC'
                            className='w-4 h-4 flex-shrink-0'
                          />
                          <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                            VLC
                          </span>
                        </button>

                        {/* MPV */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            // 如果當前是代理播放模式，使用原始 URL；否則使用當前 videoUrl
                            let urlToUse = videoUrl;
                            if (sourceProxyMode && detail?.episodes && currentEpisodeIndex < detail.episodes.length) {
                              urlToUse = detail.episodes[currentEpisodeIndex];
                            }
                            // 使用代理 URL
                            const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                            const proxyUrl = externalPlayerAdBlock
                              ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(urlToUse)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                              : urlToUse;
                            // URL encode 避免冒號被吃掉
                            window.open(`mpv://${proxyUrl}`, '_blank');
                          }}
                          className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 flex-shrink-0'
                          title='MPV'
                        >
                          <img
                            src='/players/mpv.png'
                            alt='MPV'
                            className='w-4 h-4 flex-shrink-0'
                          />
                          <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                            MPV
                          </span>
                        </button>

                        {/* MX Player */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            // 如果當前是代理播放模式，使用原始 URL；否則使用當前 videoUrl
                            let urlToUse = videoUrl;
                            if (sourceProxyMode && detail?.episodes && currentEpisodeIndex < detail.episodes.length) {
                              urlToUse = detail.episodes[currentEpisodeIndex];
                            }
                            // 使用代理 URL
                            const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                            const proxyUrl = externalPlayerAdBlock
                              ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(urlToUse)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                              : urlToUse;
                            window.open(
                              `intent://${proxyUrl}#Intent;package=com.mxtech.videoplayer.ad;S.title=${encodeURIComponent(
                                videoTitle
                              )};end`,
                              '_blank'
                            );
                          }}
                          className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 flex-shrink-0'
                          title='MX Player'
                        >
                          <img
                            src='/players/mxplayer.png'
                            alt='MX Player'
                            className='w-4 h-4 flex-shrink-0'
                          />
                          <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                            MX Player
                          </span>
                        </button>

                        {/* nPlayer */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            // 如果當前是代理播放模式，使用原始 URL；否則使用當前 videoUrl
                            let urlToUse = videoUrl;
                            if (sourceProxyMode && detail?.episodes && currentEpisodeIndex < detail.episodes.length) {
                              urlToUse = detail.episodes[currentEpisodeIndex];
                            }
                            // 使用代理 URL
                            const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                            const proxyUrl = externalPlayerAdBlock
                              ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(urlToUse)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                              : urlToUse;
                            window.open(`nplayer-${proxyUrl}`, '_blank');
                          }}
                          className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 flex-shrink-0'
                          title='nPlayer'
                        >
                          <img
                            src='/players/nplayer.png'
                            alt='nPlayer'
                            className='w-4 h-4 flex-shrink-0'
                          />
                          <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                            nPlayer
                          </span>
                        </button>

                        {/* IINA */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            // 如果當前是代理播放模式，使用原始 URL；否則使用當前 videoUrl
                            let urlToUse = videoUrl;
                            if (sourceProxyMode && detail?.episodes && currentEpisodeIndex < detail.episodes.length) {
                              urlToUse = detail.episodes[currentEpisodeIndex];
                            }
                            // 使用代理 URL
                            const tokenParam = proxyToken ? `&token=${encodeURIComponent(proxyToken)}` : '';
                            const proxyUrl = externalPlayerAdBlock
                              ? `${window.location.origin}/api/proxy-m3u8?url=${encodeURIComponent(urlToUse)}&source=${encodeURIComponent(currentSource)}${tokenParam}`
                              : urlToUse;
                            window.open(
                              `iina://weblink?url=${encodeURIComponent(
                                proxyUrl
                              )}`,
                              '_blank'
                            );
                          }}
                          className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 flex-shrink-0'
                          title='IINA'
                        >
                          <img
                            src='/players/iina.png'
                            alt='IINA'
                            className='w-4 h-4 flex-shrink-0'
                          />
                          <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                            IINA
                          </span>
                        </button>
                      </div>

                      {/* 去廣告開關 */}
                      <button
                        onClick={() => setExternalPlayerAdBlock(!externalPlayerAdBlock)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer border flex-shrink-0 ${externalPlayerAdBlock
                          ? 'bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white border-blue-400'
                          : 'bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'
                          }`}
                        title={externalPlayerAdBlock ? '去廣告已開啟' : '去廣告已關閉'}
                      >
                        <svg
                          className='w-4 h-4 flex-shrink-0'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          {externalPlayerAdBlock ? (
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth='2'
                              d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                            />
                          ) : (
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth='2'
                              d='M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636'
                            />
                          )}
                        </svg>
                        <span className='whitespace-nowrap'>
                          {externalPlayerAdBlock ? '去廣告' : '去廣告'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 選集和換源 - 在移動端始終顯示，在 lg 及以上可摺疊 */}
            <div
              className={`relative z-10 h-[350px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${isEpisodeSelectorCollapsed
                ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                : 'md:col-span-1 lg:opacity-100 lg:scale-100'
                }`}
            >
              <EpisodeSelector
                totalEpisodes={totalEpisodes}
                episodes_titles={detail?.episodes_titles || []}
                value={currentEpisodeIndex + 1}
                onChange={playSync.shouldDisableControls ? () => { /* disabled */ } : handleEpisodeChange}
                onSourceChange={playSync.shouldDisableControls ? () => { /* disabled */ } : handleSourceChange}
                isRoomMember={playSync.shouldDisableControls}
                currentSource={currentSource}
                currentId={currentId}
                episodeProgressContentKey={episodeProgressContentKey || undefined}
                videoTitle={searchTitle || videoTitle}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                backgroundSourcesLoading={backgroundSourcesLoading}
                precomputedVideoInfo={precomputedVideoInfo}
                onDanmakuSelect={(selection) => handleDanmakuSelect(selection, true)}
                currentDanmakuSelection={currentDanmakuSelection}
                onUploadDanmaku={handleUploadDanmaku}
                episodeFilterConfig={episodeFilterConfig}
                onFilterConfigUpdate={setEpisodeFilterConfig}
                onShowToast={(message, type) => {
                  setToast({ message, type, onClose: () => setToast(null) });
                }}
              />
            </div>
          </div>
        </div>

        {!isDirectPlay && (
          <>
            {/* 詳情展示 */}
            <div className='grid grid-cols-1 md:grid-cols-5 lg:grid-cols-6 gap-4'>
              {/* 文字區 */}
              <div className='md:col-span-4 lg:col-span-5'>
                <div className='p-6 flex flex-col min-h-0'>
                  {/* 標題 */}
                  <h1 className={`text-3xl font-bold mb-2 tracking-wide flex items-center flex-shrink-0 text-center md:text-left w-full flex-wrap gap-2 ${tmdbBackdrop ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
                    <span className={doubanAka.length > 0 ? 'relative group cursor-help' : ''}>
                      {videoTitle || '影片標題'}
                      {/* aka 懸浮提示 */}
                      {doubanAka.length > 0 && (
                        <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 dark:bg-gray-900 text-white text-sm rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 ease-out whitespace-nowrap z-[100] pointer-events-none'>
                          <div className='font-semibold text-xs text-gray-400 mb-1'>又名：</div>
                          {doubanAka.map((name, index) => (
                            <div key={index} className='text-sm'>
                              {name}
                            </div>
                          ))}
                          <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800 dark:border-t-gray-900'></div>
                        </div>
                      )}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFavorite();
                      }}
                      className='flex-shrink-0 hover:opacity-80 transition-opacity'
                    >
                      <FavoriteIcon filled={favorited} />
                    </button>
                    {/* 網盤搜索按鈕 */}
                    {netdiskSearchEnabled && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDrawer('pansou');
                        }}
                        className='flex-shrink-0 hover:opacity-80 transition-opacity'
                        title='搜索網盤資源'
                      >
                        <Cloud className='h-6 w-6 text-gray-700 dark:text-gray-300' />
                      </button>
                    )}
                    {/* AI問片按鈕 */}
                    {aiEnabled && detail && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDrawer('aiChat');
                        }}
                        className='flex-shrink-0 hover:opacity-80 transition-opacity'
                        title='AI問片'
                      >
                        <Sparkles className='h-6 w-6 text-gray-700 dark:text-gray-300' />
                      </button>
                    )}
                    {/* 詳情按鈕 */}
                    {detail && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDrawer('detail');
                        }}
                        className='flex-shrink-0 hover:opacity-80 transition-opacity px-2 py-1 text-base font-medium text-gray-700 dark:text-gray-300'
                        title='詳情'
                      >
                        詳
                      </button>
                    )}
                    {/* 糾錯按鈕 - 僅小雅源顯示 */}
                    {detail && detail.source === 'xiaoya' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDrawer('correct');
                        }}
                        className='flex-shrink-0 hover:opacity-80 transition-opacity'
                        title='糾錯'
                      >
                        <AlertCircle className='h-6 w-6 text-gray-700 dark:text-gray-300' />
                      </button>
                    )}
                    {/* 豆瓣評分顯示 */}
                    {doubanRating && doubanRating.value > 0 && (
                      <div className='flex items-center gap-2 text-base font-normal'>
                        {/* 星級顯示 */}
                        <div className='flex items-center gap-1'>
                          {[1, 2, 3, 4, 5].map((star) => {
                            const starValue = doubanRating.value / 2; // 轉換為5星制
                            const isFullStar = star <= Math.floor(starValue);
                            const isHalfStar = !isFullStar && star <= Math.ceil(starValue) && starValue % 1 >= 0.25;

                            return (
                              <div key={star} className='relative w-5 h-5'>
                                {isFullStar ? (
                                  // 全星
                                  <svg
                                    className='w-5 h-5 text-yellow-400 fill-yellow-400'
                                    viewBox='0 0 24 24'
                                    xmlns='http://www.w3.org/2000/svg'
                                  >
                                    <path d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' />
                                  </svg>
                                ) : isHalfStar ? (
                                  // 半星
                                  <>
                                    {/* 空星背景 */}
                                    <svg
                                      className='absolute w-5 h-5 text-gray-300 dark:text-gray-600 fill-gray-300 dark:fill-gray-600'
                                      viewBox='0 0 24 24'
                                      xmlns='http://www.w3.org/2000/svg'
                                    >
                                      <path d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' />
                                    </svg>
                                    {/* 半星遮罩 */}
                                    <svg
                                      className='absolute w-5 h-5 text-yellow-400 fill-yellow-400'
                                      viewBox='0 0 24 24'
                                      xmlns='http://www.w3.org/2000/svg'
                                      style={{ clipPath: 'inset(0 50% 0 0)' }}
                                    >
                                      <path d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' />
                                    </svg>
                                  </>
                                ) : (
                                  // 空星
                                  <svg
                                    className='w-5 h-5 text-gray-300 dark:text-gray-600 fill-gray-300 dark:fill-gray-600'
                                    viewBox='0 0 24 24'
                                    xmlns='http://www.w3.org/2000/svg'
                                  >
                                    <path d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' />
                                  </svg>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {/* 評分數值 */}
                        <span className='text-gray-700 dark:text-gray-300 font-semibold'>
                          {doubanRating.value.toFixed(1)}
                        </span>
                        {/* 評分人數 */}
                        <span className='text-gray-500 dark:text-gray-400 text-sm'>
                          ({doubanRating.count.toLocaleString()}人評價)
                        </span>
                      </div>
                    )}
                  </h1>

                  {/* 關鍵信息行 */}
                  <div className={`flex flex-wrap items-center gap-3 text-base mb-4 opacity-80 flex-shrink-0 ${tmdbBackdrop ? 'text-white' : ''}`}>
                    {detail?.class && (
                      <span className='text-green-600 font-semibold'>
                        {detail.class}
                      </span>
                    )}
                    {/* 優先使用 doubanYear，如果沒有則使用 detail.year 或 videoYear */}
                    {(doubanYear || netdiskTMDBMeta?.year || detail?.year || videoYear) && (
                      <span>{doubanYear || netdiskTMDBMeta?.year || detail?.year || videoYear}</span>
                    )}
                    {detail?.source_name && (
                      <span
                        className={`relative group cursor-pointer border px-2 py-[1px] rounded ${detail.source === 'xiaoya' ? 'border-blue-500' : isNetdiskSource(detail.source) ? 'border-purple-500' : detail.source === 'openlist' || detail.source === 'emby' || detail.source?.startsWith('emby_') ? 'border-yellow-500' : 'border-gray-500/60'
                          }`}
                        onClick={fetchCurrentSourceVideoInfo}
                      >
                        {detail.source_name}
                        {/* 視頻信息懸浮提示 */}
                        {currentSourceVideoInfo && (
                          <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 dark:bg-gray-900 text-white text-sm rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 ease-out whitespace-nowrap z-[100] pointer-events-none'>
                            <div className='text-sm'>
                              <div>分辨率: {currentSourceVideoInfo.quality}</div>
                              <div>碼率: {currentSourceVideoInfo.bitrate}</div>
                            </div>
                            <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800 dark:border-t-gray-900'></div>
                          </div>
                        )}
                      </span>
                    )}
                    {detail?.type_name && <span>{detail.type_name}</span>}
                  </div>
                  {/* 劇情簡介 */}
                  {(doubanCardSubtitle || netdiskTMDBMeta?.desc || correctedDesc || detail?.desc) && (
                    <div
                      className={`mt-0 text-base leading-relaxed opacity-90 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide ${tmdbBackdrop ? 'text-white' : ''}`}
                      style={{ whiteSpace: 'pre-line' }}
                    >
                      {/* card_subtitle 在前，desc 在後 */}
                      {doubanCardSubtitle && (
                        <div className='mb-3 pb-3 border-b border-gray-300 dark:border-gray-700'>
                          {doubanCardSubtitle}
                        </div>
                      )}
                      {netdiskTMDBMeta?.desc || correctedDesc || detail?.desc}
                    </div>
                  )}
                </div>
              </div>

              {/* 封面展示 */}
              <div className='hidden md:block md:col-span-1 md:order-first'>
                <div className='pl-0 py-4 pr-6 max-w-sm mx-auto'>
                  <div className='relative bg-gray-300 dark:bg-gray-700 aspect-[2/3] flex items-center justify-center rounded-xl overflow-hidden'>
                    {videoCover ? (
                      <>
                        <ProxyImage
                          originalSrc={videoCover}
                          alt={videoTitle}
                          className='w-full h-full object-cover'
                        />

                        {/* 豆瓣鏈接按鈕 */}
                        {videoDoubanId !== 0 && (
                          <a
                            href={`https://movie.douban.com/subject/${videoDoubanId.toString()}`}
                            target='_blank'
                            rel='noopener noreferrer'
                            className='absolute top-3 left-3'
                          >
                            <div className='bg-green-500 text-white text-xs font-bold w-8 h-8 rounded-full flex items-center justify-center shadow-md hover:bg-green-600 hover:scale-[1.1] transition-all duration-300 ease-out'>
                              <svg
                                width='16'
                                height='16'
                                viewBox='0 0 24 24'
                                fill='none'
                                stroke='currentColor'
                                strokeWidth='2'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                              >
                                <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'></path>
                                <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'></path>
                              </svg>
                            </div>
                          </a>
                        )}
                      </>
                    ) : (
                      isNetdiskSource(detail?.source) ? (
                        <div className='flex flex-col items-center justify-center text-gray-500 dark:text-gray-400'>
                          <Cloud className='w-16 h-16 opacity-80' />
                        </div>
                      ) : (
                        <span className='text-gray-600 dark:text-gray-400'>
                          封面圖片
                        </span>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 推薦區域 */}
            <SmartRecommendations
              doubanId={videoDoubanId !== 0 ? videoDoubanId : undefined}
              videoTitle={videoTitle}
            />

            {/* 豆瓣評論區域 */}
            {videoDoubanId !== 0 && enableComments && (
              <div className='mt-6 -mx-3 md:mx-0 md:px-4'>
                <div className='bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden'>
                  {/* 標題 */}
                  <div className='px-3 md:px-6 py-4 border-b border-gray-200 dark:border-gray-700'>
                    <h3 className='text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2'>
                      <svg className='w-5 h-5' fill='currentColor' viewBox='0 0 24 24'>
                        <path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z' />
                      </svg>
                      豆瓣評論
                    </h3>
                  </div>

                  {/* 評論內容 */}
                  <div className='p-3 md:p-6'>
                    <DoubanComments doubanId={videoDoubanId} />
                  </div>
                </div>
              </div>
            )}

            {/* AI評論區域 */}
            {videoTitle && enableAIComments && (
              <div className='mt-6 -mx-3 md:mx-0 md:px-4'>
                <div className='bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-xl border border-blue-200/50 dark:border-blue-700/50 overflow-hidden'>
                  {/* 標題 */}
                  <div className='px-3 md:px-6 py-4 border-b border-blue-200 dark:border-blue-700'>
                    <h3 className='text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2'>
                      <svg className='w-5 h-5 text-blue-600 dark:text-blue-400' fill='currentColor' viewBox='0 0 24 24'>
                        <path d='M13 10V3L4 14h7v7l9-11h-7z' />
                      </svg>
                      AI生成評論
                    </h3>
                  </div>

                  {/* 評論內容 */}
                  <div className='p-3 md:p-6'>
                    <AIComments movieName={videoTitle} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Toast通知 */}
      {toast && <Toast {...toast} />}

      {/* 下載選集面板 */}
      <DownloadEpisodeSelector
        isOpen={showDownloadSelector}
        onClose={() => setShowDownloadSelector(false)}
        totalEpisodes={totalEpisodes}
        episodesTitles={detail?.episodes_titles || []}
        videoTitle={videoTitle}
        currentEpisodeIndex={currentEpisodeIndex}
        onDownload={handleDownloadEpisode}
        enableOfflineDownload={enableOfflineDownload}
        hasOfflinePermission={hasOfflinePermission}
      />

      {/* 彈幕過濾設置對話框 */}
      <DanmakuFilterSettings
        isOpen={showDanmakuFilterSettings}
        onClose={() => setShowDanmakuFilterSettings(false)}
        onConfigUpdate={(config) => {
          setDanmakuFilterConfig(config);
          danmakuFilterConfigRef.current = config;

          // 重新加載彈幕以應用新的過濾規則
          if (danmakuPluginRef.current) {
            try {
              danmakuPluginRef.current.load();
              console.log('彈幕過濾規則已更新，重新加載彈幕');
            } catch (error) {
              console.error('重新加載彈幕失敗:', error);
            }
          }
        }}
        onShowToast={(message, type) => {
          setToast({
            message,
            type,
            onClose: () => setToast(null),
          });
        }}
      />

      {/* 網盤搜索彈窗 */}
      {showPansouDialog && (
        isLargeScreen ? (
          <Drawer
            isOpen={showPansouDialog}
            onClose={() => setShowPansouDialog(false)}
            title={`搜索網盤資源: ${detail?.title || ''}`}
            width='w-[400px]'
          >
            <div className='p-4'>
              <PansouSearch
                keyword={detail?.title || ''}
                triggerSearch={showPansouDialog}
              />
            </div>
          </Drawer>
        ) : (
          <div
            className='fixed inset-0 z-[10000] flex items-center justify-center bg-black/50'
            onClick={() => setShowPansouDialog(false)}
          >
            <div
              className='relative w-full max-w-4xl max-h-[80vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-lg shadow-xl m-4'
              onClick={(e) => e.stopPropagation()}
            >
              {/* 彈窗頭部 */}
              <div className='sticky top-0 z-10 flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'>
                <h2 className='text-xl font-bold text-gray-900 dark:text-gray-100'>
                  搜索網盤資源: {detail?.title || ''}
                </h2>
                <button
                  onClick={() => setShowPansouDialog(false)}
                  className='p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors'
                >
                  <X className='h-5 w-5 text-gray-600 dark:text-gray-400' />
                </button>
              </div>

              {/* 彈窗內容 */}
              <div className='p-4'>
                <PansouSearch
                  keyword={detail?.title || ''}
                  triggerSearch={showPansouDialog}
                />
              </div>
            </div>
          </div>
        )
      )}

      {/* AI問片面板 */}
      {aiEnabled && detail && (
        <AIChatPanel
          isOpen={showAIChat}
          onClose={() => setShowAIChat(false)}
          context={{
            title: detail.title,
            year: detail.year,
            douban_id: videoDoubanId !== 0 ? videoDoubanId : undefined,
            currentEpisode: currentEpisodeIndex + 1,
          }}
          welcomeMessage={aiDefaultMessageWithVideo ? aiDefaultMessageWithVideo.replace('{title}', detail.title || '') : `想了解《${detail.title}》的更多信息嗎？我可以幫你查詢劇情、演員、評價等。`}
          useDrawer={isLargeScreen}
          drawerWidth='w-[400px]'
        />
      )}

      {/* 糾錯彈窗 - 僅小雅源顯示 */}
      {detail && detail.source === 'xiaoya' && (
        <CorrectDialog
          isOpen={showCorrectDialog}
          onClose={() => setShowCorrectDialog(false)}
          videoKey={`${detail.source}_${detail.id}`}
          currentTitle={detail.title}
          currentVideo={{
            tmdbId: detail.tmdb_id,
            doubanId: detail.douban_id ? String(detail.douban_id) : undefined,
            poster: detail.poster,
            releaseDate: detail.year,
            overview: detail.desc,
            voteAverage: detail.rating,
            mediaType: detail.type_name === '電影' ? 'movie' : 'tv',
          }}
          source="xiaoya"
          onCorrect={() => {
            // 糾錯成功後的回調
            handleCorrectSuccess();
          }}
          useDrawer={isLargeScreen}
          drawerWidth='w-[400px]'
        />
      )}

      {/* 詳情面板 */}
      {detail && (
        <DetailPanel
          isOpen={showDetailPanel}
          onClose={() => setShowDetailPanel(false)}
          title={detail.title}
          poster={detail.poster}
          doubanId={
            // 特殊源使用 tmdb，其他使用 cms（通過 doubanId）
            // 如果有豆瓣ID且不為0，傳入doubanId
            detail.source === 'openlist' ||
              isNetdiskSource(detail.source) ||
              detail.source?.startsWith('emby') ||
              detail.source === 'xiaoya'
              ? undefined
              : detail.douban_id && detail.douban_id !== 0
                ? detail.douban_id
                : undefined
          }
          tmdbId={
            // 特殊源使用 tmdb
            detail.source === 'openlist' ||
              isNetdiskSource(detail.source) ||
              detail.source?.startsWith('emby') ||
              detail.source === 'xiaoya'
              ? detail.tmdb_id
              : undefined
          }
          type={detail.type_name === '電影' ? 'movie' : 'tv'}
          currentEpisode={currentEpisodeIndex + 1}
          cmsData={
            // 非特殊源使用 cms 數據
            // 但如果有豆瓣ID且不為0，則不傳入cmsData，優先使用豆瓣數據
            detail.source !== 'openlist' &&
              !isNetdiskSource(detail.source) &&
              !detail.source?.startsWith('emby') &&
              detail.source !== 'xiaoya' &&
              !(detail.douban_id && detail.douban_id !== 0)
              ? {
                desc: detail.desc,
                episodes: detail.episodes,
                episodes_titles: detail.episodes_titles,
              }
              : undefined
          }
          sourceId={detail.id}
          source={detail.source}
          useDrawer={isLargeScreen}
          drawerWidth='w-[400px]'
        />
      )}
    </PageLayout>
  );
}

// 從 localStorage 讀取小雅源的糾錯信息
const getXiaoyaCorrection = (source: string, id: string) => {
  try {
    const storageKey = `xiaoya_correction_${source}_${id}`;
    const correctionJson = localStorage.getItem(storageKey);
    if (correctionJson) {
      return JSON.parse(correctionJson);
    }
  } catch (error) {
    console.error('讀取糾錯信息失敗:', error);
  }
  return null;
};

// 應用糾錯信息到 detail 對象
const applyCorrection = (detail: SearchResult, correction: any): SearchResult => {
  return {
    ...detail,
    title: correction.title || detail.title,
    poster: correction.posterPath ? processImageUrl(getTMDBImageUrl(correction.posterPath)) : detail.poster,
    year: correction.releaseDate || detail.year,
    desc: correction.overview || detail.desc,
    rating: correction.voteAverage || detail.rating,
    tmdb_id: correction.tmdbId || detail.tmdb_id,
    douban_id: correction.doubanId ? (typeof correction.doubanId === 'string' ? parseInt(correction.doubanId, 10) : correction.doubanId) : detail.douban_id,
    type_name: correction.mediaType === 'movie' ? '電影' : (correction.mediaType === 'tv' ? '電視劇' : detail.type_name),
  };
};

// 批量應用糾錯信息到源列表
const applyCorrectionsToSources = (sources: SearchResult[]): SearchResult[] => {
  return sources.map(source => {
    if (source.source === 'xiaoya') {
      const correction = getXiaoyaCorrection(source.source, source.id);
      if (correction) {
        return applyCorrection(source, correction);
      }
    }
    return source;
  });
};

// FavoriteIcon 組件
const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-7 w-7'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='#ef4444' /* Tailwind red-500 */
          stroke='#ef4444'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-7 w-7 stroke-[1] text-gray-600 dark:text-gray-300' />
  );
};

export default function PlayPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayPageClient />
    </Suspense>
  );
}
