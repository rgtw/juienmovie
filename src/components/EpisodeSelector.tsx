/* eslint-disable @next/next/no-img-element */

import { Link as LinkIcon, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { DanmakuComment,DanmakuSelection } from '@/lib/danmaku/types';
import { generateStorageKey, getCachedPlayRecordsSnapshot } from '@/lib/db.client';
import { isEpisodeHiddenByFilter } from '@/lib/episode-filter';
import { loadAllLocalEpisodeProgressRecords } from '@/lib/episode-progress';
import { isNetdiskSource } from '@/lib/netdisk/source';
import { EpisodeFilterConfig,SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8 } from '@/lib/utils';

import DanmakuPanel from '@/components/DanmakuPanel';
import EpisodeFilterSettings from '@/components/EpisodeFilterSettings';
import ProxyImage from '@/components/ProxyImage';

// 定義視頻信息類型
interface VideoInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  bitrate: string; // 視頻碼率
  hasError?: boolean; // 添加錯誤狀態標識
}

interface EpisodeSelectorProps {
  /** 總集數 */
  totalEpisodes: number;
  /** 劇集標題 */
  episodes_titles: string[];
  /** 每頁顯示多少集，默認 50 */
  episodesPerPage?: number;
  /** 當前選中的集數（1 開始） */
  value?: number;
  /** 用戶點擊選集後的回調 */
  onChange?: (episodeNumber: number) => void;
  /** 換源相關 */
  onSourceChange?: (source: string, id: string, title: string) => void;
  currentSource?: string;
  currentId?: string;
  episodeProgressContentKey?: string;
  videoTitle?: string;
  videoYear?: string;
  availableSources?: SearchResult[];
  sourceSearchLoading?: boolean;
  sourceSearchError?: string | null;
  /** 後臺源加載狀態 */
  backgroundSourcesLoading?: boolean;
  /** 預計算的測速結果，避免重複測速 */
  precomputedVideoInfo?: Map<string, VideoInfo>;
  /** 彈幕相關 */
  onDanmakuSelect?: (selection: DanmakuSelection) => void;
  currentDanmakuSelection?: DanmakuSelection | null;
  onUploadDanmaku?: (comments: DanmakuComment[]) => void;
  /** 觀影室房員狀態 - 禁用選集和換源，但保留彈幕 */
  isRoomMember?: boolean;
  /** 集數過濾配置 */
  episodeFilterConfig?: EpisodeFilterConfig | null;
  onFilterConfigUpdate?: (config: EpisodeFilterConfig) => void;
  onShowToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

/**
 * 選集組件，支持分頁、自動滾動聚焦當前分頁標籤，以及換源功能。
 */
const EpisodeSelector: React.FC<EpisodeSelectorProps> = ({
  totalEpisodes,
  episodes_titles,
  episodesPerPage = 50,
  value = 1,
  onChange,
  onSourceChange,
  currentSource,
  currentId,
  episodeProgressContentKey,
  videoTitle,
  availableSources = [],
  sourceSearchLoading = false,
  sourceSearchError = null,
  backgroundSourcesLoading = false,
  precomputedVideoInfo,
  onDanmakuSelect,
  currentDanmakuSelection,
  onUploadDanmaku,
  isRoomMember = false,
  episodeFilterConfig = null,
  onFilterConfigUpdate,
  onShowToast,
}) => {
  const router = useRouter();
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);

  // 存儲每個源的視頻信息
  const [videoInfoMap, setVideoInfoMap] = useState<Map<string, VideoInfo>>(
    new Map()
  );
  const [attemptedSources, setAttemptedSources] = useState<Set<string>>(
    new Set()
  );
  // 存儲正在重新測試的源
  const [retestingSources, setRetestingSources] = useState<Set<string>>(
    new Set()
  );
  // 標記初始測速是否已完成
  const [initialTestingCompleted, setInitialTestingCompleted] = useState(false);
  // 標記是否正在進行全部重測
  const [isRetestingAll, setIsRetestingAll] = useState(false);
  // 標記是否正在進行初始測速
  const [isInitialTesting, setIsInitialTesting] = useState(false);
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<number>>(new Set());

  // 使用 ref 來避免閉包問題
  const attemptedSourcesRef = useRef<Set<string>>(new Set());
  const videoInfoMapRef = useRef<Map<string, VideoInfo>>(new Map());

  // 同步狀態到 ref
  useEffect(() => {
    attemptedSourcesRef.current = attemptedSources;
  }, [attemptedSources]);

