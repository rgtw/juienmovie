/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Blend, Cat, Clover, Container, Film, Globe, Home, Star, Tv, TvMinimalPlay, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useWatchRoomContextSafe } from './WatchRoomProvider';

interface MobileBottomNavProps {
  /**
   * 主動?��?當�?激活�?路�??��??��?供時，自?�使??usePathname() ?��??�路徑�?   */
  activePath?: string;
}

const MobileBottomNav = ({ activePath }: MobileBottomNavProps) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const watchRoomContext = useWatchRoomContextSafe();

  // ?�接使用當�?路由?�態�?確�?立即?��?路由?��?
  const getCurrentFullPath = () => {
    const queryString = searchParams.toString();
    return queryString ? `${pathname}?${queryString}` : pathname;
  };
  const currentActive = activePath ?? getCurrentFullPath();

  if (pathname === '/watch-room/screen') {
    return null;
  }

  const [navItems, setNavItems] = useState([
    { icon: Home, label: '首頁', href: '/' },
    {
      icon: Film,
      label: '?�影',
      href: '/douban?type=movie',
    },
    {
      icon: Tv,
      label: '?��?',
      href: '/douban?type=tv',
    },
    {
      icon: Cat,
      label: '?�漫',
      href: '/douban?type=anime',
    },
    {
      icon: Clover,
      label: '綜藝',
      href: '/douban?type=show',
    },
      {
        icon: TvMinimalPlay,
        label: '?��??�播',
        href: '/live',
      },
  ]);

  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;

    // ?��?導航項�?不�??��?影室�?    const items = [
      { icon: Home, label: '首頁', href: '/' },
      {
        icon: Film,
        label: '?�影',
        href: '/douban?type=movie',
      },
      {
        icon: Tv,
        label: '?��?',
        href: '/douban?type=tv',
      },
      {
        icon: Cat,
        label: '?�漫',
        href: '/douban?type=anime',
      },
      {
        icon: Clover,
        label: '綜藝',
        href: '/douban?type=show',
      },
      ...(runtimeConfig?.LIVE_ENABLED
        ? [
            {
              icon: TvMinimalPlay,
              label: '?��??�播',
              href: '/live',
            },
          ]
        : []),
    ];

    // 如�??�用網�??�播，添?��?絡直?�入??    if (runtimeConfig?.WEB_LIVE_ENABLED) {
      items.push({
        icon: Globe,
        label: '網�??�播',
        href: '/web-live',
      });
    }

    // 如�??�置�?OpenList ??Emby，添?��?人影庫入??    if (runtimeConfig?.PRIVATE_LIBRARY_ENABLED) {
      items.push({
        icon: Container,
        label: '私人影�?',
        href: '/private-library',
      });
    }

    if (runtimeConfig?.ADVANCED_RECOMMENDATION_ENABLED) {
      items.push({
        icon: Blend,
        label: '高級?��?',
        href: '/advanced-recommendation',
      });
    }

    // 如�??�用觀影室�?添�?觀影室入??    if (watchRoomContext?.isEnabled) {
      items.push({
        icon: Users,
        label: '觀影�?,
        href: '/watch-room',
      });
    }

    // 添�??��?義�?類�?如�??��?
    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      items.push({
        icon: Star,
        label: '?��?�?,
        href: '/douban?type=custom',
      });
    }

    setNavItems(items);
  }, [watchRoomContext?.isEnabled]);

  const isActive = (href: string) => {
    const typeMatch = href.match(/type=([^&]+)/)?.[1];

    // �??URL以�?行正確�?比�?
    const decodedActive = decodeURIComponent(currentActive);
    const decodedItemHref = decodeURIComponent(href);

    return (
      decodedActive === decodedItemHref ||
      (decodedActive.startsWith('/douban') &&
        decodedActive.includes(`type=${typeMatch}`))
    );
  };

  return (
    <nav
      className='md:hidden fixed left-0 right-0 z-[600] bg-white/90 backdrop-blur-xl border-t border-gray-200/50 overflow-hidden dark:bg-gray-900/80 dark:border-gray-700/50'
      style={{
        /* 緊貼視口底部，�??�在?�部?�出安全?��?�?*/
        bottom: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
        minHeight: 'calc(3.5rem + env(safe-area-inset-bottom))',
      }}
    >
      <ul className='flex items-center overflow-x-auto scrollbar-hide'>
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <li
              key={item.href}
              className='flex-shrink-0'
              style={{ width: '20vw', minWidth: '20vw' }}
            >
              <Link
                href={item.href}
                prefetch={false}
                className='flex flex-col items-center justify-center w-full h-14 gap-1 text-xs'
              >
                <item.icon
                  className={`h-6 w-6 ${active
                    ? 'text-primary-500 dark:text-primary-500'
                    : 'text-gray-500 dark:text-gray-400'
                    }`}
                />
                <span
                  className={
                    active
                      ? 'text-primary-500 dark:text-primary-500'
                      : 'text-gray-600 dark:text-gray-300'
                  }
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default MobileBottomNav;
