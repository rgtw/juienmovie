/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import { GitBranch, Heart, Radio, Tv } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  deleteFavorite,
  generateStorageKey,
  isFavorited as checkIsFavorited,
  saveFavorite,
  savePlayRecord,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { parseCustomTimeFormat } from '@/lib/time';
import { useLiveSync } from '@/hooks/useLiveSync';

import EpgScrollableRow from '@/components/EpgScrollableRow';
import PageLayout from '@/components/PageLayout';

// 擴展 HTMLVideoElement 類型以支持 hls 和 flv 屬性
declare global {
  interface HTMLVideoElement {
    hls?: any;
    flv?: any;
  }
}

// 動態導入瀏覽器專用庫
let Artplayer: any = null;
let Hls: any = null;
let flvjs: any = null;

// 直播頻道接口
interface LiveChannel {
  id: string;
  tvgId: string;
  name: string;
  logo: string;
  group: string;
  url: string;
}

type MergedChannelItem =
  | {
    type: 'single';
    key: string;
    channel: LiveChannel;
  }
  | {
    type: 'merged';
    key: string;
    name: string;
    group: string;
    logo: string;
    channels: LiveChannel[];
  };

// 直播源接口
interface LiveSource {
  key: string;
  name: string;
  url: string;  // m3u 地址
  ua?: string;
  epg?: string; // 節目單
  from: 'config' | 'custom';
  channelNumber?: number;
  disabled?: boolean;
  proxyMode?: 'full' | 'm3u8-only' | 'direct'; // 代理模式
}

function LivePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // 動態加載瀏覽器專用庫
  useEffect(() => {
    if (typeof window !== 'undefined') {
      import('artplayer').then(mod => { Artplayer = mod.default; });
      import('hls.js').then(mod => { Hls = mod.default; });
      import('flv.js').then(mod => { flvjs = mod.default; });

      const runtimeConfig = (window as any).RUNTIME_CONFIG;
      if (runtimeConfig?.LIVE_ENABLED === false) {
        router.replace('/');
      }
    }
  }, [router]);

  // -----------------------------------------------------------------------------
  // 狀態變量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'loading' | 'fetching' | 'ready'
  >('loading');
  const [loadingMessage, setLoadingMessage] = useState('正在加載直播源...');
  const [error, setError] = useState<string | null>(null);

  // 直播源相關
  const [liveSources, setLiveSources] = useState<LiveSource[]>([]);
  const [currentSource, setCurrentSource] = useState<LiveSource | null>(null);
  const currentSourceRef = useRef<LiveSource | null>(null);
  useEffect(() => {
    currentSourceRef.current = currentSource;
  }, [currentSource]);

  // 頻道相關
  const [currentChannels, setCurrentChannels] = useState<LiveChannel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<LiveChannel | null>(null);
  useEffect(() => {
    currentChannelRef.current = currentChannel;
  }, [currentChannel]);

  const [needLoadSource] = useState(searchParams.get('source'));
  const [needLoadChannel] = useState(searchParams.get('id'));

  // 播放器相關
  const [videoUrl, setVideoUrl] = useState('');
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [unsupportedType, setUnsupportedType] = useState<string | null>(null);

  // 切換直播源狀態
  const [isSwitchingSource, setIsSwitchingSource] = useState(false);

  // 分組相關
  const [groupedChannels, setGroupedChannels] = useState<{ [key: string]: LiveChannel[] }>({});
  const [selectedGroup, setSelectedGroup] = useState<string>('');

  // Tab 切換
  const [activeTab, setActiveTab] = useState<'channels' | 'sources'>('channels');

  // 頻道列表收起狀態
  const [isChannelListCollapsed, setIsChannelListCollapsed] = useState(false);

  // 過濾後的頻道列表
  const [filteredChannels, setFilteredChannels] = useState<LiveChannel[]>([]);

  // 搜索關鍵詞
  const [searchKeyword, setSearchKeyword] = useState('');
  const [expandedMergedChannels, setExpandedMergedChannels] = useState<string[]>([]);

  // 節目單信息
  const [epgData, setEpgData] = useState<{
    tvgId: string;
    source: string;
    epgUrl: string;
    programs: Array<{
      start: string;
      end: string;
      title: string;
    }>;
  } | null>(null);

  // EPG 數據加載狀態
  const [isEpgLoading, setIsEpgLoading] = useState(false);

  // 收藏狀態
  const [favorited, setFavorited] = useState(false);
  const favoritedRef = useRef(false);
  const currentChannelRef = useRef<LiveChannel | null>(null);

  // 觀影室同步功能
  const liveSync = useLiveSync({
    currentChannelId: currentChannel?.id || '',
    currentChannelName: currentChannel?.name || '',
    currentChannelUrl: currentChannel?.url || '',
    onChannelChange: (channelId, channelUrl) => {
      // 房員接收到頻道切換指令
      if (!currentChannels || !Array.isArray(currentChannels)) return;
      const channel = currentChannels.find(c => c.id === channelId);
      if (channel) {
        handleChannelChange(channel);
      }
    },
  });

  // EPG數據清洗函數 - 去除重疊的節目，保留時間較短的，顯示今日節目（18點後包含明天10點前的節目）
  const cleanEpgData = (programs: Array<{ start: string; end: string; title: string }>) => {
    if (!programs || programs.length === 0) return programs;

    // 獲取當前時間
    const now = new Date();
    const currentHour = now.getHours();

    // 獲取今日日期（只考慮年月日，忽略時間）
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    // 如果當前時間超過18點，擴展到明天10點
    let endTime = todayEnd;
    if (currentHour >= 18) {
      // 明天10點
      endTime = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 10, 0, 0);
    }

    // 首先過濾出符合時間範圍的節目（包括跨天節目）
    const filteredPrograms = programs.filter(program => {
      const programStart = parseCustomTimeFormat(program.start);
      const programEnd = parseCustomTimeFormat(program.end);

      // 使用時間戳進行比較
      const programStartTime = programStart.getTime();
      const programEndTime = programEnd.getTime();
      const todayStartTime = todayStart.getTime();
      const endTimeValue = endTime.getTime();

      // 節目的開始時間在範圍內，或者節目在範圍內播放（開始時間早於範圍開始，但結束時間在範圍內）
      return programStartTime < endTimeValue && programEndTime > todayStartTime;
    });

    // 按開始時間排序
    const sortedPrograms = [...filteredPrograms].sort((a, b) => {
      const startA = parseCustomTimeFormat(a.start).getTime();
      const startB = parseCustomTimeFormat(b.start).getTime();
      return startA - startB;
    });

    const cleanedPrograms: Array<{ start: string; end: string; title: string }> = [];

    for (let i = 0; i < sortedPrograms.length; i++) {
      const currentProgram = sortedPrograms[i];
      const currentStart = parseCustomTimeFormat(currentProgram.start);
      const currentEnd = parseCustomTimeFormat(currentProgram.end);

      // 檢查是否與已添加的節目重疊
      let hasOverlap = false;

      for (const existingProgram of cleanedPrograms) {
        const existingStart = parseCustomTimeFormat(existingProgram.start);
        const existingEnd = parseCustomTimeFormat(existingProgram.end);

        // 檢查時間重疊（考慮完整的日期和時間）
        if (
          (currentStart >= existingStart && currentStart < existingEnd) || // 當前節目開始時間在已存在節目時間段內
          (currentEnd > existingStart && currentEnd <= existingEnd) || // 當前節目結束時間在已存在節目時間段內
          (currentStart <= existingStart && currentEnd >= existingEnd) // 當前節目完全包含已存在節目
        ) {
          hasOverlap = true;
          break;
        }
      }

      // 如果沒有重疊，則添加該節目
      if (!hasOverlap) {
        cleanedPrograms.push(currentProgram);
      } else {
        // 如果有重疊，檢查是否需要替換已存在的節目
        for (let j = 0; j < cleanedPrograms.length; j++) {
          const existingProgram = cleanedPrograms[j];
          const existingStart = parseCustomTimeFormat(existingProgram.start);
          const existingEnd = parseCustomTimeFormat(existingProgram.end);

          // 檢查是否與當前節目重疊（考慮完整的日期和時間）
          if (
            (currentStart >= existingStart && currentStart < existingEnd) ||
            (currentEnd > existingStart && currentEnd <= existingEnd) ||
            (currentStart <= existingStart && currentEnd >= existingEnd)
          ) {
            // 計算節目時長
            const currentDuration = currentEnd.getTime() - currentStart.getTime();
            const existingDuration = existingEnd.getTime() - existingStart.getTime();

            // 如果當前節目時間更短，則替換已存在的節目
            if (currentDuration < existingDuration) {
              cleanedPrograms[j] = currentProgram;
            }
            break;
          }
        }
      }
    }

    return cleanedPrograms;
  };

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

  // 播放器引用
  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);

  // 分組標籤滾動相關
  const groupContainerRef = useRef<HTMLDivElement>(null);
  const groupButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const channelListRef = useRef<HTMLDivElement>(null);

  // -----------------------------------------------------------------------------
  // 工具函數（Utils）
  // -----------------------------------------------------------------------------

  // 獲取 logo URL（始終使用代理）
  const getLogoUrl = (logoUrl: string, sourceKey: string) => {
    if (!logoUrl) return '';
    return `/api/proxy/logo?url=${encodeURIComponent(logoUrl)}&source=${sourceKey}`;
  };

  // 獲取直播源列表
  const fetchLiveSources = async () => {
    try {
      setLoadingStage('fetching');
      setLoadingMessage('正在獲取直播源...');

      // 獲取 AdminConfig 中的直播源信息
      const response = await fetch('/api/live/sources');
      if (!response.ok) {
        throw new Error('獲取直播源失敗');
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || '獲取直播源失敗');
      }

      const sources = result.data;
      setLiveSources(sources);

      if (sources.length > 0) {
        // 默認選中第一個源
        const firstSource = sources[0];
        if (needLoadSource) {
          const foundSource = sources.find((s: LiveSource) => s.key === needLoadSource);
          if (foundSource) {
            setCurrentSource(foundSource);
            await fetchChannels(foundSource);
          } else {
            setCurrentSource(firstSource);
            await fetchChannels(firstSource);
          }
        } else {
          setCurrentSource(firstSource);
          await fetchChannels(firstSource);
        }
      }

      setLoadingStage('ready');
      setLoadingMessage('✨ 準備就緒...');

      setTimeout(() => {
        setLoading(false);
      }, 1000);
    } catch (err) {
      console.error('獲取直播源失敗:', err);
      // 不設置錯誤，而是顯示空狀態
      setLiveSources([]);
      setLoading(false);
    }
  };

  // 獲取頻道列表
  const fetchChannels = async (source: LiveSource) => {
    try {
      setIsVideoLoading(true);

      // 從 cachedLiveChannels 獲取頻道信息
      const response = await fetch(`/api/live/channels?source=${source.key}`);
      if (!response.ok) {
        throw new Error('獲取頻道列表失敗');
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || '獲取頻道列表失敗');
      }

      const channelsData = result.data;
      if (!channelsData || channelsData.length === 0) {
        // 不拋出錯誤，而是設置空頻道列表
        setCurrentChannels([]);
        setGroupedChannels({});
        setFilteredChannels([]);

        // 更新直播源的頻道數為 0
        setLiveSources(prevSources =>
          prevSources.map(s =>
            s.key === source.key ? { ...s, channelNumber: 0 } : s
          )
        );

        setIsVideoLoading(false);
        return;
      }

      // 轉換頻道數據格式
      const channels: LiveChannel[] = channelsData.map((channel: any) => ({
        id: channel.id,
        tvgId: channel.tvgId || channel.name,
        name: channel.name,
        logo: channel.logo,
        group: channel.group || '其他',
        url: channel.url
      }));

      setCurrentChannels(channels);

      // 更新直播源的頻道數
      setLiveSources(prevSources =>
        prevSources.map(s =>
          s.key === source.key ? { ...s, channelNumber: channels.length } : s
        )
      );

      // 默認選中第一個頻道
      if (channels.length > 0) {
        let selectedChannel: LiveChannel | null = null;

        if (needLoadChannel) {
          const foundChannel = channels.find((c: LiveChannel) => c.id === needLoadChannel);
          if (foundChannel) {
            selectedChannel = foundChannel;
            setCurrentChannel(foundChannel);
            setVideoUrl(foundChannel.url);
            // 延遲滾動到選中的頻道
            setTimeout(() => {
              scrollToChannel(foundChannel);
            }, 200);
          } else {
            selectedChannel = channels[0];
            setCurrentChannel(channels[0]);
            setVideoUrl(channels[0].url);
          }
        } else {
          selectedChannel = channels[0];
          setCurrentChannel(channels[0]);
          setVideoUrl(channels[0].url);
        }

        // 異步獲取初始頻道的節目單（不阻塞頁面加載）
        if (selectedChannel) {
          fetchEpgData(selectedChannel, source);

          // 保存播放記錄
          try {
            await savePlayRecord(`live_${source.key}`, `live_${selectedChannel.id}`, {
              title: selectedChannel.name,
              source_name: source.name,
              year: '',
              cover: getLogoUrl(selectedChannel.logo, source.key),
              index: 1,
              total_episodes: 1,
              play_time: 0,
              total_time: 0,
              save_time: Date.now(),
              search_title: '',
              origin: 'live',
            });
          } catch (err) {
            console.error('保存播放記錄失敗:', err);
          }

          // 更新URL參數
          const newSearchParams = new URLSearchParams(searchParams.toString());
          newSearchParams.set('source', source.key);
          newSearchParams.set('id', selectedChannel.id);

          const newUrl = `?${newSearchParams.toString()}`;
          router.replace(newUrl);
        }
      }

      // 按分組組織頻道
      const grouped = channels.reduce((acc, channel) => {
        const group = channel.group || '其他';
        if (!acc[group]) {
          acc[group] = [];
        }
        acc[group].push(channel);
        return acc;
      }, {} as { [key: string]: LiveChannel[] });

      setGroupedChannels(grouped);

      // 默認選中當前加載的channel所在的分組，如果沒有則選中第一個分組
      let targetGroup = '';
      if (needLoadChannel) {
        const foundChannel = channels.find((c: LiveChannel) => c.id === needLoadChannel);
        if (foundChannel) {
          targetGroup = foundChannel.group || '其他';
        }
      }

      // 如果目標分組不存在，則使用第一個分組
      if (!targetGroup || !grouped[targetGroup]) {
        targetGroup = Object.keys(grouped)[0] || '';
      }

      // 先設置過濾後的頻道列表，但不設置選中的分組
      setFilteredChannels(targetGroup ? grouped[targetGroup] : channels);

      // 觸發模擬點擊分組，讓模擬點擊來設置分組狀態和觸發滾動
      if (targetGroup) {
        // 確保切換到頻道tab
        setActiveTab('channels');

        // 使用更長的延遲，確保狀態更新和DOM渲染完成
        setTimeout(() => {
          simulateGroupClick(targetGroup);
        }, 500); // 增加延遲時間，確保狀態更新和DOM渲染完成
      }

      setIsVideoLoading(false);
    } catch (err) {
      console.error('獲取頻道列表失敗:', err);
      // 不設置錯誤，而是設置空頻道列表
      setCurrentChannels([]);
      setGroupedChannels({});
      setFilteredChannels([]);

      // 更新直播源的頻道數為 0
      setLiveSources(prevSources =>
        prevSources.map(s =>
          s.key === source.key ? { ...s, channelNumber: 0 } : s
        )
      );

      setIsVideoLoading(false);
    }
  };

  // 切換直播源
  const handleSourceChange = async (source: LiveSource) => {
    try {
      // 設置切換狀態，鎖住頻道切換器
      setIsSwitchingSource(true);

      // 首先銷燬當前播放器
      cleanupPlayer();

      // 重置不支持的類型狀態
      setUnsupportedType(null);

      // 清空節目單信息
      setEpgData(null);

      // 清空搜索關鍵詞
      setSearchKeyword('');

      setCurrentSource(source);
      await fetchChannels(source);

      // 更新URL參數 - 切換直播源時清除頻道id，因為新的直播源會有不同的頻道列表
      const newSearchParams = new URLSearchParams(searchParams.toString());
      newSearchParams.set('source', source.key);
      newSearchParams.delete('id'); // 清除頻道id

      const newUrl = `?${newSearchParams.toString()}`;
      router.replace(newUrl);
    } catch (err) {
      console.error('切換直播源失敗:', err);
      // 不設置錯誤，保持當前狀態
    } finally {
      // 切換完成，解鎖頻道切換器
      setIsSwitchingSource(false);
      // 自動切換到頻道 tab
      setActiveTab('channels');
    }
  };

  // 獲取節目單信息的輔助函數
  const fetchEpgData = async (channel: LiveChannel, source: LiveSource) => {
    if (channel.tvgId && source) {
      try {
        setIsEpgLoading(true); // 開始加載 EPG 數據
        const response = await fetch(`/api/live/epg?source=${source.key}&tvgId=${channel.tvgId}`);
        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            // 清洗EPG數據，去除重疊的節目
            const cleanedData = {
              ...result.data,
              programs: cleanEpgData(result.data.programs)
            };
            setEpgData(cleanedData);
          }
        }
      } catch (error) {
        console.error('獲取節目單信息失敗:', error);
      } finally {
        setIsEpgLoading(false); // 無論成功失敗都結束加載狀態
      }
    } else {
      // 如果沒有 tvgId 或 source，清空 EPG 數據
      setEpgData(null);
      setIsEpgLoading(false);
    }
  };

  // 切換頻道
  const handleChannelChange = async (channel: LiveChannel) => {
    // 如果正在切換直播源，則禁用頻道切換
    if (isSwitchingSource) return;

    // 首先銷燬當前播放器
    cleanupPlayer();

    // 重置不支持的類型狀態
    setUnsupportedType(null);

    setCurrentChannel(channel);
    setVideoUrl(channel.url);

    // 更新URL參數
    if (currentSource) {
      const newSearchParams = new URLSearchParams(searchParams.toString());
      newSearchParams.set('source', currentSource.key);
      newSearchParams.set('id', channel.id);

      const newUrl = `?${newSearchParams.toString()}`;
      router.replace(newUrl);
    }

    // 自動滾動到選中的頻道位置
    setTimeout(() => {
      scrollToChannel(channel);
    }, 100);

    // 獲取節目單信息
    if (currentSource) {
      await fetchEpgData(channel, currentSource);
    }

    // 保存播放記錄
    if (currentSource) {
      try {
        await savePlayRecord(`live_${currentSource.key}`, `live_${channel.id}`, {
          title: channel.name,
          source_name: currentSource.name,
          year: '',
          cover: getLogoUrl(channel.logo, currentSource.key),
          index: 1,
          total_episodes: 1,
          play_time: 0,
          total_time: 0,
          save_time: Date.now(),
          search_title: '',
          origin: 'live',
        });
      } catch (err) {
        console.error('保存播放記錄失敗:', err);
      }
    }
  };

  // 滾動到指定頻道位置的函數
  const scrollToChannel = (channel: LiveChannel) => {
    if (!channelListRef.current) return;

    // 使用 data 屬性來查找頻道元素
    const targetElement = channelListRef.current.querySelector(`[data-channel-id="${channel.id}"]`) as HTMLButtonElement;

    if (targetElement) {
      // 計算滾動位置，使頻道居中顯示
      const container = channelListRef.current;
      const containerRect = container.getBoundingClientRect();
      const elementRect = targetElement.getBoundingClientRect();

      // 計算目標滾動位置
      const scrollTop = container.scrollTop + (elementRect.top - containerRect.top) - (containerRect.height / 2) + (elementRect.height / 2);

      // 平滑滾動到目標位置
      container.scrollTo({
        top: Math.max(0, scrollTop),
        behavior: 'smooth'
      });
    }
  };

  // 模擬點擊分組的函數
  const simulateGroupClick = (group: string, retryCount = 0) => {
    if (!groupContainerRef.current) {
      if (retryCount < 10) {
        setTimeout(() => {
          simulateGroupClick(group, retryCount + 1);
        }, 200);
        return;
      } else {
        return;
      }
    }

    // 直接通過 data-group 屬性查找目標按鈕
    const targetButton = groupContainerRef.current.querySelector(`[data-group="${group}"]`) as HTMLButtonElement;

    if (targetButton) {
      // 手動設置分組狀態，確保狀態一致性
      setSelectedGroup(group);

      // 觸發點擊事件
      (targetButton as HTMLButtonElement).click();
    }
  };

  // 初始化Anime4K超分
  const initAnime4K = async () => {
    if (!artPlayerRef.current?.video) return;

    let frameRequestId: number | null = null;
    let outputCanvas: HTMLCanvasElement | null = null;

    try {
      if (anime4kRef.current) {
        anime4kRef.current.stop?.();
        anime4kRef.current = null;
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
          if (video.videoWidth && video.videoHeight) {
            video.removeEventListener('loadedmetadata', handler);
            resolve();
          }
        });
      }

      if (!video.videoWidth || !video.videoHeight) {
        throw new Error('無法獲取視頻尺寸');
      }

      // 檢測是否為Firefox
      const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');

      // 創建輸出canvas
      outputCanvas = document.createElement('canvas');
      const container = artPlayerRef.current.template.$video.parentElement;

      const scale = anime4kScaleRef.current;
      outputCanvas.width = Math.floor(video.videoWidth * scale);
      outputCanvas.height = Math.floor(video.videoHeight * scale);

      if (!outputCanvas.width || !outputCanvas.height ||
          !isFinite(outputCanvas.width) || !isFinite(outputCanvas.height)) {
        throw new Error(`outputCanvas尺寸無效: ${outputCanvas.width}x${outputCanvas.height}`);
      }

      outputCanvas.style.position = 'absolute';
      outputCanvas.style.top = '0';
      outputCanvas.style.left = '0';
      outputCanvas.style.width = '100%';
      outputCanvas.style.height = '100%';
      outputCanvas.style.objectFit = 'contain';
      outputCanvas.style.cursor = 'pointer';
      outputCanvas.style.zIndex = '1';
      outputCanvas.style.backgroundColor = 'transparent';

      // Firefox兼容性處理
      let sourceCanvas: HTMLCanvasElement | null = null;
      let sourceCtx: CanvasRenderingContext2D | null = null;

      if (isFirefox) {
        sourceCanvas = document.createElement('canvas');
        const canvasW = Math.floor(video.videoWidth);
        const canvasH = Math.floor(video.videoHeight);
        sourceCanvas.width = canvasW;
        sourceCanvas.height = canvasH;

        if (!sourceCanvas.width || !sourceCanvas.height) {
          throw new Error(`sourceCanvas尺寸無效: ${sourceCanvas.width}x${sourceCanvas.height}`);
        }

        sourceCtx = sourceCanvas.getContext('2d', {
          willReadFrequently: true,
          alpha: false
        });

        if (!sourceCtx) {
          throw new Error('無法創建2D上下文');
        }

        if (video.readyState >= video.HAVE_CURRENT_DATA) {
          sourceCtx.drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);
        }
      }

      // 監聽點擊和雙擊事件
      const handleCanvasClick = () => {
        if (artPlayerRef.current) {
          artPlayerRef.current.toggle();
        }
      };
      const handleCanvasDblClick = () => {
        if (artPlayerRef.current) {
          artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        }
      };
      outputCanvas.addEventListener('click', handleCanvasClick);
      outputCanvas.addEventListener('dblclick', handleCanvasDblClick);

      // 隱藏原始video
      video.style.opacity = '0';
      video.style.pointerEvents = 'none';
      video.style.position = 'absolute';
      video.style.zIndex = '-1';

      container.insertBefore(outputCanvas, video);

      // Firefox視頻幀捕獲
      if (isFirefox && sourceCtx && sourceCanvas) {
        const captureVideoFrame = () => {
          if (sourceCtx && sourceCanvas && video.readyState >= video.HAVE_CURRENT_DATA) {
            sourceCtx.drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);
          }
          frameRequestId = requestAnimationFrame(captureVideoFrame);
        };
        captureVideoFrame();
      }

      // 動態導入anime4k-webgpu
      const { render: anime4kRender, ModeA, ModeB, ModeC, ModeAA, ModeBB, ModeCA } = await import(
        /* webpackChunkName: "anime4k-webgpu" */
        /* webpackMode: "lazy" */
        'anime4k-webgpu'
      );

      let ModeClass: any;
      const modeName = anime4kModeRef.current;

      switch (modeName) {
        case 'ModeA': ModeClass = ModeA; break;
        case 'ModeB': ModeClass = ModeB; break;
        case 'ModeC': ModeClass = ModeC; break;
        case 'ModeAA': ModeClass = ModeAA; break;
        case 'ModeBB': ModeClass = ModeBB; break;
        case 'ModeCA': ModeClass = ModeCA; break;
        default: ModeClass = ModeA;
      }

      const renderConfig: any = {
        video: isFirefox ? sourceCanvas : video,
        canvas: outputCanvas,
        pipelineBuilder: (device: GPUDevice, inputTexture: GPUTexture) => {
          if (!outputCanvas) {
            throw new Error('outputCanvas is null in pipelineBuilder');
          }
          const mode = new ModeClass({
            device,
            inputTexture,
            nativeDimensions: {
              width: Math.floor(video.videoWidth),
              height: Math.floor(video.videoHeight),
            },
            targetDimensions: {
              width: Math.floor(outputCanvas.width),
              height: Math.floor(outputCanvas.height),
            },
          });
          return [mode];
        },
      };

      const controller = await anime4kRender(renderConfig);

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

      // 清理已創建的資源
      if (frameRequestId) {
        cancelAnimationFrame(frameRequestId);
      }

      if (outputCanvas && outputCanvas.parentNode) {
        outputCanvas.parentNode.removeChild(outputCanvas);
      }

      if (artPlayerRef.current?.video) {
        artPlayerRef.current.video.style.opacity = '1';
        artPlayerRef.current.video.style.pointerEvents = 'auto';
        artPlayerRef.current.video.style.position = '';
        artPlayerRef.current.video.style.zIndex = '';
      }

      // 顯示錯誤信息
      if (artPlayerRef.current) {
        const errorMsg = err instanceof Error ? err.message : '未知錯誤';
        artPlayerRef.current.notice.show = '超分啟用失敗：' + errorMsg;
      }

      // 重新拋出錯誤，讓調用者知道失敗了
      throw err;
    }
  };

  // 清理Anime4K
  const cleanupAnime4K = async () => {
    if (anime4kRef.current) {
      try {
        if (anime4kRef.current.frameRequestId) {
          cancelAnimationFrame(anime4kRef.current.frameRequestId);
        }

        anime4kRef.current.controller?.stop?.();

        if (anime4kRef.current.canvas) {
          if (anime4kRef.current.handleCanvasClick) {
            anime4kRef.current.canvas.removeEventListener('click', anime4kRef.current.handleCanvasClick);
          }
          if (anime4kRef.current.handleCanvasDblClick) {
            anime4kRef.current.canvas.removeEventListener('dblclick', anime4kRef.current.handleCanvasDblClick);
          }
        }

        if (anime4kRef.current.canvas && anime4kRef.current.canvas.parentNode) {
          anime4kRef.current.canvas.parentNode.removeChild(anime4kRef.current.canvas);
        }

        if (anime4kRef.current.sourceCanvas) {
          const ctx = anime4kRef.current.sourceCanvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, anime4kRef.current.sourceCanvas.width, anime4kRef.current.sourceCanvas.height);
          }
        }

        anime4kRef.current = null;

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
        // 檢查視頻是否準備好
        if (!artPlayerRef.current?.video) {
          if (artPlayerRef.current) {
            artPlayerRef.current.notice.show = '視頻未準備好，請稍後再試';
          }
          return false;
        }
        await initAnime4K();
      } else {
        await cleanupAnime4K();
      }
      setAnime4kEnabled(enabled);
      localStorage.setItem('enable_anime4k', String(enabled));
      return enabled;
    } catch (err) {
      console.error('切換超分狀態失敗:', err);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = '切換超分狀態失敗';
      }
      return !enabled; // 返回原來的狀態
    }
  };

  // 更改Anime4K模式
  const changeAnime4KMode = async (mode: string) => {
    try {
      setAnime4kMode(mode);
      localStorage.setItem('anime4k_mode', mode);

      if (anime4kEnabledRef.current) {
        // 檢查視頻是否準備好
        if (!artPlayerRef.current?.video) {
          if (artPlayerRef.current) {
            artPlayerRef.current.notice.show = '視頻未準備好，請稍後再試';
          }
          return;
        }
        await cleanupAnime4K();
        await initAnime4K();
      }
    } catch (err) {
      console.error('更改超分模式失敗:', err);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = '更改超分模式失敗';
      }
    }
  };

  // 更改Anime4K分辨率倍數
  const changeAnime4KScale = async (scale: number) => {
    try {
      setAnime4kScale(scale);
      localStorage.setItem('anime4k_scale', scale.toString());

      if (anime4kEnabledRef.current) {
        // 檢查視頻是否準備好
        if (!artPlayerRef.current?.video) {
          if (artPlayerRef.current) {
            artPlayerRef.current.notice.show = '視頻未準備好，請稍後再試';
          }
          return;
        }
        await cleanupAnime4K();
        await initAnime4K();
      }
    } catch (err) {
      console.error('更改超分倍數失敗:', err);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = '更改超分倍數失敗';
      }
    }
  };

  // 清理播放器資源的統一函數
  const cleanupPlayer = () => {
    // 重置不支持的類型狀態
    setUnsupportedType(null);

    // 清理Anime4K
    cleanupAnime4K();

    if (artPlayerRef.current) {
      try {
        // 先暫停播放
        if (artPlayerRef.current.video) {
          artPlayerRef.current.video.pause();
          artPlayerRef.current.video.src = '';
          artPlayerRef.current.video.load();
        }

        // 銷燬 HLS 實例
        if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
          artPlayerRef.current.video.hls.destroy();
          artPlayerRef.current.video.hls = null;
        }

        // 銷燬 FLV 實例 - 增強清理邏輯
        if (artPlayerRef.current.video && artPlayerRef.current.video.flv) {
          try {
            // 先停止加載
            if (artPlayerRef.current.video.flv.unload) {
              artPlayerRef.current.video.flv.unload();
            }
            // 銷燬播放器
            artPlayerRef.current.video.flv.destroy();
            // 確保引用被清空
            artPlayerRef.current.video.flv = null;
          } catch (flvError) {
            console.warn('FLV實例銷燬時出錯:', flvError);
            // 強制清空引用
            artPlayerRef.current.video.flv = null;
          }
        }

        // 移除所有事件監聽器
        artPlayerRef.current.off('ready');
        artPlayerRef.current.off('loadstart');
        artPlayerRef.current.off('loadeddata');
        artPlayerRef.current.off('canplay');
        artPlayerRef.current.off('waiting');
        artPlayerRef.current.off('error');

        // 銷燬 ArtPlayer 實例
        artPlayerRef.current.destroy();
        artPlayerRef.current = null;
      } catch (err) {
        console.warn('清理播放器資源時出錯:', err);
        artPlayerRef.current = null;
      }
    }
  };

  // 確保視頻源正確設置
  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 移除舊的 source，保持唯一
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 始終允許遠程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾經有禁用屬性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  // 過濾頻道（根據分組和搜索關鍵詞）
  const filterChannels = (group: string, keyword: string) => {
    if (!currentChannels || !Array.isArray(currentChannels)) return [];

    let filtered = currentChannels.filter(channel => channel.group === group);

    // 如果有搜索關鍵詞，進一步過濾
    if (keyword.trim()) {
      filtered = filtered.filter(channel =>
        channel.name.toLowerCase().includes(keyword.toLowerCase())
      );
    }

    return filtered;
  };

  const mergedChannelItems = useMemo<MergedChannelItem[]>(() => {
    if (!filteredChannels || filteredChannels.length === 0) return [];

    const mergedMap = new Map<string, {
      key: string;
      name: string;
      group: string;
      logo: string;
      channels: LiveChannel[];
    }>();
    const order: string[] = [];

    filteredChannels.forEach((channel) => {
      const mergedKey = `${channel.group}::${channel.name.trim().toLowerCase()}`;
      const existing = mergedMap.get(mergedKey);

      if (existing) {
        existing.channels.push(channel);
        if (!existing.logo && channel.logo) {
          existing.logo = channel.logo;
        }
        return;
      }

      mergedMap.set(mergedKey, {
        key: mergedKey,
        name: channel.name,
        group: channel.group,
        logo: channel.logo,
        channels: [channel],
      });
      order.push(mergedKey);
    });

    return order.map((key) => {
      const item = mergedMap.get(key)!;
      if (item.channels.length === 1) {
        return {
          type: 'single',
          key,
          channel: item.channels[0],
        };
      }

      return {
        type: 'merged',
        key,
        name: item.name,
        group: item.group,
        logo: item.logo,
        channels: item.channels,
      };
    });
  }, [filteredChannels]);

  const toggleMergedChannel = (key: string) => {
    setExpandedMergedChannels((prev) => (
      prev.includes(key)
        ? prev.filter(item => item !== key)
        : [...prev, key]
    ));
  };

  // 切換分組
  const handleGroupChange = (group: string) => {
    // 如果正在切換直播源，則禁用分組切換
    if (isSwitchingSource) return;

    setSelectedGroup(group);
    const filtered = filterChannels(group, searchKeyword);
    setFilteredChannels(filtered);

    // 如果當前選中的頻道在新的分組中，自動滾動到該頻道位置
    if (currentChannel && filtered.some(channel => channel.id === currentChannel.id)) {
      setTimeout(() => {
        scrollToChannel(currentChannel);
      }, 100);
    } else {
      // 否則滾動到頻道列表頂端
      if (channelListRef.current) {
        channelListRef.current.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }
    }
  };

  // 處理搜索
  const handleSearch = (keyword: string) => {
    setSearchKeyword(keyword);

    if (!selectedGroup) return;

    // 先在當前分組搜索
    const filtered = filterChannels(selectedGroup, keyword);

    // 如果當前分組沒有匹配的頻道，且有搜索關鍵詞，輪詢所有分組
    if (filtered.length === 0 && keyword.trim() && groupedChannels) {
      const groups = Object.keys(groupedChannels);

      // 輪詢所有分組，找到第一個有匹配頻道的分組
      for (const group of groups) {
        const groupFiltered = filterChannels(group, keyword);
        if (groupFiltered.length > 0) {
          // 找到有匹配頻道的分組，自動切換
          setSelectedGroup(group);
          setFilteredChannels(groupFiltered);

          // 滾動到頻道列表頂端
          if (channelListRef.current) {
            channelListRef.current.scrollTo({
              top: 0,
              behavior: 'smooth'
            });
          }

          return;
        }
      }
    }

    // 如果當前分組有匹配的頻道，或者所有分組都沒有匹配的頻道，使用當前分組的結果
    setFilteredChannels(filtered);
  };

  // 切換收藏
  const handleToggleFavorite = async () => {
    if (!currentSourceRef.current || !currentChannelRef.current) return;

    try {
      const currentFavorited = favoritedRef.current;
      const newFavorited = !currentFavorited;

      // 立即更新狀態
      setFavorited(newFavorited);
      favoritedRef.current = newFavorited;

      // 異步執行收藏操作
      try {
        if (newFavorited) {
          // 如果未收藏，添加收藏
          await saveFavorite(`live_${currentSourceRef.current.key}`, `live_${currentChannelRef.current.id}`, {
            title: currentChannelRef.current.name,
            source_name: currentSourceRef.current.name,
            year: '',
            cover: getLogoUrl(currentChannelRef.current.logo, currentSourceRef.current.key),
            total_episodes: 1,
            save_time: Date.now(),
            search_title: '',
            origin: 'live',
          });
        } else {
          // 如果已收藏，刪除收藏
          await deleteFavorite(`live_${currentSourceRef.current.key}`, `live_${currentChannelRef.current.id}`);
        }
      } catch (err) {
        console.error('收藏操作失敗:', err);
        // 如果操作失敗，回滾狀態
        setFavorited(currentFavorited);
        favoritedRef.current = currentFavorited;
      }
    } catch (err) {
      console.error('切換收藏失敗:', err);
    }
  };

  // 檢測WebGPU支持
  useEffect(() => {
    const checkWebGPUSupport = async () => {
      if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
        setWebGPUSupported(false);
        console.log('WebGPU不支持：瀏覽器不支持WebGPU API');
        return;
      }

      try {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (!adapter) {
          setWebGPUSupported(false);
          console.log('WebGPU不支持：無法獲取GPU適配器');
          return;
        }

        setWebGPUSupported(true);
        console.log('WebGPU支持檢測：✅ 支持');
      } catch (err) {
        setWebGPUSupported(false);
        console.log('WebGPU不支持：', err);
      }
    };

    checkWebGPUSupport();
  }, []);

  // 初始化
  useEffect(() => {
    fetchLiveSources();
  }, []);

  // 檢查收藏狀態
  useEffect(() => {
    if (!currentSource || !currentChannel) return;
    (async () => {
      try {
        const fav = await checkIsFavorited(`live_${currentSource.key}`, `live_${currentChannel.id}`);
        setFavorited(fav);
        favoritedRef.current = fav;
      } catch (err) {
        console.error('檢查收藏狀態失敗:', err);
      }
    })();
  }, [currentSource, currentChannel]);

  // 監聽收藏數據更新事件
  useEffect(() => {
    if (!currentSource || !currentChannel) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(`live_${currentSource.key}`, `live_${currentChannel.id}`);
        const isFav = !!favorites[key];
        setFavorited(isFav);
        favoritedRef.current = isFav;
      }
    );

    return unsubscribe;
  }, [currentSource, currentChannel]);

  // 當分組切換時，將激活的分組標籤滾動到視口中間
  useEffect(() => {
    if (!selectedGroup || !groupContainerRef.current || !groupedChannels) return;

    const groupKeys = Object.keys(groupedChannels);
    const groupIndex = groupKeys.indexOf(selectedGroup);
    if (groupIndex === -1) return;

    const btn = groupButtonRefs.current?.[groupIndex];
    const container = groupContainerRef.current;
    if (btn && container) {
      // 手動計算滾動位置，只滾動分組標籤容器
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;

      // 計算按鈕相對於容器的位置
      const btnLeft = btnRect.left - containerRect.left + scrollLeft;
      const btnWidth = btnRect.width;
      const containerWidth = containerRect.width;

      // 計算目標滾動位置，使按鈕居中
      const targetScrollLeft = btnLeft - (containerWidth - btnWidth) / 2;

      // 平滑滾動到目標位置
      container.scrollTo({
        left: targetScrollLeft,
        behavior: 'smooth',
      });
    }
  }, [selectedGroup, groupedChannels]);

  function m3u8Loader(video: HTMLVideoElement, url: string) {
    if (!Hls) {
      console.error('HLS.js 未加載');
      return;
    }

    class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
      constructor(config: any) {
        super(config);
        const load = this.load.bind(this);
        this.load = function (context: any, config: any, callbacks: any) {
          // 判斷當前直播源的代理模式
          const currentLiveSource = currentSourceRef.current;
          const proxyMode = currentLiveSource?.proxyMode || 'full';

          // 攔截manifest和level請求
          if (
            (context as any).type === 'manifest' ||
            (context as any).type === 'level'
          ) {
            // manifest 請求處理
            if ((context as any).type === 'manifest') {
              if (proxyMode === 'full') {
                // 全量代理：添加 source 參數
                try {
                  const url = new URL(context.url);
                  url.searchParams.set('moontv-source', currentSourceRef.current?.key || '');
                  context.url = url.toString();
                } catch (error) {
                  // ignore
                }
              } else if (proxyMode === 'm3u8-only') {
                // 僅代理m3u8模式：添加 source 參數和 allowCORS 參數
                try {
                  const url = new URL(context.url);
                  url.searchParams.set('moontv-source', currentSourceRef.current?.key || '');
                  url.searchParams.set('allowCORS', 'true');
                  context.url = url.toString();
                } catch (error) {
                  context.url = context.url + '&allowCORS=true';
                }
              }
              // direct 模式：直接使用原始 URL，不添加任何參數
            }

            // level 請求（ts 分片）處理
            if ((context as any).type === 'level') {
              if (proxyMode === 'full') {
                // 全量代理：添加 source 參數
                try {
                  const url = new URL(context.url);
                  url.searchParams.set('moontv-source', currentSourceRef.current?.key || '');
                  context.url = url.toString();
                } catch (error) {
                  // ignore
                }
              }
              // m3u8-only 模式：ts 分片 URL 已經被代理服務器重寫為原始 URL，不需要添加參數
              // direct 模式：ts 分片直接使用原始 URL，不添加任何參數
            }
          }
          // 執行原始load方法
          load(context, config, callbacks);
        };
      }
    }

    // 清理之前的 HLS 實例
    if (video.hls) {
      try {
        video.hls.destroy();
        video.hls = null;
      } catch (err) {
        console.warn('清理 HLS 實例時出錯:', err);
      }
    }

    const hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: true,
      maxBufferLength: 30,
      backBufferLength: 30,
      maxBufferSize: 60 * 1000 * 1000,
      loader: CustomHlsJsLoader,
    });

    hls.loadSource(url);
    hls.attachMedia(video);
    video.hls = hls;

    hls.on(Hls.Events.ERROR, function (event: any, data: any) {
      console.error('HLS Error:', event, data);

      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            // hls.recoverMediaError();
            break;
          default:
            hls.destroy();
            break;
        }
      }
    });
  }

  function flvLoader(video: HTMLVideoElement, url: string) {
    if (!flvjs) {
      console.error('FLV.js 未加載');
      return;
    }

    // 清理之前的 FLV 實例
    if (video.flv) {
      try {
        if (video.flv.unload) {
          video.flv.unload();
        }
        video.flv.destroy();
        video.flv = null;
      } catch (err) {
        console.warn('清理 FLV 實例時出錯:', err);
      }
    }

    const flvPlayer = flvjs.createPlayer({
      type: 'flv',
      url,
      isLive: true
    });
    flvPlayer.attachMediaElement(video);
    flvPlayer.on(flvjs.Events.ERROR, (errorType: string, errorDetail: string) => {
      console.error('FLV.js error:', errorType, errorDetail);
    });
    flvPlayer.load();
    video.flv = flvPlayer;
  }

  // 播放器初始化
  useEffect(() => {
    const preload = async () => {
      if (
        !Artplayer ||
        !Hls ||
        !flvjs ||
        !videoUrl ||
        !artRef.current ||
        !currentChannel
      ) {
        return;
      }

      console.log('視頻URL:', videoUrl);

      // 銷燬之前的播放器實例並創建新的
      if (artPlayerRef.current) {
        cleanupPlayer();
      }

      // precheck type
      let type = 'm3u8';
      const proxyMode = currentSourceRef.current?.proxyMode || 'full';

      // 直連模式：跳過服務器預檢查，直接使用 m3u8
      if (proxyMode === 'direct') {
        type = 'm3u8';
      } else {
        // 全量代理或僅代理m3u8：通過服務器預檢查
        try {
          const precheckUrl = `/api/live/precheck?url=${encodeURIComponent(videoUrl)}&moontv-source=${currentSourceRef.current?.key || ''}`;
          const precheckResponse = await fetch(precheckUrl);
          if (!precheckResponse.ok) {
            console.error('預檢查失敗:', precheckResponse.statusText);
            setIsVideoLoading(false);
            return;
          }
          const precheckResult = await precheckResponse.json();
          if (precheckResult?.success && precheckResult?.type) {
            type = precheckResult.type;
          } else {
            console.error('預檢查返回無效結果:', precheckResult);
            setIsVideoLoading(false);
            return;
          }
        } catch (err) {
          console.error('預檢查異常:', err);
          setIsVideoLoading(false);
          return;
        }
      }

      // 如果不是 m3u8、flv 或 mp4 類型，設置不支持的類型並返回
      if (type !== 'm3u8' && type !== 'flv' && type !== 'mp4') {
        setUnsupportedType(type);
        setIsVideoLoading(false);
        return;
      }

      // 重置不支持的類型
      setUnsupportedType(null);

      const customType = { m3u8: m3u8Loader, flv: flvLoader };

      // 根據代理模式決定 URL
      let targetUrl = videoUrl;
      if (type === 'm3u8') {
        if (proxyMode === 'direct') {
          // 直連模式：直接使用原始 URL
          targetUrl = videoUrl;
        } else {
          // 全量代理或僅代理m3u8：使用代理 URL
          targetUrl = `/api/proxy/m3u8?url=${encodeURIComponent(videoUrl)}&moontv-source=${currentSourceRef.current?.key || ''}`;
        }
      }

      try {
        // 創建新的播放器實例
        Artplayer.USE_RAF = true;

        artPlayerRef.current = new Artplayer({
          container: artRef.current,
          url: targetUrl,
          poster: currentChannel.logo,
          volume: 0.7,
          isLive: true, // 設置為直播模式
          muted: false,
          autoplay: true,
          pip: true,
          autoSize: false,
          autoMini: false,
          screenshot: false,
          setting: webGPUSupported, // 只有支持WebGPU時才顯示設置按鈕
          loop: false,
          flip: false,
          playbackRate: false,
          aspectRatio: false,
          fullscreen: true,
          fullscreenWeb: true,
          subtitleOffset: false,
          miniProgressBar: false,
          mutex: true,
          playsInline: true,
          autoPlayback: false,
          airplay: true,
          theme: '#22c55e',
          lang: 'zh-cn',
          hotkey: false,
          fastForward: false, // 直播不需要快進
          autoOrientation: true,
          lock: true,
          moreVideoAttr: {
            crossOrigin: 'anonymous',
            preload: 'metadata',
          },
          type: type,
          customType: customType,
          icons: {
            loading:
              '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
          },
          settings: [
            ...(webGPUSupported ? [
              {
                name: 'Anime4K超分',
                html: 'Anime4K超分',
                icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 18c-4 0-7-3-7-7V9l7-3.5L19 9v4c0 4-3 7-7 7z" fill="#ffffff"/><path d="M10 12l2 2 4-4" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
                switch: anime4kEnabledRef.current,
                onSwitch: async function (item: any) {
                  const newVal = !item.switch;
                  const result = await toggleAnime4K(newVal);
                  return result;
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
          ],
        });

        // 監聽播放器事件
        artPlayerRef.current.on('ready', () => {
          setError(null);
          setIsVideoLoading(false);

        });

        artPlayerRef.current.on('loadstart', () => {
          setIsVideoLoading(true);
        });

        artPlayerRef.current.on('loadeddata', () => {
          setIsVideoLoading(false);
        });

        artPlayerRef.current.on('canplay', () => {
          setIsVideoLoading(false);
        });

        artPlayerRef.current.on('waiting', () => {
          setIsVideoLoading(true);
        });

        artPlayerRef.current.on('error', (err: any) => {
          console.error('播放器錯誤:', err);
        });

        if (artPlayerRef.current?.video) {
          ensureVideoSource(
            artPlayerRef.current.video as HTMLVideoElement,
            targetUrl
          );
        }

      } catch (err) {
        console.error('創建播放器失敗:', err);
        // 不設置錯誤，只記錄日誌
      }
    }
    preload();
  }, [Artplayer, Hls, videoUrl, currentChannel, loading]);

  // 清理播放器資源
  useEffect(() => {
    return () => {
      cleanupPlayer();
    };
  }, []);

  // 頁面卸載時的額外清理
  useEffect(() => {
    const handleBeforeUnload = () => {
      cleanupPlayer();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      cleanupPlayer();
    };
  }, []);

  // 全局快捷鍵處理
  useEffect(() => {
    const handleKeyboardShortcuts = (e: KeyboardEvent) => {
      // 忽略輸入框中的按鍵事件
      if (
        (e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'TEXTAREA'
      )
        return;

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

    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  if (loading) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 動畫直播圖標 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>📺</div>
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
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${loadingStage === 'loading' ? 'bg-green-500 scale-125' : 'bg-green-500'
                    }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${loadingStage === 'fetching' ? 'bg-green-500 scale-125' : 'bg-green-500'
                    }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${loadingStage === 'ready' ? 'bg-green-500 scale-125' : 'bg-gray-300'
                    }`}
                ></div>
              </div>

              {/* 進度條 */}
              <div className='w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden'>
                <div
                  className='h-full bg-gradient-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-1000 ease-out'
                  style={{
                    width:
                      loadingStage === 'loading' ? '33%' : loadingStage === 'fetching' ? '66%' : '100%',
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
      <PageLayout activePath='/live'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 錯誤圖標 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>😵</div>
                {/* 脈衝效果 */}
                <div className='absolute -inset-2 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl opacity-20 animate-pulse'></div>
              </div>
            </div>

            {/* 錯誤信息 */}
            <div className='space-y-4 mb-8'>
              <h2 className='text-2xl font-bold text-gray-800 dark:text-gray-200'>
                哎呀，出現了一些問題
              </h2>
              <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4'>
                <p className='text-red-600 dark:text-red-400 font-medium'>
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
                onClick={() => window.location.reload()}
                className='w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-cyan-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl'
              >
                🔄 重新嘗試
              </button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/live'>
      <div className='flex flex-col gap-3 py-4 px-5 lg:px-[3rem] 2xl:px-20'>
        {/* 第一行：頁面標題 */}
        <div className='py-1'>
          <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 max-w-[80%]'>
            <Radio className='w-5 h-5 text-blue-500 flex-shrink-0' />
            <div className='min-w-0 flex-1'>
              <div className='truncate'>
                {currentSource?.name}
                {currentSource && currentChannel && (
                  <span className='text-gray-500 dark:text-gray-400'>
                    {` > ${currentChannel.name}`}
                  </span>
                )}
                {currentSource && !currentChannel && (
                  <span className='text-gray-500 dark:text-gray-400'>
                    {` > ${currentSource.name}`}
                  </span>
                )}
              </div>
            </div>
          </h1>
        </div>

        {/* 第二行：播放器和頻道列表 */}
        <div className='space-y-2'>
          {/* 摺疊控制 - 僅在 lg 及以上屏幕顯示 */}
          <div className='hidden lg:flex justify-end'>
            <button
              onClick={() =>
                setIsChannelListCollapsed(!isChannelListCollapsed)
              }
              className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-800 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-all duration-200'
              title={
                isChannelListCollapsed ? '顯示頻道列表' : '隱藏頻道列表'
              }
            >
              <svg
                className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isChannelListCollapsed ? 'rotate-180' : 'rotate-0'
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
                {isChannelListCollapsed ? '顯示' : '隱藏'}
              </span>

              {/* 精緻的狀態指示點 */}
              <div
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${isChannelListCollapsed
                  ? 'bg-orange-400 animate-pulse'
                  : 'bg-green-400'
                  }`}
              ></div>
            </button>
          </div>

          <div className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${isChannelListCollapsed
            ? 'grid-cols-1'
            : 'grid-cols-1 md:grid-cols-4'
            }`}>
            {/* 播放器 */}
            <div className={`h-full transition-all duration-300 ease-in-out ${isChannelListCollapsed ? 'col-span-1' : 'md:col-span-3'}`}>
              <div className='relative w-full h-[300px] lg:h-full'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg border border-white/0 dark:border-white/30'
                ></div>

                {/* 不支持的直播類型提示 */}
                {unsupportedType && (
                  <div className='absolute inset-0 bg-black/90 backdrop-blur-sm rounded-xl overflow-hidden shadow-lg border border-white/0 dark:border-white/30 flex items-center justify-center z-[600] transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      <div className='relative mb-8'>
                        <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-orange-500 to-red-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                          <div className='text-white text-4xl'>⚠️</div>
                          <div className='absolute -inset-2 bg-gradient-to-r from-orange-500 to-red-600 rounded-2xl opacity-20 animate-pulse'></div>
                        </div>
                      </div>
                      <div className='space-y-4'>
                        <h3 className='text-xl font-semibold text-white'>
                          暫不支持的直播流類型
                        </h3>
                        <div className='bg-orange-500/20 border border-orange-500/30 rounded-lg p-4'>
                          <p className='text-orange-300 font-medium'>
                            當前頻道直播流類型：<span className='text-white font-bold'>{unsupportedType.toUpperCase()}</span>
                          </p>
                          <p className='text-sm text-orange-200 mt-2'>
                            目前僅支持 M3U8 格式的直播流
                          </p>
                        </div>
                        <p className='text-sm text-gray-300'>
                          請嘗試其他頻道
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 視頻加載蒙層 */}
                {isVideoLoading && (
                  <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl overflow-hidden shadow-lg border border-white/0 dark:border-white/30 flex items-center justify-center z-[500] transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      <div className='relative mb-8'>
                        <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                          <div className='text-white text-4xl'>📺</div>
                          <div className='absolute -inset-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
                        </div>
                      </div>
                      <div className='space-y-2'>
                        <p className='text-xl font-semibold text-white animate-pulse'>
                          🔄 IPTV 加載中...
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 外部播放器按鈕 - 觀影室同步狀態下隱藏 */}
              {videoUrl && !liveSync.isInRoom && (
                <div className='mt-3 px-2 lg:flex-shrink-0 flex justify-end'>
                  <div className='bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-lg p-2 border border-gray-200/50 dark:border-gray-700/50 w-full lg:w-auto overflow-x-auto'>
                    <div className='flex gap-1.5 justify-end lg:flex-wrap items-center'>
                      {/* 網頁播放 */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          // 在新標籤頁打開視頻URL
                          window.open(videoUrl, '_blank');
                        }}
                        className='group relative flex items-center justify-center gap-1 w-8 h-8 lg:w-auto lg:h-auto lg:px-2 lg:py-1.5 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-xs font-medium rounded-md transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 flex-shrink-0'
                        title='網頁播放'
                      >
                        <svg
                          className='w-4 h-4 flex-shrink-0 text-gray-700 dark:text-gray-200'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                          />
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z'
                          />
                        </svg>
                        <span className='hidden lg:inline max-w-0 group-hover:max-w-[100px] overflow-hidden whitespace-nowrap transition-all duration-200 ease-in-out text-gray-700 dark:text-gray-200'>
                          網頁播放
                        </span>
                      </button>

                      {/* PotPlayer */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          // 直接使用原始 URL,不使用代理
                          window.open(`potplayer://${videoUrl}`, '_blank');
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
                          // 直接使用原始 URL,不使用代理
                          window.open(`vlc://${videoUrl}`, '_blank');
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
                          // 直接使用原始 URL,不使用代理
                          window.open(`mpv://${videoUrl}`, '_blank');
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
                          // 直接使用原始 URL,不使用代理
                          window.open(
                            `intent://${videoUrl}#Intent;package=com.mxtech.videoplayer.ad;S.title=${encodeURIComponent(
                              currentChannel?.name || '直播'
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
                          // 直接使用原始 URL,不使用代理
                          window.open(`nplayer-${videoUrl}`, '_blank');
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
                          // 直接使用原始 URL,不使用代理
                          window.open(
                            `iina://weblink?url=${encodeURIComponent(videoUrl)}`,
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
                  </div>
                </div>
              )}
            </div>

            {/* 頻道列表 */}
            <div className={`h-[330px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${isChannelListCollapsed
              ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
              : 'md:col-span-1 lg:opacity-100 lg:scale-100'
              }`}>
              <div className='md:ml-2 px-4 py-0 h-full rounded-xl bg-black/10 dark:bg-white/5 flex flex-col border border-white/0 dark:border-white/30 overflow-hidden'>
                {/* 主要的 Tab 切換 */}
                <div className='flex mb-1 -mx-6 flex-shrink-0'>
                  <div
                    onClick={() => setActiveTab('channels')}
                    className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
                      ${activeTab === 'channels'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
                      }
                    `.trim()}
                  >
                    頻道
                  </div>
                  <div
                    onClick={() => setActiveTab('sources')}
                    className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
                      ${activeTab === 'sources'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
                      }
                    `.trim()}
                  >
                    直播源
                  </div>
                </div>

                {/* 頻道 Tab 內容 */}
                {activeTab === 'channels' && (
                  <>
                    {/* 搜索框 */}
                    <div className='mb-3 -mx-6 px-6 flex-shrink-0'>
                      <div className='relative'>
                        <input
                          type='text'
                          value={searchKeyword}
                          onChange={(e) => handleSearch(e.target.value)}
                          placeholder='搜索頻道...'
                          disabled={isSwitchingSource}
                          className={`w-full px-3 py-2 pl-9 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all ${
                            isSwitchingSource ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                        />
                        <svg
                          className='absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
                          />
                        </svg>
                        {searchKeyword && (
                          <button
                            onClick={() => handleSearch('')}
                            className='absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                          >
                            <svg
                              className='w-4 h-4'
                              fill='none'
                              stroke='currentColor'
                              viewBox='0 0 24 24'
                            >
                              <path
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                strokeWidth={2}
                                d='M6 18L18 6M6 6l12 12'
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 分組標籤 */}
                    <div className='flex items-center gap-4 mb-4 border-b border-gray-300 dark:border-gray-700 -mx-6 px-6 flex-shrink-0'>
                      {/* 切換狀態提示 */}
                      {isSwitchingSource && (
                        <div className='flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400'>
                          <div className='w-2 h-2 bg-amber-500 rounded-full animate-pulse'></div>
                          切換直播源中...
                        </div>
                      )}

                      <div
                        className='flex-1 overflow-x-auto'
                        ref={groupContainerRef}
                        onMouseEnter={() => {
                          // 鼠標進入分組標籤區域時，添加滾輪事件監聽
                          const container = groupContainerRef.current;
                          if (container) {
                            const handleWheel = (e: WheelEvent) => {
                              if (container.scrollWidth > container.clientWidth) {
                                e.preventDefault();
                                container.scrollLeft += e.deltaY;
                              }
                            };
                            container.addEventListener('wheel', handleWheel, { passive: false });
                            // 將事件處理器存儲在容器上，以便後續移除
                            (container as any)._wheelHandler = handleWheel;
                          }
                        }}
                        onMouseLeave={() => {
                          // 鼠標離開分組標籤區域時，移除滾輪事件監聽
                          const container = groupContainerRef.current;
                          if (container && (container as any)._wheelHandler) {
                            container.removeEventListener('wheel', (container as any)._wheelHandler);
                            delete (container as any)._wheelHandler;
                          }
                        }}
                      >
                        <div className='flex gap-4 min-w-max'>
                          {groupedChannels && Object.keys(groupedChannels).map((group, index) => (
                            <button
                              key={group}
                              data-group={group}
                              ref={(el) => {
                                groupButtonRefs.current[index] = el;
                              }}
                              onClick={() => handleGroupChange(group)}
                              disabled={isSwitchingSource}
                              className={`w-20 relative py-2 text-sm font-medium transition-colors flex-shrink-0 text-center overflow-hidden
                                 ${isSwitchingSource
                                  ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50'
                                  : selectedGroup === group
                                    ? 'text-green-500 dark:text-green-400'
                                    : 'text-gray-700 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400'
                                }
                               `.trim()}
                            >
                              <div className='px-1 overflow-hidden whitespace-nowrap' title={group}>
                                {group}
                              </div>
                              {selectedGroup === group && !isSwitchingSource && (
                                <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-green-500 dark:bg-green-400' />
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 頻道列表 */}
                    <div ref={channelListRef} className='flex-1 overflow-y-auto space-y-2 pb-4'>
                      {mergedChannelItems?.length > 0 ? (
                        mergedChannelItems.map(item => {
                          if (item.type === 'single') {
                            const channel = item.channel;
                            const isActive = channel.id === currentChannel?.id;
                            return (
                              <button
                                key={channel.id}
                                data-channel-id={channel.id}
                                onClick={() => handleChannelChange(channel)}
                                disabled={isSwitchingSource}
                                className={`w-full p-3 rounded-lg text-left transition-all duration-200 ${isSwitchingSource
                                  ? 'opacity-50 cursor-not-allowed'
                                  : isActive
                                    ? 'bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700'
                                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                                  }`}
                              >
                                <div className='flex items-center gap-3'>
                                  <div className='w-10 h-10 bg-gray-300 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden'>
                                    {channel.logo ? (
                                      <img
                                        src={getLogoUrl(channel.logo, currentSource?.key || '')}
                                        alt={channel.name}
                                        className='w-full h-full rounded object-contain'
                                        loading="lazy"
                                      />
                                    ) : (
                                      <Tv className='w-5 h-5 text-gray-500' />
                                    )}
                                  </div>
                                  <div className='flex-1 min-w-0'>
                                    <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate' title={channel.name}>
                                      {channel.name}
                                    </div>
                                    <div className='text-xs text-gray-500 dark:text-gray-400 mt-1' title={channel.group}>
                                      {channel.group}
                                    </div>
                                  </div>
                                </div>
                              </button>
                            );
                          }

                          const isExpanded = expandedMergedChannels.includes(item.key);
                          const activeLineIndex = item.channels.findIndex(channel => channel.id === currentChannel?.id);
                          const hasActiveChild = activeLineIndex !== -1;

                          return (
                            <div
                              key={item.key}
                              className='space-y-2'
                            >
                              <button
                                type='button'
                                onClick={() => {
                                  handleChannelChange(item.channels[0]);
                                }}
                                disabled={isSwitchingSource}
                                className={`w-full p-3 rounded-lg text-left transition-all duration-200 ${isSwitchingSource
                                  ? 'opacity-50 cursor-not-allowed'
                                  : hasActiveChild
                                    ? 'bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700'
                                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                                  }`}
                              >
                                <div className='flex items-center gap-3'>
                                  <div className='w-10 h-10 bg-gray-300 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden'>
                                    {item.logo ? (
                                      <img
                                        src={getLogoUrl(item.logo, currentSource?.key || '')}
                                        alt={item.name}
                                        className='w-full h-full rounded object-contain'
                                        loading='lazy'
                                      />
                                    ) : (
                                      <Tv className='w-5 h-5 text-gray-500' />
                                    )}
                                  </div>
                                  <div className='flex-1 min-w-0'>
                                    <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate' title={item.name}>
                                      {item.name}
                                    </div>
                                    <div className='text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-2'>
                                      <span title={item.group}>{item.group}</span>
                                      <span>·</span>
                                      <span>{item.channels.length} 條線路</span>
                                      {hasActiveChild && (
                                        <>
                                          <span>·</span>
                                          <span>{`當前線路${activeLineIndex + 1}`}</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  <div className='flex flex-col items-end gap-2 flex-shrink-0'>
                                    <span
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleMergedChannel(item.key);
                                      }}
                                      className='text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                                    >
                                      {isExpanded ? '收起' : '展開'}
                                    </span>
                                  </div>
                                </div>
                              </button>

                              {isExpanded && (
                                <div className='pl-4 space-y-2'>
                                  {item.channels.map((channel, index) => {
                                    const isActive = channel.id === currentChannel?.id;
                                    return (
                                      <button
                                        key={channel.id}
                                        type='button'
                                        data-channel-id={channel.id}
                                        onClick={() => handleChannelChange(channel)}
                                        disabled={isSwitchingSource}
                                        className={`w-full p-3 rounded-lg text-left text-sm transition-all duration-200 ${
                                          isSwitchingSource
                                            ? 'opacity-50 cursor-not-allowed'
                                            : isActive
                                              ? 'bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700'
                                              : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                                        }`}
                                      >
                                        <div className='flex items-center justify-between gap-3'>
                                          <span className='font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2'>
                                            <GitBranch className='w-4 h-4 text-gray-500 dark:text-gray-400' />
                                            {`線路${index + 1}`}
                                          </span>
                                          {isActive && (
                                            <span className='text-xs text-green-600 dark:text-green-400'>
                                              當前播放
                                            </span>
                                          )}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className='flex flex-col items-center justify-center py-12 text-center'>
                          <div className='w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4'>
                            {searchKeyword ? (
                              <svg
                                className='w-8 h-8 text-gray-400 dark:text-gray-600'
                                fill='none'
                                stroke='currentColor'
                                viewBox='0 0 24 24'
                              >
                                <path
                                  strokeLinecap='round'
                                  strokeLinejoin='round'
                                  strokeWidth={2}
                                  d='M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
                                />
                              </svg>
                            ) : (
                              <Tv className='w-8 h-8 text-gray-400 dark:text-gray-600' />
                            )}
                          </div>
                          <p className='text-gray-500 dark:text-gray-400 font-medium'>
                            {searchKeyword ? '未找到匹配的頻道' : '暫無可用頻道'}
                          </p>
                          <p className='text-sm text-gray-400 dark:text-gray-500 mt-1'>
                            {searchKeyword ? '請嘗試其他搜索關鍵詞' : '請選擇其他直播源或稍後再試'}
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* 直播源 Tab 內容 */}
                {activeTab === 'sources' && (
                  <div className='flex flex-col h-full mt-4'>
                    <div className='flex-1 overflow-y-auto space-y-2 pb-20'>
                      {liveSources?.length > 0 ? (
                        liveSources.map((source) => {
                          const isCurrentSource = source.key === currentSource?.key;
                          return (
                            <div
                              key={source.key}
                              onClick={() => !isCurrentSource && handleSourceChange(source)}
                              className={`flex items-start gap-3 px-2 py-3 rounded-lg transition-all select-none duration-200 relative
                                ${isCurrentSource
                                  ? 'bg-green-500/10 dark:bg-green-500/20 border-green-500/30 border'
                                  : 'hover:bg-gray-200/50 dark:hover:bg-white/10 hover:scale-[1.02] cursor-pointer'
                                }`.trim()}
                            >
                              {/* 圖標 */}
                              <div className='w-12 h-12 bg-gray-200 dark:bg-gray-600 rounded-lg flex items-center justify-center flex-shrink-0'>
                                <Radio className='w-6 h-6 text-gray-500' />
                              </div>

                              {/* 信息 */}
                              <div className='flex-1 min-w-0'>
                                <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                                  {source.name}
                                </div>
                                <div className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                                  {!source.channelNumber || source.channelNumber === 0 ? '-' : `${source.channelNumber} 個頻道`}
                                </div>
                              </div>

                              {/* 當前標識 */}
                              {isCurrentSource && (
                                <div className='absolute top-2 right-2 w-2 h-2 bg-green-500 rounded-full'></div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className='flex flex-col items-center justify-center py-12 text-center'>
                          <div className='w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4'>
                            <Radio className='w-8 h-8 text-gray-400 dark:text-gray-600' />
                          </div>
                          <p className='text-gray-500 dark:text-gray-400 font-medium'>
                            暫無可用直播源
                          </p>
                          <p className='text-sm text-gray-400 dark:text-gray-500 mt-1'>
                            請檢查網絡連接或聯繫管理員添加直播源
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 當前頻道信息 */}
        {currentChannel && (
          <div className='pt-4'>
            <div className='flex flex-col lg:flex-row gap-4'>
              {/* 頻道圖標+名稱 - 在小屏幕上佔100%，大屏幕佔20% */}
              <div className='w-full flex-shrink-0'>
                <div className='flex items-center gap-4'>
                  <div className='w-20 h-20 bg-gray-300 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden'>
                    {currentChannel.logo ? (
                      <img
                        src={getLogoUrl(currentChannel.logo, currentSource?.key || '')}
                        alt={currentChannel.name}
                        className='w-full h-full rounded object-contain'
                        loading="lazy"
                      />
                    ) : (
                      <Tv className='w-10 h-10 text-gray-500' />
                    )}
                  </div>
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-3'>
                      <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 truncate'>
                        {currentChannel.name}
                      </h3>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFavorite();
                        }}
                        className='flex-shrink-0 hover:opacity-80 transition-opacity'
                        title={favorited ? '取消收藏' : '收藏'}
                      >
                        <FavoriteIcon filled={favorited} />
                      </button>
                    </div>
                    <p className='text-sm text-gray-500 dark:text-gray-400 truncate'>
                      {currentSource?.name} {' > '} {currentChannel.group}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* EPG節目單 */}
            <EpgScrollableRow
              programs={epgData?.programs || []}
              currentTime={new Date()}
              isLoading={isEpgLoading}
            />
          </div>
        )}
      </div>
    </PageLayout>
  );
}

// FavoriteIcon 組件
const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-6 w-6'
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
    <Heart className='h-6 w-6 stroke-[1] text-gray-600 dark:text-gray-300' />
  );
};

export default function LivePage() {
  return <LivePageClient />;
}
