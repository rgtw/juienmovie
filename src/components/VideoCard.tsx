/* eslint-disable @typescript-eslint/no-explicit-any,react-hooks/exhaustive-deps,@typescript-eslint/no-empty-function */

import { Cloud, ExternalLink, Heart, Info, Link, PlayCircleIcon, Radio, Sparkles, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  isFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { isNetdiskSource } from '@/lib/netdisk/source';
import {
  base58Decode,
  getDoubanImageFallbackUrl,
  processImageUrl,
  tryApplyDoubanImageFallback,
} from '@/lib/utils';
import { useLongPress } from '@/hooks/useLongPress';

import AIChatPanel from '@/components/AIChatPanel';
import DetailPanel from '@/components/DetailPanel';
import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import ImageViewer from '@/components/ImageViewer';
import MobileActionSheet from '@/components/MobileActionSheet';

export interface VideoCardProps {
  id?: string;
  source?: string;
  title?: string;
  query?: string;
  poster?: string;
  episodes?: number;
  source_name?: string;
  source_names?: string[];
  progress?: number;
  year?: string;
  from: 'playrecord' | 'favorite' | 'search' | 'douban' | 'tmdb' | 'source-search';
  currentEpisode?: number;
  douban_id?: number;
  tmdb_id?: number;
  onDelete?: () => void;
  rate?: string;
  type?: string;
  isBangumi?: boolean;
  isAggregate?: boolean;
  origin?: 'vod' | 'live';
  releaseDate?: string; // 上映日期，格式：YYYY-MM-DD
  isUpcoming?: boolean; // 是否為即將上映
  seasonNumber?: number; // 季度編號
  seasonName?: string; // 季度名稱
  orientation?: 'vertical' | 'horizontal'; // 卡片方向
  playTime?: number; // 當前播放時間（秒）
  totalTime?: number; // 總時長（秒）
  cmsData?: {
    desc?: string;
    episodes?: string[];
    episodes_titles?: string[];
  };
}

export type VideoCardHandle = {
  setEpisodes: (episodes?: number) => void;
  setSourceNames: (names?: string[]) => void;
  setDoubanId: (id?: number) => void;
};

const VideoCard = forwardRef<VideoCardHandle, VideoCardProps>(function VideoCard(
  {
    id,
    title = '',
    query = '',
    poster = '',
    episodes,
    source,
    source_name,
    source_names,
    progress = 0,
    year,
    from,
    currentEpisode,
    douban_id,
    tmdb_id,
    onDelete,
    rate,
    type = '',
    isBangumi = false,
    isAggregate = false,
    origin = 'vod',
    releaseDate,
    isUpcoming = false,
    seasonNumber,
    seasonName,
    orientation = 'vertical',
    playTime,
    totalTime,
    cmsData,
  }: VideoCardProps,
  ref
) {
  const router = useRouter();
  const actualTitle = title;
  const actualPoster = poster;
  const netdiskPosterPlaceholder = useMemo(() => {
    return `data:image/svg+xml;utf8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600">
        <rect width="400" height="600" fill="#f3f4f6"/>
        <g fill="none" stroke="#9ca3af" stroke-width="16" stroke-linecap="round" stroke-linejoin="round">
          <path d="M118 332c-30.9 0-56-25.1-56-56 0-28.5 21.3-52 48.9-55.4C120.6 184.7 154.8 160 195 160c51.1 0 92.9 39.2 97.1 89.2 27.3 4.2 47.9 27.7 47.9 56.8 0 32-26 58-58 58H118z"/>
        </g>
      </svg>
    `)}`;
  }, []);
  const processedPoster = useMemo(
    () =>
      actualPoster
        ? processImageUrl(actualPoster)
        : isNetdiskSource(source)
          ? netdiskPosterPlaceholder
          : '',
    [actualPoster, source, netdiskPosterPlaceholder]
  );
  const [favorited, setFavorited] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [searchFavorited, setSearchFavorited] = useState<boolean | null>(null); // 搜索結果的收藏狀態
  const [showAIChat, setShowAIChat] = useState(false);
  const [isAIStreaming, setIsAIStreaming] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiDefaultMessageWithVideo, setAiDefaultMessageWithVideo] = useState('');
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showImageViewer, setShowImageViewer] = useState(false);
  const [showUpcomingInfo, setShowUpcomingInfo] = useState(false); // 控制即將上映倒計時的顯示
  const [displayPoster, setDisplayPoster] = useState(processedPoster);

  // 檢查AI功能是否啟用
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const enabled =
        (window as any).RUNTIME_CONFIG?.AI_ENABLED &&
        (window as any).RUNTIME_CONFIG?.AI_ENABLE_VIDEOCARD_ENTRY;
      setAiEnabled(enabled);

      // 加載AI默認消息配置
      const defaultMsg = (window as any).RUNTIME_CONFIG?.AI_DEFAULT_MESSAGE_WITH_VIDEO;
      if (defaultMsg) {
        setAiDefaultMessageWithVideo(defaultMsg);
      }
    }
  }, []);

  // 可外部修改的可控字段
  const [dynamicEpisodes, setDynamicEpisodes] = useState<number | undefined>(
    episodes
  );
  const [dynamicSourceNames, setDynamicSourceNames] = useState<string[] | undefined>(
    source_names
  );
  const [dynamicDoubanId, setDynamicDoubanId] = useState<number | undefined>(
    douban_id
  );

  useEffect(() => {
    setDynamicEpisodes(episodes);
  }, [episodes]);

  useEffect(() => {
    setDynamicSourceNames(source_names);
  }, [source_names]);

  useEffect(() => {
    setDynamicDoubanId(douban_id);
  }, [douban_id]);

  useEffect(() => {
    setDisplayPoster(processedPoster);
  }, [processedPoster]);

  useImperativeHandle(ref, () => ({
    setEpisodes: (eps?: number) => setDynamicEpisodes(eps),
    setSourceNames: (names?: string[]) => setDynamicSourceNames(names),
    setDoubanId: (id?: number) => setDynamicDoubanId(id),
  }));

  const actualSource = source;
  const actualId = id;
  const actualDoubanId = dynamicDoubanId;
  const actualEpisodes = dynamicEpisodes;
  const actualYear = year;
  const actualQuery = query || '';
  const actualSearchType = type;
  const isDirectPlaySource = actualSource === 'directplay';
  const directLinkUrl = useMemo(() => {
    if (!isDirectPlaySource || !actualId) return '';
    try {
      return base58Decode(actualId);
    } catch {
      return '';
    }
  }, [isDirectPlaySource, actualId]);
  const displayYear = useMemo(() => {
    if (!actualYear) return '';
    const normalized = actualYear.trim();
    if (!normalized || normalized === 'unknown') return '';
    const digits = normalized.replace(/\D/g, '');
    if (!digits) return normalized;
    return digits.slice(-2).padStart(2, '0');
  }, [actualYear]);

  // 獲取收藏狀態（搜索結果頁面不檢查）
  useEffect(() => {
    if (from === 'douban' || from === 'search' || !actualSource || !actualId) return;

    const fetchFavoriteStatus = async () => {
      try {
        const fav = await isFavorited(actualSource, actualId);
        setFavorited(fav);
      } catch (err) {
        throw new Error('檢查收藏狀態失敗');
      }
    };

    fetchFavoriteStatus();

    // 監聽收藏狀態更新事件
    const storageKey = generateStorageKey(actualSource, actualId);
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        // 檢查當前項目是否在新的收藏列表中
        const isNowFavorited = !!newFavorites[storageKey];
        setFavorited(isNowFavorited);
      }
    );

    return unsubscribe;
  }, [from, actualSource, actualId]);

  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (from === 'douban' || !actualSource || !actualId) return;

      try {
        // 確定當前收藏狀態
        const currentFavorited = from === 'search' ? searchFavorited : favorited;

        if (currentFavorited) {
          // 如果已收藏，刪除收藏
          await deleteFavorite(actualSource, actualId);
          if (from === 'search') {
            setSearchFavorited(false);
          } else {
            setFavorited(false);
          }
        } else {
          // 如果未收藏，添加收藏
          await saveFavorite(actualSource, actualId, {
            title: actualTitle,
            source_name: source_name || '',
            year: actualYear || '',
            cover: actualPoster,
            total_episodes: actualEpisodes ?? 1,
            save_time: Date.now(),
          });
          if (from === 'search') {
            setSearchFavorited(true);
          } else {
            setFavorited(true);
          }
        }
      } catch (err) {
        throw new Error('切換收藏狀態失敗');
      }
    },
    [
      from,
      actualSource,
      actualId,
      actualTitle,
      source_name,
      actualYear,
      actualPoster,
      actualEpisodes,
      favorited,
      searchFavorited,
    ]
  );

  const handleDeleteRecord = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (from !== 'playrecord' || !actualSource || !actualId) return;
      try {
        await deletePlayRecord(actualSource, actualId);
        onDelete?.();
      } catch (err) {
        throw new Error('刪除播放記錄失敗');
      }
    },
    [from, actualSource, actualId, onDelete]
  );

  const handleClick = useCallback(() => {
    // 即將上映的電影：單擊顯示上映倒計時提示，不跳轉
    if (isUpcoming) {
      setShowUpcomingInfo(true);
      // 2秒後自動隱藏
      setTimeout(() => {
        setShowUpcomingInfo(false);
      }, 2000);
      return;
    }

    if (origin === 'live' && actualSource && actualId) {
      // 直播內容跳轉到直播頁面
      const url = `/live?source=${actualSource.replace('live_', '')}&id=${actualId.replace('live_', '')}`;
      router.push(url);
    } else if (from === 'douban' || from === 'tmdb' || (isAggregate && !actualSource && !actualId)) {
      // 檢測當前是否在 play 頁面
      const isCurrentlyOnPlayPage = typeof window !== 'undefined' && window.location.pathname === '/play';

      let url = `/play?title=${encodeURIComponent(actualTitle.trim())}${actualYear ? `&year=${actualYear}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}${isAggregate ? '&prefer=true' : ''}${actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''}`;

      if (isCurrentlyOnPlayPage) {
        // 在 play 頁面內，添加 _reload 參數強制刷新
        url += `&_reload=${Date.now()}`;
        window.location.href = url;
      } else {
        // 不在 play 頁面，正常跳轉
        router.push(url);
      }
    } else if (actualSource && actualId) {
      // 檢測當前是否在 play 頁面
      const isCurrentlyOnPlayPage = typeof window !== 'undefined' && window.location.pathname === '/play';

      let url = `/play?source=${actualSource}&id=${actualId}&title=${encodeURIComponent(
        actualTitle
      )}${actualYear ? `&year=${actualYear}` : ''}${isAggregate ? '&prefer=true' : ''
        }${actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}`;

      if (isCurrentlyOnPlayPage) {
        // 在 play 頁面內，添加 _reload 參數強制刷新
        url += `&_reload=${Date.now()}`;
        window.location.href = url;
      } else {
        // 不在 play 頁面，正常跳轉
        router.push(url);
      }
    }
  }, [
    isUpcoming,
    origin,
    from,
    actualSource,
    actualId,
    router,
    actualTitle,
    actualYear,
    isAggregate,
    actualQuery,
    actualSearchType,
  ]);

  // 新標籤頁播放處理函數
  const handlePlayInNewTab = useCallback(() => {
    // 即將上映的電影不跳轉
    if (isUpcoming) {
      return;
    }

    if (origin === 'live' && actualSource && actualId) {
      // 直播內容跳轉到直播頁面
      const url = `/live?source=${actualSource.replace('live_', '')}&id=${actualId.replace('live_', '')}`;
      window.open(url, '_blank');
    } else if (from === 'douban' || from === 'tmdb' || (isAggregate && !actualSource && !actualId)) {
      const url = `/play?title=${encodeURIComponent(actualTitle.trim())}${actualYear ? `&year=${actualYear}` : ''}${actualSearchType ? `&stype=${actualSearchType}` : ''}${isAggregate ? '&prefer=true' : ''}${actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''}`;
      window.open(url, '_blank');
    } else if (actualSource && actualId) {
      const url = `/play?source=${actualSource}&id=${actualId}&title=${encodeURIComponent(
        actualTitle
      )}${actualYear ? `&year=${actualYear}` : ''}${isAggregate ? '&prefer=true' : ''
        }${actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}`;
      window.open(url, '_blank');
    }
  }, [
    isUpcoming,
    origin,
    from,
    actualSource,
    actualId,
    actualTitle,
    actualYear,
    isAggregate,
    actualQuery,
    actualSearchType,
  ]);

  // 檢查搜索結果的收藏狀態
  const checkSearchFavoriteStatus = useCallback(async () => {
    if (from === 'search' && !isAggregate && actualSource && actualId && searchFavorited === null) {
      try {
        const fav = await isFavorited(actualSource, actualId);
        setSearchFavorited(fav);
      } catch (err) {
        setSearchFavorited(false);
      }
    }
  }, [from, isAggregate, actualSource, actualId, searchFavorited]);

  // 長按操作
  const handleLongPress = useCallback(() => {
    if (!showMobileActions) { // 防止重複觸發
      // 立即顯示菜單，避免等待數據加載導致動畫卡頓
      setShowMobileActions(true);

      // 異步檢查收藏狀態，不阻塞菜單顯示
      if (from === 'search' && !isAggregate && actualSource && actualId && searchFavorited === null) {
        checkSearchFavoriteStatus();
      }
    }
  }, [showMobileActions, from, isAggregate, actualSource, actualId, searchFavorited, checkSearchFavoriteStatus]);

  // 長按手勢hook
  const longPressProps = useLongPress({
    onLongPress: handleLongPress,
    onClick: handleClick, // 保持點擊播放功能
    longPressDelay: 500,
  });

  // 計算距離上映的天數（使用本地時區）
  const daysUntilRelease = useMemo(() => {
    if (!isUpcoming || !releaseDate) return null;

    // 獲取今天的本地日期（午夜）
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 將日期字符串解析為本地時區的日期對象
    // 使用 'YYYY-MM-DD' 格式直接構造，避免 UTC 解析問題
    const [releaseYear, releaseMonth, releaseDay] = releaseDate.split('-').map(Number);
    const release = new Date(releaseYear, releaseMonth - 1, releaseDay);

    const [todayYear, todayMonth, todayDay] = todayStr.split('-').map(Number);
    const todayDate = new Date(todayYear, todayMonth - 1, todayDay);

    const diffTime = release.getTime() - todayDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  }, [isUpcoming, releaseDate]);

  const config = useMemo(() => {
    const configs = {
      playrecord: {
        showSourceName: true,
        showProgress: true,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: true,
        showDoubanLink: false,
        showRating: false,
        showYear: false,
      },
      favorite: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: false,
        showDoubanLink: false,
        showRating: false,
        showYear: false,
      },
      search: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: true, // 移動端菜單中需要顯示收藏選項
        showCheckCircle: false,
        showDoubanLink: true, // 移動端菜單中顯示豆瓣鏈接
        showRating: !!rate,
        showYear: true,
      },
      douban: {
        showSourceName: false,
        showProgress: false,
        showPlayButton: !isUpcoming, // 即將上映不顯示播放按鈕
        showHeart: false,
        showCheckCircle: false,
        showDoubanLink: false,
        showRating: !!rate,
        showYear: false,
      },
      tmdb: {
        showSourceName: false,
        showProgress: false,
        showPlayButton: !isUpcoming, // 即將上映不顯示播放按鈕
        showHeart: false,
        showCheckCircle: false,
        showDoubanLink: false,
        showRating: !!rate,
        showYear: false,
      },
      'source-search': {
        showSourceName: false,
        showProgress: false,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: false,
        showDoubanLink: true,
        showRating: !!rate,
        showYear: true,
      },
    };
    return configs[from] || configs.search;
  }, [from, isAggregate, douban_id, rate, isUpcoming]);

  // 移動端操作菜單配置
  const mobileActions = useMemo(() => {
    const actions = [];

    // 播放操作
    if (config.showPlayButton) {
      actions.push({
        id: 'play',
        label: origin === 'live' ? '觀看直播' : '播放',
        icon: <PlayCircleIcon size={20} />,
        onClick: handleClick,
        color: 'primary' as const,
      });

      // 新標籤頁播放
      actions.push({
        id: 'play-new-tab',
        label: origin === 'live' ? '新標籤頁觀看' : '新標籤頁播放',
        icon: <ExternalLink size={20} />,
        onClick: handlePlayInNewTab,
        color: 'default' as const,
      });
    }

    // 聚合源信息 - 直接在菜單中展示，不需要單獨的操作項

    // 收藏/取消收藏操作
    if (config.showHeart && from !== 'douban' && from !== 'tmdb' && actualSource && actualId) {
      const currentFavorited = from === 'search' ? searchFavorited : favorited;

      if (from === 'search') {
        // 搜索結果：根據加載狀態顯示不同的選項
        if (searchFavorited !== null) {
          // 已加載完成，顯示實際的收藏狀態
          actions.push({
            id: 'favorite',
            label: currentFavorited ? '取消收藏' : '添加收藏',
            icon: currentFavorited ? (
              <Heart size={20} className="fill-red-600 stroke-red-600" />
            ) : (
              <Heart size={20} className="fill-transparent stroke-red-500" />
            ),
            onClick: () => {
              const mockEvent = {
                preventDefault: () => { },
                stopPropagation: () => { },
              } as React.MouseEvent;
              handleToggleFavorite(mockEvent);
            },
            color: currentFavorited ? ('danger' as const) : ('default' as const),
          });
        } else {
          // 正在加載中，顯示佔位項
          actions.push({
            id: 'favorite-loading',
            label: '收藏加載中...',
            icon: <Heart size={20} />,
            onClick: () => { }, // 加載中時不響應點擊
            disabled: true,
          });
        }
      } else {
        // 非搜索結果：直接顯示收藏選項
        actions.push({
          id: 'favorite',
          label: currentFavorited ? '取消收藏' : '添加收藏',
          icon: currentFavorited ? (
            <Heart size={20} className="fill-red-600 stroke-red-600" />
          ) : (
            <Heart size={20} className="fill-transparent stroke-red-500" />
          ),
          onClick: () => {
            const mockEvent = {
              preventDefault: () => { },
              stopPropagation: () => { },
            } as React.MouseEvent;
            handleToggleFavorite(mockEvent);
          },
          color: currentFavorited ? ('danger' as const) : ('default' as const),
        });
      }
    }

    // 刪除播放記錄操作
    if (config.showCheckCircle && from === 'playrecord' && actualSource && actualId) {
      actions.push({
        id: 'delete',
        label: '刪除記錄',
        icon: <Trash2 size={20} />,
        onClick: () => {
          const mockEvent = {
            preventDefault: () => { },
            stopPropagation: () => { },
          } as React.MouseEvent;
          handleDeleteRecord(mockEvent);
        },
        color: 'danger' as const,
      });
    }

    // 豆瓣鏈接操作
    if (config.showDoubanLink && actualDoubanId && actualDoubanId !== 0) {
      actions.push({
        id: 'douban',
        label: isBangumi ? 'Bangumi 詳情' : '豆瓣詳情',
        icon: <Link size={20} />,
        onClick: () => {
          const url = isBangumi
            ? `https://bgm.tv/subject/${actualDoubanId.toString()}`
            : `https://movie.douban.com/subject/${actualDoubanId.toString()}`;
          window.open(url, '_blank', 'noopener,noreferrer');
        },
        color: 'default' as const,
      });
    }

    // 詳情頁面按鈕（直播源不顯示詳情）
    if (origin !== 'live') {
      actions.push({
        id: 'detail',
        label: '詳情',
        icon: <Info size={20} />,
        onClick: () => {
          setShowMobileActions(false);
          // 延遲打開 DetailPanel，確保 MobileActionSheet 完全清理完成
          setTimeout(() => {
            setShowDetailPanel(true);
          }, 250);
        },
        color: 'default' as const,
      });
    }

    // AI問片功能
    if (aiEnabled && actualTitle) {
      actions.push({
        id: 'ai-chat',
        label: 'AI問片',
        icon: <Sparkles size={20} />,
        onClick: () => {
          setShowMobileActions(false);
          // 延遲打開 AIChatPanel，確保 MobileActionSheet 完全清理完成
          setTimeout(() => {
            setShowAIChat(true);
          }, 250);
        },
        color: 'default' as const,
      });
    }

    return actions;
  }, [
    config,
    from,
    actualSource,
    actualId,
    favorited,
    searchFavorited,
    actualDoubanId,
    isBangumi,
    isAggregate,
    dynamicSourceNames,
    handleClick,
    handleToggleFavorite,
    handleDeleteRecord,
    handlePlayInNewTab,
    aiEnabled,
    actualTitle,
  ]);

  return (
    <>
      <div
        className={`group relative w-full rounded-lg bg-transparent transition-all duration-300 ease-in-out hover:scale-[1.05] hover:z-[500] ${isUpcoming ? 'cursor-default' : 'cursor-pointer'} ${
          showUpcomingInfo ? 'scale-[1.05] z-[500]' : ''
        }`}
        onClick={handleClick}
        {...longPressProps}
        style={{
          // 禁用所有默認的長按和選擇效果
          WebkitUserSelect: 'none',
          userSelect: 'none',
          WebkitTouchCallout: 'none',
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
          // 禁用右鍵菜單和長按菜單
          pointerEvents: 'auto',
        } as React.CSSProperties}
        onContextMenu={(e) => {
          // 阻止默認右鍵菜單
          e.preventDefault();
          e.stopPropagation();

          // 右鍵彈出操作菜單
          setShowMobileActions(true);

          // 異步檢查收藏狀態，不阻塞菜單顯示
          if (from === 'search' && !isAggregate && actualSource && actualId && searchFavorited === null) {
            checkSearchFavoriteStatus();
          }

          return false;
        }}

        onDragStart={(e) => {
          // 阻止拖拽
          e.preventDefault();
          return false;
        }}
      >
        {/* 海報容器 */}
        <div
          className={`relative overflow-hidden rounded-lg ${origin === 'live' ? 'ring-1 ring-gray-300/80 dark:ring-gray-600/80' : ''} ${
            orientation === 'horizontal'
              ? 'aspect-[3/2]'
              : 'aspect-[2/3]'
          }`}
          style={{
            WebkitUserSelect: 'none',
            userSelect: 'none',
            WebkitTouchCallout: 'none',
          } as React.CSSProperties}
          onContextMenu={(e) => {
            e.preventDefault();
            return false;
          }}
        >
          {/* 骨架屏 */}
          {!isLoading && !isDirectPlaySource && <ImagePlaceholder aspectRatio={orientation === 'horizontal' ? 'aspect-[3/2]' : 'aspect-[2/3]'} />}
          {isDirectPlaySource ? (
            <div className='absolute inset-0 flex items-center justify-center bg-gray-200/80 dark:bg-gray-700/80'>
              <Link className='w-8 h-8 text-blue-500' />
            </div>
          ) : (isNetdiskSource(actualSource) && !actualPoster && displayPoster === netdiskPosterPlaceholder) ? (
            <div className='absolute inset-0 flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'>
              <Cloud className='w-10 h-10 opacity-80' />
            </div>
          ) : (
            <Image
              src={displayPoster}
              alt={actualTitle}
              fill
              className={origin === 'live' ? 'object-contain' : orientation === 'horizontal' ? 'object-cover object-center' : 'object-cover'}
              referrerPolicy='no-referrer'
              loading='lazy'
              onLoadingComplete={() => setIsLoading(true)}
              onClick={(e) => {
                e.stopPropagation();
                setShowImageViewer(true);
              }}
              onError={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                const fallbackPoster = getDoubanImageFallbackUrl(actualPoster);
                if (fallbackPoster && tryApplyDoubanImageFallback(img, actualPoster)) {
                  setDisplayPoster(fallbackPoster);
                  return;
                }

                // 圖片加載失敗時的重試機制
                if (!img.dataset.retried) {
                  img.dataset.retried = 'true';
                  setTimeout(() => {
                    setDisplayPoster(processedPoster);
                    img.src = processedPoster;
                  }, 2000);
                }
              }}
              style={{
                // 禁用圖片的默認長按效果
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
                pointerEvents: 'auto', // 改為auto以響應點擊事件
                cursor: 'pointer', // 添加指針樣式
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
              onDragStart={(e) => {
                e.preventDefault();
                return false;
              }}
            />
          )}

          {/* 懸浮遮罩 */}
          <div
            className='absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent transition-opacity duration-300 ease-in-out opacity-0 group-hover:opacity-100'
            style={{
              WebkitUserSelect: 'none',
              userSelect: 'none',
              WebkitTouchCallout: 'none',
            } as React.CSSProperties}
            onContextMenu={(e) => {
              e.preventDefault();
              return false;
            }}
          />

          {/* 播放按鈕或上映倒計時 */}
          {isUpcoming && daysUntilRelease !== null ? (
            <div
              data-button="true"
              className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ease-in-out ${
                showUpcomingInfo ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
              }`}
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              <div
                className='bg-black/70 backdrop-blur-sm text-white px-4 py-2 rounded-lg text-xs md:text-sm font-medium shadow-lg'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
              >
                {daysUntilRelease > 0
                  ? `${daysUntilRelease}天后上映`
                  : daysUntilRelease === 0
                    ? '今日上映'
                    : '已上映'}
              </div>
            </div>
          ) : config.showPlayButton && (
            <div
              data-button="true"
              className='absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 ease-in-out delay-75 group-hover:opacity-100 group-hover:scale-100'
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              <PlayCircleIcon
                size={50}
                strokeWidth={0.8}
                className='text-white fill-transparent transition-all duration-300 ease-out hover:fill-green-500 hover:scale-[1.1]'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              />
            </div>
          )}

          {/* 操作按鈕 - 繼續觀看不顯示桌面端懸停按鈕 */}
          {(config.showHeart || config.showCheckCircle) && from !== 'playrecord' && (
            <div
              data-button="true"
              className='absolute bottom-3 right-3 flex gap-3 opacity-0 translate-y-2 transition-all duration-300 ease-in-out sm:group-hover:opacity-100 sm:group-hover:translate-y-0'
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              {config.showCheckCircle && (
                <Trash2
                  onClick={handleDeleteRecord}
                  size={20}
                  className='text-white transition-all duration-300 ease-out hover:stroke-red-500 hover:scale-[1.1]'
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                />
              )}
              {config.showHeart && from !== 'search' && (
                <Heart
                  onClick={handleToggleFavorite}
                  size={20}
                  className={`transition-all duration-300 ease-out ${favorited
                    ? 'fill-red-600 stroke-red-600'
                    : 'fill-transparent stroke-white hover:stroke-red-400'
                    } hover:scale-[1.1]`}
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                />
              )}
            </div>
          )}


          {/* 季度徽章 */}
          {seasonNumber && (
            <div
              className="absolute top-2 left-2 bg-blue-500/80 text-white text-xs font-medium px-2 py-1 rounded backdrop-blur-sm shadow-sm transition-all duration-300 ease-out group-hover:opacity-90"
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
              title={seasonName || `第${seasonNumber}季`}
            >
              S{seasonNumber}
            </div>
          )}

          {/* 徽章 */}
          {config.showRating && rate && (
            <div
              className='absolute top-2 right-2 bg-pink-500 text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center shadow-md transition-all duration-300 ease-out group-hover:scale-110'
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              {rate}
            </div>
          )}

          {/* 豎向模式：頂部直鏈地址顯示 */}
          {orientation === 'vertical' && isDirectPlaySource && directLinkUrl && (
            <div
              className='absolute top-1 left-1 right-1 sm:top-2 sm:left-2 sm:right-2 pt-1 px-1 sm:pt-2 sm:px-2'
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              <div
                className='text-[9px] sm:text-[10px] text-yellow-400 line-clamp-2 break-all'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
                title={directLinkUrl}
              >
                {directLinkUrl}
              </div>
            </div>
          )}

          {actualEpisodes && actualEpisodes > 1 && orientation === 'vertical' && (
            <div
              className='absolute top-1 right-1 sm:top-2 sm:right-2 flex flex-col gap-0.5 sm:gap-1.5'
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              {/* 集數顯示 */}
              <div
                className='bg-black/60 text-white text-[9px] sm:text-xs font-medium px-2 sm:px-3 py-0.5 sm:py-1 rounded-full shadow-md transition-all duration-300 ease-out group-hover:scale-110 backdrop-blur-sm flex items-center justify-center'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                共{actualEpisodes}集
              </div>

              {/* 年份顯示 */}
              {displayYear && (
                <div
                  className='bg-black/60 text-white text-[9px] sm:text-xs font-medium px-2 sm:px-3 py-0.5 sm:py-1 rounded-full shadow-md transition-all duration-300 ease-out group-hover:scale-110 backdrop-blur-sm flex items-center justify-center'
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                >
                  {displayYear}年
                </div>
              )}
            </div>
          )}

          {/* 豎向模式：來源名稱顯示在海報右下角 */}
          {orientation === 'vertical' && config.showSourceName && source_name && !cmsData && (
            <div
              className='absolute bottom-1 right-1 sm:bottom-2 sm:right-2'
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              <span
                className={`inline-block border rounded px-1 py-0.5 text-[8px] text-white/90 bg-black/60 ${
                  actualSource === 'xiaoya' ? 'border-blue-500' : isNetdiskSource(actualSource) ? 'border-purple-500' : actualSource === 'openlist' || actualSource === 'emby' || actualSource?.startsWith('emby_') ? 'border-yellow-500' : origin === 'live' ? 'border-red-500' : 'border-white/60'
                }`}
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                {origin === 'live' && (
                  <Radio size={8} className="inline-block text-white/90 mr-0.5" />
                )}
                {source_name}
              </span>
            </div>
          )}

          {/* 豆瓣鏈接 */}
          {config.showDoubanLink && actualDoubanId && actualDoubanId !== 0 && (
            <a
              href={
                isBangumi
                  ? `https://bgm.tv/subject/${actualDoubanId.toString()}`
                  : `https://movie.douban.com/subject/${actualDoubanId.toString()}`
              }
              target='_blank'
              rel='noopener noreferrer'
              onClick={(e) => e.stopPropagation()}
              className='absolute top-2 left-2 opacity-0 -translate-x-2 transition-all duration-300 ease-in-out delay-100 sm:group-hover:opacity-100 sm:group-hover:translate-x-0'
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              <div
                className='bg-green-500 text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center shadow-md hover:bg-green-600 hover:scale-[1.1] transition-all duration-300 ease-out'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                <Link
                  size={16}
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                    pointerEvents: 'none',
                  } as React.CSSProperties}
                />
              </div>
            </a>
          )}

          {/* 聚合播放源指示器 */}
          {isAggregate && dynamicSourceNames && dynamicSourceNames.length > 0 && (() => {
            const uniqueSources = Array.from(new Set(dynamicSourceNames));
            const sourceCount = uniqueSources.length;

            return (
              <div
                className={`absolute bottom-1 right-1 sm:bottom-2 sm:right-2 transition-all duration-300 ease-in-out delay-75 ${
                  from === 'search' ? 'opacity-100' : 'opacity-0 sm:group-hover:opacity-100'
                }`}
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                <div
                  className='relative group/sources'
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                >
                  <div
                    className='bg-gray-700 text-white text-xs font-bold w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center shadow-md hover:bg-gray-600 hover:scale-[1.1] transition-all duration-300 ease-out cursor-pointer'
                    style={{
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      return false;
                    }}
                  >
                    {sourceCount}
                  </div>

                  {/* 播放源詳情懸浮框 */}
                  {(() => {
                    // 優先顯示的播放源（常見的主流平臺）
                    const prioritySources = ['愛奇藝', '騰訊視頻', '優酷', '芒果TV', '嗶哩嗶哩', 'Netflix', 'Disney+'];

                    // 按優先級排序播放源
                    const sortedSources = uniqueSources.sort((a, b) => {
                      const aIndex = prioritySources.indexOf(a);
                      const bIndex = prioritySources.indexOf(b);
                      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
                      if (aIndex !== -1) return -1;
                      if (bIndex !== -1) return 1;
                      return a.localeCompare(b);
                    });

                    const maxDisplayCount = 6; // 最多顯示6個
                    const displaySources = sortedSources.slice(0, maxDisplayCount);
                    const hasMore = sortedSources.length > maxDisplayCount;
                    const remainingCount = sortedSources.length - maxDisplayCount;

                    return (
                      <div
                        className='absolute bottom-full mb-2 opacity-0 invisible group-hover/sources:opacity-100 group-hover/sources:visible transition-all duration-200 ease-out delay-100 pointer-events-none z-50 right-0 sm:right-0 -translate-x-0 sm:translate-x-0'
                        style={{
                          WebkitUserSelect: 'none',
                          userSelect: 'none',
                          WebkitTouchCallout: 'none',
                        } as React.CSSProperties}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          return false;
                        }}
                      >
                        <div
                          className='bg-gray-800/90 backdrop-blur-sm text-white text-xs sm:text-xs rounded-lg shadow-xl border border-white/10 p-1.5 sm:p-2 min-w-[100px] sm:min-w-[120px] max-w-[140px] sm:max-w-[200px] overflow-hidden'
                          style={{
                            WebkitUserSelect: 'none',
                            userSelect: 'none',
                            WebkitTouchCallout: 'none',
                          } as React.CSSProperties}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            return false;
                          }}
                        >
                          {/* 單列布局 */}
                          <div className='space-y-0.5 sm:space-y-1'>
                            {displaySources.map((sourceName, index) => (
                              <div key={index} className='flex items-center gap-1 sm:gap-1.5'>
                                <div className='w-0.5 h-0.5 sm:w-1 sm:h-1 bg-blue-400 rounded-full flex-shrink-0'></div>
                                <span className='truncate text-[10px] sm:text-xs leading-tight' title={sourceName}>
                                  {sourceName}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* 顯示更多提示 */}
                          {hasMore && (
                            <div className='mt-1 sm:mt-2 pt-1 sm:pt-1.5 border-t border-gray-700/50'>
                              <div className='flex items-center justify-center text-gray-400'>
                                <span className='text-[10px] sm:text-xs font-medium'>+{remainingCount} 播放源</span>
                              </div>
                            </div>
                          )}

                          {/* 小箭頭 */}
                          <div className='absolute top-full right-2 sm:right-3 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[4px] sm:border-l-[6px] sm:border-r-[6px] sm:border-t-[6px] border-transparent border-t-gray-800/90'></div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })()}

          {/* 橫向模式：標題和進度條在海報上 */}
          {orientation === 'horizontal' && (
            <>
              {/* 頂部漸變遮罩 - 用於標題背景 */}
              <div
                className='absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent pt-2 pb-8 px-2'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                {/* 標題 */}
                <div
                  className='mb-1'
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                >
                  <span
                    className='block text-sm font-bold truncate text-white'
                    style={{
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      return false;
                    }}
                    title={actualTitle}
                  >
                    {actualTitle}
                  </span>
                </div>

                {/* 集數信息 - 只有超過1集時才顯示 */}
                {currentEpisode && actualEpisodes && actualEpisodes > 1 && (
                  <div
                    className='text-xs text-white/90'
                    style={{
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      return false;
                    }}
                  >
                    第{currentEpisode}集 · 共{actualEpisodes}集
                  </div>
                )}

                {/* 直鏈地址 */}
                {isDirectPlaySource && directLinkUrl && (
                  <div
                    className='text-[10px] text-white/75 truncate'
                    style={{
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      return false;
                    }}
                    title={directLinkUrl}
                  >
                    {directLinkUrl}
                  </div>
                )}
              </div>

              {/* 底部漸變遮罩 - 用於進度條背景 */}
              <div
                className='absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-8 pb-2 px-2'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                {/* 進度條 */}
                {config.showProgress && progress !== undefined && origin !== 'live' && (
                  <div
                    style={{
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties}
                  >
                    {/* 來源和時長顯示 - 在進度條上方 */}
                    <div className='flex items-center justify-between mb-1'>
                      {/* 時長顯示 - 左側 */}
                      {from === 'playrecord' && playTime !== undefined && totalTime !== undefined && (
                        <div
                          className='text-[10px] text-white/80'
                          style={{
                            WebkitUserSelect: 'none',
                            userSelect: 'none',
                            WebkitTouchCallout: 'none',
                          } as React.CSSProperties}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            return false;
                          }}
                        >
                          {(() => {
                            const formatTime = (seconds: number) => {
                              const mins = Math.floor(seconds / 60);
                              const secs = Math.floor(seconds % 60);
                              // 0分鐘時不顯示分鐘
                              if (mins === 0) {
                                return `${secs}秒`;
                              }
                              return `${mins}分${secs}秒`;
                            };
                            return formatTime(playTime);
                          })()}
                        </div>
                      )}

                      {/* 來源 - 右側 */}
                      {config.showSourceName && source_name && !cmsData && (
                        <span
                          className={`inline-block border rounded px-1 py-0.5 text-[8px] text-white/90 bg-black/30 backdrop-blur-sm ${
                            actualSource === 'xiaoya' ? 'border-blue-500' : isNetdiskSource(actualSource) ? 'border-purple-500' : actualSource === 'openlist' || actualSource === 'emby' || actualSource?.startsWith('emby_') ? 'border-yellow-500' : 'border-white/60'
                          }`}
                          style={{
                            WebkitUserSelect: 'none',
                            userSelect: 'none',
                            WebkitTouchCallout: 'none',
                          } as React.CSSProperties}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            return false;
                          }}
                        >
                          {source_name}
                        </span>
                      )}
                    </div>
                    <div
                      className='h-1 w-full bg-white/20 rounded-full overflow-hidden'
                      style={{
                        WebkitUserSelect: 'none',
                        userSelect: 'none',
                        WebkitTouchCallout: 'none',
                      } as React.CSSProperties}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        return false;
                      }}
                    >
                      <div
                        className='h-full bg-white transition-all duration-500 ease-out'
                        style={{
                          width: `${progress}%`,
                          WebkitUserSelect: 'none',
                          userSelect: 'none',
                          WebkitTouchCallout: 'none',
                        } as React.CSSProperties}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          return false;
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* 直播時只顯示來源 */}
                {origin === 'live' && config.showSourceName && source_name && !cmsData && (
                  <div className='flex items-center justify-end'>
                    <span
                      className={`inline-block border rounded px-1 py-0.5 text-[8px] text-white/90 bg-black/30 backdrop-blur-sm ${
                        origin === 'live' ? 'border-red-500' : actualSource === 'openlist' || actualSource === 'emby' || actualSource?.startsWith('emby_') ? 'border-yellow-500' : 'border-white/60'
                      }`}
                      style={{
                        WebkitUserSelect: 'none',
                        userSelect: 'none',
                        WebkitTouchCallout: 'none',
                      } as React.CSSProperties}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        return false;
                      }}
                    >
                      <Radio size={8} className="inline-block text-white/90 mr-0.5" />
                      {source_name}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* 豎向模式：進度條和標題在海報下方 */}
        {orientation === 'vertical' && (
          <>
            {/* 進度條 */}
            {config.showProgress && progress !== undefined && (
              <div
                className='mt-1 h-1 w-full bg-gray-200 rounded-full overflow-hidden'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                <div
                  className='h-full bg-green-500 transition-all duration-500 ease-out'
                  style={{
                    width: `${progress}%`,
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                />
              </div>
            )}

            {/* 標題 */}
            <div
              className='mt-2 text-center'
              style={{
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties}
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            >
              <div
                className='relative'
                style={{
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties}
              >
                <span
                  className='block text-sm font-semibold truncate text-gray-900 dark:text-gray-100 transition-colors duration-300 ease-in-out group-hover:text-green-600 dark:group-hover:text-green-400 peer'
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                >
                  {actualTitle}
                </span>
                {/* 自定義 tooltip */}
                <div
                  className='absolute bottom-full left-1/2 z-10 mb-2 w-max max-w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md bg-gray-800 px-3 py-1 text-center text-xs text-white shadow-lg opacity-0 invisible peer-hover:opacity-100 peer-hover:visible transition-all duration-200 ease-out delay-100 whitespace-normal break-words pointer-events-none'
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                >
                  {actualTitle}
                  <div
                    className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'
                    style={{
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties}
                  ></div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 操作菜單 - 支持右鍵和長按觸發 */}
      <MobileActionSheet
        isOpen={showMobileActions}
        onClose={() => setShowMobileActions(false)}
        title={actualTitle}
        poster={displayPoster}
        actions={mobileActions}
        sources={isAggregate && dynamicSourceNames ? Array.from(new Set(dynamicSourceNames)) : undefined}
        isAggregate={isAggregate}
        sourceName={cmsData ? undefined : source_name}
        directLinkUrl={directLinkUrl || undefined}
        currentEpisode={currentEpisode}
        totalEpisodes={actualEpisodes}
        origin={origin}
        onPosterClick={() => {
          setShowImageViewer(true);
        }}
      />

      {/* AI問片面板 - 只在打開或正在流式響應時渲染 */}
      {aiEnabled && (showAIChat || isAIStreaming) && (
        <AIChatPanel
          isOpen={showAIChat}
          onClose={() => setShowAIChat(false)}
          onStreamingChange={setIsAIStreaming}
          context={{
            title: actualTitle,
            year: actualYear,
            douban_id: actualDoubanId,
            tmdb_id,
            type: actualSearchType as 'movie' | 'tv',
            currentEpisode,
          }}
          welcomeMessage={aiDefaultMessageWithVideo ? aiDefaultMessageWithVideo.replace('{title}', actualTitle || '') : `想了解《${actualTitle}》的更多信息嗎？我可以幫你查詢劇情、演員、評價等。`}
        />
      )}

      {/* 詳情面板 */}
      {showDetailPanel && (
        <DetailPanel
          isOpen={showDetailPanel}
          onClose={() => setShowDetailPanel(false)}
          title={actualTitle}
          poster={displayPoster}
          doubanId={actualDoubanId}
          bangumiId={isBangumi ? actualDoubanId : undefined}
          isBangumi={isBangumi}
          tmdbId={tmdb_id}
          type={actualSearchType as 'movie' | 'tv'}
          seasonNumber={seasonNumber}
          currentEpisode={currentEpisode}
          cmsData={cmsData}
          sourceId={id}
          source={source}
        />
      )}

      {/* 圖片查看器 */}
      {showImageViewer && (
        <ImageViewer
          isOpen={showImageViewer}
          onClose={() => setShowImageViewer(false)}
          imageUrl={actualPoster}
          alt={actualTitle}
        />
      )}
    </>
  );
}

);

export default memo(VideoCard);