  useEffect(() => {
    videoInfoMapRef.current = videoInfoMap;
  }, [videoInfoMap]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !currentSource ||
      !currentId ||
      !episodeProgressContentKey
    ) {
      setWatchedEpisodes(new Set());
      return;
    }

    const readWatchedEpisodes = () => {
      const watched = new Set<number>();

      try {
        const records = getCachedPlayRecordsSnapshot();
        const record = records[generateStorageKey(currentSource, currentId)];
        if (record && record.index > 0 && record.play_time > 1) {
          watched.add(record.index);
        }
      } catch (error) {
        console.warn('[EpisodeSelector] Failed to read cached play records:', error);
      }

      try {
        const episodeRecords = loadAllLocalEpisodeProgressRecords(
          episodeProgressContentKey
        );

        for (const [episodeIndex, record] of Object.entries(episodeRecords)) {
          if (Number(record?.playTime) > 1) {
            const episodeNumber = Number(episodeIndex) + 1;
            if (episodeNumber >= 1 && episodeNumber <= totalEpisodes) {
              watched.add(episodeNumber);
            }
          }
        }
      } catch (error) {
        console.warn('[EpisodeSelector] Failed to read local episode progress:', error);
      }

      setWatchedEpisodes(watched);
    };

    readWatchedEpisodes();

    const handlePlayRecordsUpdated = () => {
      readWatchedEpisodes();
    };

    window.addEventListener('playRecordsUpdated', handlePlayRecordsUpdated as EventListener);
    window.addEventListener('storage', handlePlayRecordsUpdated);

