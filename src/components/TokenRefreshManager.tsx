'use client';

import { useEffect } from 'react';

import { getAuthInfoFromBrowserCookie, clearAuthCookie } from '@/lib/auth';
import { TOKEN_CONFIG } from '@/lib/refresh-token';

/**
 * Token 自動刷新管理器
 *
 * 功能：
 * 1. 攔截所有 fetch 請求
 * 2. 檢測到 401 錯誤時自動刷新 Token 並重試
 * 3. 在請求前檢查 Token 是否即將過期，主動刷新
 *
 * 策略：
 * - 響應攔截：401 錯誤 → 刷新 Token → 重試請求
 * - 請求攔截：剩餘時間 < 10 分鐘 → 主動刷新
 */
export function TokenRefreshManager() {
  useEffect(() => {
    // localStorage 模式不需要刷新
    const storageType = (window as any).RUNTIME_CONFIG?.STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return;
    }

    // 刷新狀態管理
    let isRefreshing = false;
    let refreshPromise: Promise<boolean> | null = null;

    // Token 刷新函數
    const refreshToken = async (): Promise<boolean> => {
      // 如果正在刷新，返回現有的 Promise
      if (isRefreshing && refreshPromise) {
        return refreshPromise;
      }

      isRefreshing = true;
      refreshPromise = (async () => {
        try {
          // 使用原始 fetch 避免遞歸
          const response = await window.fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include',
          });

          if (response.ok) {
            console.log('[Token] Refreshed successfully');
            return true;
          } else {
            console.error('[Token] Refresh failed:', response.status);

            // 刷新失敗，先登出再跳轉登錄
            if (response.status === 401 || response.status === 403) {
              // 如果在登錄頁面，跳過登出和跳轉邏輯
              if (window.location.pathname === '/login') {
                console.log('[Token] On login page, skipping logout and redirect');
                return false;
              }

              try {
                await window.fetch('/api/logout', {
                  method: 'POST',
                  credentials: 'include',
                });
              } catch (error) {
                console.error('[Token] Logout error:', error);
                // 登出失敗時清除前端cookie
                clearAuthCookie();
              }
              window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
            }
            return false;
          }
        } catch (error) {
          console.error('[Token] Refresh error:', error);
          return false;
        } finally {
          isRefreshing = false;
          refreshPromise = null;
        }
      })();

      return refreshPromise;
    };

    // 檢查 Token 是否需要刷新
    const shouldRefreshToken = (): boolean => {
      const authInfo = getAuthInfoFromBrowserCookie();
      if (!authInfo || !authInfo.timestamp || !authInfo.refreshExpires) {
        return false;
      }

      const now = Date.now();

      // Refresh Token 已過期
      if (now >= authInfo.refreshExpires) {
        console.log('[Token] Refresh token expired, redirecting to login');
        // 先登出再跳轉登錄
        window.fetch('/api/logout', {
          method: 'POST',
          credentials: 'include',
        }).catch(error => {
          console.error('[Token] Logout error:', error);
          // 登出失敗時清除前端cookie
          clearAuthCookie();
        }).finally(() => {
          window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        });
        return false;
      }

      // 計算 Access Token 剩餘時間
      const ACCESS_TOKEN_AGE = TOKEN_CONFIG.ACCESS_TOKEN_AGE;
      const age = now - authInfo.timestamp;
      const remaining = ACCESS_TOKEN_AGE - age;

      // 剩餘時間 < 刷新閾值時需要刷新（包括已過期的情況）
      const REFRESH_THRESHOLD = TOKEN_CONFIG.RENEWAL_THRESHOLD;
      return remaining < REFRESH_THRESHOLD;
    };

    // 保存原始 fetch
    const originalFetch = window.fetch;

    // 攔截 fetch
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      // 跳過不需要 Token 刷新的 API
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      // 跳過：刷新 API、登錄、登出、註冊等認證相關接口
      if (
        url.includes('/api/auth/refresh') ||
        url.includes('/api/login') ||
        url.includes('/api/logout') ||
        url.includes('/api/register') ||
        url.includes('/api/auth/oidc')
      ) {
        return originalFetch(input, init);
      }

      // 請求前檢查：Token 即將過期時主動刷新
      if (shouldRefreshToken()) {
        console.log('[Token] Expiring soon, refreshing proactively...');
        await refreshToken();
      }

      // 發送請求
      let response = await originalFetch(input, init);

      // 響應攔截：401 錯誤時刷新 Token 並重試（僅重試一次）
      if (response.status === 401) {
        // 如果在登錄頁面，跳過刷新邏輯
        if (window.location.pathname === '/login') {
          console.log('[Token] On login page, skipping refresh logic');
          return response;
        }

        // 克隆響應以便讀取響應體
        const clonedResponse = response.clone();

        try {
          const responseText = await clonedResponse.text();

          // 只有當響應體包含 "Unauthorized" 或 "Refresh token expired" 或 "Access token expired" 時才刷新
          if (responseText.includes('Unauthorized') || responseText.includes('Refresh token expired') || responseText.includes('Access token expired')) {
            console.log('[Token] Received 401 with auth error, attempting refresh and retry...');

            const refreshed = await refreshToken();

            if (refreshed) {
              // 刷新成功，重試原請求（僅此一次）
              response = await originalFetch(input, init);

              // 如果重試後仍然是 401，說明有問題，先登出再跳轉登錄
              if (response.status === 401) {
                console.error('[Token] Still 401 after refresh, redirecting to login');

                // 如果在登錄頁面，跳過登出和跳轉邏輯
                if (window.location.pathname === '/login') {
                  console.log('[Token] On login page, skipping logout and redirect');
                  return response;
                }

                try {
                  await originalFetch('/api/logout', {
                    method: 'POST',
                    credentials: 'include',
                  });
                } catch (error) {
                  console.error('[Token] Logout error:', error);
                  // 登出失敗時清除前端cookie
                  clearAuthCookie();
                }
                window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
              }
            }
          } else {
            console.log('[Token] Received 401 but not an auth error, skipping refresh');
          }
        } catch (error) {
          console.error('[Token] Failed to read response body:', error);
        }
      }

      return response;
    };

    // 清理：恢復原始 fetch
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  // 這是一個純邏輯組件，不渲染任何內容
  return null;
}
