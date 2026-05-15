'use client';

import { usePathname, useRouter,useSearchParams } from 'next/navigation';
import NProgress from 'nprogress';
import { useEffect, useRef } from 'react';

// 創建全局鉤子來攔截 router
let globalRouterRef: any = null;

export default function TopProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isNavigatingRef = useRef(false);
  const previousPathnameRef = useRef(pathname);

  useEffect(() => {
    // 配置 NProgress
    NProgress.configure({
      showSpinner: false,
      trickleSpeed: 200,
      minimum: 0.08,
      easing: 'ease',
      speed: 200,
    });

    // 保存原始的 router 方法
    globalRouterRef = router;
    const originalPush = router.push;
    const originalReplace = router.replace;
    const originalBack = router.back;
    const originalForward = router.forward;

    // 攔截 router.push
    router.push = function (...args: Parameters<typeof originalPush>) {
      const targetUrl = args[0] as string;
      const targetPathname = new URL(targetUrl, window.location.href).pathname;
      const currentPathname = window.location.pathname;

      // /play 和 /live 頁面：參數變化也顯示進度條
      // 其他頁面：僅路徑變化時顯示進度條
      if (currentPathname === '/play' || currentPathname === '/live' || targetPathname !== previousPathnameRef.current) {
        isNavigatingRef.current = true;
        NProgress.start();
      }
      return originalPush.apply(this, args);
    };

    // 攔截 router.replace
    router.replace = function (...args: Parameters<typeof originalReplace>) {
      const targetUrl = args[0] as string;
      const targetPathname = new URL(targetUrl, window.location.href).pathname;
      const currentPathname = window.location.pathname;

      // /play 和 /live 頁面：參數變化也顯示進度條
      // 其他頁面：僅路徑變化時顯示進度條
      if (currentPathname === '/play' || currentPathname === '/live' || targetPathname !== previousPathnameRef.current) {
        isNavigatingRef.current = true;
        NProgress.start();
      }
      return originalReplace.apply(this, args);
    };

    // 攔截 router.back
    router.back = function () {
      isNavigatingRef.current = true;
      NProgress.start();
      return originalBack.apply(this);
    };

    // 攔截 router.forward
    router.forward = function () {
      isNavigatingRef.current = true;
      NProgress.start();
      return originalForward.apply(this);
    };

    // 監聽所有鏈接點擊事件
    const handleAnchorClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const anchor = target.closest('a');

      if (anchor && anchor.href) {
        const currentUrl = window.location.href;
        const targetUrl = anchor.href;

        if (targetUrl !== currentUrl && !anchor.target && !anchor.download) {
          const currentOrigin = window.location.origin;
          try {
            const targetOrigin = new URL(targetUrl, currentOrigin).origin;
            const targetPathname = new URL(targetUrl, currentOrigin).pathname;
            if (currentOrigin === targetOrigin && targetPathname !== previousPathnameRef.current) {
              isNavigatingRef.current = true;
              NProgress.start();
            }
          } catch (e) {
            // URL 解析失敗，忽略
          }
        }
      }
    };

    // 監聽瀏覽器前進後退按鈕
    const handlePopState = () => {
      isNavigatingRef.current = true;
      NProgress.start();
    };

    document.addEventListener('click', handleAnchorClick, true);
    window.addEventListener('popstate', handlePopState);

    return () => {
      // 恢復原始方法
      if (globalRouterRef) {
        globalRouterRef.push = originalPush;
        globalRouterRef.replace = originalReplace;
        globalRouterRef.back = originalBack;
        globalRouterRef.forward = originalForward;
      }

      document.removeEventListener('click', handleAnchorClick, true);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [router]);

  useEffect(() => {
    // 僅在頁面路徑變化時結束進度條，參數變化不觸發
    if (isNavigatingRef.current) {
      NProgress.done();
      isNavigatingRef.current = false;
    }
    previousPathnameRef.current = pathname;
  }, [pathname, searchParams]);

  return null;
}
