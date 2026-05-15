'use client';

import { useEffect } from 'react';

import { initStartupCacheCleanup } from '@/lib/startup/cacheCleanup';

/**
 * 啟動緩存清理組件
 * 在應用啟動時異步執行一次緩存清理
 */
export function StartupCacheCleanup() {
  useEffect(() => {
    initStartupCacheCleanup();
  }, []);

  return null;
}
