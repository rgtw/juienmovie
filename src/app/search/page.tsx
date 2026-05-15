/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any,@typescript-eslint/no-non-null-assertion,no-empty */
'use client';

import {
  ChevronUp,
  Film,
  Grid2x2,
  HardDrive,
  List,
  Magnet,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import React, {
  startTransition,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import AcgSearch from '@/components/AcgSearch';
import CapsuleSwitch from '@/components/CapsuleSwitch';
import ImageViewer from '@/components/ImageViewer';
import PageLayout from '@/components/PageLayout';
import PansouSearch from '@/components/PansouSearch';
import ProxyImage from '@/components/ProxyImage';
import SearchResultFilter, {
  SearchFilterCategory,
} from '@/components/SearchResultFilter';
import SearchSuggestions from '@/components/SearchSuggestions';
import VideoCard, { VideoCardHandle } from '@/components/VideoCard';
import VirtualScrollableGrid from '@/components/VirtualScrollableGrid';

function SearchPageClient() {
  // 搜索歷史
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  // 返回頂部按鈕顯示狀態
  const [showBackToTop, setShowBackToTop] = useState(false);
  // 選項卡狀態: 'video' 或 'pansou' 或 'acg'
  const [activeTab, setActiveTab] = useState<'video' | 'pansou' | 'acg'>(
    'video'
  );
  // Pansou 搜索觸發標誌
  const [triggerPansouSearch, setTriggerPansouSearch] = useState(false);
  // ACG 搜索觸發標誌
  const [triggerAcgSearch, setTriggerAcgSearch] = useState(false);
  // 用戶權限
  const [userRole, setUserRole] = useState<'owner' | 'admin' | 'user' | null>(
    null
  );
  const [netdiskSearchEnabled, setNetdiskSearchEnabled] = useState(false);
  const [magnetSearchEnabled, setMagnetSearchEnabled] = useState(false);
  // 繁體轉簡體轉換器
  const converterRef = useRef<((text: string) => string) | null>(null);
  // 轉換器是否已初始化
  const [converterReady, setConverterReady] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const submittedSearchQuery = searchParams.get('q')?.trim() || '';
  const currentQueryRef = useRef<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [totalSources, setTotalSources] = useState(0);
  const [completedSources, setCompletedSources] = useState(0);
  const pendingResultsRef = useRef<SearchResult[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const [useFluidSearch, setUseFluidSearch] = useState(true);
  // 聚合卡片 refs 與聚合統計緩存
  const groupRefs = useRef<Map<string, React.RefObject<VideoCardHandle>>>(
    new Map()
  );
  const groupStatsRef = useRef<
    Map<
      string,
      { douban_id?: number; episodes?: number; source_names: string[] }
    >
  >(new Map());
  // 強制刷新狀態
  const [forceRefresh, setForceRefresh] = useState(false);
  // 是否使用了緩存結果
  const [isFromCache, setIsFromCache] = useState(false);
  // 精確搜索開關
  const [exactSearch, setExactSearch] = useState(true);

  // 生成緩存鍵
  const getCacheKey = (query: string) => {
    return `search_cache_${query.trim()}`;
  };

  // 從 sessionStorage 獲取緩存的搜索結果
  const getCachedResults = (query: string): SearchResult[] | null => {
    if (typeof window === 'undefined') return null;
    try {
      const cacheKey = getCacheKey(query);
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error('Failed to get cached results:', error);
    }
    return null;
  };

  // 保存搜索結果到 sessionStorage
  const setCachedResults = (query: string, results: SearchResult[]) => {
    if (typeof window === 'undefined') return;
    try {
      const cacheKey = getCacheKey(query);
      sessionStorage.setItem(cacheKey, JSON.stringify(results));
    } catch (error) {
      console.error('Failed to cache results:', error);
    }
  };

  // 清除指定查詢的緩存
  const clearCachedResults = (query: string) => {
    if (typeof window === 'undefined') return;
    try {
      const cacheKey = getCacheKey(query);
      sessionStorage.removeItem(cacheKey);
    } catch (error) {
      console.error('Failed to clear cached results:', error);
    }
  };

  const getGroupRef = (key: string) => {
    let ref = groupRefs.current.get(key);
    if (!ref) {
      ref = React.createRef<VideoCardHandle>();
      groupRefs.current.set(key, ref);
    }
    return ref;
  };

  const computeGroupStats = (group: SearchResult[]) => {
    const episodes = (() => {
      const countMap = new Map<number, number>();
      group.forEach((g) => {
        const len = g.episodes?.length || 0;
        if (len > 0) countMap.set(len, (countMap.get(len) || 0) + 1);
      });
      let max = 0;
      let res = 0;
      countMap.forEach((v, k) => {
        if (v > max) {
          max = v;
          res = k;
        }
      });
      return res;
    })();
    const source_names = Array.from(
      new Set(group.map((g) => g.source_name).filter(Boolean))
    ) as string[];

    const douban_id = (() => {
      const countMap = new Map<number, number>();
      group.forEach((g) => {
        if (g.douban_id && g.douban_id > 0) {
          countMap.set(g.douban_id, (countMap.get(g.douban_id) || 0) + 1);
        }
      });
      let max = 0;
      let res: number | undefined;
      countMap.forEach((v, k) => {
        if (v > max) {
          max = v;
          res = k;
        }
      });
      return res;
    })();

    return { episodes, source_names, douban_id };
  };
  // 過濾器：非聚合與聚合
  const [filterAll, setFilterAll] = useState<{
    source: string;
    title: string;
    year: string;
    yearOrder: 'none' | 'asc' | 'desc';
  }>({
    source: 'all',
    title: 'all',
    year: 'all',
    yearOrder: 'none',
  });
  const [filterAgg, setFilterAgg] = useState<{
    source: string;
    title: string;
    year: string;
    yearOrder: 'none' | 'asc' | 'desc';
  }>({
    source: 'all',
    title: 'all',
    year: 'all',
    yearOrder: 'none',
  });

  // 獲取默認聚合設置：只讀取用戶本地設置，默認為 true
  const getDefaultAggregate = () => {
    if (typeof window !== 'undefined') {
      const userSetting = localStorage.getItem('defaultAggregateSearch');
      if (userSetting !== null) {
        return JSON.parse(userSetting);
      }
    }
    return true; // 默認啟用聚合
  };

  const [viewMode, setViewMode] = useState<'agg' | 'all'>(() => {
    return getDefaultAggregate() ? 'agg' : 'all';
  });
  const [resultDisplayMode, setResultDisplayMode] = useState<'card' | 'list'>(
    () => {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('searchResultDisplayMode');
        if (saved === 'card' || saved === 'list') {
          return saved;
        }
      }
      return 'card';
    }
  );
  const [expandedSourceTags, setExpandedSourceTags] = useState<
    Record<string, boolean>
  >({});
  const [previewImage, setPreviewImage] = useState<{
    url: string;
    alt: string;
  } | null>(null);

  // 在“無排序”場景用於每個源批次的預排序：完全匹配標題優先，其次年份倒序，未知年份最後
  const sortBatchForNoOrder = (items: SearchResult[]) => {
    const q = currentQueryRef.current.trim();
    return items.slice().sort((a, b) => {
      const aExact = (a.title || '').trim() === q;
      const bExact = (b.title || '').trim() === q;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      const aNum = Number.parseInt(a.year as any, 10);
      const bNum = Number.parseInt(b.year as any, 10);
      const aValid = !Number.isNaN(aNum);
      const bValid = !Number.isNaN(bNum);
      if (aValid && !bValid) return -1;
      if (!aValid && bValid) return 1;
      if (aValid && bValid) return bNum - aNum; // 年份倒序
      return 0;
    });
  };

  // 簡化的年份排序：unknown/空值始終在最後
  const compareYear = (
    aYear: string,
    bYear: string,
    order: 'none' | 'asc' | 'desc'
  ) => {
    // 如果是無排序狀態，返回0（保持原順序）
    if (order === 'none') return 0;

    // 處理空值和unknown
    const aIsEmpty = !aYear || aYear === 'unknown';
    const bIsEmpty = !bYear || bYear === 'unknown';

    if (aIsEmpty && bIsEmpty) return 0;
    if (aIsEmpty) return 1; // a 在後
    if (bIsEmpty) return -1; // b 在後

    // 都是有效年份，按數字比較
    const aNum = parseInt(aYear, 10);
    const bNum = parseInt(bYear, 10);

    return order === 'asc' ? aNum - bNum : bNum - aNum;
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
    if (
      item.source === 'emby' ||
      item.source?.startsWith('emby_') ||
      item.source === 'openlist'
    ) {
      return item.type_name === '電影' ? 'movie' : 'tv';
    }

    // 2. API 採集源：綜合判斷
    const typeName = item.type_name?.toLowerCase() || '';

    // 2.1 明確包含"電影"或"movie"或"片"的，判斷為電影
    if (
      typeName.includes('電影') ||
      typeName.includes('movie') ||
      (typeName.endsWith('片') && !typeName.includes('動漫'))
    ) {
      return 'movie';
    }

    // 2.2 包含"劇"、"動漫"、"綜藝"等關鍵詞的，判斷為劇集
    if (
      typeName.includes('劇') ||
      typeName.includes('動漫') ||
      typeName.includes('綜藝') ||
      typeName.includes('anime')
    ) {
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

  // 輔助函數：檢查標題是否包含搜索詞（用於精確搜索）
  const titleContainsQuery = (title: string, query: string): boolean => {
    if (!exactSearch) return true; // 如果未開啟精確搜索，不過濾
    if (!query || !title) return true; // 如果沒有搜索詞或標題，不過濾

    const normalizedTitle = title.toLowerCase();
    const normalizedQuery = query.toLowerCase();

    return normalizedTitle.includes(normalizedQuery);
  };

  const allExactSearchResults = useMemo(() => {
    if (!exactSearch) return searchResults;

    return searchResults.filter((item) =>
      titleContainsQuery(item.title, submittedSearchQuery)
    );
  }, [searchResults, submittedSearchQuery, exactSearch]);

  // 聚合後的結果（按標題和年份分組）
  const aggregatedResults = useMemo(() => {
    //===== 階段1：按 normalizedTitle-type 初步分組 =====
    const preliminaryMap = new Map<string, SearchResult[]>();

    allExactSearchResults.forEach((item) => {
      const normalizedTitle = normalizeTitle(item.title);
      const type = getType(item);
      const preliminaryKey = `${normalizedTitle}-${type}`;

      const arr = preliminaryMap.get(preliminaryKey) || [];
      arr.push(item);
      preliminaryMap.set(preliminaryKey, arr);
    });

    //===== 階段2：智能年份推斷和最終分組 =====
    const finalMap = new Map<string, SearchResult[]>();
    const keyOrder: string[] = [];

    preliminaryMap.forEach((group, preliminaryKey) => {
      // 分離有年份和無年份的結果
      const withYear = new Map<string, SearchResult[]>();
      const withoutYear: SearchResult[] = [];

      group.forEach((item) => {
        const year = item.year;

        // 判斷是否為有效年份：必須是4位數字，且不能是空字符串或'unknown'
        if (
          year &&
          year.trim() !== '' &&
          year !== 'unknown' &&
          /^\d{4}$/.test(year)
        ) {
          // 有有效年份
          const arr = withYear.get(year) || [];
          arr.push(item);
          withYear.set(year, arr);
        } else {
          // 無年份（包括空字符串、'unknown'、null、undefined等）
          withoutYear.push(item);
        }
      });

      // 如果有有效年份組
      if (withYear.size > 0) {
        // 將無年份的結果複製到每個有年份的組中
        withYear.forEach((yearGroup, year) => {
          const finalKey = `${preliminaryKey}-${year}`;
          // 合併：有年份的 + 無年份的（複製）
          const mergedGroup = [...yearGroup, ...withoutYear];
          finalMap.set(finalKey, mergedGroup);
          keyOrder.push(finalKey);
        });
      } else if (withoutYear.length > 0) {
        // 如果完全沒有年份信息，單獨成組
        const finalKey = `${preliminaryKey}-unknown`;
        finalMap.set(finalKey, withoutYear);
        keyOrder.push(finalKey);
      }
    });

    // 按出現順序返回聚合結果
    return keyOrder.map(
      (key) => [key, finalMap.get(key)!] as [string, SearchResult[]]
    );
  }, [allExactSearchResults]);

  // 當聚合結果變化時，如果某個聚合已存在，則調用其卡片 ref 的 set 方法增量更新
  useEffect(() => {
    aggregatedResults.forEach(([mapKey, group]) => {
      const stats = computeGroupStats(group);
      const prev = groupStatsRef.current.get(mapKey);
      if (!prev) {
        // 第一次出現，記錄初始值，不調用 ref（由初始 props 渲染）
        groupStatsRef.current.set(mapKey, stats);
        return;
      }
      // 對比變化並調用對應的 set 方法
      const ref = groupRefs.current.get(mapKey);
      if (ref && ref.current) {
        if (prev.episodes !== stats.episodes) {
          ref.current.setEpisodes(stats.episodes);
        }
        const prevNames = (prev.source_names || []).join('|');
        const nextNames = (stats.source_names || []).join('|');
        if (prevNames !== nextNames) {
          ref.current.setSourceNames(stats.source_names);
        }
        if (prev.douban_id !== stats.douban_id) {
          ref.current.setDoubanId(stats.douban_id);
        }
        groupStatsRef.current.set(mapKey, stats);
      }
    });
  }, [aggregatedResults]);

  // 構建篩選選項
  const filterOptions = useMemo(() => {
    const exactSearchFiltered = exactSearch
      ? searchResults.filter((item) =>
          titleContainsQuery(item.title, currentQueryRef.current)
        )
      : searchResults;

    const buildSourceOptions = (
      sourceEntries: Array<{ source: string; source_name: string }>
    ) => [
      { label: '全部來源', value: 'all' },
      ...Array.from(
        new Map(
          sourceEntries
            .filter(
              (item) =>
                item.source &&
                item.source_name &&
                item.source.trim() !== '' &&
                item.source_name.trim() !== ''
            )
            .map((item) => [item.source, item.source_name])
        ).entries()
      )
        .sort((a, b) => {
          const aIsOpenList = a[0] === 'openlist';
          const bIsOpenList = b[0] === 'openlist';
          const aIsEmby = a[0] === 'emby' || a[0].startsWith('emby_');
          const bIsEmby = b[0] === 'emby' || b[0].startsWith('emby_');

          const aPriority = aIsOpenList ? 100 : aIsEmby ? 90 : 0;
          const bPriority = bIsOpenList ? 100 : bIsEmby ? 90 : 0;

          if (aPriority !== bPriority) {
            return bPriority - aPriority;
          }

          return a[1].localeCompare(b[1]);
        })
        .map(([value, label]) => ({ label, value })),
    ];

    const buildTitleOptions = (titles: string[]) => [
      { label: '全部標題', value: 'all' },
      ...Array.from(new Set(titles))
        .filter((title) => title && title.trim() !== '')
        .sort((a, b) => a.localeCompare(b))
        .map((title) => ({ label: title, value: title })),
    ];

    const buildYearOptions = (years: string[]) => {
      const yearSet = Array.from(
        new Set(years.filter((year) => year && year.trim() !== ''))
      );
      const knownYears = yearSet
        .filter((year) => year !== 'unknown')
        .sort((a, b) => parseInt(b) - parseInt(a));
      const hasUnknown = yearSet.includes('unknown');

      return [
        { label: '全部年份', value: 'all' },
        ...knownYears.map((year) => ({ label: year, value: year })),
        ...(hasUnknown ? [{ label: '未知', value: 'unknown' }] : []),
      ];
    };

    const allForSourceOptions = exactSearchFiltered.filter((item) => {
      if (filterAll.title !== 'all' && item.title !== filterAll.title)
        return false;
      if (filterAll.year !== 'all' && item.year !== filterAll.year)
        return false;
      return true;
    });

    const allForTitleOptions = exactSearchFiltered.filter((item) => {
      if (filterAll.source !== 'all' && item.source !== filterAll.source)
        return false;
      if (filterAll.year !== 'all' && item.year !== filterAll.year)
        return false;
      return true;
    });

    const allForYearOptions = exactSearchFiltered.filter((item) => {
      if (filterAll.source !== 'all' && item.source !== filterAll.source)
        return false;
      if (filterAll.title !== 'all' && item.title !== filterAll.title)
        return false;
      return true;
    });

    const aggForSourceOptions = aggregatedResults.filter(([_, group]) => {
      const gTitle = group[0]?.title ?? '';
      const gYear = group[0]?.year ?? 'unknown';
      if (filterAgg.title !== 'all' && gTitle !== filterAgg.title) return false;
      if (filterAgg.year !== 'all' && gYear !== filterAgg.year) return false;
      return true;
    });

    const aggForTitleOptions = aggregatedResults.filter(([_, group]) => {
      const gYear = group[0]?.year ?? 'unknown';
      const hasSource =
        filterAgg.source === 'all'
          ? true
          : group.some((item) => item.source === filterAgg.source);
      if (!hasSource) return false;
      if (filterAgg.year !== 'all' && gYear !== filterAgg.year) return false;
      return true;
    });

    const aggForYearOptions = aggregatedResults.filter(([_, group]) => {
      const gTitle = group[0]?.title ?? '';
      const hasSource =
        filterAgg.source === 'all'
          ? true
          : group.some((item) => item.source === filterAgg.source);
      if (!hasSource) return false;
      if (filterAgg.title !== 'all' && gTitle !== filterAgg.title) return false;
      return true;
    });

    const categoriesAll: SearchFilterCategory[] = [
      {
        key: 'source',
        label: '來源',
        options: buildSourceOptions(
          allForSourceOptions.map((item) => ({
            source: item.source,
            source_name: item.source_name,
          }))
        ),
      },
      {
        key: 'title',
        label: '標題',
        options: buildTitleOptions(
          allForTitleOptions.map((item) => item.title)
        ),
      },
      {
        key: 'year',
        label: '年份',
        options: buildYearOptions(allForYearOptions.map((item) => item.year)),
      },
    ];

    const categoriesAgg: SearchFilterCategory[] = [
      {
        key: 'source',
        label: '來源',
        options: buildSourceOptions(
          aggForSourceOptions.flatMap(([_, group]) =>
            group.map((item) => ({
              source: item.source,
              source_name: item.source_name,
            }))
          )
        ),
      },
      {
        key: 'title',
        label: '標題',
        options: buildTitleOptions(
          aggForTitleOptions.map(([_, group]) => group[0]?.title ?? '')
        ),
      },
      {
        key: 'year',
        label: '年份',
        options: buildYearOptions(
          aggForYearOptions.map(([_, group]) => group[0]?.year ?? 'unknown')
        ),
      },
    ];

    return { categoriesAll, categoriesAgg };
  }, [searchResults, aggregatedResults, exactSearch, filterAll, filterAgg]);

  // 非聚合：應用篩選與排序
  const filteredAllResults = useMemo(() => {
    const { source, title, year, yearOrder } = filterAll;

    const filtered = allExactSearchResults.filter((item) => {
      if (source !== 'all' && item.source !== source) return false;
      if (title !== 'all' && item.title !== title) return false;
      if (year !== 'all' && item.year !== year) return false;
      return true;
    });

    // 如果是無排序狀態，直接返回過濾後的原始順序
    if (yearOrder === 'none') {
      return filtered;
    }

    // 簡化排序：1. 年份排序，2. 年份相同時精確匹配在前，3. 標題排序
    return filtered.sort((a, b) => {
      // 首先按年份排序
      const yearComp = compareYear(a.year, b.year, yearOrder);
      if (yearComp !== 0) return yearComp;

      // 年份相同時，精確匹配在前
      const aExactMatch = a.title === searchQuery.trim();
      const bExactMatch = b.title === searchQuery.trim();
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      // 最後按標題排序，正序時字母序，倒序時反字母序
      return yearOrder === 'asc'
        ? a.title.localeCompare(b.title)
        : b.title.localeCompare(a.title);
    });
  }, [allExactSearchResults, filterAll, searchQuery]);

  // 聚合：應用篩選與排序
  const filteredAggResults = useMemo(() => {
    const { source, title, year, yearOrder } = filterAgg as any;
    const filtered = aggregatedResults.filter(([_, group]) => {
      const gTitle = group[0]?.title ?? '';
      const gYear = group[0]?.year ?? 'unknown';
      const hasSource =
        source === 'all' ? true : group.some((item) => item.source === source);
      if (!hasSource) return false;
      if (title !== 'all' && gTitle !== title) return false;
      if (year !== 'all' && gYear !== year) return false;
      return true;
    });

    // 如果是無排序狀態，保持按關鍵字+年份+類型出現的原始順序
    if (yearOrder === 'none') {
      return filtered;
    }

    // 簡化排序：1. 年份排序，2. 年份相同時精確匹配在前，3. 標題排序
    return filtered.sort((a, b) => {
      // 首先按年份排序
      const aYear = a[1][0].year;
      const bYear = b[1][0].year;
      const yearComp = compareYear(aYear, bYear, yearOrder);
      if (yearComp !== 0) return yearComp;

      // 年份相同時，精確匹配在前
      const aExactMatch = a[1][0].title === searchQuery.trim();
      const bExactMatch = b[1][0].title === searchQuery.trim();
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      // 最後按標題排序，正序時字母序，倒序時反字母序
      const aTitle = a[1][0].title;
      const bTitle = b[1][0].title;
      return yearOrder === 'asc'
        ? aTitle.localeCompare(bTitle)
        : bTitle.localeCompare(aTitle);
    });
  }, [aggregatedResults, filterAgg, searchQuery]);

  const useVirtualGrid = useMemo(() => {
    const cardCount =
      viewMode === 'agg'
        ? filteredAggResults.length
        : filteredAllResults.length;
    return resultDisplayMode === 'card' && cardCount >= 100;
  }, [
    viewMode,
    resultDisplayMode,
    filteredAggResults.length,
    filteredAllResults.length,
  ]);

  const resultCountMeta = useMemo(() => {
    const isAggregateView = viewMode === 'agg';
    const visibleCount = isAggregateView
      ? filteredAggResults.length
      : filteredAllResults.length;
    const totalCount = isAggregateView
      ? aggregatedResults.length
      : allExactSearchResults.length;

    return {
      visibleCount,
      totalCount,
      isFiltered: visibleCount !== totalCount,
      modeLabel: isAggregateView ? '聚合結果' : '搜索結果',
      unit: isAggregateView ? '組' : '條',
    };
  }, [
    viewMode,
    filteredAggResults.length,
    filteredAllResults.length,
    aggregatedResults.length,
    allExactSearchResults.length,
  ]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('searchResultDisplayMode', resultDisplayMode);
    }
  }, [resultDisplayMode]);

  const getSearchResultUrl = (params: {
    title: string;
    year?: string;
    type?: string;
    source?: string;
    id?: string;
    query?: string;
    isAggregate?: boolean;
  }) => {
    const yearParam =
      params.year && params.year !== 'unknown' ? `&year=${params.year}` : '';
    const queryParam = params.query
      ? `&stitle=${encodeURIComponent(params.query.trim())}`
      : '';
    const typeParam = params.type ? `&stype=${params.type}` : '';
    const preferParam = params.isAggregate ? '&prefer=true' : '';

    if (params.isAggregate || !params.source || !params.id) {
      return `/play?title=${encodeURIComponent(
        params.title.trim()
      )}${yearParam}${typeParam}${preferParam}${queryParam}`;
    }

    return `/play?source=${params.source}&id=${
      params.id
    }&title=${encodeURIComponent(
      params.title.trim()
    )}${yearParam}${preferParam}${queryParam}${typeParam}`;
  };

  const renderTag = (label: string, className: string) => (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium ${className}`}
    >
      {label}
    </span>
  );

  const renderListItem = (item: {
    key: string;
    title: string;
    poster: string;
    year?: string;
    type: 'movie' | 'tv';
    episodes?: number;
    sourceName?: string;
    sourceNames?: string[];
    doubanId?: number;
    desc?: string;
    vodRemarks?: string;
    isAggregate?: boolean;
    source?: string;
    id?: string;
    query?: string;
  }) => {
    const yearText = item.year && item.year !== 'unknown' ? item.year : '';
    const sourceTags = item.isAggregate
      ? Array.from(new Set(item.sourceNames || []))
      : item.sourceName
      ? [item.sourceName]
      : [];
    const isExpanded = !!expandedSourceTags[item.key];
    const maxVisibleSourceTags = 3;
    const visibleSourceTags = isExpanded
      ? sourceTags
      : sourceTags.slice(0, maxVisibleSourceTags);
    const hiddenSourceCount = Math.max(
      0,
      sourceTags.length - visibleSourceTags.length
    );
    const description = (item.desc || '').trim();
    const itemUrl = getSearchResultUrl({
      title: item.title,
      year: item.year,
      type: item.type,
      source: item.source,
      id: item.id,
      query: item.query,
      isAggregate: item.isAggregate,
    });

    return (
      <button
        key={item.key}
        type='button'
        onClick={() => router.push(itemUrl)}
        className='group w-full rounded-2xl border border-gray-200/80 bg-white/90 p-3 text-left shadow-sm transition-all hover:border-green-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900/70 dark:hover:border-green-700'
      >
        <div className='flex items-start gap-4'>
          <div className='relative h-32 w-24 shrink-0 overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800'>
            <ProxyImage
              originalSrc={item.poster}
              alt={item.title}
              className='h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]'
              loading='lazy'
              onClick={(e) => {
                e.stopPropagation();
                setPreviewImage({
                  url: processImageUrl(item.poster),
                  alt: item.title,
                });
              }}
            />
          </div>

          <div className='min-w-0 flex-1'>
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <h3 className='line-clamp-2 text-base font-semibold text-gray-900 dark:text-gray-100'>
                  {item.title}
                </h3>
                <div className='mt-2 flex flex-wrap gap-2'>
                  {renderTag(
                    item.type === 'movie' ? '電影' : '劇集',
                    'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                  )}
                  {yearText &&
                    renderTag(
                      yearText,
                      'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    )}
                  {item.episodes &&
                    item.episodes > 0 &&
                    renderTag(
                      `${item.episodes}集`,
                      'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                    )}
                  {item.vodRemarks &&
                    renderTag(
                      item.vodRemarks,
                      'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    )}
                  {item.doubanId &&
                    item.doubanId > 0 &&
                    renderTag(
                      '豆瓣',
                      'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                    )}
                </div>
              </div>
            </div>

            {description && (
              <p className='mt-3 line-clamp-3 text-sm leading-6 text-gray-600 dark:text-gray-400'>
                {description}
              </p>
            )}
          </div>
        </div>

        {sourceTags.length > 0 && (
          <div
            className={`mt-3 flex gap-2 ${
              isExpanded ? 'flex-wrap' : 'flex-nowrap overflow-hidden'
            }`}
          >
            {visibleSourceTags.map((sourceName) => (
              <span
                key={`${item.key}-${sourceName}`}
                className='inline-flex max-w-full shrink-0 items-center truncate rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
                title={sourceName}
              >
                {sourceName}
              </span>
            ))}
            {hiddenSourceCount > 0 && (
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedSourceTags((prev) => ({
                    ...prev,
                    [item.key]: true,
                  }));
                }}
                className='inline-flex shrink-0 items-center rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50'
                aria-label={`展開剩餘${hiddenSourceCount}個來源`}
              >
                +{hiddenSourceCount}
              </button>
            )}
          </div>
        )}
      </button>
    );
  };

  // 監聽選項卡切換，自動執行搜索
  useEffect(() => {
    // 如果切換到網盤搜索選項卡，且有搜索關鍵詞，且已顯示結果，則觸發搜索
    if (activeTab === 'pansou' && searchQuery.trim() && showResults) {
      setTriggerPansouSearch((prev) => !prev);
    }
    // 如果切換到 ACG 磁力搜索選項卡，且有搜索關鍵詞，且已顯示結果，則觸發搜索
    if (activeTab === 'acg' && searchQuery.trim() && showResults) {
      setTriggerAcgSearch((prev) => !prev);
    }
  }, [activeTab]);

  useEffect(() => {
    // 獲取用戶權限
    const authInfo = getAuthInfoFromBrowserCookie();
    setUserRole(authInfo?.role || null);
    setNetdiskSearchEnabled(
      !!(window as any).RUNTIME_CONFIG?.NETDISK_SEARCH_ENABLED
    );
    setMagnetSearchEnabled(
      !!(window as any).RUNTIME_CONFIG?.MAGNET_SEARCH_ENABLED
    );

    // 初始化繁體轉簡體轉換器
    if (typeof window !== 'undefined') {
      import('opencc-js')
        .then((module) => {
          try {
            const OpenCC = module.default || module;
            const converter = OpenCC.Converter({ from: 'hk', to: 'cn' });
            converterRef.current = converter;
            setConverterReady(true);
          } catch (error) {
            console.error('初始化繁體轉簡體轉換器失敗:', error);
            setConverterReady(true); // 即使失敗也設置為 true，避免阻塞
          }
        })
        .catch((error) => {
          console.error('加載 opencc-js 失敗:', error);
          setConverterReady(true); // 即使失敗也設置為 true，避免阻塞
        });
    } else {
      setConverterReady(true);
    }

    // 初始加載搜索歷史
    getSearchHistory().then(setSearchHistory);

    // 讀取流式搜索設置
    if (typeof window !== 'undefined') {
      const savedFluidSearch = localStorage.getItem('fluidSearch');
      const defaultFluidSearch =
        (window as any).RUNTIME_CONFIG?.FLUID_SEARCH !== false;
      if (savedFluidSearch !== null) {
        setUseFluidSearch(JSON.parse(savedFluidSearch));
      } else if (defaultFluidSearch !== undefined) {
        setUseFluidSearch(defaultFluidSearch);
      }

      // 讀取精確搜索設置
      const savedExactSearch = localStorage.getItem('exactSearch');
      if (savedExactSearch !== null) {
        setExactSearch(savedExactSearch === 'true');
      }
    }

    // 監聽搜索歷史更新事件
    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (newHistory: string[]) => {
        setSearchHistory(newHistory);
      }
    );

    // 獲取滾動位置的函數 - 專門針對 body 滾動
    const getScrollTop = () => {
      return document.body.scrollTop || 0;
    };

    // 使用 requestAnimationFrame 持續檢測滾動位置
    let isRunning = false;
    const checkScrollPosition = () => {
      if (!isRunning) return;

      const scrollTop = getScrollTop();
      const shouldShow = scrollTop > 300;
      setShowBackToTop(shouldShow);

      requestAnimationFrame(checkScrollPosition);
    };

    // 啟動持續檢測
    isRunning = true;
    checkScrollPosition();

    // 監聽 body 元素的滾動事件
    const handleScroll = () => {
      const scrollTop = getScrollTop();
      setShowBackToTop(scrollTop > 300);
    };

    document.body.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      unsubscribe();
      isRunning = false; // 停止 requestAnimationFrame 循環

      // 移除 body 滾動事件監聽器
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    const typeParam = searchParams.get('type');
    const query = searchParams.get('q');

    if (typeParam === 'pansou') {
      if (netdiskSearchEnabled) {
        setActiveTab('pansou');
      } else {
        setActiveTab('video');
      }
    } else if (typeParam === 'acg') {
      if (magnetSearchEnabled) {
        setActiveTab('acg');
      } else {
        setActiveTab('video');
      }
    } else {
      setActiveTab('video');
    }

    if (!query) {
      document.getElementById('searchInput')?.focus();
    }
  }, [searchParams, netdiskSearchEnabled, magnetSearchEnabled]);

  useEffect(() => {
    // 等待轉換器初始化完成
    if (!converterReady) {
      return;
    }

    // 當搜索參數變化時更新搜索狀態
    let query = searchParams.get('q') || '';

    // 如果開啟了繁體轉簡體，進行轉換
    if (query && typeof window !== 'undefined') {
      const searchTraditionalToSimplified = localStorage.getItem(
        'searchTraditionalToSimplified'
      );

      if (searchTraditionalToSimplified === 'true' && converterRef.current) {
        try {
          const originalQuery = query;
          query = converterRef.current(query);

          // 如果轉換後的文本與原文本不同，更新 URL
          if (originalQuery !== query) {
            const trimmedConverted = query.trim();
            // 使用 replace 而不是 push，避免在歷史記錄中留下繁體版本
            router.replace(
              `/search?q=${encodeURIComponent(trimmedConverted)}${
                searchParams.get('type')
                  ? `&type=${searchParams.get('type')}`
                  : ''
              }`
            );
            return; // 等待 URL 更新後重新觸發此 effect
          }
        } catch (error) {
          console.error('[URL參數監聽] 繁體轉簡體轉換失敗:', error);
        }
      }
    }

    currentQueryRef.current = query.trim();

    if (query) {
      setSearchQuery(query);

      const trimmed = query.trim();

      // 檢查是否有緩存且不是強制刷新
      if (!forceRefresh) {
        const cachedResults = getCachedResults(trimmed);
        if (cachedResults && cachedResults.length > 0) {
          // 使用緩存的結果
          setIsLoading(false); // 先設置加載狀態為 false
          setSearchResults(cachedResults);
          setShowResults(true);
          setTotalSources(1);
          setCompletedSources(1);
          setShowSuggestions(false);
          setIsFromCache(true); // 標記為緩存結果
          // 保存到搜索歷史
          addSearchHistory(query);
          return;
        }
      }

      // 如果是強制刷新，清除緩存
      if (forceRefresh) {
        clearCachedResults(trimmed);
        setForceRefresh(false);
      }

      // 開始新搜索時，重置緩存標記
      setIsFromCache(false);

      // 新搜索：關閉舊連接並清空結果
      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.close();
        } catch {}
        eventSourceRef.current = null;
      }
      // 先設置加載狀態，再清空結果，避免短暫顯示"暫無搜索結果"
      setIsLoading(true);
      setShowResults(true);
      setSearchResults([]);
      setTotalSources(0);
      setCompletedSources(0);
      // 清理緩衝
      pendingResultsRef.current = [];
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      // 每次搜索時重新讀取設置，確保使用最新的配置
      let currentFluidSearch = useFluidSearch;
      if (typeof window !== 'undefined') {
        const savedFluidSearch = localStorage.getItem('fluidSearch');
        if (savedFluidSearch !== null) {
          currentFluidSearch = JSON.parse(savedFluidSearch);
        } else {
          const defaultFluidSearch =
            (window as any).RUNTIME_CONFIG?.FLUID_SEARCH !== false;
          currentFluidSearch = defaultFluidSearch;
        }
      }

      // 如果讀取的配置與當前狀態不同，更新狀態
      if (currentFluidSearch !== useFluidSearch) {
        setUseFluidSearch(currentFluidSearch);
      }

      if (currentFluidSearch) {
        // 流式搜索：打開新的流式連接
        const es = new EventSource(
          `/api/search/ws?q=${encodeURIComponent(trimmed)}`
        );
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          if (!event.data) return;
          try {
            const payload = JSON.parse(event.data);
            if (currentQueryRef.current !== trimmed) return;
            switch (payload.type) {
              case 'start':
                setTotalSources(payload.totalSources || 0);
                setCompletedSources(0);
                break;
              case 'source_result': {
                setCompletedSources((prev) => prev + 1);
                if (
                  Array.isArray(payload.results) &&
                  payload.results.length > 0
                ) {
                  // 緩衝新增結果，節流刷入，避免頻繁重渲染導致閃爍
                  const activeYearOrder =
                    viewMode === 'agg'
                      ? filterAgg.yearOrder
                      : filterAll.yearOrder;
                  const incoming: SearchResult[] =
                    activeYearOrder === 'none'
                      ? sortBatchForNoOrder(payload.results as SearchResult[])
                      : (payload.results as SearchResult[]);
                  pendingResultsRef.current.push(...incoming);
                  if (!flushTimerRef.current) {
                    flushTimerRef.current = window.setTimeout(() => {
                      const toAppend = pendingResultsRef.current;
                      pendingResultsRef.current = [];
                      startTransition(() => {
                        setSearchResults((prev) => prev.concat(toAppend));
                      });
                      flushTimerRef.current = null;
                    }, 80);
                  }
                }
                break;
              }
              case 'source_error':
                setCompletedSources((prev) => prev + 1);
                break;
              case 'complete':
                setCompletedSources(payload.completedSources || totalSources);
                // 完成前確保將緩衝寫入
                if (pendingResultsRef.current.length > 0) {
                  const toAppend = pendingResultsRef.current;
                  pendingResultsRef.current = [];
                  if (flushTimerRef.current) {
                    clearTimeout(flushTimerRef.current);
                    flushTimerRef.current = null;
                  }
                  startTransition(() => {
                    setSearchResults((prev) => {
                      const newResults = prev.concat(toAppend);
                      // 緩存完整的搜索結果
                      setCachedResults(trimmed, newResults);
                      return newResults;
                    });
                  });
                } else {
                  // 即使沒有待寫入的緩衝，也緩存當前結果
                  setSearchResults((prev) => {
                    setCachedResults(trimmed, prev);
                    return prev;
                  });
                }
                setIsLoading(false);
                try {
                  es.close();
                } catch {}
                if (eventSourceRef.current === es) {
                  eventSourceRef.current = null;
                }
                break;
            }
          } catch {}
        };

        es.onerror = () => {
          setIsLoading(false);
          // 錯誤時也清空緩衝
          if (pendingResultsRef.current.length > 0) {
            const toAppend = pendingResultsRef.current;
            pendingResultsRef.current = [];
            if (flushTimerRef.current) {
              clearTimeout(flushTimerRef.current);
              flushTimerRef.current = null;
            }
            startTransition(() => {
              setSearchResults((prev) => prev.concat(toAppend));
            });
          }
          try {
            es.close();
          } catch {}
          if (eventSourceRef.current === es) {
            eventSourceRef.current = null;
          }
        };
      } else {
        // 傳統搜索：使用普通接口
        fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
          .then((response) => response.json())
          .then((data) => {
            if (currentQueryRef.current !== trimmed) return;

            if (data.results && Array.isArray(data.results)) {
              const activeYearOrder =
                viewMode === 'agg' ? filterAgg.yearOrder : filterAll.yearOrder;
              const results: SearchResult[] =
                activeYearOrder === 'none'
                  ? sortBatchForNoOrder(data.results as SearchResult[])
                  : (data.results as SearchResult[]);

              setSearchResults(results);
              // 緩存搜索結果
              setCachedResults(trimmed, results);
              setTotalSources(1);
              setCompletedSources(1);
            }
            setIsLoading(false);
          })
          .catch(() => {
            setIsLoading(false);
          });
      }
      setShowSuggestions(false);

      // 保存到搜索歷史 (事件監聽會自動更新界面)
      addSearchHistory(query);
    } else {
      setShowResults(false);
      setShowSuggestions(false);
    }
  }, [searchParams, forceRefresh, converterReady]);

  useEffect(() => {
    const typeParam = searchParams.get('type');
    const query = searchParams.get('q');
    if (!query || !query.trim()) return;

    if (typeParam === 'pansou' && netdiskSearchEnabled) {
      setSearchQuery(query);
      setShowResults(true);
      setTimeout(() => {
        setTriggerPansouSearch((prev) => !prev);
      }, 100);
    } else if (typeParam === 'acg' && magnetSearchEnabled) {
      setSearchQuery(query);
      setShowResults(true);
      setTimeout(() => {
        setTriggerAcgSearch((prev) => !prev);
      }, 100);
    }
  }, [searchParams, netdiskSearchEnabled, magnetSearchEnabled]);

  // 組件卸載時，關閉可能存在的連接
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.close();
        } catch {}
        eventSourceRef.current = null;
      }
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingResultsRef.current = [];
    };
  }, []);

  // 輸入框內容變化時觸發，顯示搜索建議
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);

    if (value.trim()) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  // 搜索框聚焦時觸發，顯示搜索建議
  const handleInputFocus = () => {
    if (searchQuery.trim()) {
      setShowSuggestions(true);
    }
  };

  // 搜索表單提交時觸發，處理搜索邏輯
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    let trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;

    // 如果開啟了繁體轉簡體，進行轉換
    if (typeof window !== 'undefined') {
      const searchTraditionalToSimplified = localStorage.getItem(
        'searchTraditionalToSimplified'
      );
      if (searchTraditionalToSimplified === 'true' && converterRef.current) {
        try {
          trimmed = converterRef.current(trimmed);
        } catch (error) {
          console.error('繁體轉簡體轉換失敗:', error);
        }
      }
    }

    // 回顯搜索框
    setSearchQuery(trimmed);
    setShowResults(true);
    setShowSuggestions(false);
    // 立即設置加載狀態，避免顯示"未找到相關結果"
    setIsLoading(true);

    // 根據當前選項卡執行不同的搜索
    if (activeTab === 'video') {
      // 影視搜索
      router.push(`/search?q=${encodeURIComponent(trimmed)}&type=video`);
      // 其餘由 searchParams 變化的 effect 處理
    } else if (activeTab === 'pansou') {
      // 網盤搜索 - 觸發搜索
      router.push(`/search?q=${encodeURIComponent(trimmed)}&type=pansou`);
      setTriggerPansouSearch((prev) => !prev); // 切換狀態來觸發搜索
    } else if (activeTab === 'acg') {
      // ACG 磁力搜索 - 觸發搜索
      router.push(`/search?q=${encodeURIComponent(trimmed)}&type=acg`);
      setTriggerAcgSearch((prev) => !prev);
    }
  };

  const handleSuggestionSelect = (suggestion: string) => {
    let processedSuggestion = suggestion;

    // 如果開啟了繁體轉簡體，進行轉換
    if (typeof window !== 'undefined') {
      const searchTraditionalToSimplified = localStorage.getItem(
        'searchTraditionalToSimplified'
      );
      if (searchTraditionalToSimplified === 'true' && converterRef.current) {
        try {
          processedSuggestion = converterRef.current(suggestion);
        } catch (error) {
          console.error('繁體轉簡體轉換失敗:', error);
        }
      }
    }

    setSearchQuery(processedSuggestion);
    setShowSuggestions(false);

    // 自動執行搜索
    setShowResults(true);
    // 立即設置加載狀態，避免顯示"未找到相關結果"
    setIsLoading(true);

    // 根據當前選項卡執行不同的搜索
    if (activeTab === 'video') {
      // 影視搜索
      router.push(
        `/search?q=${encodeURIComponent(processedSuggestion)}&type=video`
      );
      // 其餘由 searchParams 變化的 effect 處理
    } else if (activeTab === 'pansou') {
      // 網盤搜索 - 觸發搜索
      router.push(
        `/search?q=${encodeURIComponent(processedSuggestion)}&type=pansou`
      );
      setTriggerPansouSearch((prev) => !prev);
    } else if (activeTab === 'acg') {
      // ACG 磁力搜索 - 觸發搜索
      router.push(
        `/search?q=${encodeURIComponent(processedSuggestion)}&type=acg`
      );
      setTriggerAcgSearch((prev) => !prev);
    }
  };

  // 返回頂部功能
  const scrollToTop = () => {
    try {
      // 根據調試結果，真正的滾動容器是 document.body
      document.body.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } catch (error) {
      // 如果平滑滾動完全失敗，使用立即滾動
      document.body.scrollTop = 0;
    }
  };

  // 處理標籤切換
  const handleTabChange = (newTab: 'video' | 'pansou' | 'acg') => {
    setActiveTab(newTab);

    // 如果有搜索關鍵詞，更新 URL
    const currentQuery = searchParams.get('q');
    if (currentQuery) {
      router.push(
        `/search?q=${encodeURIComponent(currentQuery)}&type=${newTab}`
      );
    }
  };

  return (
    <PageLayout activePath='/search'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10'>
        {/* 搜索框 */}
        <div className='mb-8'>
          <form onSubmit={handleSearch} className='max-w-2xl mx-auto'>
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500' />
              <input
                id='searchInput'
                type='text'
                value={searchQuery}
                onChange={handleInputChange}
                onFocus={handleInputFocus}
                placeholder='搜索電影、電視劇...'
                autoComplete='off'
                className='w-full h-12 rounded-lg bg-gray-50/80 py-3 pl-10 pr-12 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:bg-white border border-gray-200/50 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 dark:border-gray-700'
              />

              {/* 清除按鈕 */}
              {searchQuery && (
                <button
                  type='button'
                  onClick={() => {
                    setSearchQuery('');
                    setShowSuggestions(false);
                    document.getElementById('searchInput')?.focus();
                  }}
                  className='absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors dark:text-gray-500 dark:hover:text-gray-300'
                  aria-label='清除搜索內容'
                >
                  <X className='h-5 w-5' />
                </button>
              )}

              {/* 搜索建議 */}
              <SearchSuggestions
                query={searchQuery}
                isVisible={showSuggestions}
                onSelect={handleSuggestionSelect}
                onClose={() => setShowSuggestions(false)}
                onEnterKey={() => {
                  // 當用戶按回車鍵時，使用搜索框的實際內容進行搜索
                  const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
                  if (!trimmed) return;

                  // 回顯搜索框
                  setSearchQuery(trimmed);
                  setShowResults(true);
                  setShowSuggestions(false);
                  router.push(
                    `/search?q=${encodeURIComponent(trimmed)}&type=${activeTab}`
                  );
                }}
              />
            </div>
          </form>

          {/* 選項卡 */}
          <div className='flex justify-center mt-6'>
            <CapsuleSwitch
              options={[
                {
                  label: '影視搜索',
                  value: 'video',
                  icon: <Film size={16} />,
                },
                ...(netdiskSearchEnabled
                  ? [
                      {
                        label: '網盤搜索',
                        value: 'pansou' as const,
                        icon: <HardDrive size={16} />,
                      },
                    ]
                  : []),
                ...(magnetSearchEnabled
                  ? [
                      {
                        label: '動漫磁力',
                        value: 'acg' as const,
                        icon: <Magnet size={16} />,
                      },
                    ]
                  : []),
              ]}
              active={activeTab}
              onChange={(value) =>
                handleTabChange(value as 'video' | 'pansou' | 'acg')
              }
            />
          </div>
        </div>

        {/* 搜索結果或搜索歷史 */}
        <div className='max-w-[95%] mx-auto mt-12 overflow-visible'>
          {showResults ? (
            <section className='mb-12'>
              {activeTab === 'video' ? (
                <>
                  {/* 影視搜索結果 */}
                  {/* 標題 */}
                  <div className='mb-4 flex items-start justify-between gap-4'>
                    <div className='min-w-0'>
                      <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                        搜索結果
                        {isFromCache ? (
                          <span className='ml-2 rounded-md bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600 dark:bg-green-900/30 dark:text-green-400'>
                            緩存
                          </span>
                        ) : (
                          <>
                            {totalSources > 0 && useFluidSearch && (
                              <span className='ml-2 text-sm font-normal text-gray-500 dark:text-gray-400'>
                                源 {completedSources}/{totalSources}
                              </span>
                            )}
                            {isLoading && useFluidSearch && (
                              <span className='ml-2 inline-block align-middle'>
                                <span className='inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-green-500'></span>
                              </span>
                            )}
                          </>
                        )}
                      </h2>
                      <div className='mt-2 flex flex-wrap items-center gap-2 text-xs'>
                        <span className='inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200'>
                          {resultCountMeta.modeLabel}{' '}
                          {resultCountMeta.visibleCount.toLocaleString()}{' '}
                          {resultCountMeta.unit}
                        </span>
                        {resultCountMeta.isFiltered && (
                          <span className='inline-flex items-center rounded-full bg-white/80 px-2.5 py-1 font-medium text-gray-500 ring-1 ring-gray-200 dark:bg-gray-900/70 dark:text-gray-400 dark:ring-gray-700'>
                            篩選前{' '}
                            {resultCountMeta.totalCount.toLocaleString()}{' '}
                            {resultCountMeta.unit}
                          </span>
                        )}
                      </div>
                    </div>
                    {searchQuery && (
                      <button
                        onClick={() => {
                          setForceRefresh(true);
                        }}
                        disabled={isLoading}
                        className='flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-green-50 hover:text-green-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-green-400'
                        aria-label='強制刷新搜索結果'
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${
                            isLoading ? 'animate-spin' : ''
                          }`}
                        />
                        <span>刷新</span>
                      </button>
                    )}
                  </div>
                  <div className='mb-4 flex items-center gap-3'>
                    <div className='min-w-0 flex-1'>
                      {viewMode === 'agg' ? (
                        <SearchResultFilter
                          categories={filterOptions.categoriesAgg}
                          values={filterAgg}
                          onChange={(v) => setFilterAgg(v as any)}
                        />
                      ) : (
                        <SearchResultFilter
                          categories={filterOptions.categoriesAll}
                          values={filterAll}
                          onChange={(v) => setFilterAll(v as any)}
                        />
                      )}
                    </div>
                    <div className='flex shrink-0 items-center justify-end self-center'>
                      <label className='flex shrink-0 cursor-pointer select-none items-center gap-2'>
                        <span className='text-xs text-gray-700 dark:text-gray-300 sm:text-sm'>
                          聚合
                        </span>
                        <div className='relative'>
                          <input
                            type='checkbox'
                            className='peer sr-only'
                            checked={viewMode === 'agg'}
                            onChange={() =>
                              setViewMode(viewMode === 'agg' ? 'all' : 'agg')
                            }
                          />
                          <div className='h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500 dark:bg-gray-600'></div>
                          <div className='absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4'></div>
                        </div>
                      </label>
                    </div>
                  </div>
                  <div className='mb-8 flex justify-center'>
                    <div className='inline-flex items-center rounded-xl border border-gray-200 bg-white p-1 shadow-sm dark:border-gray-700 dark:bg-gray-900'>
                      <button
                        type='button'
                        onClick={() => setResultDisplayMode('card')}
                        className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                          resultDisplayMode === 'card'
                            ? 'bg-green-500 text-white'
                            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                        }`}
                        aria-label='切換為卡片視圖'
                      >
                        <Grid2x2 className='h-4 w-4' />
                        <span>卡片</span>
                      </button>
                      <button
                        type='button'
                        onClick={() => setResultDisplayMode('list')}
                        className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                          resultDisplayMode === 'list'
                            ? 'bg-green-500 text-white'
                            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                        }`}
                        aria-label='切換為列表視圖'
                      >
                        <List className='h-4 w-4' />
                        <span>列表</span>
                      </button>
                    </div>
                  </div>
                  {searchResults.length === 0 ? (
                    isLoading ? (
                      <div className='flex justify-center items-center h-40'>
                        <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
                      </div>
                    ) : (
                      <div className='text-center text-gray-500 py-8 dark:text-gray-400'>
                        未找到相關結果
                      </div>
                    )
                  ) : (
                    (() => {
                      const gridClassName =
                        'justify-start grid grid-cols-3 gap-x-2 gap-y-14 px-0 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-20 sm:px-2';

                      const listClassName = 'space-y-4';

                      const resultChildren =
                        viewMode === 'agg'
                          ? filteredAggResults.map(([mapKey, group]) => {
                              const title = group[0]?.title || '';
                              const poster = group[0]?.poster || '';
                              const year = group[0]?.year || 'unknown';
                              const desc =
                                group.find((entry) => entry.desc?.trim())
                                  ?.desc || '';
                              const vodRemarks =
                                group.find((entry) => entry.vod_remarks?.trim())
                                  ?.vod_remarks || '';
                              const { episodes, source_names, douban_id } =
                                computeGroupStats(group);

                              const lastDashIndex = mapKey.lastIndexOf('-');
                              const secondLastDashIndex = mapKey.lastIndexOf(
                                '-',
                                lastDashIndex - 1
                              );
                              const type =
                                secondLastDashIndex > 0
                                  ? (mapKey.substring(
                                      secondLastDashIndex + 1,
                                      lastDashIndex
                                    ) as 'movie' | 'tv')
                                  : episodes === 1
                                  ? 'movie'
                                  : 'tv';

                              if (!groupStatsRef.current.has(mapKey)) {
                                groupStatsRef.current.set(mapKey, {
                                  episodes,
                                  source_names,
                                  douban_id,
                                });
                              }

                              if (resultDisplayMode === 'list') {
                                return renderListItem({
                                  key: `agg-${mapKey}`,
                                  title,
                                  poster,
                                  year,
                                  type,
                                  episodes,
                                  sourceNames: source_names,
                                  doubanId: douban_id,
                                  desc,
                                  vodRemarks,
                                  isAggregate: true,
                                  query:
                                    searchQuery.trim() !== title
                                      ? searchQuery.trim()
                                      : '',
                                });
                              }

                              return (
                                <div key={`agg-${mapKey}`} className='w-full'>
                                  <VideoCard
                                    ref={getGroupRef(mapKey)}
                                    from='search'
                                    isAggregate={true}
                                    title={title}
                                    poster={poster}
                                    year={year}
                                    episodes={episodes}
                                    source_names={source_names}
                                    douban_id={douban_id}
                                    query={
                                      searchQuery.trim() !== title
                                        ? searchQuery.trim()
                                        : ''
                                    }
                                    type={type}
                                  />
                                </div>
                              );
                            })
                          : filteredAllResults.map((item) => {
                              const type =
                                item.episodes.length > 1 ? 'tv' : 'movie';

                              if (resultDisplayMode === 'list') {
                                return renderListItem({
                                  key: `all-${item.source}-${item.id}`,
                                  id: item.id,
                                  title: item.title,
                                  poster: item.poster,
                                  episodes: item.episodes.length,
                                  source: item.source,
                                  sourceName: item.source_name,
                                  doubanId: item.douban_id,
                                  query:
                                    searchQuery.trim() !== item.title
                                      ? searchQuery.trim()
                                      : '',
                                  year: item.year,
                                  type,
                                  desc: item.desc,
                                  vodRemarks: item.vod_remarks,
                                });
                              }

                              return (
                                <div
                                  key={`all-${item.source}-${item.id}`}
                                  className='w-full'
                                >
                                  <VideoCard
                                    id={item.id}
                                    title={item.title}
                                    poster={item.poster}
                                    episodes={item.episodes.length}
                                    source={item.source}
                                    source_name={item.source_name}
                                    douban_id={item.douban_id}
                                    query={
                                      searchQuery.trim() !== item.title
                                        ? searchQuery.trim()
                                        : ''
                                    }
                                    year={item.year}
                                    from='search'
                                    type={type}
                                  />
                                </div>
                              );
                            });

                      if (useVirtualGrid) {
                        return (
                          <VirtualScrollableGrid
                            key={`search-results-virtual-${viewMode}`}
                            gridClassName={gridClassName}
                          >
                            {resultChildren}
                          </VirtualScrollableGrid>
                        );
                      }

                      return (
                        <div
                          key={`search-results-${viewMode}-${resultDisplayMode}`}
                          className={
                            resultDisplayMode === 'list'
                              ? listClassName
                              : gridClassName
                          }
                        >
                          {resultChildren}
                        </div>
                      );
                    })()
                  )}
                </>
              ) : activeTab === 'pansou' ? (
                <>
                  {/* 網盤搜索結果 */}
                  <div className='mb-4'>
                    <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                      網盤搜索結果
                    </h2>
                  </div>
                  <PansouSearch
                    keyword={searchQuery}
                    triggerSearch={triggerPansouSearch}
                  />
                </>
              ) : (
                <>
                  {/* ACG 磁力搜索結果 */}
                  <div className='mb-4'>
                    <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                      動漫磁力搜索結果
                    </h2>
                  </div>
                  <AcgSearch
                    keyword={searchQuery}
                    triggerSearch={triggerAcgSearch}
                  />
                </>
              )}
            </section>
          ) : searchHistory.length > 0 ? (
            // 搜索歷史
            <section className='mb-12'>
              <h2 className='mb-4 text-xl font-bold text-gray-800 text-left dark:text-gray-200'>
                搜索歷史
                {searchHistory.length > 0 && (
                  <button
                    onClick={() => {
                      clearSearchHistory(); // 事件監聽會自動更新界面
                    }}
                    className='ml-3 text-sm text-gray-500 hover:text-red-500 transition-colors dark:text-gray-400 dark:hover:text-red-500'
                  >
                    清空
                  </button>
                )}
              </h2>
              <div className='flex flex-wrap gap-2'>
                {searchHistory.map((item) => (
                  <div key={item} className='relative group'>
                    <button
                      onClick={() => {
                        setSearchQuery(item);
                        setShowResults(true);
                        // 立即設置加載狀態，避免顯示"未找到相關結果"
                        setIsLoading(true);

                        // 根據當前選項卡執行不同的搜索
                        if (activeTab === 'video') {
                          // 影視搜索
                          router.push(
                            `/search?q=${encodeURIComponent(
                              item.trim()
                            )}&type=video`
                          );
                        } else if (activeTab === 'pansou') {
                          // 網盤搜索
                          router.push(
                            `/search?q=${encodeURIComponent(
                              item.trim()
                            )}&type=pansou`
                          );
                          setTriggerPansouSearch((prev) => !prev);
                        } else if (activeTab === 'acg') {
                          // ACG 磁力搜索
                          router.push(
                            `/search?q=${encodeURIComponent(
                              item.trim()
                            )}&type=acg`
                          );
                          setTriggerAcgSearch((prev) => !prev);
                        }
                      }}
                      className='px-4 py-2 bg-gray-500/10 hover:bg-gray-300 rounded-full text-sm text-gray-700 transition-colors duration-200 dark:bg-gray-700/50 dark:hover:bg-gray-600 dark:text-gray-300'
                    >
                      {item}
                    </button>
                    {/* 刪除按鈕 */}
                    <button
                      aria-label='刪除搜索歷史'
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        deleteSearchHistory(item); // 事件監聽會自動更新界面
                      }}
                      className='absolute -top-1 -right-1 w-4 h-4 opacity-0 group-hover:opacity-100 bg-gray-400 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] transition-colors'
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {previewImage && (
        <ImageViewer
          isOpen={!!previewImage}
          onClose={() => setPreviewImage(null)}
          imageUrl={previewImage.url}
          alt={previewImage.alt}
        />
      )}

      {/* 返回頂部懸浮按鈕 */}
      <button
        onClick={scrollToTop}
        className={`fixed bottom-20 md:bottom-6 right-6 z-[500] w-12 h-12 bg-green-500/90 hover:bg-green-500 text-white rounded-full shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out flex items-center justify-center group ${
          showBackToTop
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        aria-label='返回頂部'
      >
        <ChevronUp className='w-6 h-6 transition-transform group-hover:scale-110' />
      </button>
    </PageLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageClient />
    </Suspense>
  );
}
