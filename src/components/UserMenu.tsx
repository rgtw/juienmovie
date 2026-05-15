/* eslint-disable no-console,@typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

'use client';

import {
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Gauge,
  Globe,
  Home,
  LogOut,
  MessageSquare,
  Monitor,
  MoveDown,
  MoveUp,
  Package,
  Router as RouterIcon,
  Rss,
  Settings,
  Shield,
  Sliders,
  Smartphone,
  Star,
  Tablet,
  User,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { clearAllDanmakuCache, getDanmakuCacheStats } from '@/lib/danmaku/api';
import { CURRENT_VERSION } from '@/lib/version';
import { UpdateStatus } from '@/lib/version_check';

import { DeviceManagementPanel } from './DeviceManagementPanel';
import { DownloadManagementPanel } from './DownloadManagementPanel';
import { EmailSettingsPanel } from './EmailSettingsPanel';
import { FavoritesPanel } from './FavoritesPanel';
import { NotificationPanel } from './NotificationPanel';
import { OfflineDownloadPanel } from './OfflineDownloadPanel';
import { PersonalCenterPanel } from './PersonalCenterPanel';
import { useVersionCheck } from './VersionCheckProvider';
import { VersionPanel } from './VersionPanel';

interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
}

export const UserMenu: React.FC = () => {
  const router = useRouter();
  const { updateStatus, isChecking } = useVersionCheck();
  const [isOpen, setIsOpen] = useState(false);
  const [isProfileCenterOpen, setIsProfileCenterOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isSubscribeOpen, setIsSubscribeOpen] = useState(false);
  const [isVersionPanelOpen, setIsVersionPanelOpen] = useState(false);
  const [isOfflineDownloadPanelOpen, setIsOfflineDownloadPanelOpen] = useState(false);
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const [isFavoritesPanelOpen, setIsFavoritesPanelOpen] = useState(false);
  const [isEmailSettingsOpen, setIsEmailSettingsOpen] = useState(false);
  const [isDeviceManagementOpen, setIsDeviceManagementOpen] = useState(false);
  const [isEcoAppsOpen, setIsEcoAppsOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isDownloadManagementOpen, setIsDownloadManagementOpen] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [storageType, setStorageType] = useState<string>('localstorage');
  const [displayStorageType, setDisplayStorageType] = useState<string>('localstorage');
  const [mounted, setMounted] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // 訂閱相關狀態
  const [subscribeEnabled, setSubscribeEnabled] = useState(false);
  const [subscribeUrl, setSubscribeUrl] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [tvboxToken, setTvboxToken] = useState('');
  const [isResettingToken, setIsResettingToken] = useState(false);
  const [isLoadingSubscribeUrl, setIsLoadingSubscribeUrl] = useState(false);
  const [subscribeAdFilterEnabled, setSubscribeAdFilterEnabled] = useState(false);
  const [subscribeYellowFilterEnabled, setSubscribeYellowFilterEnabled] = useState(false);

  // Body 滾動鎖定 - 使用 overflow 方式避免佈局問題
  useEffect(() => {
    if (isProfileCenterOpen || isSettingsOpen || isChangePasswordOpen || isSubscribeOpen || isOfflineDownloadPanelOpen || isEmailSettingsOpen || isDeviceManagementOpen || isEcoAppsOpen || isReportOpen || isDownloadManagementOpen) {
      const body = document.body;
      const html = document.documentElement;

      // 保存原始樣式
      const originalBodyOverflow = body.style.overflow;
      const originalHtmlOverflow = html.style.overflow;

      // 只設置 overflow 來阻止滾動
      body.style.overflow = 'hidden';
      html.style.overflow = 'hidden';

      return () => {

        // 恢復所有原始樣式
        body.style.overflow = originalBodyOverflow;
        html.style.overflow = originalHtmlOverflow;
      };
    }
  }, [isProfileCenterOpen, isSettingsOpen, isChangePasswordOpen, isSubscribeOpen, isOfflineDownloadPanelOpen, isEmailSettingsOpen, isDeviceManagementOpen, isEcoAppsOpen, isReportOpen, isDownloadManagementOpen]);

  // 設置相關狀態
  const [defaultAggregateSearch, setDefaultAggregateSearch] = useState(true);
  const [doubanProxyUrl, setDoubanProxyUrl] = useState('');
  const [enableOptimization, setEnableOptimization] = useState(true);
  const [preferStrategy, setPreferStrategy] = useState<'fast' | 'full'>('fast');
  const [speedTestTimeout, setSpeedTestTimeout] = useState(4000); // 測速超時時間（毫秒）
  const [fluidSearch, setFluidSearch] = useState(true);
  const [tmdbBackdropDisabled, setTmdbBackdropDisabled] = useState(true);
  const [enableTrailers, setEnableTrailers] = useState(false);
  const [doubanDataSource, setDoubanDataSource] = useState('cmliussss-cdn-tencent');
  const [doubanDataSourceBackup, setDoubanDataSourceBackup] = useState('direct');
  const [doubanImageProxyType, setDoubanImageProxyType] = useState('cmliussss-cdn-tencent');
  const [doubanImageProxyTypeBackup, setDoubanImageProxyTypeBackup] = useState('server');
  const [doubanImageProxyUrl, setDoubanImageProxyUrl] = useState('');
  const [doubanProxyUrlBackup, setDoubanProxyUrlBackup] = useState('');
  const [doubanImageProxyUrlBackup, setDoubanImageProxyUrlBackup] = useState('');
  const [isDoubanDropdownOpen, setIsDoubanDropdownOpen] = useState(false);
  const [isDoubanBackupDropdownOpen, setIsDoubanBackupDropdownOpen] = useState(false);
  const [isDoubanImageProxyDropdownOpen, setIsDoubanImageProxyDropdownOpen] =
    useState(false);
  const [isDoubanImageProxyBackupDropdownOpen, setIsDoubanImageProxyBackupDropdownOpen] =
    useState(false);
  const [bufferStrategy, setBufferStrategy] = useState('medium');
  const [nextEpisodePreCache, setNextEpisodePreCache] = useState(true);
  const [nextEpisodeDanmakuPreload, setNextEpisodeDanmakuPreload] = useState(true);
  const [disableAutoLoadDanmaku, setDisableAutoLoadDanmaku] = useState(false);
  const [danmakuMaxCount, setDanmakuMaxCount] = useState(0);
  const [danmakuHeatmapDisabled, setDanmakuHeatmapDisabled] = useState(false);
  const [searchTraditionalToSimplified, setSearchTraditionalToSimplified] = useState(true);
  const [exactSearch, setExactSearch] = useState(true);
  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState(6);
  const [downloadThreadsPerTask, setDownloadThreadsPerTask] = useState(6);
  const [downloadMode, setDownloadMode] = useState<'browser' | 'filesystem'>('browser');
  const [filesystemSavePath, setFilesystemSavePath] = useState<string>('');

  // 郵件通知設置
  const [userEmail, setUserEmail] = useState('');
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [emailSettingsLoading, setEmailSettingsLoading] = useState(false);
  const [emailSettingsSaving, setEmailSettingsSaving] = useState(false);
  const [emailSettingsMessage, setEmailSettingsMessage] = useState('');
  const [emailSettingsMessageType, setEmailSettingsMessageType] = useState<
    'success' | 'error' | null
  >(null);

  // 設備管理狀態
  const [devices, setDevices] = useState<any[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  // 確認對話框狀態
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => undefined,
  });

  // 摺疊面板狀態
  const [isDoubanSectionOpen, setIsDoubanSectionOpen] = useState(false);

  // TMDB 圖片設置
  const [tmdbImageBaseUrl, setTmdbImageBaseUrl] = useState('https://image.tmdb.org');
  const [isUsageSectionOpen, setIsUsageSectionOpen] = useState(false);
  const [isDownloadSectionOpen, setIsDownloadSectionOpen] = useState(false);
  const [isBufferSectionOpen, setIsBufferSectionOpen] = useState(false);
  const [isDanmakuSectionOpen, setIsDanmakuSectionOpen] = useState(false);
  const [isHomepageSectionOpen, setIsHomepageSectionOpen] = useState(false);

  // 首頁模塊配置
  interface HomeModule {
    id: string;
    name: string;
    enabled: boolean;
    order: number;
  }

  const defaultHomeModules: HomeModule[] = [
    { id: 'hotMovies', name: '热门電影', enabled: true, order: 0 },
    { id: 'hotDuanju', name: '熱播短劇', enabled: true, order: 1 },
    { id: 'bangumiCalendar', name: '新番放送', enabled: true, order: 2 },
    { id: 'hotTvShows', name: '热门劇集', enabled: true, order: 3 },
    { id: 'hotVarietyShows', name: '热门綜藝', enabled: true, order: 4 },
    { id: 'upcomingContent', name: '即將上映', enabled: true, order: 5 },
  ];

  const [homeModules, setHomeModules] = useState<HomeModule[]>(defaultHomeModules);
  const [homeBannerEnabled, setHomeBannerEnabled] = useState(true);
  const [homeContinueWatchingEnabled, setHomeContinueWatchingEnabled] = useState(true);

  // 豆瓣數據源選項
  const doubanDataSourceOptions = [
    { value: 'direct', label: '直連（服務器直接請求豆瓣）' },
    { value: 'cors-proxy-zwei', label: 'Cors Proxy By Zwei' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（騰訊雲）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里雲）' },
    { value: 'custom', label: '自定義代理' },
  ];

  // 豆瓣圖片代理選項
  const doubanImageProxyTypeOptions = [
    { value: 'server', label: '服務器代理（由服務器代理請求豆瓣）' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（騰訊雲）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里雲）' },
    { value: 'baidu', label: '百度圖片代理' },
    { value: 'custom', label: '自定義代理' },
    { value: 'direct', label: '直連（瀏覽器直接請求豆瓣，可能需要瀏覽器插件才能正常顯示）' },
    { value: 'img3', label: '豆瓣官方精品 CDN（阿里雲，可能需要瀏覽器插件才能正常顯示）' },
  ];

  // 緩衝策略選項
  const bufferStrategyOptions = [
    { value: 'low', label: '低緩衝（省流量）' },
    { value: 'medium', label: '中緩衝（推薦）' },
    { value: 'high', label: '高緩衝（流暢播放）' },
    { value: 'ultra', label: '超高緩衝（極速體驗）' },
  ];

  // 修改密碼相關狀態
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // 清除彈幕緩存相關狀態
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [clearCacheMessage, setClearCacheMessage] = useState<string | null>(null);
  const [danmakuCacheUsage, setDanmakuCacheUsage] = useState('計算中...');

  // 確保組件已掛載
  useEffect(() => {
    setMounted(true);
  }, []);

  // 加載未讀通知數量
  const loadUnreadCount = async () => {
    try {
      const response = await fetch('/api/notifications');
      if (response.ok) {
        const data = await response.json();
        const count = data.unreadCount || 0;
        setUnreadCount(count);
        // 同步到全局，讓其他 UserMenu 實例也能獲取
        if (typeof window !== 'undefined') {
          (window as any).__unreadNotificationCount = count;
        }
      }
    } catch (error) {
      console.error('加載未讀通知數量失敗:', error);
    }
  };

  const formatCacheSize = useCallback((size: number) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
    return `${(size / 1024 / 1024).toFixed(2)} MB`;
  }, []);

  const loadDanmakuCacheUsage = useCallback(async () => {
    try {
      const stats = await getDanmakuCacheStats();
      setDanmakuCacheUsage(formatCacheSize(stats.totalSize));
    } catch (error) {
      console.error('獲取彈幕緩存佔用失敗:', error);
      setDanmakuCacheUsage('獲取失敗');
    }
  }, [formatCacheSize]);

  // 首次加載時檢查未讀通知數量（使用全局標記避免多個實例重複請求）
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 檢查是否已經有其他實例在加載
    const globalWindow = window as any;
    if (globalWindow.__loadingNotifications) {
      // 如果正在加載，等待加載完成後獲取結果
      const checkInterval = setInterval(() => {
        if (!globalWindow.__loadingNotifications && globalWindow.__unreadNotificationCount !== undefined) {
          setUnreadCount(globalWindow.__unreadNotificationCount);
          clearInterval(checkInterval);
        }
      }, 100);
      return () => clearInterval(checkInterval);
    }

    // 檢查是否已經加載過
    if (globalWindow.__unreadNotificationCount !== undefined) {
      setUnreadCount(globalWindow.__unreadNotificationCount);
      return;
    }

    // 標記正在加載
    globalWindow.__loadingNotifications = true;
    loadUnreadCount().finally(() => {
      globalWindow.__loadingNotifications = false;
    });
  }, []);

  useEffect(() => {
    if (!mounted || !isSettingsOpen || !isDanmakuSectionOpen) return;
    void (async () => {
      await loadDanmakuCacheUsage();
    })();
  }, [loadDanmakuCacheUsage, mounted, isSettingsOpen, isDanmakuSectionOpen]);

  // 監聽通知更新事件
  useEffect(() => {
    const handleNotificationsUpdated = () => {
      // 清除緩存，強制重新加載
      if (typeof window !== 'undefined') {
        delete (window as any).__unreadNotificationCount;
      }
      loadUnreadCount();
    };

    window.addEventListener('notificationsUpdated', handleNotificationsUpdated);
    return () => {
      window.removeEventListener('notificationsUpdated', handleNotificationsUpdated);
    };
  }, []);

  // 從運行時配置讀取訂閱是否啟用
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const enabled = (window as any).RUNTIME_CONFIG?.ENABLE_TVBOX_SUBSCRIBE || false;
      setSubscribeEnabled(enabled);
    }
  }, []);

  // 懶加載訂閱 URL - 只在打開訂閱面板時請求
  const fetchSubscribeUrl = async () => {
    setIsLoadingSubscribeUrl(true);
    try {
      // 獲取用戶的 TVBox token
      const response = await fetch('/api/user/tvbox-token');
      if (response.ok) {
        const data = await response.json();
        const token = data.token;
        setTvboxToken(token);

        setSubscribeUrl(buildSubscribeUrl(token, subscribeAdFilterEnabled, subscribeYellowFilterEnabled));
      }
    } catch (error) {
      console.error('獲取訂閱URL失敗:', error);
    } finally {
      setIsLoadingSubscribeUrl(false);
    }
  };

  // 重置 TVBox token
  const handleResetToken = async () => {
    setConfirmDialog({
      isOpen: true,
      title: '重置訂閱Token',
      message: '確定要重置訂閱token嗎？重置後舊的訂閱鏈接將失效。',
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        setIsResettingToken(true);

        try {
          const response = await fetch('/api/user/tvbox-token/reset', {
            method: 'POST',
          });

          const messageEl = document.getElementById('tvbox-token-message');
          if (response.ok) {
            const data = await response.json();
            const token = data.token;
            setTvboxToken(token);

            setSubscribeUrl(buildSubscribeUrl(token, subscribeAdFilterEnabled, subscribeYellowFilterEnabled));

            if (messageEl) {
              messageEl.textContent = '訂閱token已重置！';
              messageEl.className = 'text-xs text-center text-green-600 dark:text-green-400 mt-2';
              messageEl.classList.remove('hidden');
              setTimeout(() => {
                messageEl.classList.add('hidden');
              }, 3000);
            }
          } else {
            const data = await response.json();
            if (messageEl) {
              messageEl.textContent = data.error || '重置失敗，請重試';
              messageEl.className = 'text-xs text-center text-red-600 dark:text-red-400 mt-2';
              messageEl.classList.remove('hidden');
            }
          }
        } catch (error) {
          console.error('重置token失敗:', error);
          const messageEl = document.getElementById('tvbox-token-message');
          if (messageEl) {
            messageEl.textContent = '重置失敗，請重試';
            messageEl.className = 'text-xs text-center text-red-600 dark:text-red-400 mt-2';
            messageEl.classList.remove('hidden');
          }
        } finally {
          setIsResettingToken(false);
        }
      },
    });
  };

  const buildSubscribeUrl = (token: string, adFilter: boolean, yellowFilter: boolean) => {
    const currentOrigin = window.location.origin;
    const url = new URL('/api/tvbox/subscribe', currentOrigin);
    url.searchParams.set('token', token);
    if (adFilter) {
      url.searchParams.set('adFilter', 'true');
    }
    if (yellowFilter) {
      url.searchParams.set('yellowFilter', 'true');
    }
    return url.toString();
  };

  // 獲取認證信息和存儲類型
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const auth = getAuthInfoFromBrowserCookie();
      setAuthInfo(auth);

      const runtimeConfig = (window as any).RUNTIME_CONFIG || {};
      const type = runtimeConfig.STORAGE_TYPE || 'localstorage';
      const displayType = runtimeConfig.DISPLAY_STORAGE_TYPE || type;
      setStorageType(type);
      setDisplayStorageType(displayType);
    }
  }, []);

  // 從 localStorage 讀取設置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedAggregateSearch = localStorage.getItem(
        'defaultAggregateSearch'
      );
      if (savedAggregateSearch !== null) {
        setDefaultAggregateSearch(JSON.parse(savedAggregateSearch));
      }

      const savedDoubanDataSource = localStorage.getItem('doubanDataSource');
      const defaultDoubanProxyType =
        (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE || 'cmliussss-cdn-tencent';
      if (savedDoubanDataSource !== null) {
        setDoubanDataSource(savedDoubanDataSource);
      } else if (defaultDoubanProxyType) {
        setDoubanDataSource(defaultDoubanProxyType);
      }

      const savedDoubanProxyUrl = localStorage.getItem('doubanProxyUrl');
      const defaultDoubanProxy =
        (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY || '';
      if (savedDoubanProxyUrl !== null) {
        setDoubanProxyUrl(savedDoubanProxyUrl);
      } else if (defaultDoubanProxy) {
        setDoubanProxyUrl(defaultDoubanProxy);
      }

      const savedDoubanDataSourceBackup = localStorage.getItem(
        'doubanDataSourceBackup'
      );
      setDoubanDataSourceBackup(savedDoubanDataSourceBackup || 'direct');

      const savedDoubanProxyUrlBackup = localStorage.getItem(
        'doubanProxyUrlBackup'
      );
      setDoubanProxyUrlBackup(savedDoubanProxyUrlBackup || '');

      const savedDoubanImageProxyType = localStorage.getItem(
        'doubanImageProxyType'
      );
      const defaultDoubanImageProxyType =
        (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE || 'cmliussss-cdn-tencent';
      if (savedDoubanImageProxyType !== null) {
        setDoubanImageProxyType(savedDoubanImageProxyType);
      } else if (defaultDoubanImageProxyType) {
        setDoubanImageProxyType(defaultDoubanImageProxyType);
      }

      const savedDoubanImageProxyUrl = localStorage.getItem(
        'doubanImageProxyUrl'
      );
      const defaultDoubanImageProxyUrl =
        (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY || '';
      if (savedDoubanImageProxyUrl !== null) {
        setDoubanImageProxyUrl(savedDoubanImageProxyUrl);
      } else if (defaultDoubanImageProxyUrl) {
        setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);
      }

      const savedDoubanImageProxyTypeBackup = localStorage.getItem(
        'doubanImageProxyTypeBackup'
      );
      setDoubanImageProxyTypeBackup(savedDoubanImageProxyTypeBackup || 'server');

      const savedDoubanImageProxyUrlBackup = localStorage.getItem(
        'doubanImageProxyUrlBackup'
      );
      setDoubanImageProxyUrlBackup(savedDoubanImageProxyUrlBackup || '');

      const savedTmdbImageBaseUrl = localStorage.getItem('tmdbImageBaseUrl');
      if (savedTmdbImageBaseUrl !== null) {
        setTmdbImageBaseUrl(savedTmdbImageBaseUrl);
      }

      const savedEnableOptimization =
        localStorage.getItem('enableOptimization');
      if (savedEnableOptimization !== null) {
        setEnableOptimization(JSON.parse(savedEnableOptimization));
      }

      const savedPreferStrategy = localStorage.getItem('preferStrategy');
      if (savedPreferStrategy === 'fast' || savedPreferStrategy === 'full') {
        setPreferStrategy(savedPreferStrategy);
      }

      const savedSpeedTestTimeout = localStorage.getItem('speedTestTimeout');
      if (savedSpeedTestTimeout !== null) {
        setSpeedTestTimeout(Number(savedSpeedTestTimeout));
      }

      const savedFluidSearch = localStorage.getItem('fluidSearch');
      const defaultFluidSearch =
        (window as any).RUNTIME_CONFIG?.FLUID_SEARCH !== false;
      if (savedFluidSearch !== null) {
        setFluidSearch(JSON.parse(savedFluidSearch));
      } else if (defaultFluidSearch !== undefined) {
        setFluidSearch(defaultFluidSearch);
      }

      const savedTmdbBackdropDisabled = localStorage.getItem('tmdb_backdrop_disabled');
      if (savedTmdbBackdropDisabled !== null) {
        setTmdbBackdropDisabled(savedTmdbBackdropDisabled === 'true');
      }

      const savedEnableTrailers = localStorage.getItem('enableTrailers');
      if (savedEnableTrailers !== null) {
        setEnableTrailers(savedEnableTrailers === 'true');
      }

      const savedBufferStrategy = localStorage.getItem('bufferStrategy');
      if (savedBufferStrategy !== null) {
        setBufferStrategy(savedBufferStrategy);
      }

      const savedNextEpisodePreCache = localStorage.getItem('nextEpisodePreCache');
      if (savedNextEpisodePreCache !== null) {
        setNextEpisodePreCache(savedNextEpisodePreCache === 'true');
      }

      const savedNextEpisodeDanmakuPreload = localStorage.getItem('nextEpisodeDanmakuPreload');
      if (savedNextEpisodeDanmakuPreload !== null) {
        setNextEpisodeDanmakuPreload(savedNextEpisodeDanmakuPreload === 'true');
      }

      const savedDisableAutoLoadDanmaku = localStorage.getItem('disableAutoLoadDanmaku');
      if (savedDisableAutoLoadDanmaku !== null) {
        setDisableAutoLoadDanmaku(savedDisableAutoLoadDanmaku === 'true');
      } else {
        const runtimeDefault =
          (window as any).RUNTIME_CONFIG?.DANMAKU_AUTO_LOAD_DEFAULT !== false;
        setDisableAutoLoadDanmaku(!runtimeDefault);
      }

      const savedDanmakuMaxCount = localStorage.getItem('danmakuMaxCount');
      if (savedDanmakuMaxCount !== null) {
        setDanmakuMaxCount(parseInt(savedDanmakuMaxCount, 10));
      }

      const savedDanmakuHeatmapDisabled = localStorage.getItem('danmaku_heatmap_disabled');
      if (savedDanmakuHeatmapDisabled !== null) {
        setDanmakuHeatmapDisabled(savedDanmakuHeatmapDisabled === 'true');
      }

      const savedHomeBannerEnabled = localStorage.getItem('homeBannerEnabled');
      if (savedHomeBannerEnabled !== null) {
        setHomeBannerEnabled(savedHomeBannerEnabled === 'true');
      }

      const savedHomeContinueWatchingEnabled = localStorage.getItem('homeContinueWatchingEnabled');
      if (savedHomeContinueWatchingEnabled !== null) {
        setHomeContinueWatchingEnabled(savedHomeContinueWatchingEnabled === 'true');
      }

      // 加載首頁模塊配置
      const savedHomeModules = localStorage.getItem('homeModules');
      if (savedHomeModules !== null) {
        try {
          setHomeModules(JSON.parse(savedHomeModules));
        } catch (error) {
          console.error('解析首頁模塊配置失敗:', error);
        }
      }

      // 加載搜索繁體轉簡體設置
      const savedSearchTraditionalToSimplified = localStorage.getItem('searchTraditionalToSimplified');
      if (savedSearchTraditionalToSimplified !== null) {
        setSearchTraditionalToSimplified(savedSearchTraditionalToSimplified === 'true');
      }

      // 加載精確搜索設置
      const savedExactSearch = localStorage.getItem('exactSearch');
      if (savedExactSearch !== null) {
        setExactSearch(savedExactSearch === 'true');
      }

      // 加載最大同時下載限制設置
      const savedMaxConcurrentDownloads = localStorage.getItem('maxConcurrentDownloads');
      if (savedMaxConcurrentDownloads !== null) {
        setMaxConcurrentDownloads(Number(savedMaxConcurrentDownloads));
      }

      // 加載單任務線程數設置
      const savedDownloadThreadsPerTask = localStorage.getItem('downloadThreadsPerTask');
      if (savedDownloadThreadsPerTask !== null) {
        setDownloadThreadsPerTask(Number(savedDownloadThreadsPerTask));
      }

      // 加載下載模式設置
      const savedDownloadMode = localStorage.getItem('downloadMode');
      if (savedDownloadMode === 'browser' || savedDownloadMode === 'filesystem') {
        setDownloadMode(savedDownloadMode);
      }

      // 加載保存路徑設置
      const savedFilesystemSavePath = localStorage.getItem('filesystemSavePath');
      if (savedFilesystemSavePath !== null) {
        setFilesystemSavePath(savedFilesystemSavePath);
      }
    }
  }, []);

  // 加載郵件通知設置
  const loadEmailSettings = async () => {
    setEmailSettingsLoading(true);
    setEmailSettingsMessage('');
    setEmailSettingsMessageType(null);
    try {
      const response = await fetch('/api/user/email-settings');
      if (response.ok) {
        const data = await response.json();
        setUserEmail(data.email || '');
        setEmailNotifications(data.emailNotifications || false);
      }
    } catch (error) {
      console.error('加載郵件設置失敗:', error);
    } finally {
      setEmailSettingsLoading(false);
    }
  };

  // 保存郵件通知設置
  const handleSaveEmailSettings = async () => {
    setEmailSettingsSaving(true);
    setEmailSettingsMessage('');
    setEmailSettingsMessageType(null);
    try {
      const response = await fetch('/api/user/email-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          emailNotifications,
        }),
      });

      if (response.ok) {
        setEmailSettingsMessage('保存成功！');
        setEmailSettingsMessageType('success');
        setTimeout(() => {
          setEmailSettingsMessage('');
          setEmailSettingsMessageType(null);
        }, 3000);
      } else {
        const data = await response.json();
        setEmailSettingsMessage(data.error || '保存失敗');
        setEmailSettingsMessageType('error');
      }
    } catch (error) {
      console.error('保存郵件設置失敗:', error);
      setEmailSettingsMessage('保存失敗，請重試');
      setEmailSettingsMessageType('error');
    } finally {
      setEmailSettingsSaving(false);
    }
  };

  // 加載設備列表
  const loadDevices = async () => {
    setDevicesLoading(true);
    try {
      const response = await fetch('/api/auth/devices');
      if (response.ok) {
        const data = await response.json();
        setDevices(data.devices || []);
      }
    } catch (error) {
      console.error('加載設備列表失敗:', error);
    } finally {
      setDevicesLoading(false);
    }
  };

  // 撤銷單個設備
  const handleRevokeDevice = async (tokenId: string) => {
    setConfirmDialog({
      isOpen: true,
      title: '撤銷設備登錄',
      message: '確定要撤銷該設備的登錄嗎？',
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        setRevoking(tokenId);
        try {
          const response = await fetch('/api/auth/devices', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tokenId }),
          });

          if (response.ok) {
            // 重新加載設備列表
            await loadDevices();
          } else {
            alert('撤銷失敗，請重試');
          }
        } catch (error) {
          console.error('撤銷設備失敗:', error);
          alert('撤銷失敗，請重試');
        } finally {
          setRevoking(null);
        }
      },
    });
  };

  // 撤銷所有設備
  const handleRevokeAllDevices = async () => {
    setConfirmDialog({
      isOpen: true,
      title: '登出所有設備',
      message: '確定要登出所有設備嗎？這將清除所有設備的登錄狀態（包括當前設備）。',
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        try {
          const response = await fetch('/api/auth/devices', {
            method: 'POST',
          });

          if (response.ok) {
            // 登出所有設備後，重定向到首頁
            window.location.href = '/';
          } else {
            alert('操作失敗，請重試');
          }
        } catch (error) {
          console.error('登出所有設備失敗:', error);
          alert('操作失敗，請重試');
        }
      },
    });
  };

  // 根據設備類型返回對應的圖標
  const getDeviceIcon = (deviceInfo: string) => {
    const info = deviceInfo.toLowerCase();

    if (info.includes('mobile') || info.includes('iphone') || info.includes('android')) {
      return Smartphone;
    }

    if (info.includes('tablet') || info.includes('ipad')) {
      return Tablet;
    }

    return Monitor;
  };

  // 點擊外部區域關閉下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-datasource"]')) {
          setIsDoubanDropdownOpen(false);
        }
      }
    };

    if (isDoubanDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanBackupDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-datasource-backup"]')) {
          setIsDoubanBackupDropdownOpen(false);
        }
      }
    };

    if (isDoubanBackupDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanBackupDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanImageProxyDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-image-proxy"]')) {
          setIsDoubanImageProxyDropdownOpen(false);
        }
      }
    };

    if (isDoubanImageProxyDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanImageProxyDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanImageProxyBackupDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-image-proxy-backup"]')) {
          setIsDoubanImageProxyBackupDropdownOpen(false);
        }
      }
    };

    if (isDoubanImageProxyBackupDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanImageProxyBackupDropdownOpen]);

  const handleMenuClick = () => {
    setIsOpen(!isOpen);
  };

  const handleCloseMenu = () => {
    setIsOpen(false);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('註銷請求失敗:', error);
    }
    window.location.href = '/';
  };

  const handleAdminPanel = () => {
    router.push('/admin');
  };

  const handleChangePassword = () => {
    setIsOpen(false);
    setIsChangePasswordOpen(true);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const handleCloseChangePassword = () => {
    setIsChangePasswordOpen(false);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const handleSubscribe = async () => {
    setIsOpen(false);
    setIsSubscribeOpen(true);
    setCopySuccess(false);
    // 懶加載:打開面板時才請求訂閱URL
    await fetchSubscribeUrl();
  };

  const handleCloseSubscribe = () => {
    setIsSubscribeOpen(false);
    setCopySuccess(false);
  };

  const handleCopySubscribeUrl = async () => {
    try {
      await navigator.clipboard.writeText(subscribeUrl);
      setCopySuccess(true);
      setTimeout(() => {
        setCopySuccess(false);
      }, 2000);
    } catch (error) {
      console.error('複製失敗:', error);
    }
  };
  
  useEffect(() => {
    if (!tvboxToken || !isSubscribeOpen) return;
    setSubscribeUrl(buildSubscribeUrl(tvboxToken, subscribeAdFilterEnabled, subscribeYellowFilterEnabled));
  }, [tvboxToken, subscribeAdFilterEnabled, subscribeYellowFilterEnabled, isSubscribeOpen]);

  const handleSubmitChangePassword = async () => {
    setPasswordError('');

    // 驗證密碼
    if (!newPassword) {
      setPasswordError('新密碼不得為空');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('兩次輸入的密碼不一致');
      return;
    }

    setPasswordLoading(true);

    try {
      const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setPasswordError(data.error || '修改密碼失敗');
        return;
      }

      // 修改成功，關閉彈窗並登出
      setIsChangePasswordOpen(false);
      await handleLogout();
    } catch (error) {
      setPasswordError('網絡錯誤，請稍後重試');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSettings = () => {
    setIsOpen(false);
    setIsSettingsOpen(true);
  };

  const handleCloseSettings = () => {
    setIsSettingsOpen(false);
  };

  // 設置相關的處理函數
  const handleAggregateToggle = (value: boolean) => {
    setDefaultAggregateSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(value));
    }
  };

  const handleDoubanProxyUrlChange = (value: string) => {
    setDoubanProxyUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanProxyUrl', value);
    }
  };

  const handleOptimizationToggle = (value: boolean) => {
    setEnableOptimization(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableOptimization', JSON.stringify(value));
    }
  };

  const handlePreferStrategyChange = (value: 'fast' | 'full') => {
    setPreferStrategy(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('preferStrategy', value);
    }
  };

  const handleSpeedTestTimeoutChange = (value: number) => {
    setSpeedTestTimeout(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('speedTestTimeout', String(value));
    }
  };

  const handleMaxConcurrentDownloadsChange = (value: number) => {
    setMaxConcurrentDownloads(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('maxConcurrentDownloads', String(value));
    }
  };

  const handleDownloadThreadsPerTaskChange = (value: number) => {
    setDownloadThreadsPerTask(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('downloadThreadsPerTask', String(value));
    }
  };

  const handleDownloadModeChange = (mode: 'browser' | 'filesystem') => {
    // 如果選擇 filesystem 模式，先檢測瀏覽器是否支持
    if (mode === 'filesystem' && typeof window !== 'undefined' && !('showDirectoryPicker' in window)) {
      setConfirmDialog({
        isOpen: true,
        title: '瀏覽器不支持',
        message: '您的瀏覽器不支持 File System Access API，請使用 Chrome 86+ 或 Edge 86+',
        onConfirm: () => {
          setConfirmDialog({ ...confirmDialog, isOpen: false });
        },
      });
      return;
    }

    setDownloadMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('downloadMode', mode);
    }
  };

  const handleSelectSavePath = async () => {
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      setFilesystemSavePath(dirHandle.name);
      localStorage.setItem('filesystemSavePath', dirHandle.name);

      // 保存目錄句柄到 IndexedDB
      const dbName = 'MoonTVPlus';
      const storeName = 'dirHandles';

      // 使用 Promise 包裝 IndexedDB 操作
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, 2); // 使用版本 2，與 download-db.ts 保持一致

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

        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const transaction = db.transaction([storeName], 'readwrite');
          const store = transaction.objectStore(storeName);
          const putRequest = store.put(dirHandle, 'downloadDir');

          putRequest.onsuccess = () => {
            db.close();
            resolve();
          };

          putRequest.onerror = () => {
            db.close();
            reject(new Error('保存目錄句柄失敗'));
          };
        };

        request.onerror = () => {
          reject(new Error('無法打開 IndexedDB'));
        };
      });
    } catch (err) {
      console.error('選擇目錄失敗:', err);
    }
  };

  const handleFluidSearchToggle = (value: boolean) => {
    setFluidSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('fluidSearch', JSON.stringify(value));
    }
  };

  const handleTmdbBackdropDisabledToggle = (value: boolean) => {
    setTmdbBackdropDisabled(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('tmdb_backdrop_disabled', String(value));
    }
  };

  const handleEnableTrailersToggle = (value: boolean) => {
    setEnableTrailers(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('enableTrailers', String(value));
    }
  };

  const handleDoubanDataSourceChange = (value: string) => {
    setDoubanDataSource(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanDataSource', value);
    }
  };

  const handleDoubanDataSourceBackupChange = (value: string) => {
    setDoubanDataSourceBackup(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanDataSourceBackup', value);
    }
  };

  const handleDoubanImageProxyTypeChange = (value: string) => {
    setDoubanImageProxyType(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyType', value);
    }
  };

  const handleDoubanImageProxyTypeBackupChange = (value: string) => {
    setDoubanImageProxyTypeBackup(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyTypeBackup', value);
    }
  };

  const handleDoubanProxyUrlBackupChange = (value: string) => {
    setDoubanProxyUrlBackup(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanProxyUrlBackup', value);
    }
  };

  const handleDoubanImageProxyUrlChange = (value: string) => {
    setDoubanImageProxyUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyUrl', value);
    }
  };

  const handleDoubanImageProxyUrlBackupChange = (value: string) => {
    setDoubanImageProxyUrlBackup(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyUrlBackup', value);
    }
  };

  const handleTmdbImageBaseUrlChange = (value: string) => {
    setTmdbImageBaseUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('tmdbImageBaseUrl', value);
    }
  };

  const handleBufferStrategyChange = (value: string) => {
    setBufferStrategy(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('bufferStrategy', value);
    }
  };

  // 將滑塊值轉換為策略值
  const getBufferStrategyFromSlider = (sliderValue: number): string => {
    const strategies = ['low', 'medium', 'high', 'ultra'];
    return strategies[sliderValue] || 'medium';
  };

  // 將策略值轉換為滑塊值
  const getSliderValueFromStrategy = (strategy: string): number => {
    const strategies = ['low', 'medium', 'high', 'ultra'];
    const index = strategies.indexOf(strategy);
    return index >= 0 ? index : 1; // 默認返回 1 (medium)
  };

  const handleNextEpisodePreCacheToggle = (value: boolean) => {
    setNextEpisodePreCache(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('nextEpisodePreCache', String(value));
    }
  };

  const handleNextEpisodeDanmakuPreloadToggle = (value: boolean) => {
    setNextEpisodeDanmakuPreload(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('nextEpisodeDanmakuPreload', String(value));
    }
  };

  const handleDisableAutoLoadDanmakuToggle = (value: boolean) => {
    setDisableAutoLoadDanmaku(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('disableAutoLoadDanmaku', String(value));
    }
  };

  const handleDanmakuMaxCountChange = (value: number) => {
    setDanmakuMaxCount(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('danmakuMaxCount', String(value));
    }
  };

  const handleDanmakuHeatmapDisabledToggle = (value: boolean) => {
    setDanmakuHeatmapDisabled(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('danmaku_heatmap_disabled', String(value));
    }
  };

  const handleSearchTraditionalToSimplifiedToggle = (value: boolean) => {
    setSearchTraditionalToSimplified(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('searchTraditionalToSimplified', String(value));
    }
  };

  const handleExactSearchToggle = (value: boolean) => {
    setExactSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('exactSearch', String(value));
    }
  };

  const handleHomeBannerToggle = (value: boolean) => {
    setHomeBannerEnabled(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('homeBannerEnabled', String(value));
      window.dispatchEvent(new CustomEvent('homeModulesUpdated'));
    }
  };

  const handleHomeContinueWatchingToggle = (value: boolean) => {
    setHomeContinueWatchingEnabled(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('homeContinueWatchingEnabled', String(value));
      window.dispatchEvent(new CustomEvent('homeModulesUpdated'));
    }
  };

  // 首頁模塊配置處理函數
  const handleHomeModuleToggle = (id: string, enabled: boolean) => {
    const updatedModules = homeModules.map(module =>
      module.id === id ? { ...module, enabled } : module
    );
    setHomeModules(updatedModules);
    if (typeof window !== 'undefined') {
      localStorage.setItem('homeModules', JSON.stringify(updatedModules));
      // 觸發自定義事件通知首頁刷新
      window.dispatchEvent(new CustomEvent('homeModulesUpdated'));
    }
  };

  const handleHomeModuleMoveUp = (index: number) => {
    if (index === 0) return;
    const updatedModules = [...homeModules];
    const temp = updatedModules[index];
    updatedModules[index] = updatedModules[index - 1];
    updatedModules[index - 1] = temp;
    // 更新order
    updatedModules.forEach((module, idx) => {
      module.order = idx;
    });
    setHomeModules(updatedModules);
    if (typeof window !== 'undefined') {
      localStorage.setItem('homeModules', JSON.stringify(updatedModules));
      window.dispatchEvent(new CustomEvent('homeModulesUpdated'));
    }
  };

  const handleHomeModuleMoveDown = (index: number) => {
    if (index === homeModules.length - 1) return;
    const updatedModules = [...homeModules];
    const temp = updatedModules[index];
    updatedModules[index] = updatedModules[index + 1];
    updatedModules[index + 1] = temp;
    // 更新order
    updatedModules.forEach((module, idx) => {
      module.order = idx;
    });
    setHomeModules(updatedModules);
    if (typeof window !== 'undefined') {
      localStorage.setItem('homeModules', JSON.stringify(updatedModules));
      window.dispatchEvent(new CustomEvent('homeModulesUpdated'));
    }
  };

  // 獲取感謝信息
  const getThanksInfo = (dataSource: string) => {
    switch (dataSource) {
      case 'cors-proxy-zwei':
        return {
          text: 'Thanks to @Zwei',
          url: 'https://github.com/bestzwei',
        };
      case 'cmliussss-cdn-tencent':
      case 'cmliussss-cdn-ali':
        return {
          text: 'Thanks to @CMLiussss',
          url: 'https://github.com/cmliu',
        };
      default:
        return null;
    }
  };

  const handleResetSettings = () => {
    const defaultDoubanProxyType =
      (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE || 'cmliussss-cdn-tencent';
    const defaultDoubanProxy =
      (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY || '';
    const defaultDoubanImageProxyType =
      (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE || 'cmliussss-cdn-tencent';
    const defaultDoubanImageProxyUrl =
      (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY || '';
    const defaultFluidSearch =
      (window as any).RUNTIME_CONFIG?.FLUID_SEARCH !== false;

    setDefaultAggregateSearch(true);
    setEnableOptimization(true);
    setPreferStrategy('fast');
    setFluidSearch(defaultFluidSearch);
    setTmdbBackdropDisabled(false);
    setEnableTrailers(false);
    setDoubanProxyUrl(defaultDoubanProxy);
    setDoubanDataSource(defaultDoubanProxyType);
    setDoubanDataSourceBackup('direct');
    setDoubanProxyUrlBackup('');
    setDoubanImageProxyType(defaultDoubanImageProxyType);
    setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);
    setDoubanImageProxyTypeBackup('server');
    setDoubanImageProxyUrlBackup('');
    setTmdbImageBaseUrl('https://image.tmdb.org');
    setBufferStrategy('medium');
    setNextEpisodePreCache(true);
    setNextEpisodeDanmakuPreload(true);
    const defaultDanmakuAutoLoad =
      (typeof window !== 'undefined' &&
        (window as any).RUNTIME_CONFIG?.DANMAKU_AUTO_LOAD_DEFAULT !== false) ||
      false;
    setDisableAutoLoadDanmaku(!defaultDanmakuAutoLoad);
    setHomeBannerEnabled(true);
    setHomeContinueWatchingEnabled(true);
    setHomeModules(defaultHomeModules);
    setSearchTraditionalToSimplified(false);

    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(true));
      localStorage.setItem('enableOptimization', JSON.stringify(true));
      localStorage.setItem('preferStrategy', 'fast');
      localStorage.setItem('fluidSearch', JSON.stringify(defaultFluidSearch));
      localStorage.setItem('liveDirectConnect', JSON.stringify(false));
      localStorage.setItem('tmdb_backdrop_disabled', 'false');
      localStorage.setItem('enableTrailers', 'false');
      localStorage.setItem('doubanProxyUrl', defaultDoubanProxy);
      localStorage.setItem('doubanDataSource', defaultDoubanProxyType);
      localStorage.setItem('doubanDataSourceBackup', 'direct');
      localStorage.setItem('doubanProxyUrlBackup', '');
      localStorage.setItem('doubanImageProxyType', defaultDoubanImageProxyType);
      localStorage.setItem('doubanImageProxyUrl', defaultDoubanImageProxyUrl);
      localStorage.setItem('doubanImageProxyTypeBackup', 'server');
      localStorage.setItem('doubanImageProxyUrlBackup', '');
      localStorage.setItem('tmdbImageBaseUrl', 'https://image.tmdb.org');
      localStorage.setItem('bufferStrategy', 'medium');
      localStorage.setItem('nextEpisodePreCache', 'true');
      localStorage.setItem('nextEpisodeDanmakuPreload', 'true');
      localStorage.setItem(
        'disableAutoLoadDanmaku',
        String(!defaultDanmakuAutoLoad)
      );
      localStorage.setItem('danmakuMaxCount', '0');
      localStorage.setItem('danmaku_heatmap_disabled', 'false');
      localStorage.setItem('homeBannerEnabled', 'true');
      localStorage.setItem('homeContinueWatchingEnabled', 'true');
      localStorage.setItem('homeModules', JSON.stringify(defaultHomeModules));
      localStorage.setItem('searchTraditionalToSimplified', 'false');
      window.dispatchEvent(new CustomEvent('homeModulesUpdated'));
    }
  };

  // 清除彈幕緩存
  const handleClearDanmakuCache = async () => {
    setIsClearingCache(true);
    setClearCacheMessage(null);

    try {
      await clearAllDanmakuCache();
      setClearCacheMessage('彈幕緩存已清除成功！');
      setDanmakuCacheUsage('0 B');
      console.log('彈幕緩存已清除');

      // 3秒後自動清除提示
      setTimeout(() => {
        setClearCacheMessage(null);
      }, 3000);
    } catch (error) {
      console.error('清除彈幕緩存失敗:', error);
      setClearCacheMessage('清除失敗，請重試');

      // 3秒後自動清除提示
      setTimeout(() => {
        setClearCacheMessage(null);
      }, 3000);
    } finally {
      setIsClearingCache(false);
    }
  };

  // 檢查是否顯示管理面板按鈕
  const showAdminPanel =
    (authInfo?.role === 'owner' || authInfo?.role === 'admin') &&
    storageType !== 'localstorage';

  // 檢查是否顯示離線下載按鈕
  const showOfflineDownload =
    (authInfo?.role === 'owner' || authInfo?.role === 'admin') &&
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.ENABLE_OFFLINE_DOWNLOAD === true;

  // 檢查是否顯示修改密碼按鈕
  const showChangePassword =
    authInfo?.role !== 'owner' && storageType !== 'localstorage';

  // 角色中文映射
  const getRoleText = (role?: string) => {
    switch (role) {
      case 'owner':
        return '站長';
      case 'admin':
        return '管理員';
      case 'user':
        return '用戶';
      default:
        return '';
    }
  };

  const currentUsername = authInfo?.username || 'default';
  const currentRole = authInfo?.role || 'user';
  const currentRoleText = getRoleText(currentRole);
  const shouldShowRoleBadge = currentRole !== 'user';
  const avatarText = currentUsername.trim().charAt(0).toUpperCase() || 'D';

  const roleBadgeClassName =
    currentRole === 'owner'
      ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
      : currentRole === 'admin'
        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
        : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';

  const handleOpenProfileCenter = () => {
    setIsOpen(false);
    setIsProfileCenterOpen(true);
  };

  // 菜單面板內容
  const menuPanel = (
    <>
      {/* 背景遮罩 - 普通菜單無需模糊 */}
      <div
        className='fixed inset-0 bg-transparent z-[1000]'
        onClick={handleCloseMenu}
      />

      {/* 菜單面板 */}
      <div className='fixed top-14 right-4 w-56 bg-white dark:bg-gray-900 rounded-lg shadow-xl z-[1001] border border-gray-200/50 dark:border-gray-700/50 overflow-hidden select-none'>
        {/* 用戶信息區域 */}
        <div className='px-3 py-1 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-gray-100/50 dark:from-gray-800 dark:to-gray-800/50'>
          <div className='flex items-start justify-between gap-3'>
            <button
              onClick={handleOpenProfileCenter}
              className='flex items-center gap-3 rounded-xl px-2 py-1 text-left hover:bg-white/70 dark:hover:bg-gray-700/40 transition-colors'
            >
              <div className='relative flex h-11 w-11 items-center justify-center rounded-full bg-blue-500 text-lg font-semibold text-white shadow-sm'>
                <span>{avatarText}</span>
                {shouldShowRoleBadge && (
                  <span
                    className={`absolute left-1/2 top-[calc(100%-6px)] z-10 -translate-x-1/2 inline-flex min-w-[26px] items-center justify-center whitespace-nowrap rounded-full px-1.5 py-[2px] text-[8px] leading-none font-medium shadow-sm ${roleBadgeClassName}`}
                  >
                    {currentRoleText}
                  </span>
                )}
              </div>
              <div className='min-w-0'>
                <span className='block max-w-[84px] truncate text-sm font-semibold text-gray-900 dark:text-gray-100 leading-none'>
                  {currentUsername}
                </span>
              </div>
            </button>

            <div className='pt-1 text-right'>
              <div className='text-[10px] text-gray-400 dark:text-gray-500'>
                <div>數據存儲</div>
                <div className='mt-0.5'>
                  {displayStorageType === 'localstorage' ? '本地' : displayStorageType}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 菜單項 */}
        <div className='py-1'>
          {/* 通知按鈕 */}
          <button
            onClick={() => {
              setIsOpen(false);
              setIsNotificationPanelOpen(true);
            }}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm relative'
          >
            <Bell className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>通知中心</span>
            {unreadCount > 0 && (
              <span className='ml-auto px-2 py-0.5 text-xs font-medium bg-red-500 text-white rounded-full'>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {/* 我的收藏按鈕 */}
          <button
            onClick={() => {
              setIsOpen(false);
              setIsFavoritesPanelOpen(true);
            }}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm relative'
          >
            <Star className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>我的收藏</span>
          </button>

          {/* 設置按鈕 */}
          <button
            onClick={handleSettings}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
          >
            <Settings className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>設置</span>
          </button>

          {/* 管理面板按鈕 */}
          {showAdminPanel && (
            <button
              onClick={handleAdminPanel}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
            >
              <Shield className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>管理面板</span>
            </button>
          )}

          {/* 離線下載按鈕 */}
          {showOfflineDownload && (
            <button
              onClick={() => {
                setIsOfflineDownloadPanelOpen(true);
                setIsOpen(false);
              }}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
            >
              <Download className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>離線下載</span>
            </button>
          )}

          {/* 訂閱按鈕 */}
          {subscribeEnabled && (
            <button
              onClick={handleSubscribe}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
            >
              <Rss className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>訂閱</span>
            </button>
          )}

          {/* 生態應用按鈕 */}
          <button
            onClick={() => {
              setIsOpen(false);
              setIsEcoAppsOpen(true);
            }}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
          >
            <Package className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>生態應用</span>
          </button>

          {/* 分割線 */}
          <div className='my-1 border-t border-gray-200 dark:border-gray-700'></div>

          {/* 登出按鈕 */}
          <button
            onClick={handleLogout}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm'
          >
            <LogOut className='w-4 h-4' />
            <span className='font-medium'>登出</span>
          </button>

          {/* 分割線 */}
          <div className='my-1 border-t border-gray-200 dark:border-gray-700'></div>

          {/* 版本信息 */}
          <button
            onClick={() => {
              setIsVersionPanelOpen(true);
              handleCloseMenu();
            }}
            className='w-full px-3 py-2 text-center flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-xs'
          >
            <div className='flex items-center gap-1'>
              <span className='font-mono'>v{CURRENT_VERSION}</span>
              {!isChecking &&
                updateStatus &&
                updateStatus !== UpdateStatus.FETCH_FAILED && (
                  <div
                    className={`w-2 h-2 rounded-full -translate-y-2 ${updateStatus === UpdateStatus.HAS_UPDATE
                      ? 'bg-yellow-500'
                      : updateStatus === UpdateStatus.NO_UPDATE
                        ? 'bg-green-400'
                        : ''
                      }`}
                  ></div>
                )}
            </div>
          </button>
        </div>
      </div>
    </>
  );

  // 設置面板內容
  const settingsPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={handleCloseSettings}
        onTouchMove={(e) => {
          // 只阻止滾動，允許其他觸摸事件
          e.preventDefault();
        }}
        onWheel={(e) => {
          // 阻止滾輪滾動
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 設置面板 */}
      <div
        className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] flex flex-col'
      >
        {/* 內容容器 - 獨立的滾動區域 */}
        <div
          className='flex-1 px-4 py-6 md:p-6 overflow-y-auto'
          data-panel-content
          style={{
            touchAction: 'pan-y', // 只允許垂直滾動
            overscrollBehavior: 'contain', // 防止滾動冒泡
          }}
        >
          {/* 標題欄 */}
          <div className='flex items-center justify-between mb-6'>
            <div className='flex items-center gap-3'>
              <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                本地設置
              </h3>
              <button
                onClick={handleResetSettings}
                className='px-2 py-1 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border border-red-200 hover:border-red-300 dark:border-red-800 dark:hover:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors'
                title='重置為默認設置'
              >
                恢復默認
              </button>
            </div>
            <button
              onClick={handleCloseSettings}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 設置項 */}
          <div className='space-y-3 md:space-y-4'>
            {/* 豆瓣設置 */}
            <div className='border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible'>
              <button
                onClick={() => setIsDoubanSectionOpen(!isDoubanSectionOpen)}
                className='w-full px-3 py-2.5 md:px-4 md:py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors flex items-center justify-between'
              >
                <div className='flex items-center gap-2'>
                  <Globe className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                  <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200'>
                    數據源設置
                  </h3>
                </div>
                {isDoubanSectionOpen ? (
                  <ChevronUp className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                ) : (
                  <ChevronDown className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                )}
              </button>
              {isDoubanSectionOpen && (
                <div className='p-3 md:p-4 space-y-4 md:space-y-6'>
                  {/* 豆瓣數據源選擇 */}
                  <div className='space-y-3'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        豆瓣數據代理
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        選擇獲取豆瓣數據的方式
                      </p>
                    </div>
                    <div className='relative' data-dropdown='douban-datasource'>
                      {/* 自定義下拉選擇框 */}
                      <button
                        type='button'
                        onClick={() => setIsDoubanDropdownOpen(!isDoubanDropdownOpen)}
                        className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
                      >
                        {
                          doubanDataSourceOptions.find(
                            (option) => option.value === doubanDataSource
                          )?.label
                        }
                      </button>

                      {/* 下拉箭頭 */}
                      <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                        <ChevronDown
                          className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${isDoubanDropdownOpen ? 'rotate-180' : ''
                            }`}
                        />
                      </div>

                      {/* 下拉選項列表 */}
                      {isDoubanDropdownOpen && (
                        <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                          {doubanDataSourceOptions.map((option) => (
                            <button
                              key={option.value}
                              type='button'
                              onClick={() => {
                                handleDoubanDataSourceChange(option.value);
                                setIsDoubanDropdownOpen(false);
                              }}
                              className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${doubanDataSource === option.value
                                ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                                : 'text-gray-900 dark:text-gray-100'
                                }`}
                            >
                              <span className='truncate'>{option.label}</span>
                              {doubanDataSource === option.value && (
                                <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 感謝信息 */}
                    {getThanksInfo(doubanDataSource) && (
                      <div className='mt-3'>
                        <button
                          type='button'
                          onClick={() =>
                            window.open(getThanksInfo(doubanDataSource)!.url, '_blank')
                          }
                          className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
                        >
                          <span className='font-medium'>
                            {getThanksInfo(doubanDataSource)!.text}
                          </span>
                          <ExternalLink className='w-3.5 opacity-70' />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 豆瓣代理地址設置 - 僅在選擇自定義代理時顯示 */}
                  {doubanDataSource === 'custom' && (
                    <div className='space-y-3'>
                      <div>
                        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                          豆瓣代理地址
                        </h4>
                        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                          自定義代理服務器地址
                        </p>
                      </div>
                      <input
                        type='text'
                        className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                        placeholder='例如: https://proxy.example.com/fetch?url='
                        value={doubanProxyUrl}
                        onChange={(e) => handleDoubanProxyUrlChange(e.target.value)}
                      />
                      {!doubanProxyUrl.trim() && (
                        <p className='text-xs text-amber-600 dark:text-amber-400 mt-1'>
                          未填寫地址時將自動按直連處理
                        </p>
                      )}
                    </div>
                  )}

                  <div className='space-y-3'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        豆瓣數據備用渠道
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        主渠道失敗後自動切換，默認直連
                      </p>
                    </div>
                    <div
                      className='relative'
                      data-dropdown='douban-datasource-backup'
                    >
                      <button
                        type='button'
                        onClick={() =>
                          setIsDoubanBackupDropdownOpen(!isDoubanBackupDropdownOpen)
                        }
                        className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
                      >
                        {
                          doubanDataSourceOptions.find(
                            (option) => option.value === doubanDataSourceBackup
                          )?.label
                        }
                      </button>
                      <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                        <ChevronDown
                          className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${isDoubanBackupDropdownOpen ? 'rotate-180' : ''
                            }`}
                        />
                      </div>
                      {isDoubanBackupDropdownOpen && (
                        <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                          {doubanDataSourceOptions.map((option) => (
                            <button
                              key={option.value}
                              type='button'
                              onClick={() => {
                                handleDoubanDataSourceBackupChange(option.value);
                                setIsDoubanBackupDropdownOpen(false);
                              }}
                              className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${doubanDataSourceBackup === option.value
                                ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                                : 'text-gray-900 dark:text-gray-100'
                                }`}
                            >
                              <span className='truncate'>{option.label}</span>
                              {doubanDataSourceBackup === option.value && (
                                <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {doubanDataSourceBackup === 'custom' && (
                    <div className='space-y-3'>
                      <div>
                        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                          豆瓣備用代理地址
                        </h4>
                        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                          備用渠道為自定義代理時生效
                        </p>
                      </div>
                      <input
                        type='text'
                        className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                        placeholder='例如: https://proxy.example.com/fetch?url='
                        value={doubanProxyUrlBackup}
                        onChange={(e) =>
                          handleDoubanProxyUrlBackupChange(e.target.value)
                        }
                      />
                      {!doubanProxyUrlBackup.trim() && (
                        <p className='text-xs text-amber-600 dark:text-amber-400 mt-1'>
                          未填寫地址時備用渠道將自動按直連處理
                        </p>
                      )}
                    </div>
                  )}

                  {/* 分割線 */}
                  <div className='border-t border-gray-200 dark:border-gray-700'></div>

                  {/* 豆瓣圖片代理設置 */}
                  <div className='space-y-3'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        豆瓣圖片代理
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        選擇獲取豆瓣圖片的方式
                      </p>
                    </div>
                    <div className='relative' data-dropdown='douban-image-proxy'>
                      {/* 自定義下拉選擇框 */}
                      <button
                        type='button'
                        onClick={() =>
                          setIsDoubanImageProxyDropdownOpen(
                            !isDoubanImageProxyDropdownOpen
                          )
                        }
                        className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
                      >
                        {
                          doubanImageProxyTypeOptions.find(
                            (option) => option.value === doubanImageProxyType
                          )?.label
                        }
                      </button>

                      {/* 下拉箭頭 */}
                      <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                        <ChevronDown
                          className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${isDoubanDropdownOpen ? 'rotate-180' : ''
                            }`}
                        />
                      </div>

                      {/* 下拉選項列表 */}
                      {isDoubanImageProxyDropdownOpen && (
                        <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                          {doubanImageProxyTypeOptions.map((option) => (
                            <button
                              key={option.value}
                              type='button'
                              onClick={() => {
                                handleDoubanImageProxyTypeChange(option.value);
                                setIsDoubanImageProxyDropdownOpen(false);
                              }}
                              className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${doubanImageProxyType === option.value
                                ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                                : 'text-gray-900 dark:text-gray-100'
                                }`}
                            >
                              <span className='truncate'>{option.label}</span>
                              {doubanImageProxyType === option.value && (
                                <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 感謝信息 */}
                    {getThanksInfo(doubanImageProxyType) && (
                      <div className='mt-3'>
                        <button
                          type='button'
                          onClick={() =>
                            window.open(
                              getThanksInfo(doubanImageProxyType)!.url,
                              '_blank'
                            )
                          }
                          className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
                        >
                          <span className='font-medium'>
                            {getThanksInfo(doubanImageProxyType)!.text}
                          </span>
                          <ExternalLink className='w-3.5 opacity-70' />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 豆瓣圖片代理地址設置 - 僅在選擇自定義代理時顯示 */}
                  {doubanImageProxyType === 'custom' && (
                    <div className='space-y-3'>
                      <div>
                        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                          豆瓣圖片代理地址
                        </h4>
                        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                          自定義圖片代理服務器地址
                        </p>
                      </div>
                      <input
                        type='text'
                        className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                        placeholder='例如: https://proxy.example.com/fetch?url='
                        value={doubanImageProxyUrl}
                        onChange={(e) =>
                          handleDoubanImageProxyUrlChange(e.target.value)
                        }
                      />
                      {!doubanImageProxyUrl.trim() && (
                        <p className='text-xs text-amber-600 dark:text-amber-400 mt-1'>
                          未填寫地址時將自動按服務器代理處理
                        </p>
                      )}
                    </div>
                  )}

                  <div className='space-y-3'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        豆瓣圖片備用渠道
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        主圖片渠道失敗後自動切換，默認服務器代理
                      </p>
                    </div>
                    <div
                      className='relative'
                      data-dropdown='douban-image-proxy-backup'
                    >
                      <button
                        type='button'
                        onClick={() =>
                          setIsDoubanImageProxyBackupDropdownOpen(
                            !isDoubanImageProxyBackupDropdownOpen
                          )
                        }
                        className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
                      >
                        {
                          doubanImageProxyTypeOptions.find(
                            (option) => option.value === doubanImageProxyTypeBackup
                          )?.label
                        }
                      </button>
                      <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                        <ChevronDown
                          className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${isDoubanImageProxyBackupDropdownOpen ? 'rotate-180' : ''
                            }`}
                        />
                      </div>
                      {isDoubanImageProxyBackupDropdownOpen && (
                        <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                          {doubanImageProxyTypeOptions.map((option) => (
                            <button
                              key={option.value}
                              type='button'
                              onClick={() => {
                                handleDoubanImageProxyTypeBackupChange(option.value);
                                setIsDoubanImageProxyBackupDropdownOpen(false);
                              }}
                              className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${doubanImageProxyTypeBackup === option.value
                                ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                                : 'text-gray-900 dark:text-gray-100'
                                }`}
                            >
                              <span className='truncate'>{option.label}</span>
                              {doubanImageProxyTypeBackup === option.value && (
                                <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {doubanImageProxyTypeBackup === 'custom' && (
                    <div className='space-y-3'>
                      <div>
                        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                          豆瓣圖片備用代理地址
                        </h4>
                        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                          備用圖片渠道為自定義代理時生效
                        </p>
                      </div>
                      <input
                        type='text'
                        className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                        placeholder='例如: https://proxy.example.com/fetch?url='
                        value={doubanImageProxyUrlBackup}
                        onChange={(e) =>
                          handleDoubanImageProxyUrlBackupChange(e.target.value)
                        }
                      />
                      {!doubanImageProxyUrlBackup.trim() && (
                        <p className='text-xs text-amber-600 dark:text-amber-400 mt-1'>
                          未填寫地址時備用圖片渠道將自動按服務器代理處理
                        </p>
                      )}
                    </div>
                  )}

                  {/* 分割線 */}
                  <div className='border-t border-gray-200 dark:border-gray-700'></div>

                  {/* TMDB 圖片網絡請求地址設置 */}
                  <div className='space-y-3'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        TMDB 圖片網絡請求地址
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        TMDB 圖片的 Base URL（默認: https://image.tmdb.org）
                      </p>
                    </div>
                    <input
                      type='text'
                      className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                      placeholder='例如: https://image.tmdb.org'
                      value={tmdbImageBaseUrl}
                      onChange={(e) =>
                        handleTmdbImageBaseUrlChange(e.target.value)
                      }
                    />
                  </div>
                </div>
              )}
            </div>

            <div className='border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible'>
              <button
                onClick={() => setIsUsageSectionOpen(!isUsageSectionOpen)}
                className='w-full px-3 py-2.5 md:px-4 md:py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors flex items-center justify-between'
              >
                <div className='flex items-center gap-2'>
                  <Sliders className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                  <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200'>
                    通用設置
                  </h3>
                </div>
                {isUsageSectionOpen ? (
                  <ChevronUp className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                ) : (
                  <ChevronDown className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                )}
              </button>
              {isUsageSectionOpen && (
                <div className='p-3 md:p-4 space-y-4 md:space-y-6'>
                  {/* 默認聚合搜索結果 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        默認聚合搜索結果
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        搜索時默認按標題和年份聚合顯示結果
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={defaultAggregateSearch}
                          onChange={(e) => handleAggregateToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 優選和測速 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        優選和測速
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        如出現播放器劫持問題可關閉
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={enableOptimization}
                          onChange={(e) => handleOptimizationToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 測速超時設置 */}
                  {enableOptimization && (
                    <div className='ml-4 mt-2 space-y-2'>
                      <div className='space-y-2'>
                        <div className='flex items-center justify-between gap-3'>
                          <span className='text-xs text-gray-600 dark:text-gray-400'>
                            優選策略
                          </span>
                          <div className='inline-flex rounded-lg border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-gray-800'>
                            <button
                              type='button'
                              onClick={() => handlePreferStrategyChange('fast')}
                              className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all ${
                                preferStrategy === 'fast'
                                  ? 'bg-white text-green-600 shadow-sm dark:bg-gray-700 dark:text-green-400'
                                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                              }`}
                            >
                              快速優選
                            </button>
                            <button
                              type='button'
                              onClick={() => handlePreferStrategyChange('full')}
                              className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all ${
                                preferStrategy === 'full'
                                  ? 'bg-white text-green-600 shadow-sm dark:bg-gray-700 dark:text-green-400'
                                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                              }`}
                            >
                              全量優選
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className='flex items-center justify-between'>
                        <span className='text-xs text-gray-600 dark:text-gray-400'>
                          換源面板測速超時
                        </span>
                        <span className='text-xs font-medium text-gray-700 dark:text-gray-300'>
                          {speedTestTimeout / 1000}秒
                        </span>
                      </div>
                      <div className='flex items-center gap-2'>
                        <input
                          type='range'
                          min='4000'
                          max='30000'
                          step='1000'
                          value={speedTestTimeout}
                          onChange={(e) => handleSpeedTestTimeoutChange(Number(e.target.value))}
                          className='flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700'
                          style={{
                            background: `linear-gradient(to right, #10b981 0%, #10b981 ${((speedTestTimeout - 4000) / (30000 - 4000)) * 100}%, #e5e7eb ${((speedTestTimeout - 4000) / (30000 - 4000)) * 100}%, #e5e7eb 100%)`
                          }}
                        />
                      </div>
                      <div className='flex justify-between text-xs text-gray-500 dark:text-gray-400'>
                        <button
                          onClick={() => handleSpeedTestTimeoutChange(4000)}
                          className={`px-2 py-0.5 rounded ${speedTestTimeout === 4000 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        >
                          4秒
                        </button>
                        <button
                          onClick={() => handleSpeedTestTimeoutChange(10000)}
                          className={`px-2 py-0.5 rounded ${speedTestTimeout === 10000 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        >
                          10秒
                        </button>
                        <button
                          onClick={() => handleSpeedTestTimeoutChange(20000)}
                          className={`px-2 py-0.5 rounded ${speedTestTimeout === 20000 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        >
                          20秒
                        </button>
                        <button
                          onClick={() => handleSpeedTestTimeoutChange(30000)}
                          className={`px-2 py-0.5 rounded ${speedTestTimeout === 30000 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        >
                          30秒
                        </button>
                      </div>
                      <p className='text-xs text-gray-500 dark:text-gray-400 italic'>
                        注：此設置僅對換源面板測速生效，優選播放源時仍使用4秒超時
                      </p>
                    </div>
                  )}

                  {/* 流式搜索 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        流式搜索輸出
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        啟用搜索結果實時流式輸出，關閉後使用傳統一次性搜索
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={fluidSearch}
                          onChange={(e) => handleFluidSearchToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 禁用背景圖渲染 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        禁用背景圖渲染
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        關閉播放頁面的TMDB背景圖顯示（需手動刷新頁面生效）
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={tmdbBackdropDisabled}
                          onChange={(e) => handleTmdbBackdropDisabledToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 啟用預告片 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        首頁預告片
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        在首頁輪播圖中顯示視頻預告片（需刷新頁面生效）
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={enableTrailers}
                          onChange={(e) => handleEnableTrailersToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 搜索繁體轉簡體 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        搜索繁體轉簡體
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        搜索時自動將繁體中文轉換為簡體中文
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={searchTraditionalToSimplified}
                          onChange={(e) => handleSearchTraditionalToSimplifiedToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 精確搜索 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        精確搜索
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        開啟後，搜索結果將過濾掉不包含搜索詞的內容
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={exactSearch}
                          onChange={(e) => handleExactSearchToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* 下載設置 */}
            <div className='border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible'>
              <button
                onClick={() => setIsDownloadSectionOpen(!isDownloadSectionOpen)}
                className='w-full px-3 py-2.5 md:px-4 md:py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors flex items-center justify-between'
              >
                <div className='flex items-center gap-2'>
                  <Download className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                  <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200'>
                    下載設置
                  </h3>
                </div>
                {isDownloadSectionOpen ? (
                  <ChevronUp className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                ) : (
                  <ChevronDown className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                )}
              </button>
              {isDownloadSectionOpen && (
                <div className='p-3 md:p-4 space-y-4 md:space-y-6'>
                  {/* 最大同時下載限制 */}
                  <div className='space-y-2'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        最大同時下載限制
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        控制播放頁面下載時的同時下載數量
                      </p>
                    </div>
                    <div className='flex items-center justify-between'>
                      <span className='text-xs text-gray-600 dark:text-gray-400'>
                        同時下載數量
                      </span>
                      <span className='text-xs font-medium text-gray-700 dark:text-gray-300'>
                        {maxConcurrentDownloads}個
                      </span>
                    </div>
                    <div className='flex items-center gap-2'>
                      <input
                        type='range'
                        min='1'
                        max='10'
                        step='1'
                        value={maxConcurrentDownloads}
                        onChange={(e) => handleMaxConcurrentDownloadsChange(Number(e.target.value))}
                        className='flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700'
                        style={{
                          background: `linear-gradient(to right, #10b981 0%, #10b981 ${((maxConcurrentDownloads - 1) / (10 - 1)) * 100}%, #e5e7eb ${((maxConcurrentDownloads - 1) / (10 - 1)) * 100}%, #e5e7eb 100%)`
                        }}
                      />
                    </div>
                    <div className='flex justify-between text-xs text-gray-500 dark:text-gray-400'>
                      <button
                        onClick={() => handleMaxConcurrentDownloadsChange(1)}
                        className={`px-2 py-0.5 rounded ${maxConcurrentDownloads === 1 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                      >
                        1個
                      </button>
                      <button
                        onClick={() => handleMaxConcurrentDownloadsChange(10)}
                        className={`px-2 py-0.5 rounded ${maxConcurrentDownloads === 10 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                      >
                        10個
                      </button>
                    </div>
                  </div>

                  {/* 單任務線程數 */}
                  <div className='space-y-2'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        單任務線程數
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        控制每個下載任務使用的線程數量，線程越多下載越快但佔用資源越多
                      </p>
                    </div>
                    <div className='flex items-center justify-between'>
                      <span className='text-xs text-gray-600 dark:text-gray-400'>
                        線程數量
                      </span>
                      <span className='text-xs font-medium text-gray-700 dark:text-gray-300'>
                        {downloadThreadsPerTask}個
                      </span>
                    </div>
                    <div className='flex items-center gap-2'>
                      <input
                        type='range'
                        min='1'
                        max='32'
                        step='1'
                        value={downloadThreadsPerTask}
                        onChange={(e) => handleDownloadThreadsPerTaskChange(Number(e.target.value))}
                        className='flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700'
                        style={{
                          background: `linear-gradient(to right, #10b981 0%, #10b981 ${((downloadThreadsPerTask - 1) / (32 - 1)) * 100}%, #e5e7eb ${((downloadThreadsPerTask - 1) / (32 - 1)) * 100}%, #e5e7eb 100%)`
                        }}
                      />
                    </div>
                    <div className='flex justify-between text-xs text-gray-500 dark:text-gray-400'>
                      <button
                        onClick={() => handleDownloadThreadsPerTaskChange(1)}
                        className={`px-2 py-0.5 rounded ${downloadThreadsPerTask === 1 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                      >
                        1個
                      </button>
                      <button
                        onClick={() => handleDownloadThreadsPerTaskChange(32)}
                        className={`px-2 py-0.5 rounded ${downloadThreadsPerTask === 32 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                      >
                        32個
                      </button>
                    </div>
                  </div>

                  {/* 下載模式 */}
                  <div className='space-y-2'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        下載模式
                      </h4>
                    </div>
                    <div className='space-y-2'>
                      <label className='flex items-center gap-2 cursor-pointer'>
                        <input
                          type='radio'
                          name='downloadMode'
                          value='browser'
                          checked={downloadMode === 'browser'}
                          onChange={() => handleDownloadModeChange('browser')}
                          className='w-4 h-4 text-green-500'
                        />
                        <span className='text-sm text-gray-700 dark:text-gray-300'>
                          瀏覽器下載（合併為單文件）
                        </span>
                      </label>
                      <label className='flex items-center gap-2 cursor-pointer'>
                        <input
                          type='radio'
                          name='downloadMode'
                          value='filesystem'
                          checked={downloadMode === 'filesystem'}
                          onChange={() => handleDownloadModeChange('filesystem')}
                          className='w-4 h-4 text-green-500'
                        />
                        <span className='text-sm text-gray-700 dark:text-gray-300'>
                          File System API（保存分片到本地目錄）
                        </span>
                      </label>
                    </div>

                    {/* 保存路徑選擇（僅在 filesystem 模式顯示） */}
                    {downloadMode === 'filesystem' && (
                      <div className='mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2'>
                        <label className='block text-xs font-medium text-gray-700 dark:text-gray-300'>
                          保存路徑
                        </label>
                        <div className='flex gap-2'>
                          <input
                            type='text'
                            value={filesystemSavePath}
                            readOnly
                            placeholder='點擊選擇保存目錄'
                            className='flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                          />
                          <button
                            onClick={handleSelectSavePath}
                            className='px-4 py-2 text-sm bg-green-500 text-white rounded hover:bg-green-600 transition-colors'
                          >
                            選擇目錄
                          </button>
                        </div>
                        <p className='text-xs text-gray-500 dark:text-gray-400'>
                          需要 Chrome 86+ 或 Edge 86+ 瀏覽器支持
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 下載文件管理 */}
                  <div className='space-y-2'>
                    <button
                      onClick={() => setIsDownloadManagementOpen(true)}
                      className='w-full px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors flex items-center justify-center gap-2'
                    >
                      <Package className='w-4 h-4' />
                      下載文件管理
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 緩衝設置 */}
            <div className='border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible'>
              <button
                onClick={() => setIsBufferSectionOpen(!isBufferSectionOpen)}
                className='w-full px-3 py-2.5 md:px-4 md:py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors flex items-center justify-between'
              >
                <div className='flex items-center gap-2'>
                  <Gauge className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                  <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200'>
                    緩衝設置
                  </h3>
                </div>
                {isBufferSectionOpen ? (
                  <ChevronUp className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                ) : (
                  <ChevronDown className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                )}
              </button>
              {isBufferSectionOpen && (
                <div className='p-3 md:p-4 space-y-4 md:space-y-6'>
                  <div>
                    <p className='text-xs text-gray-500 dark:text-gray-400'>
                      調整播放器緩衝策略（僅在播放頁面生效）
                    </p>
                  </div>

                  {/* 緩衝策略 */}
                  <div className='space-y-3'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        緩衝策略
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        設置視頻緩衝塊大小，影響播放流暢度和流量消耗
                      </p>
                    </div>

                    {/* 滑塊控件 */}
                    <div className='space-y-2'>
                      <input
                        type='range'
                        min='0'
                        max='3'
                        step='1'
                        value={getSliderValueFromStrategy(bufferStrategy)}
                        onChange={(e) => {
                          const sliderValue = parseInt(e.target.value);
                          const strategy = getBufferStrategyFromSlider(sliderValue);
                          handleBufferStrategyChange(strategy);
                        }}
                        className='w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500'
                        style={{
                          background: `linear-gradient(to right, rgb(34 197 94) 0%, rgb(34 197 94) ${(getSliderValueFromStrategy(bufferStrategy) / 3) * 100}%, rgb(229 231 235) ${(getSliderValueFromStrategy(bufferStrategy) / 3) * 100}%, rgb(229 231 235) 100%)`
                        }}
                      />

                      {/* 標籤顯示 */}
                      <div className='flex justify-between text-xs text-gray-500 dark:text-gray-400 px-1'>
                        <span className={bufferStrategy === 'low' ? 'font-semibold text-green-600 dark:text-green-400' : ''}>
                          低緩衝
                        </span>
                        <span className={bufferStrategy === 'medium' ? 'font-semibold text-green-600 dark:text-green-400' : ''}>
                          中緩衝
                        </span>
                        <span className={bufferStrategy === 'high' ? 'font-semibold text-green-600 dark:text-green-400' : ''}>
                          高緩衝
                        </span>
                        <span className={bufferStrategy === 'ultra' ? 'font-semibold text-green-600 dark:text-green-400' : ''}>
                          超高緩衝
                        </span>
                      </div>

                      {/* 當前選擇的說明 */}
                      <div className='text-center text-sm font-medium text-gray-700 dark:text-gray-300 mt-2'>
                        {
                          bufferStrategyOptions.find(
                            (option) => option.value === bufferStrategy
                          )?.label
                        }
                      </div>
                    </div>
                  </div>

                  {/* 下集預緩衝 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        下集預緩衝
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        播放進度達到90%時，自動預緩衝下一集內容
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={nextEpisodePreCache}
                          onChange={(e) => handleNextEpisodePreCacheToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* 彈幕設置 */}
            <div className='border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible'>
              <button
                onClick={() => setIsDanmakuSectionOpen(!isDanmakuSectionOpen)}
                className='w-full px-3 py-2.5 md:px-4 md:py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors flex items-center justify-between'
              >
                <div className='flex items-center gap-2'>
                  <MessageSquare className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                  <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200'>
                    彈幕設置
                  </h3>
                </div>
                {isDanmakuSectionOpen ? (
                  <ChevronUp className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                ) : (
                  <ChevronDown className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                )}
              </button>
              {isDanmakuSectionOpen && (
                <div className='p-3 md:p-4 space-y-4 md:space-y-6'>
                  {/* 禁用自動裝填彈幕 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        禁用自動裝填彈幕
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        開啟後，播放頁面不會自動匹配彈幕，只能手動匹配
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={disableAutoLoadDanmaku}
                          onChange={(e) => handleDisableAutoLoadDanmakuToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 下集彈幕預加載 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        下集彈幕預加載
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        播放進度達到90%時，自動預加載下一集彈幕
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={nextEpisodeDanmakuPreload}
                          onChange={(e) => handleNextEpisodeDanmakuPreloadToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 禁用彈幕熱力圖 */}
                  <div className='flex items-center justify-between'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        禁用彈幕熱力圖
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        開啟後不顯示彈幕熱力圖和熱力圖開關
                      </p>
                    </div>
                    <label className='flex items-center cursor-pointer'>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={danmakuHeatmapDisabled}
                          onChange={(e) => handleDanmakuHeatmapDisabledToggle(e.target.checked)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                  </div>

                  {/* 彈幕加載上限 */}
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between'>
                      <span className='text-xs text-gray-600 dark:text-gray-400'>
                        彈幕加載上限
                      </span>
                      <span className='text-xs font-medium text-gray-700 dark:text-gray-300'>
                        {danmakuMaxCount === 0 ? '無上限' : `${danmakuMaxCount} 條`}
                      </span>
                    </div>
                    <div className='flex items-center gap-2'>
                      <input
                        type='range'
                        min='0'
                        max='10000'
                        step='100'
                        value={danmakuMaxCount}
                        onChange={(e) => handleDanmakuMaxCountChange(parseInt(e.target.value))}
                        className='flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700'
                        style={{
                          background: `linear-gradient(to right, #10b981 0%, #10b981 ${(danmakuMaxCount / 10000) * 100}%, #e5e7eb ${(danmakuMaxCount / 10000) * 100}%, #e5e7eb 100%)`
                        }}
                      />
                    </div>
                    <div className='relative text-xs text-gray-500 dark:text-gray-400' style={{ height: '24px' }}>
                      <button
                        onClick={() => handleDanmakuMaxCountChange(0)}
                        className={`absolute px-2 py-0.5 rounded ${danmakuMaxCount === 0 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        style={{ left: '0%', transform: 'translateX(0%)' }}
                      >
                        無上限
                      </button>
                      <button
                        onClick={() => handleDanmakuMaxCountChange(3000)}
                        className={`absolute px-2 py-0.5 rounded ${danmakuMaxCount === 3000 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        style={{ left: '30%', transform: 'translateX(-50%)' }}
                      >
                        3000
                      </button>
                      <button
                        onClick={() => handleDanmakuMaxCountChange(5000)}
                        className={`absolute px-2 py-0.5 rounded ${danmakuMaxCount === 5000 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        style={{ left: '50%', transform: 'translateX(-50%)' }}
                      >
                        5000
                      </button>
                      <button
                        onClick={() => handleDanmakuMaxCountChange(10000)}
                        className={`absolute px-2 py-0.5 rounded ${danmakuMaxCount === 10000 ? 'bg-green-500 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        style={{ left: '100%', transform: 'translateX(-100%)' }}
                      >
                        10000
                      </button>
                    </div>
                    <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                      限制加載的彈幕數量，減少性能消耗
                    </p>
                  </div>

                  {/* 清除彈幕緩存 */}
                  <div className='space-y-3'>
                    <div>
                      <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                        彈幕緩存管理
                      </h4>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        彈幕緩存空間佔用：{danmakuCacheUsage}
                      </p>
                      <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        清除所有已緩存的彈幕數據
                      </p>
                    </div>
                    <button
                      onClick={handleClearDanmakuCache}
                      disabled={isClearingCache}
                      className='w-full px-4 py-2.5 bg-red-500 hover:bg-red-600 disabled:bg-red-400 dark:bg-red-600 dark:hover:bg-red-700 dark:disabled:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors duration-200 shadow-sm hover:shadow-md disabled:cursor-not-allowed flex items-center justify-center gap-2'
                    >
                      {isClearingCache ? (
                        <>
                          <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                          <span>清除中...</span>
                        </>
                      ) : (
                        <>
                          <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                            <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' />
                          </svg>
                          <span>清除彈幕緩存</span>
                        </>
                      )}
                    </button>

                    {/* 成功/失敗提示 */}
                    {clearCacheMessage && (
                      <div className={`text-sm p-3 rounded-lg border ${
                        clearCacheMessage.includes('成功')
                          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
                          : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                      }`}>
                        {clearCacheMessage}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 首頁設置 */}
            <div className='border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible'>
              <button
                onClick={() => setIsHomepageSectionOpen(!isHomepageSectionOpen)}
                className='w-full px-3 py-2.5 md:px-4 md:py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors flex items-center justify-between'
              >
                <div className='flex items-center gap-2'>
                  <Home className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                  <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200'>
                    首頁設置
                  </h3>
                </div>
                {isHomepageSectionOpen ? (
                  <ChevronUp className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                ) : (
                  <ChevronDown className='w-5 h-5 text-gray-600 dark:text-gray-400' />
                )}
              </button>
              {isHomepageSectionOpen && (
                <div className='p-3 md:p-4 space-y-4 md:space-y-6'>
                  <div>
                    <p className='text-xs text-gray-500 dark:text-gray-400 mb-3'>
                      配置首頁模塊的顯示順序和可見性
                    </p>
                  </div>

                  {/* 首頁頂部組件顯示 */}
                  <div className='space-y-2'>
                    <div className='flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
                      <button
                        onClick={() => handleHomeBannerToggle(!homeBannerEnabled)}
                        className='flex-shrink-0'
                        title={homeBannerEnabled ? '點擊隱藏' : '點擊顯示'}
                      >
                        {homeBannerEnabled ? (
                          <Eye className='w-5 h-5 text-green-600 dark:text-green-400' />
                        ) : (
                          <EyeOff className='w-5 h-5 text-gray-400 dark:text-gray-500' />
                        )}
                      </button>
                      <div className='flex-1'>
                        <span className={`text-sm font-medium ${
                          homeBannerEnabled
                            ? 'text-gray-900 dark:text-gray-100'
                            : 'text-gray-400 dark:text-gray-500'
                        }`}>
                          首頁輪播圖
                        </span>
                      </div>
                    </div>

                    <div className='flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
                      <button
                        onClick={() => handleHomeContinueWatchingToggle(!homeContinueWatchingEnabled)}
                        className='flex-shrink-0'
                        title={homeContinueWatchingEnabled ? '點擊隱藏' : '點擊顯示'}
                      >
                        {homeContinueWatchingEnabled ? (
                          <Eye className='w-5 h-5 text-green-600 dark:text-green-400' />
                        ) : (
                          <EyeOff className='w-5 h-5 text-gray-400 dark:text-gray-500' />
                        )}
                      </button>
                      <div className='flex-1'>
                        <span className={`text-sm font-medium ${
                          homeContinueWatchingEnabled
                            ? 'text-gray-900 dark:text-gray-100'
                            : 'text-gray-400 dark:text-gray-500'
                        }`}>
                          繼續觀看
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 模塊列表 */}
                  <div className='space-y-2'>
                    {homeModules.map((module, index) => (
                      <div
                        key={module.id}
                        className='flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'
                      >
                        {/* 左側：顯示/隱藏開關 */}
                        <button
                          onClick={() => handleHomeModuleToggle(module.id, !module.enabled)}
                          className='flex-shrink-0'
                          title={module.enabled ? '點擊隱藏' : '點擊顯示'}
                        >
                          {module.enabled ? (
                            <Eye className='w-5 h-5 text-green-600 dark:text-green-400' />
                          ) : (
                            <EyeOff className='w-5 h-5 text-gray-400 dark:text-gray-500' />
                          )}
                        </button>

                        {/* 中間：模塊名稱 */}
                        <div className='flex-1'>
                          <span className={`text-sm font-medium ${
                            module.enabled
                              ? 'text-gray-900 dark:text-gray-100'
                              : 'text-gray-400 dark:text-gray-500'
                          }`}>
                            {module.name}
                          </span>
                        </div>

                        {/* 右側：上下移動按鈕 */}
                        <div className='flex gap-1'>
                          <button
                            onClick={() => handleHomeModuleMoveUp(index)}
                            disabled={index === 0}
                            className='p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
                            title='上移'
                          >
                            <MoveUp className='w-4 h-4 text-gray-600 dark:text-gray-400' />
                          </button>
                          <button
                            onClick={() => handleHomeModuleMoveDown(index)}
                            disabled={index === homeModules.length - 1}
                            className='p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
                            title='下移'
                          >
                            <MoveDown className='w-4 h-4 text-gray-600 dark:text-gray-400' />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 恢復默認按鈕 */}
                  <button
                    onClick={() => {
                      setHomeModules(defaultHomeModules);
                      setHomeBannerEnabled(true);
                      setHomeContinueWatchingEnabled(true);
                      if (typeof window !== 'undefined') {
                        localStorage.setItem('homeModules', JSON.stringify(defaultHomeModules));
                        localStorage.setItem('homeBannerEnabled', 'true');
                        localStorage.setItem('homeContinueWatchingEnabled', 'true');
                        window.dispatchEvent(new CustomEvent('homeModulesUpdated'));
                      }
                    }}
                    className='w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors'
                  >
                    恢復默認配置
                  </button>

                  {/* 提示信息 */}
                  <div className='text-xs text-gray-500 dark:text-gray-400 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg'>
                    <p>💡 提示：點擊眼睛圖標可顯示/隱藏模塊，使用箭頭按鈕調整模塊順序</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 底部說明 */}
          <div className='mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              這些設置保存在本地瀏覽器中
            </p>
          </div>
        </div>
      </div>
    </>
  );

  // 訂閱面板內容
  const subscribePanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={handleCloseSubscribe}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 訂閱面板 */}
      <div
        className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] overflow-hidden'
      >
        <div
          className='h-full p-6'
          data-panel-content
          onTouchMove={(e) => {
            e.stopPropagation();
          }}
          style={{
            touchAction: 'auto',
          }}
        >
          {/* 標題欄 */}
          <div className='flex items-center justify-between mb-6'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              TVBox訂閱
            </h3>
            <button
              onClick={handleCloseSubscribe}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 內容 */}
          <div className='space-y-4'>
            {isLoadingSubscribeUrl ? (
              <>
                {/* 加載骨架 - 開關 */}
                <div>
                  <div className='h-5 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-3 animate-pulse'></div>
                  <div className='space-y-2'>
                    <div className='h-14 bg-gray-200 dark:bg-gray-700 rounded animate-pulse'></div>
                    <div className='h-14 bg-gray-200 dark:bg-gray-700 rounded animate-pulse'></div>
                  </div>
                </div>

                {/* 加載骨架 - 訂閱鏈接 */}
                <div>
                  <div className='h-5 w-28 bg-gray-200 dark:bg-gray-700 rounded mb-2 animate-pulse'></div>
                  <div className='flex gap-2'>
                    <div className='flex-1 h-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse'></div>
                    <div className='w-20 h-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse'></div>
                  </div>
                  <div className='h-4 w-full bg-gray-200 dark:bg-gray-700 rounded mt-1 animate-pulse'></div>
                </div>

                {/* 加載骨架 - 重置按鈕 */}
                <div className='pt-2'>
                  <div className='w-full h-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse'></div>
                  <div className='h-4 w-40 bg-gray-200 dark:bg-gray-700 rounded mt-2 mx-auto animate-pulse'></div>
                </div>
              </>
            ) : (
              <>
                <div className='space-y-3'>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    訂閱選項
                  </h4>

                  <button
                    type='button'
                    onClick={() => setSubscribeAdFilterEnabled((prev) => !prev)}
                    className='w-full flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 text-left bg-gray-50 dark:bg-gray-800/70'
                  >
                    <div>
                      <div className='text-sm font-medium text-gray-800 dark:text-gray-200'>
                        去廣告
                      </div>
                      <div className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        開啟後通過代理處理播放鏈接，兼容性可能略低
                      </div>
                    </div>
                    <div className={`relative h-6 w-11 rounded-full transition-colors ${subscribeAdFilterEnabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                      <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${subscribeAdFilterEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </div>
                  </button>

                  <button
                    type='button'
                    onClick={() => setSubscribeYellowFilterEnabled((prev) => !prev)}
                    className='w-full flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 text-left bg-gray-50 dark:bg-gray-800/70'
                  >
                    <div>
                      <div className='text-sm font-medium text-gray-800 dark:text-gray-200'>
                        黃色過濾
                      </div>
                      <div className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                        開啟後同樣走代理，並在代理搜索時過濾黃色內容
                      </div>
                    </div>
                    <div className={`relative h-6 w-11 rounded-full transition-colors ${subscribeYellowFilterEnabled ? 'bg-yellow-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                      <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${subscribeYellowFilterEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                </div>

                <div>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    訂閱鏈接
                  </h4>
                  <div className='flex gap-2'>
                    <input
                      type='text'
                      className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                      value={subscribeUrl}
                      readOnly
                    />
                    <button
                      onClick={handleCopySubscribeUrl}
                      className='px-4 py-2 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white text-sm font-medium rounded-md transition-colors flex items-center gap-2 whitespace-nowrap'
                    >
                      <Copy className='w-4 h-4' />
                      {copySuccess ? '已複製' : '複製'}
                    </button>
                  </div>
                  {(subscribeAdFilterEnabled || subscribeYellowFilterEnabled) && (
                    <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                      💡 代理模式已開啟，某些源可能因為區域或兼容問題無法播放
                    </p>
                  )}
                </div>

                {/* 重置Token按鈕 */}
                <div className='pt-2'>
                  <button
                    onClick={handleResetToken}
                    disabled={isResettingToken}
                    className='w-full px-4 py-2 bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                  >
                    {isResettingToken ? '重置中...' : '重置訂閱Token'}
                  </button>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-2 text-center'>
                    ⚠️ 重置後舊鏈接將失效
                  </p>
                  {/* 消息提示 */}
                  <p id='tvbox-token-message' className='text-xs text-center hidden'></p>
                </div>
              </>
            )}
          </div>

          {/* 底部說明 */}
          <div className='mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              將訂閱鏈接複製到TVBox應用中使用
            </p>
          </div>
        </div>
      </div>
    </>
  );

  // 修改密碼面板內容
  const changePasswordPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={handleCloseChangePassword}
        onTouchMove={(e) => {
          // 只阻止滾動，允許其他觸摸事件
          e.preventDefault();
        }}
        onWheel={(e) => {
          // 阻止滾輪滾動
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 修改密碼面板 */}
      <div
        className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] overflow-hidden'
      >
        {/* 內容容器 - 獨立的滾動區域 */}
        <div
          className='h-full p-6'
          data-panel-content
          onTouchMove={(e) => {
            // 阻止事件冒泡到遮罩層，但允許內部滾動
            e.stopPropagation();
          }}
          style={{
            touchAction: 'auto', // 允許所有觸摸操作
          }}
        >
          {/* 標題欄 */}
          <div className='flex items-center justify-between mb-6'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              修改密碼
            </h3>
            <button
              onClick={handleCloseChangePassword}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 表單 */}
          <div className='space-y-4'>
            {/* 新密碼輸入 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                新密碼
              </label>
              <input
                type='password'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
                placeholder='請輸入新密碼'
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={passwordLoading}
              />
            </div>

            {/* 確認密碼輸入 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                確認密碼
              </label>
              <input
                type='password'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
                placeholder='請再次輸入新密碼'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={passwordLoading}
              />
            </div>

            {/* 錯誤信息 */}
            {passwordError && (
              <div className='text-red-500 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded-md border border-red-200 dark:border-red-800'>
                {passwordError}
              </div>
            )}
          </div>

          {/* 操作按鈕 */}
          <div className='flex gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <button
              onClick={handleCloseChangePassword}
              className='flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors'
              disabled={passwordLoading}
            >
              取消
            </button>
            <button
              onClick={handleSubmitChangePassword}
              className='flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              disabled={passwordLoading || !newPassword || !confirmPassword}
            >
              {passwordLoading ? '修改中...' : '確認修改'}
            </button>
          </div>

          {/* 底部說明 */}
          <div className='mt-4 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              修改密碼後需要重新登錄
            </p>
          </div>
        </div>
      </div>
    </>
  );

  // 舉報信息彈窗
  const reportPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1002]'
        onClick={() => setIsReportOpen(false)}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 舉報信息面板 */}
      <div
        className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1003] overflow-hidden'
      >
        <div
          className='h-full max-h-[70vh] flex flex-col'
          data-panel-content
          onTouchMove={(e) => {
            e.stopPropagation();
          }}
          style={{
            touchAction: 'auto',
          }}
        >
          {/* 標題欄 */}
          <div className='flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              恥辱柱
            </h3>
            <button
              onClick={() => setIsReportOpen(false)}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 內容區域 */}
          <div className='flex-1 overflow-y-auto p-6'>
            <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4'>
              <p className='text-gray-800 dark:text-gray-200 leading-relaxed'>
                抄襲狗<span className='font-bold text-red-600 dark:text-red-400'>SzeMeng76</span>毫無廉恥，盯著本項目的commit區，瘋狂抄襲。警告亦全當看不見，實為開源界恥辱。
              </p>
              <p className='text-gray-800 dark:text-gray-200 leading-relaxed mt-3'>
                超分，觀影室，豆瓣反爬，精確搜索等等等等，直接抄襲，最不要臉的就是，剛更新一版，幾小時後直接抄走。
              </p>
              <p className='text-gray-800 dark:text-gray-200 leading-relaxed mt-3'>
                <span className='font-semibold text-red-600 dark:text-red-400'>2026-02-25：</span>抄襲emby功能
              </p>
            </div>
          </div>

          {/* 底部按鈕 */}
          <div className='p-6 border-t border-gray-200 dark:border-gray-700'>
            <button
              onClick={() => setIsReportOpen(false)}
              className='w-full px-4 py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-medium rounded-lg transition-colors'
            >
              我知道了
            </button>
          </div>
        </div>
      </div>
    </>
  );

  // 生態應用面板內容
  const ecoAppsPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={() => setIsEcoAppsOpen(false)}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 生態應用面板 */}
      <div
        className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] overflow-hidden'
      >
        <div
          className='h-full max-h-[85vh] flex flex-col'
          data-panel-content
          onTouchMove={(e) => {
            e.stopPropagation();
          }}
          style={{
            touchAction: 'auto',
          }}
        >
          {/* 標題欄 */}
          <div className='flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              生態應用
            </h3>
            <div className='flex items-center gap-2'>
              {/* 舉報按鈕 */}
              <button
                onClick={() => setIsReportOpen(true)}
                className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-lg'
                aria-label='Report'
                title='舉報抄襲'
              >
                🐶
              </button>
              {/* 關閉按鈕 */}
              <button
                onClick={() => setIsEcoAppsOpen(false)}
                className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
                aria-label='Close'
              >
                <X className='w-full h-full' />
              </button>
            </div>
          </div>

          {/* 應用列表 */}
          <div className='flex-1 overflow-y-auto p-6'>
            <div className='grid gap-6 md:grid-cols-1'>
              {/* MoonTVPlus-PC 客戶端 */}
              <div className='bg-gray-50 dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700'>
                <div className='flex items-start gap-4'>
                  <div className='flex-shrink-0 relative'>
                    <img
                      src='/logo.png'
                      alt='MoonTVPlus-PC'
                      className='w-16 h-16 rounded-xl object-cover'
                    />
                    <div className='absolute -bottom-1 -right-1 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center shadow-lg'>
                      <Monitor className='w-3.5 h-3.5 text-white' />
                    </div>
                  </div>
                  <div className='flex-1 min-w-0'>
                    <h4 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'>
                      MoonTVPlus-PC客戶端
                    </h4>
                    <p className='text-sm text-gray-600 dark:text-gray-400 mb-3'>
                      專為Windows開發的客戶端，完美支持私人影庫mkv視頻
                    </p>
                    <a
                      href='https://github.com/mtvpls/MoonTVPlus-PC/releases'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors'
                    >
                      <Download className='w-4 h-4' />
                      下載
                      <ExternalLink className='w-3 h-3' />
                    </a>
                  </div>
                </div>
              </div>

              {/* Selene 跨平臺客戶端 */}
              <div className='bg-gray-50 dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700'>
                <div className='flex items-start gap-4'>
                  <div className='flex-shrink-0 relative'>
                    <img
                      src='/icons/Selene.png'
                      alt='Selene'
                      className='w-16 h-16 rounded-xl object-cover'
                    />
                    <span className='absolute -top-1 -right-1 px-1.5 py-0.5 bg-orange-500 text-white text-[10px] font-bold rounded'>
                      二開
                    </span>
                  </div>
                  <div className='flex-1 min-w-0'>
                    <h4 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'>
                      Selene 跨平臺客戶端
                    </h4>
                    <p className='text-sm text-gray-600 dark:text-gray-400 mb-3'>
                      多平臺客戶端
                    </p>
                    <div className='flex flex-wrap gap-2'>
                      <a
                        href='https://github.com/mtvpls/Selene-Build/releases'
                        target='_blank'
                        rel='noopener noreferrer'
                        className='inline-flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors'
                      >
                        <Download className='w-4 h-4' />
                        下載
                        <ExternalLink className='w-3 h-3' />
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              {/* OrionTV TV專用客戶端 */}
              <div className='bg-gray-50 dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700'>
                <div className='flex items-start gap-4'>
                  <div className='flex-shrink-0 relative'>
                    <img
                      src='/icons/OrionTV.png'
                      alt='OrionTV'
                      className='w-16 h-16 rounded-xl object-cover'
                    />
                    <span className='absolute -top-1 -right-1 px-1.5 py-0.5 bg-orange-500 text-white text-[10px] font-bold rounded'>
                      二開
                    </span>
                  </div>
                  <div className='flex-1 min-w-0'>
                    <h4 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'>
                      OrionTV TV專用客戶端
                    </h4>
                    <p className='text-sm text-gray-600 dark:text-gray-400 mb-3'>
                      tv專用
                    </p>
                    <a
                      href='https://github.com/mtvpls/OrionTV_Build/tags'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg transition-colors'
                    >
                      <Download className='w-4 h-4' />
                      下載
                      <ExternalLink className='w-3 h-3' />
                    </a>
                  </div>
                </div>
              </div>

              {/* 私人影庫轉碼器 */}
              <div className='bg-gray-50 dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700'>
                <div className='flex items-start gap-4'>
                  <div className='flex-shrink-0 relative'>
                    <div className='w-16 h-16 rounded-xl bg-amber-500 flex items-center justify-center shadow-sm'>
                      <RouterIcon className='w-8 h-8 text-white' />
                    </div>
                    <span className='absolute -top-1 -right-1 px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded'>
                      MKV轉碼
                    </span>
                  </div>
                  <div className='flex-1 min-w-0'>
                    <h4 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'>
                      私人影庫轉碼器
                    </h4>
                    <p className='text-sm text-gray-600 dark:text-gray-400 mb-3'>
                      為私人影庫中的 MKV 視頻提供轉碼播放能力，可解析內封字幕並解決部分視頻無音頻問題，但通常需要較高的本機性能配置。
                    </p>
                    <a
                      href='https://github.com/mtvpls/moontvplus-transcoder/tags'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors'
                    >
                      <Download className='w-4 h-4' />
                      下載
                      <ExternalLink className='w-3 h-3' />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 底部說明 */}
          <div className='p-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              選擇適合您設備的客戶端下載使用
            </p>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className='relative'>
        <button
          onClick={handleMenuClick}
          className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors'
          aria-label='User Menu'
        >
          <User className='w-full h-full' />
        </button>
        {/* 版本更新紅點 */}
        {updateStatus === UpdateStatus.HAS_UPDATE && (
          <div className='absolute top-[2px] right-[2px] w-2 h-2 bg-yellow-500 rounded-full'></div>
        )}
        {/* 未讀通知紅點 */}
        {unreadCount > 0 && (
          <div className='absolute top-[2px] right-[2px] w-2 h-2 bg-red-500 rounded-full'></div>
        )}
      </div>

      {/* 使用 Portal 將菜單面板渲染到 document.body */}
      {isOpen && mounted && createPortal(menuPanel, document.body)}

      <PersonalCenterPanel
        isOpen={isProfileCenterOpen}
        mounted={mounted}
        onClose={() => setIsProfileCenterOpen(false)}
        username={currentUsername}
        roleText={currentRoleText}
        showRoleBadge={shouldShowRoleBadge}
        avatarText={avatarText}
        roleBadgeClassName={roleBadgeClassName}
        showDeviceManagement={storageType !== 'localstorage'}
        showChangePassword={showChangePassword}
        onOpenEmailSettings={() => {
          setIsProfileCenterOpen(false);
          setIsEmailSettingsOpen(true);
          loadEmailSettings();
        }}
        onOpenDeviceManagement={() => {
          setIsProfileCenterOpen(false);
          setIsDeviceManagementOpen(true);
          loadDevices();
        }}
        onOpenChangePassword={() => {
          setIsProfileCenterOpen(false);
          handleChangePassword();
        }}
      />

      {/* 使用 Portal 將設置面板渲染到 document.body */}
      {isSettingsOpen && mounted && createPortal(settingsPanel, document.body)}

      {/* 使用 Portal 將修改密碼面板渲染到 document.body */}
      {isChangePasswordOpen &&
        mounted &&
        createPortal(changePasswordPanel, document.body)}

      {/* 使用 Portal 將訂閱面板渲染到 document.body */}
      {isSubscribeOpen &&
        mounted &&
        createPortal(subscribePanel, document.body)}

      {/* 版本面板 */}
      <VersionPanel
        isOpen={isVersionPanelOpen}
        onClose={() => setIsVersionPanelOpen(false)}
      />

      {/* 離線下載面板 */}
      <OfflineDownloadPanel
        isOpen={isOfflineDownloadPanelOpen}
        onClose={() => setIsOfflineDownloadPanelOpen(false)}
      />

      {/* 使用 Portal 將通知面板渲染到 document.body */}
      {isNotificationPanelOpen &&
        mounted &&
        createPortal(
          <NotificationPanel
            isOpen={isNotificationPanelOpen}
            onClose={() => {
              setIsNotificationPanelOpen(false);
              // 不需要在這裡刷新，NotificationPanel 內部會觸發事件
            }}
          />,
          document.body
        )}

      {/* 使用 Portal 將收藏面板渲染到 document.body */}
      {isFavoritesPanelOpen &&
        mounted &&
        createPortal(
          <FavoritesPanel
            isOpen={isFavoritesPanelOpen}
            onClose={() => setIsFavoritesPanelOpen(false)}
          />,
          document.body
        )}

      {/* 使用 Portal 將下載文件管理面板渲染到 document.body */}
      {isDownloadManagementOpen &&
        mounted &&
        createPortal(
          <DownloadManagementPanel
            isOpen={isDownloadManagementOpen}
            onClose={() => setIsDownloadManagementOpen(false)}
          />,
          document.body
        )}

      <EmailSettingsPanel
        isOpen={isEmailSettingsOpen}
        mounted={mounted}
        onClose={() => setIsEmailSettingsOpen(false)}
        userEmail={userEmail}
        onUserEmailChange={setUserEmail}
        emailNotifications={emailNotifications}
        onEmailNotificationsChange={setEmailNotifications}
        emailSettingsLoading={emailSettingsLoading}
        emailSettingsSaving={emailSettingsSaving}
        onSave={handleSaveEmailSettings}
        statusMessage={emailSettingsMessage}
        statusType={emailSettingsMessageType}
      />

      <DeviceManagementPanel
        isOpen={isDeviceManagementOpen}
        mounted={mounted}
        onClose={() => setIsDeviceManagementOpen(false)}
        devices={devices}
        devicesLoading={devicesLoading}
        revoking={revoking}
        onRevokeDevice={handleRevokeDevice}
        onRevokeAllDevices={handleRevokeAllDevices}
        getDeviceIcon={getDeviceIcon}
      />

      {/* 使用 Portal 將生態應用面板渲染到 document.body */}
      {isEcoAppsOpen &&
        mounted &&
        createPortal(ecoAppsPanel, document.body)}

      {/* 使用 Portal 將舉報信息面板渲染到 document.body */}
      {isReportOpen &&
        mounted &&
        createPortal(reportPanel, document.body)}

      {/* 確認對話框 */}
      {confirmDialog.isOpen &&
        mounted &&
        createPortal(
          <div className='fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm'>
            <div className='bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md m-4'>
              {/* 標題 */}
              <div className='p-6 border-b border-gray-200 dark:border-gray-700'>
                <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                  {confirmDialog.title}
                </h3>
              </div>

              {/* 內容 */}
              <div className='p-6'>
                <p className='text-gray-700 dark:text-gray-300'>
                  {confirmDialog.message}
                </p>
              </div>

              {/* 按鈕 */}
              <div className='p-6 pt-0 flex gap-3 justify-end'>
                <button
                  onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
                  className='px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-lg transition-colors'
                >
                  取消
                </button>
                <button
                  onClick={confirmDialog.onConfirm}
                  className='px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 rounded-lg transition-colors'
                >
                  確定
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
