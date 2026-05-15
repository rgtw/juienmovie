'use client';

import { ChevronLeft, ChevronRight, Info, Play, Volume2, VolumeX } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef,useState } from 'react';

import { type TMDBItem,getGenreNames, getTMDBImageUrl } from '@/lib/tmdb.client';
import { getDoubanDetail } from '@/lib/douban.client';

import ProxyImage from '@/components/ProxyImage';

interface BannerCarouselProps {
  autoPlayInterval?: number; // 自動播放間隔（毫秒）
  delayLoad?: boolean; // 是否延遲加載（等頁面加載完畢後再加載）
}

// 擴展TMDBItem類型以支持TX數據源的額外字段
interface BannerItem extends TMDBItem {
  subtitle?: string; // TX數據源的子標題
  tags?: string[]; // TX數據源的標籤
  trailer_url?: string | null; // 豆瓣預告片直鏈
  genres?: string[]; // 豆瓣數據源的類型標籤
}

export default function BannerCarousel({ autoPlayInterval = 5000, delayLoad = false }: BannerCarouselProps) {
  const router = useRouter();
  const [items, setItems] = useState<BannerItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [shouldLoad, setShouldLoad] = useState(!delayLoad); // 是否應該開始加載數據
  const [isPaused, setIsPaused] = useState(false);
  const [skipNextAutoPlay, setSkipNextAutoPlay] = useState(false); // 跳過下一次自動播放
  const [isYouTubeAccessible, setIsYouTubeAccessible] = useState(false); // YouTube連通性（默認false，檢查後再決定）
  const [enableTrailers, setEnableTrailers] = useState(false); // 是否啟用預告片（默認關閉）
  const [dataSource, setDataSource] = useState<string>(''); // 當前數據源
  const [trailersLoaded, setTrailersLoaded] = useState(false); // 預告片是否已加載
  const [isMuted, setIsMuted] = useState(true); // 視頻是否靜音（默認靜音）
  const videoRef = useRef<HTMLVideoElement>(null); // 視頻元素引用
  const videoRefs = useRef<Map<number, HTMLVideoElement>>(new Map()); // 所有視頻元素的引用
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const isManualChange = useRef(false); // 標記是否為手動切換

  // LocalStorage 緩存配置
  const LOCALSTORAGE_DURATION = 24 * 60 * 60 * 1000; // 1天

  // 根據數據源獲取緩存key
  const getLocalStorageKey = (source: string) => {
    return `banner_trending_cache_${source}`;
  };

  // 跳轉到播放頁面
  const handlePlay = (title: string) => {
    router.push(`/play?title=${encodeURIComponent(title)}`);
  };

  // 切換音量
  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);

    // 直接更新當前視頻元素的靜音狀態
    const currentVideo = videoRefs.current.get(currentIndex);
    if (currentVideo) {
      currentVideo.muted = newMutedState;
    }
  };

  // 獲取圖片原始URL（處理TX完整URL和TMDB路徑）
  const getImageUrl = (path: string | null) => {
    if (!path) return '';
    // 如果是完整URL（TX數據源或豆瓣），直接返回原始地址
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    // 否則使用TMDB的URL拼接原始地址
    return getTMDBImageUrl(path, 'original');
  };

  // 獲取視頻URL（處理豆瓣視頻代理）
  const getVideoUrl = (url: string | null) => {
    if (!url) return null;
    // 豆瓣視頻直接使用服務器代理
    if (url.includes('doubanio.com')) {
      return `/api/video-proxy?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  // 讀取本地設置
  useEffect(() => {
    const setting = localStorage.getItem('enableTrailers');
    if (setting !== null) {
      setEnableTrailers(setting === 'true');
    }
  }, []);

  // 延遲加載：等待頁面加載完畢後再開始加載輪播圖數據
  useEffect(() => {
    if (!delayLoad) return;

    // 頁面加載完畢後再開始加載
    if (document.readyState === 'complete') {
      setShouldLoad(true);
    } else {
      const handleLoad = () => {
        setShouldLoad(true);
      };
      window.addEventListener('load', handleLoad);
      return () => window.removeEventListener('load', handleLoad);
    }
  }, [delayLoad]);

  // 檢測YouTube連通性 - 僅在啟用預告片且數據源為TMDB時檢測
  useEffect(() => {
    // 如果未啟用預告片或數據源不是TMDB，不進行檢測
    if (!enableTrailers || dataSource !== 'TMDB') {
      setIsYouTubeAccessible(false);
      return;
    }

    const checkYouTubeAccess = () => {
      const img = document.createElement('img');
      const timeout = setTimeout(() => {
        img.src = '';
        setIsYouTubeAccessible(false);
      }, 3000);

      img.onload = () => {
        clearTimeout(timeout);
        setIsYouTubeAccessible(true);
      };

      img.onerror = () => {
        clearTimeout(timeout);
        setIsYouTubeAccessible(false);
      };

      // 添加隨機查詢參數避免緩存
      img.src = `https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg?t=${Date.now()}`;
    };

    checkYouTubeAccess();
  }, [enableTrailers, dataSource]);

  // 獲取热门內容
  useEffect(() => {
    // 如果不應該加載，直接返回
    if (!shouldLoad) return;

    const fetchTrending = async () => {
      try {
        // 先嚐試從所有可能的數據源緩存中讀取，找到最新的緩存
        const sources = ['TMDB', 'TX', 'Douban'];
        let cachedData = null;
        let validSource = null;
        let cacheExpired = false;
        let latestTimestamp = 0;

        // 遍歷所有數據源，找到最新的緩存
        for (const source of sources) {
          const cacheKey = getLocalStorageKey(source);
          const cached = localStorage.getItem(cacheKey);

          if (cached) {
            try {
              const { data, timestamp } = JSON.parse(cached);

              // 選擇時間戳最新的緩存
              if (timestamp > latestTimestamp) {
                cachedData = data;
                validSource = source;
                latestTimestamp = timestamp;
                cacheExpired = Date.now() - timestamp > LOCALSTORAGE_DURATION;
              }
            } catch (e) {
              console.error('解析緩存數據失敗:', e);
            }
          }
        }

        // 樂觀緩存：如果有緩存（無論是否過期），先顯示緩存數據
        if (cachedData) {
          setItems(cachedData);
          setDataSource(validSource || ''); // 設置數據源
          setIsLoading(false);
          setTrailersLoaded(false); // 重置預告片加載狀態
        }

        // 如果緩存過期或沒有緩存，後臺更新數據
        if (!cachedData || cacheExpired) {
          const response = await fetch('/api/tmdb/trending');
          const result = await response.json();

          if (result.code === 200 && result.list.length > 0) {
            const newDataSource = result.source || 'TMDB'; // 獲取數據源標識
            const cacheKey = getLocalStorageKey(newDataSource);

            setItems(result.list);
            setDataSource(newDataSource); // 設置數據源
            setTrailersLoaded(false); // 重置預告片加載狀態

            // 保存到 localStorage（使用數據源特定的key）
            try {
              localStorage.setItem(cacheKey, JSON.stringify({
                data: result.list,
                timestamp: Date.now()
              }));
            } catch (e) {
              // localStorage 可能已滿，忽略錯誤
              console.error('保存到 localStorage 失敗:', e);
            }
          }
        }
      } catch (error) {
        console.error('獲取热门內容失敗:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTrending();
  }, [shouldLoad]);

  // 前端獲取豆瓣預告片
  useEffect(() => {
    // 只有在啟用預告片、數據源是豆瓣、有數據且未加載預告片時才執行
    if (!enableTrailers || dataSource !== 'Douban' || items.length === 0 || trailersLoaded) {
      return;
    }

    const fetchDoubanTrailers = async () => {
      try {
        // 為每個項目獲取預告片
        const itemsWithTrailers = await Promise.all(
          items.map(async (item) => {
            try {
              // 使用統一的豆瓣詳情獲取函數（會根據用戶配置的代理設置自動選擇請求方式）
              const detail = await getDoubanDetail(item.id.toString());

              // 獲取預告片鏈接（取第一個）
              const trailerUrl = detail.trailers && detail.trailers.length > 0
                ? detail.trailers[0].video_url
                : null;

              return {
                ...item,
                trailer_url: trailerUrl,
              };
            } catch (error) {
              console.error(`獲取豆瓣電影 ${item.id} 預告片失敗:`, error);
              return item;
            }
          })
        );

        setItems(itemsWithTrailers);
        setTrailersLoaded(true);
      } catch (error) {
        console.error('獲取豆瓣預告片失敗:', error);
      }
    };

    fetchDoubanTrailers();
  }, [enableTrailers, dataSource, items.length, trailersLoaded]);

  // 切換輪播圖時重置靜音狀態
  useEffect(() => {
    setIsMuted(true);
  }, [currentIndex]);

  // 控制視頻播放/暫停和靜音狀態
  useEffect(() => {
    // 遍歷所有視頻元素
    videoRefs.current.forEach((video, index) => {
      if (index === currentIndex) {
        // 當前顯示的視頻：播放並設置靜音狀態
        video.muted = isMuted;
        video.play().catch(() => {
          // 忽略自動播放失敗的錯誤
        });
      } else {
        // 非當前顯示的視頻：暫停
        video.pause();
      }
    });
  }, [currentIndex, isMuted]);

  // 自動播放
  useEffect(() => {
    if (!items.length || isPaused) return;

    const timer = setInterval(() => {
      // 如果設置了跳過標誌，跳過這一次自動播放
      if (skipNextAutoPlay) {
        setSkipNextAutoPlay(false);
        return;
      }
      
      setCurrentIndex((prev) => (prev + 1) % items.length);
    }, autoPlayInterval);

    return () => clearInterval(timer);
  }, [items.length, isPaused, autoPlayInterval, skipNextAutoPlay]);

  const goToPrevious = useCallback(() => {
    isManualChange.current = true;
    setSkipNextAutoPlay(true);
    setCurrentIndex((prev) => (prev - 1 + items.length) % items.length);
    setTimeout(() => {
      isManualChange.current = false;
    }, 100);
  }, [items.length]);

  const goToNext = useCallback(() => {
    isManualChange.current = true;
    setSkipNextAutoPlay(true);
    setCurrentIndex((prev) => (prev + 1) % items.length);
    setTimeout(() => {
      isManualChange.current = false;
    }, 100);
  }, [items.length]);

  const goToSlide = useCallback((index: number) => {
    isManualChange.current = true;
    setSkipNextAutoPlay(true);
    setCurrentIndex(index);
    setTimeout(() => {
      isManualChange.current = false;
    }, 100);
  }, []);

  // 觸摸事件處理
  const handleTouchStart = (e: React.TouchEvent) => {
    // 防止在手動切換過程中觸發
    if (isManualChange.current) return;
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = 0; // 重置結束位置
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // 防止在手動切換過程中觸發
    if (isManualChange.current) return;
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    // 防止在手動切換過程中觸發
    if (isManualChange.current) return;
    if (!touchStartX.current) return;
    
    // 如果有滑動，則執行滑動邏輯
    if (touchEndX.current !== 0) {
      const distance = touchStartX.current - touchEndX.current;
      const minSwipeDistance = 50; // 最小滑動距離

      if (Math.abs(distance) > minSwipeDistance) {
        if (distance > 0) {
          // 向左滑動，顯示下一張
          goToNext();
        } else {
          // 向右滑動，顯示上一張
          goToPrevious();
        }
      }
    }

    // 重置
    touchStartX.current = 0;
    touchEndX.current = 0;
  };

  if (isLoading || !shouldLoad) {
    return (
      <div className="relative w-full h-[200px] sm:h-[300px] md:h-[400px] lg:h-[500px] bg-gradient-to-b from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 overflow-hidden flex items-center justify-center">
        <Image
          src="/logo.png"
          alt="MoonTVPlus"
          width={120}
          height={120}
          className="opacity-50"
          priority
        />
      </div>
    );
  }

  if (!items.length) {
    return null;
  }

  const currentItem = items[currentIndex];

  return (
    <div
      className="relative w-full h-[200px] sm:h-[300px] md:h-[400px] lg:h-[500px] overflow-hidden group"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={() => {
        // 移動端點擊整個輪播圖跳轉
        if (window.innerWidth < 768) {
          handlePlay(currentItem.title);
        }
      }}
    >
      {/* 背景圖片或視頻 */}
      <div className="absolute inset-0">
        {items.map((item, index) => (
          <div
            key={item.id}
            className={`absolute inset-0 transition-opacity duration-1000 ${
              index === currentIndex ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {item.trailer_url && enableTrailers ? (
              /* 顯示豆瓣直鏈視頻 */
              <div className="absolute inset-0 overflow-hidden">
                <video
                  ref={(el) => {
                    if (el) {
                      videoRefs.current.set(index, el);
                    } else {
                      videoRefs.current.delete(index);
                    }
                  }}
                  src={getVideoUrl(item.trailer_url) || undefined}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 min-w-full min-h-full w-auto h-auto object-cover"
                  muted={isMuted}
                  loop
                  playsInline
                  preload="metadata"
                />
              </div>
            ) : item.video_key && isYouTubeAccessible && enableTrailers ? (
              /* 顯示YouTube視頻 */
              <div className="absolute inset-0 overflow-hidden">
                <iframe
                  src={`https://www.youtube.com/embed/${item.video_key}?listType=playlist&autoplay=1&mute=1&controls=0&loop=1&playlist=${item.video_key}&modestbranding=1&rel=0&showinfo=0&vq=hd1080&hd=1&disablekb=1&fs=0&iv_load_policy=3`}
                  className="absolute top-1/2 left-1/2 pointer-events-none"
                  allow="autoplay; encrypted-media"
                  style={{
                    border: 'none',
                    width: '100vw',
                    height: '100vh',
                    minWidth: '100%',
                    minHeight: '100%',
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              </div>
            ) : (
              /* 顯示圖片 */
              <ProxyImage
                originalSrc={getImageUrl(item.backdrop_path || item.poster_path)}
                alt={item.title}
                className="absolute inset-0 w-full h-full object-cover"
                loading={index === 0 ? 'eager' : 'lazy'}
              />
            )}
            {/* 漸變遮罩 */}
            <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-transparent"></div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
          </div>
        ))}
      </div>

      {/* 內容信息 */}
      <div className="absolute inset-0 flex items-end p-8 md:p-12 pointer-events-none">
        <div className="max-w-2xl space-y-4">
          <h2 className="text-3xl md:text-5xl font-bold text-white drop-shadow-lg">
            {currentItem.title}
          </h2>

          <div className="flex items-center gap-2 md:gap-3 text-sm md:text-base text-white/90 flex-wrap">
            {currentItem.vote_average > 0 && (
              <span className="px-2 py-1 bg-yellow-500 text-black font-semibold rounded">
                {currentItem.vote_average.toFixed(1)}
              </span>
            )}
            {/* 顯示標籤：優先TX的tags，其次豆瓣的genres，最後TMDB的genre_ids */}
            {currentItem.tags && currentItem.tags.length > 0 ? (
              currentItem.tags.slice(0, 3).map((tag, index) => (
                <span key={index} className="px-2 py-1 bg-white/20 backdrop-blur-sm rounded text-sm">
                  {tag}
                </span>
              ))
            ) : currentItem.genres && Array.isArray(currentItem.genres) && currentItem.genres.length > 0 ? (
              /* 顯示豆瓣數據源的標籤 */
              currentItem.genres.slice(0, 3).map((genre, index) => (
                <span key={index} className="px-2 py-1 bg-white/20 backdrop-blur-sm rounded text-sm">
                  {genre}
                </span>
              ))
            ) : (
              /* 顯示TMDB數據源的類型標籤 */
              getGenreNames(currentItem.genre_ids, 3).map(genre => (
                <span key={genre} className="px-2 py-1 bg-white/20 backdrop-blur-sm rounded text-sm">
                  {genre}
                </span>
              ))
            )}
            {currentItem.release_date && (
              <span>{currentItem.release_date}</span>
            )}
          </div>

          {/* PC端播放按鈕 */}
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePlay(currentItem.title);
              }}
              className="hidden md:flex items-center gap-2 px-8 py-2.5 bg-white hover:bg-white/80 text-black font-bold rounded transition-all pointer-events-auto"
            >
              <Play className="w-6 h-6 fill-black text-black" />
              播放
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/douban?query=${encodeURIComponent(currentItem.title)}`);
              }}
              className="hidden md:flex items-center gap-2 px-8 py-2.5 bg-[rgba(109,109,110,0.7)] hover:bg-[rgba(109,109,110,0.4)] text-white font-bold rounded transition-all pointer-events-auto"
            >
              <Info className="w-6 h-6" />
              更多信息
            </button>
          </div>

          {currentItem.overview && (
            <p className="text-sm md:text-base text-white/80 line-clamp-3 drop-shadow-md">
              {currentItem.overview}
            </p>
          )}
        </div>
      </div>

      {/* 左右切換按鈕 - 只在桌面端顯示 */}
      <button
        onClick={goToPrevious}
        className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/30 hover:bg-black/60 text-white rounded-full items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        aria-label="上一張"
      >
        <ChevronLeft className="w-8 h-8" />
      </button>
      <button
        onClick={goToNext}
        className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-black/30 hover:bg-black/60 text-white rounded-full items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        aria-label="下一張"
      >
        <ChevronRight className="w-8 h-8" />
      </button>

      {/* 音量控制按鈕 - 只在有豆瓣預告片時顯示 */}
      {currentItem.trailer_url && enableTrailers && (
        <button
          onClick={toggleMute}
          className="absolute top-2 right-2 md:top-4 md:right-4 w-8 h-8 md:w-10 md:h-10 bg-black/30 hover:bg-black/60 text-white rounded-full flex items-center justify-center transition-all duration-300 z-10"
          aria-label={isMuted ? "開啟聲音" : "關閉聲音"}
        >
          {isMuted ? (
            <VolumeX className="w-4 h-4 md:w-5 md:h-5" />
          ) : (
            <Volume2 className="w-4 h-4 md:w-5 md:h-5" />
          )}
        </button>
      )}

      {/* 指示器 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
        {items.map((_, index) => (
          <button
            key={index}
            onClick={() => goToSlide(index)}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              index === currentIndex
                ? 'w-8 bg-white'
                : 'w-1.5 bg-white/50 hover:bg-white/80'
            }`}
            aria-label={`跳轉到第 ${index + 1} 張`}
          />
        ))}
      </div>
    </div>
  );
}