    return () => {
      window.removeEventListener(
        'playRecordsUpdated',
        handlePlayRecordsUpdated as EventListener
      );
      window.removeEventListener('storage', handlePlayRecordsUpdated);
    };
  }, [currentSource, currentId, episodeProgressContentKey, totalEpisodes]);

  // 主要的 tab 狀態：'danmaku' | 'episodes' | 'sources'
  // 默認顯示選集選項卡，但如果是房員則顯示彈幕
  const [activeTab, setActiveTab] = useState<'danmaku' | 'episodes' | 'sources'>(
    isRoomMember ? 'danmaku' : 'episodes'
  );

  // 當房員狀態變化時，自動切換到彈幕選項卡
  useEffect(() => {
    if (isRoomMember && (activeTab === 'episodes' || activeTab === 'sources')) {
      setActiveTab('danmaku');
    }
  }, [isRoomMember, activeTab]);

  // 當前分頁索引（0 開始）
  const initialPage = Math.floor((value - 1) / episodesPerPage);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);

  // 是否倒序顯示
  const [descending, setDescending] = useState<boolean>(false);

  // 集數過濾設置彈窗狀態
  const [showFilterSettings, setShowFilterSettings] = useState<boolean>(false);

  // 讀取本地"優選和測速"開關，默認開啟
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

  // 讀取測速超時設置，默認4秒
  const [speedTestTimeout] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('speedTestTimeout');
      if (saved !== null) {
        return Number(saved);
      }
    }
    return 4000;
  });

  // 集數過濾邏輯
  const isEpisodeFiltered = useCallback(
    (episodeNumber: number): boolean => {
      if (!episodeFilterConfig || episodeFilterConfig.rules.length === 0) {
        return false;
      }

      // 獲取集數標題
      const title = episodes_titles?.[episodeNumber - 1];
      if (!title) return false;
      return isEpisodeHiddenByFilter(title, episodeFilterConfig);
    },
    [episodeFilterConfig, episodes_titles]
  );

  // 根據 descending 狀態計算實際顯示的分頁索引
  const displayPage = useMemo(() => {
    if (descending) {
      return pageCount - 1 - currentPage;
    }
    return currentPage;
  }, [currentPage, descending, pageCount]);

  // 獲取視頻信息的函數 - 移除 attemptedSources 依賴避免不必要的重新創建
  const getVideoInfo = useCallback(async (source: SearchResult) => {
    const sourceKey = `${source.source}-${source.id}`;

    // 使用 ref 獲取最新的狀態，避免閉包問題
    if (attemptedSourcesRef.current.has(sourceKey)) {
      return;
    }

    // 獲取第一集的URL
    if (!source.episodes || source.episodes.length === 0) {
      return;
    }
    const episodeUrl =
      source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];

    // 標記為已嘗試
    setAttemptedSources((prev) => new Set(prev).add(sourceKey));

    try {
      const info = await getVideoResolutionFromM3u8(episodeUrl, speedTestTimeout);
      setVideoInfoMap((prev) => new Map(prev).set(sourceKey, info));
    } catch (error) {
      // 失敗時保存錯誤狀態
      setVideoInfoMap((prev) =>
        new Map(prev).set(sourceKey, {
          quality: '錯誤',
          loadSpeed: '未知',
          pingTime: 0,
          bitrate: '未知',
          hasError: true,
        })
      );
    }
  }, [speedTestTimeout]);

  // 重測所有源的函數
  const retestAllSources = useCallback(async () => {
    if (!availableSources || availableSources.length === 0) return;

    setIsRetestingAll(true);

    // 清空之前的測速結果
    setVideoInfoMap(new Map());
    setAttemptedSources(new Set());
    attemptedSourcesRef.current = new Set();
    videoInfoMapRef.current = new Map();

    // 篩選需要測速的源（排除 openlist/emby/xiaoya）
    const sourcesToTest = availableSources.filter((source) => {
      if (source.source === 'openlist' || source.source === 'emby' || source.source.startsWith('emby_') || source.source === 'xiaoya') {
        return false;
      }
      return true;
    });

    // 分批測速，每批最多5個
    const batchSize = 5;
    for (let i = 0; i < sourcesToTest.length; i += batchSize) {
      const batch = sourcesToTest.slice(i, i + batchSize);
      await Promise.all(batch.map(source => getVideoInfo(source)));
    }

    setIsRetestingAll(false);
  }, [availableSources, getVideoInfo]);

  // 當有預計算結果時，先合併到videoInfoMap中
  useEffect(() => {
    if (precomputedVideoInfo && precomputedVideoInfo.size > 0) {
      // 原子性地更新兩個狀態，避免時序問題
      setVideoInfoMap((prev) => {
        const newMap = new Map(prev);
        precomputedVideoInfo.forEach((value, key) => {
          newMap.set(key, value);
        });
        return newMap;
      });

      setAttemptedSources((prev) => {
        const newSet = new Set(prev);
        precomputedVideoInfo.forEach((info, key) => {
          if (!info.hasError) {
            newSet.add(key);
          }
        });
        return newSet;
      });

      // 同步更新 ref，確保 getVideoInfo 能立即看到更新
      precomputedVideoInfo.forEach((info, key) => {
        if (!info.hasError) {
          attemptedSourcesRef.current.add(key);
        }
      });
    }
  }, [precomputedVideoInfo]);

  // 當切換到換源tab並且有源數據時，異步獲取視頻信息 - 移除 attemptedSources 依賴避免循環觸發
  useEffect(() => {
    const fetchVideoInfosInBatches = async () => {
      if (
        !optimizationEnabled || // 若關閉測速則直接退出
        activeTab !== 'sources' ||
        availableSources.length === 0
      )
        return;

      // 篩選出尚未測速的播放源，並排除不需要測速的源（openlist/emby/xiaoya）
      const pendingSources = availableSources.filter((source) => {
        const sourceKey = `${source.source}-${source.id}`;
        // 跳過已測速的源
        if (attemptedSourcesRef.current.has(sourceKey)) return false;
        // 跳過不需要測速的源
        if (source.source === 'openlist' || source.source === 'emby' || source.source.startsWith('emby_') || source.source === 'xiaoya') return false;
        return true;
      });

      if (pendingSources.length === 0) return;

      // 標記開始初始測速
      setIsInitialTesting(true);

      const batchSize = Math.ceil(pendingSources.length / 2);

      for (let start = 0; start < pendingSources.length; start += batchSize) {
        const batch = pendingSources.slice(start, start + batchSize);
        await Promise.all(batch.map(getVideoInfo));
      }

      // 初始測速完成後，標記為已完成
      setIsInitialTesting(false);
      if (!initialTestingCompleted) {
        setInitialTestingCompleted(true);
      }
    };

    fetchVideoInfosInBatches();
    // 依賴項保持與之前一致
  }, [activeTab, availableSources, getVideoInfo, optimizationEnabled, initialTestingCompleted, currentSource]);

  // 監聽後臺加載完成，觸發自動測速
  const prevBackgroundLoadingRef = useRef<boolean>(false);
  useEffect(() => {
    // 當後臺加載從 true 變為 false 時（即加載完成）
    if (prevBackgroundLoadingRef.current && !backgroundSourcesLoading) {
      // 如果當前選項卡在換源位置，觸發測速
      if (activeTab === 'sources' && optimizationEnabled) {
        // 篩選出尚未測速的播放源，並排除不需要測速的源（openlist/emby/xiaoya）
        const pendingSources = availableSources.filter((source) => {
          const sourceKey = `${source.source}-${source.id}`;
          // 跳過已測速的源
          if (attemptedSourcesRef.current.has(sourceKey)) return false;
          // 跳過不需要測速的源
          if (source.source === 'openlist' || source.source === 'emby' || source.source.startsWith('emby_') || source.source === 'xiaoya') return false;
          return true;
        });

        if (pendingSources.length > 0) {
          const batchSize = Math.ceil(pendingSources.length / 2);

          const fetchInBatches = async () => {
            for (let start = 0; start < pendingSources.length; start += batchSize) {
              const batch = pendingSources.slice(start, start + batchSize);
              await Promise.all(batch.map(getVideoInfo));
            }

            if (!initialTestingCompleted) {
              setInitialTestingCompleted(true);
            }
          };

          fetchInBatches();
        }
      }
    }

    // 更新前一次的加載狀態
    prevBackgroundLoadingRef.current = backgroundSourcesLoading;
  }, [backgroundSourcesLoading, activeTab, availableSources, getVideoInfo, optimizationEnabled, initialTestingCompleted, currentSource]);

  // 升序分頁標籤
  const categoriesAsc = useMemo(() => {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * episodesPerPage + 1;
      const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
      return { start, end };
    });
  }, [pageCount, episodesPerPage, totalEpisodes]);

  // 根據 descending 狀態決定分頁標籤的排序和內容
  const categories = useMemo(() => {
    if (descending) {
      // 倒序時，label 也倒序顯示
      return [...categoriesAsc]
        .reverse()
        .map(({ start, end }) => `${end}-${start}`);
    }
    return categoriesAsc.map(({ start, end }) => `${start}-${end}`);
  }, [categoriesAsc, descending]);

  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 添加鼠標懸停狀態管理
  const [isCategoryHovered, setIsCategoryHovered] = useState(false);

  // 阻止頁面豎向滾動
  const preventPageScroll = useCallback((e: WheelEvent) => {
    if (isCategoryHovered) {
      e.preventDefault();
    }
  }, [isCategoryHovered]);

  // 處理滾輪事件，實現橫向滾動
  const handleWheel = useCallback((e: WheelEvent) => {
    if (isCategoryHovered && categoryContainerRef.current) {
      e.preventDefault(); // 阻止默認的豎向滾動

      const container = categoryContainerRef.current;
      const scrollAmount = e.deltaY * 2; // 調整滾動速度

      // 根據滾輪方向進行橫向滾動
      container.scrollBy({
        left: scrollAmount,
        behavior: 'smooth'
      });
    }
  }, [isCategoryHovered]);

  // 添加全局wheel事件監聽器
  useEffect(() => {
    if (isCategoryHovered) {
      // 鼠標懸停時阻止頁面滾動
      document.addEventListener('wheel', preventPageScroll, { passive: false });
      document.addEventListener('wheel', handleWheel, { passive: false });
    } else {
      // 鼠標離開時恢復頁面滾動
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleWheel);
    }

    return () => {
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleWheel);
    };
  }, [isCategoryHovered, preventPageScroll, handleWheel]);

  // 當分頁切換時，將激活的分頁標籤滾動到視口中間
  useEffect(() => {
    const btn = buttonRefs.current[displayPage];
    const container = categoryContainerRef.current;
    if (btn && container) {
      // 手動計算滾動位置，只滾動分頁標籤容器
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
  }, [displayPage, pageCount]);

  // 處理換源tab點擊，只在點擊時才搜索
  const handleSourceTabClick = () => {
    setActiveTab('sources');
  };

  const handleCategoryClick = useCallback(
    (index: number) => {
      if (descending) {
        // 在倒序時，需要將顯示索引轉換為實際索引
        setCurrentPage(pageCount - 1 - index);
      } else {
        setCurrentPage(index);
      }
    },
    [descending, pageCount]
  );

  const handleEpisodeClick = useCallback(
    (episodeNumber: number) => {
      if (episodeNumber + 1 === value) {
        return;
      }

      onChange?.(episodeNumber);
    },
    [onChange, value]
  );

  const handleSourceClick = useCallback(
    (source: SearchResult) => {
      onSourceChange?.(source.source, source.id, source.title);
    },
    [onSourceChange]
  );

  // 解析網速字符串，轉換為 KB/s 數值用於排序
  const parseSpeedToKBps = useCallback((speedStr: string): number => {
    if (!speedStr || speedStr === '未知' || speedStr === '測量中...') {
      return -1; // 無效速度返回 -1，排在最後
    }

    const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
    if (!match) {
      return -1;
    }

    const value = parseFloat(match[1]);
    const unit = match[2];

    // 統一轉換為 KB/s
    return unit === 'MB/s' ? value * 1024 : value;
  }, []);

  // 重新測試單個源
  const handleRetestSource = useCallback(
    async (source: SearchResult, e: React.MouseEvent) => {
      e.stopPropagation(); // 阻止事件冒泡，避免觸發換源
      const sourceKey = `${source.source}-${source.id}`;

      // 標記為正在測試
      setRetestingSources((prev) => new Set(prev).add(sourceKey));

      // 從已嘗試列表中移除，允許重新測試
      setAttemptedSources((prev) => {
        const newSet = new Set(prev);
        newSet.delete(sourceKey);
        return newSet;
      });

      // 同步更新 ref
      attemptedSourcesRef.current.delete(sourceKey);

      // 執行測試
      try {
        await getVideoInfo(source);
      } finally {
        // 無論成功或失敗，都移除測試標記
        setRetestingSources((prev) => {
          const newSet = new Set(prev);
          newSet.delete(sourceKey);
          return newSet;
        });
      }
    },
    [getVideoInfo]
  );

  const currentStart = currentPage * episodesPerPage + 1;
  const currentEnd = Math.min(
    currentStart + episodesPerPage - 1,
    totalEpisodes
  );

  return (
    <div className='md:ml-2 px-4 py-0 h-full rounded-xl bg-black/10 dark:bg-white/5 flex flex-col border border-white/0 dark:border-white/30 overflow-hidden'>
      {/* 主要的 Tab 切換 - 無縫融入設計 */}
      <div className='flex mb-1 -mx-6 flex-shrink-0'>
        {/* 選集選項卡 - 僅在多集時顯示 */}
        {totalEpisodes > 1 && (
          <div
            onClick={() => !isRoomMember && setActiveTab('episodes')}
            className={`flex-1 py-3 px-6 text-center transition-all duration-200 font-medium relative
              ${isRoomMember ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
              ${activeTab === 'episodes'
                ? 'text-green-600 dark:text-green-400'
                : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
              }
            `.trim()}
          >
            選集
            {isRoomMember && <span className="ml-1 text-xs">🔒</span>}
          </div>
        )}

        {/* 換源選項卡 */}
        <div
          onClick={() => !isRoomMember && handleSourceTabClick()}
          className={`flex-1 py-3 px-6 text-center transition-all duration-200 font-medium relative
            ${isRoomMember ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
            ${activeTab === 'sources'
              ? 'text-green-600 dark:text-green-400'
              : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
            }
          `.trim()}
        >
          換源
          {isRoomMember && <span className="ml-1 text-xs">🔒</span>}
        </div>

        {/* 彈幕選項卡 */}
        <div
          onClick={() => setActiveTab('danmaku')}
          className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
            ${activeTab === 'danmaku'
              ? 'text-green-600 dark:text-green-400'
              : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
            }
          `.trim()}
        >
          彈幕
        </div>
      </div>

      {/* 彈幕 Tab 內容 */}
      {activeTab === 'danmaku' && onDanmakuSelect && (
        <div className='flex-1 min-h-0 overflow-hidden'>
          <DanmakuPanel
            videoTitle={videoTitle || ''}
            currentEpisodeIndex={value - 1}
            onDanmakuSelect={onDanmakuSelect}
            currentSelection={currentDanmakuSelection || null}
            onUploadDanmaku={onUploadDanmaku}
          />
        </div>
      )}

      {/* 選集 Tab 內容 */}
      {activeTab === 'episodes' && (
        <>
          {/* 分類標籤 */}
          <div className='flex items-center gap-4 mb-4 border-b border-gray-300 dark:border-gray-700 -mx-6 px-6 flex-shrink-0'>
            <div
              className='flex-1 overflow-x-auto'
              ref={categoryContainerRef}
              onMouseEnter={() => setIsCategoryHovered(true)}
              onMouseLeave={() => setIsCategoryHovered(false)}
            >
              <div className='flex gap-2 min-w-max'>
                {categories.map((label, idx) => {
                  const isActive = idx === displayPage;
                  return (
                    <button
                      key={label}
                      ref={(el) => {
                        buttonRefs.current[idx] = el;
                      }}
                      onClick={() => handleCategoryClick(idx)}
                      className={`w-20 relative py-2 text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 text-center 
                        ${isActive
                          ? 'text-green-500 dark:text-green-400'
                          : 'text-gray-700 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400'
                        }
                      `.trim()}
                    >
                      {label}
                      {isActive && (
                        <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-green-500 dark:bg-green-400' />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* 向上/向下按鈕 */}
            <button
              className='flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-gray-700 hover:text-green-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-green-400 dark:hover:bg-white/20 transition-colors transform translate-y-[-4px]'
              onClick={() => {
                // 切換集數排序（正序/倒序）
                setDescending((prev) => !prev);
              }}
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
                  strokeWidth='2'
                  d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'
                />
              </svg>
            </button>
            {/* 集數屏蔽配置按鈕 */}
            <button
              className='flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-gray-700 hover:text-green-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-green-400 dark:hover:bg-white/20 transition-colors transform translate-y-[-4px]'
              onClick={() => setShowFilterSettings(true)}
              title='集數屏蔽設置'
            >
              <Settings className='w-4 h-4' />
            </button>
          </div>

          {/* 集數網格 */}
          <div className='flex flex-wrap gap-3 overflow-y-auto flex-1 content-start pb-4'>
            {(() => {
              const len = currentEnd - currentStart + 1;
              const episodes = Array.from({ length: len }, (_, i) =>
                descending ? currentEnd - i : currentStart + i
              );
              // 過濾掉被屏蔽的集數，但保持原有索引
              return episodes
                .filter(episodeNumber => !isEpisodeFiltered(episodeNumber))
                .map((episodeNumber) => {
                  const isActive = episodeNumber === value;
                  const isWatched = watchedEpisodes.has(episodeNumber);
                  return (
                    <button
                      key={episodeNumber}
                      disabled={isActive}
                      onClick={() => handleEpisodeClick(episodeNumber - 1)}
                      className={`relative h-10 min-w-10 px-3 py-2 flex items-center justify-center text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap font-mono border
                        ${isActive
                          ? 'bg-green-500 text-white border-green-400 shadow-lg shadow-green-500/25 dark:bg-green-600'
                          : isWatched
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 hover:scale-105 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/60 dark:hover:bg-emerald-900/30'
                            : 'bg-gray-200 text-gray-700 border-transparent hover:bg-gray-300 hover:scale-105 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                        } ${isActive ? 'cursor-default' : ''}`.trim()}
                      title={isWatched && !isActive ? '已觀看過' : undefined}
                      aria-current={isActive ? 'true' : undefined}
                    >
                      {isWatched && !isActive && (
                        <span className='absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400' />
                      )}
                      {(() => {
                        const title = episodes_titles?.[episodeNumber - 1];
                        if (!title) {
                          return episodeNumber;
                        }
                        // 如果是 OVA 格式，直接返回完整標題
                        if (title.match(/^OVA\s+\d+/i)) {
                          return title;
                        }
                        // 如果匹配 S01E01 格式，提取並返回
                        const sxxexxMatch = title.match(/[Ss](\d+)[Ee](\d{1,4}(?:\.\d+)?)/);
                        if (sxxexxMatch) {
                          const season = sxxexxMatch[1].padStart(2, '0');
                          const episode = sxxexxMatch[2];
                          return `S${season}E${episode}`;
                        }
                        // 如果匹配"第X集"、"第X話"、"X集"、"X話"格式，提取中間的數字（支持小數）
                        const match = title.match(/(?:第)?(\d+(?:\.\d+)?)(?:集|話)/);
                        if (match) {
                          return match[1];
                        }
                        return title;
                      })()}
                    </button>
                  );
                });
            })()}
          </div>
        </>
      )}

      {/* 換源 Tab 內容 */}
      {activeTab === 'sources' && (
        <div className='flex flex-col h-full mt-2'>
          {/* 全部重測按鈕 - 右上角 */}
          {!sourceSearchLoading && !sourceSearchError && availableSources.length > 0 && (
            <div className='flex justify-end mb-2 px-2 pb-2 border-b border-gray-300 dark:border-gray-700'>
              <button
                onClick={retestAllSources}
                disabled={isRetestingAll || retestingSources.size > 0 || isInitialTesting}
                className={`text-xs font-medium transition-colors ${
                  isRetestingAll || retestingSources.size > 0 || isInitialTesting
                    ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                    : 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer'
                }`}
              >
                {isRetestingAll ? '重測中...' : isInitialTesting ? '測速中...' : '全部重測'}
              </button>
            </div>
          )}

          {sourceSearchLoading && (
            <div className='flex items-center justify-center py-8'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
              <span className='ml-2 text-sm text-gray-600 dark:text-gray-300'>
                搜索中...
              </span>
            </div>
          )}

          {sourceSearchError && (
            <div className='flex items-center justify-center py-8'>
              <div className='text-center'>
                <div className='text-red-500 text-2xl mb-2'>⚠️</div>
                <p className='text-sm text-red-600 dark:text-red-400'>
                  {sourceSearchError}
                </p>
              </div>
            </div>
          )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length === 0 && (
              <div className='flex items-center justify-center py-8'>
                <div className='text-center'>
                  <div className='text-gray-400 text-2xl mb-2'>📺</div>
                  <p className='text-sm text-gray-600 dark:text-gray-300'>
                    暫無可用的換源
                  </p>
                </div>
              </div>
            )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length > 0 && (
              <div className='flex-1 overflow-y-auto space-y-2 pb-20'>
                {availableSources
                  .sort((a, b) => {
                    const aIsCurrent =
                      a.source?.toString() === currentSource?.toString() &&
                      a.id?.toString() === currentId?.toString();
                    const bIsCurrent =
                      b.source?.toString() === currentSource?.toString() &&
                      b.id?.toString() === currentId?.toString();

                    // 當前源始終置頂
                    if (aIsCurrent && !bIsCurrent) return -1;
                    if (!aIsCurrent && bIsCurrent) return 1;

                    // 如果初始測速已完成，按網速排序（快的在前）
                    if (initialTestingCompleted) {
                      const aKey = `${a.source}-${a.id}`;
                      const bKey = `${b.source}-${b.id}`;
                      const aInfo = videoInfoMap.get(aKey);
                      const bInfo = videoInfoMap.get(bKey);

                      const aSpeed = aInfo ? parseSpeedToKBps(aInfo.loadSpeed) : -1;
                      const bSpeed = bInfo ? parseSpeedToKBps(bInfo.loadSpeed) : -1;

                      // 速度快的排在前面（降序）
                      return bSpeed - aSpeed;
                    }

                    return 0;
                  })
                  .map((source, index) => {
                    const isCurrentSource =
                      source.source?.toString() === currentSource?.toString() &&
                      source.id?.toString() === currentId?.toString();
                    return (
                      <div
                        key={`${source.source}-${source.id}`}
                        onClick={() =>
                          !isCurrentSource && handleSourceClick(source)
                        }
                        className={`flex items-start gap-3 px-2 py-3 rounded-lg transition-all select-none duration-200 relative
                      ${isCurrentSource
                         ? 'bg-green-500/10 dark:bg-green-500/20 border-green-500/30 border'
                          : 'hover:bg-gray-200/50 dark:hover:bg-white/10 hover:scale-[1.02] cursor-pointer'
                          }`.trim()}
                      >
                        {/* 封面 */}
                        <div className='flex-shrink-0 w-12 h-20 bg-gray-300 dark:bg-gray-600 rounded overflow-hidden flex items-center justify-center'>
                          {source.source === 'directplay' ? (
                            <LinkIcon className='w-6 h-6 text-blue-500' />
                          ) : source.poster ? (
                            <ProxyImage
                              originalSrc={source.poster}
                              alt={source.title}
                              className='w-full h-full object-cover'
                              retryOnError={false}
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                              }}
                            />
                          ) : null}
                        </div>

                        {/* 信息區域 */}
                        <div className='flex-1 min-w-0 flex flex-col justify-between h-20'>
                          {/* 標題和分辨率 - 頂部 */}
                          <div className='flex items-start justify-between gap-3 h-6'>
                            <div className='flex-1 min-w-0 relative group/title'>
                              <h3 className='font-medium text-base truncate text-gray-900 dark:text-gray-100 leading-none'>
                                {source.title}
                              </h3>
                              {/* 標題級別的 tooltip - 第一個元素不顯示 */}
                              {index !== 0 && (
                                <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible group-hover/title:opacity-100 group-hover/title:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap z-[500] pointer-events-none'>
                                  {source.title}
                                  <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'></div>
                                </div>
                              )}
                            </div>
                            {(() => {
                              const sourceKey = `${source.source}-${source.id}`;
                              const videoInfo = videoInfoMap.get(sourceKey);

                              if (videoInfo && videoInfo.quality !== '未知') {
                                if (videoInfo.hasError) {
                                  return (
                                    <div className='bg-gray-500/10 dark:bg-gray-400/20 text-red-600 dark:text-red-400 px-1.5 py-0 rounded text-xs flex-shrink-0 min-w-[50px] text-center'>
                                      檢測失敗
                                    </div>
                                  );
                                } else {
                                  // 根據分辨率設置不同顏色：2K、4K為紫色，1080p、720p為綠色，其他為黃色
                                  const isUltraHigh = ['4K', '2K'].includes(
                                    videoInfo.quality
                                  );
                                  const isHigh = ['1080p', '720p'].includes(
                                    videoInfo.quality
                                  );
                                  const textColorClasses = isUltraHigh
                                    ? 'text-purple-600 dark:text-purple-400'
                                    : isHigh
                                      ? 'text-green-600 dark:text-green-400'
                                      : 'text-yellow-600 dark:text-yellow-400';

                                  return (
                                    <div
                                      className={`bg-gray-500/10 dark:bg-gray-400/20 ${textColorClasses} px-1.5 py-0 rounded text-xs flex-shrink-0 min-w-[50px] text-center`}
                                    >
                                      {videoInfo.quality}
                                    </div>
                                  );
                                }
                              }

                              return null;
                            })()}
                          </div>

                          {/* 源名稱和集數信息 - 垂直居中 */}
                          <div className='flex items-center justify-between'>
                            <span className={`text-xs px-2 py-1 border rounded text-gray-700 dark:text-gray-300 ${
                              source.source === 'xiaoya' ? 'border-blue-500' : isNetdiskSource(source.source) ? 'border-purple-500' : source.source === 'openlist' || source.source === 'emby' || source.source?.startsWith('emby_')
                           ? 'border-yellow-500'
                                : 'border-gray-500/60'
                      }`}>
                              {source.source_name}
                            </span>
                            {source.episodes.length > 1 && (
                              <span className='text-xs text-gray-500 dark:text-gray-400 font-medium'>
                                {source.episodes.length} 集
                              </span>
                            )}
                          </div>

                          {/* 網絡信息 - 底部 */}
                          <div className='flex items-end justify-between h-6'>
                            <div className='flex items-end gap-3'>
                              {(() => {
                                const sourceKey = `${source.source}-${source.id}`;
                                const videoInfo = videoInfoMap.get(sourceKey);
                                if (videoInfo) {
                                  if (!videoInfo.hasError) {
                                    return (
                                      <div className='flex items-end gap-3 text-xs'>
                                        <div className='text-green-600 dark:text-green-400 font-medium text-xs'>
                                          {videoInfo.loadSpeed}
                                        </div>
                                        <div className='text-orange-600 dark:text-orange-400 font-medium text-xs'>
                                          {videoInfo.pingTime}ms
                                        </div>
                                        {videoInfo.bitrate && videoInfo.bitrate !== '未知' && (
                                          <div className='text-purple-600 dark:text-purple-400 font-medium text-xs'>
                                            {videoInfo.bitrate}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  } else {
                                    return (
                                      <div className='text-red-500/90 dark:text-red-400 font-medium text-xs'>
                                        無測速數據
                                      </div>
                                    );
                                  }
                                }
                                return null;
                              })()}
                            </div>
                            {/* 重新測試按鈕 */}
                            {(() => {
                              // 私人影庫、Emby 和小雅不顯示重新測試按鈕
                              if (source.source === 'openlist' || source.source === 'emby' || source.source.startsWith('emby_') || source.source === 'xiaoya') {
                                return null;
                              }

                              const sourceKey = `${source.source}-${source.id}`;
                              const isTesting = retestingSources.has(sourceKey);
                              const videoInfo = videoInfoMap.get(sourceKey);

                              // 只有第一次測試完成後（有測速數據）才顯示重新測試按鈕
                              if (videoInfo) {
                                return (
                                  <button
                                    onClick={(e) => handleRetestSource(source, e)}
                                    disabled={isTesting}
                                    className={`text-xs font-medium transition-colors ${
                                      isTesting
                                        ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                                        : 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer'
                                    }`}
                                  >
                                    {isTesting ? '測試中...' : '重新測試'}
                                  </button>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                {/* 後臺加載提示 */}
                {backgroundSourcesLoading && (
                  <div className='flex items-center justify-center py-6 border-t border-gray-300 dark:border-gray-700'>
                    <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-green-500'></div>
                    <span className='ml-2 text-sm text-gray-600 dark:text-gray-300'>
                      正在加載更多播放源...
                    </span>
                  </div>
                )}
                <div className='flex-shrink-0 mt-auto pt-2 border-t border-gray-400 dark:border-gray-700'>
                  <button
                    onClick={() => {
                      if (videoTitle) {
                        router.push(
                          `/search?q=${encodeURIComponent(videoTitle)}`
                        );
                      }
                    }}
                    className='w-full text-center text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 dark:hover:text-green-400 transition-colors py-2'
                  >
                    影片匹配有誤？點擊去搜索
                  </button>
                </div>
              </div>
            )}
        </div>
      )}

      {/* 集數過濾設置彈窗 */}
      <EpisodeFilterSettings
        isOpen={showFilterSettings}
        onClose={() => setShowFilterSettings(false)}
        onConfigUpdate={(config) => {
          onFilterConfigUpdate?.(config);
        }}
        onShowToast={onShowToast}
      />
    </div>
  );
};

export default EpisodeSelector;
