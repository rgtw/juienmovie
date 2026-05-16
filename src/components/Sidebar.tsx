/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Blend, Cat, Clover, Container, Film, Globe, Home, Search, Star, Tv, TvMinimalPlay, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';

import { useSite } from './SiteProvider';
import { useWatchRoomContextSafe } from './WatchRoomProvider';

interface SidebarContextType {
  isCollapsed: boolean;
}

const SidebarContext = createContext<SidebarContextType>({
  isCollapsed: false,
});

export const useSidebar = () => useContext(SidebarContext);

const Logo = () => {
  const { siteName } = useSite();
  return (
    <Link
      href='/'
      className='flex items-center justify-center h-16 select-none hover:opacity-80 transition-opacity duration-200'
    >
      <span className='text-3xl font-bold text-primary-500 tracking-tighter'>
        {siteName}
      </span>
    </Link>
  );
};

interface SidebarProps {
  onToggle?: (collapsed: boolean) => void;
  activePath?: string;
}

declare global {
  interface Window {
    __sidebarCollapsed?: boolean;
    RUNTIME_CONFIG?: {
      EnableComments?: boolean;
      RecommendationDataSource?: string;
      [key: string]: any;
    };
  }
}

const Sidebar = ({ onToggle, activePath = '/' }: SidebarProps) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const watchRoomContext = useWatchRoomContextSafe();

  if (pathname === '/watch-room/screen') {
    return null;
  }

  const [active, setActive] = useState(activePath);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const getCurrentFullPath = () => {
      const queryString = searchParams.toString();
      return queryString ? `${pathname}?${queryString}` : pathname;
    };
    const fullPath = getCurrentFullPath();
    setActive(fullPath);
  }, [pathname, searchParams]);

  const contextValue = {
    isCollapsed: false,
  };

  const [menuItems, setMenuItems] = useState([
    { icon: Film, label: '電影', href: '/douban?type=movie' },
    { icon: Tv, label: '劇集', href: '/douban?type=tv' },
    { icon: Cat, label: '動漫', href: '/douban?type=anime' },
    { icon: Clover, label: '綜藝', href: '/douban?type=show' },
    { icon: TvMinimalPlay, label: '電視直播', href: '/live' },
  ]);

  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;

    const items = [
      { icon: Film, label: '電影', href: '/douban?type=movie' },
      { icon: Tv, label: '劇集', href: '/douban?type=tv' },
      { icon: Cat, label: '動漫', href: '/douban?type=anime' },
      { icon: Clover, label: '綜藝', href: '/douban?type=show' },
      ...(runtimeConfig?.LIVE_ENABLED
        ? [{ icon: TvMinimalPlay, label: '電視直播', href: '/live' }]
        : []),
    ];

    if (runtimeConfig?.WEB_LIVE_ENABLED) {
      items.push({ icon: Globe, label: '網絡直播', href: '/web-live' });
    }

    if (runtimeConfig?.PRIVATE_LIBRARY_ENABLED) {
      items.push({ icon: Container, label: '私人影庫', href: '/private-library' });
    }

    if (runtimeConfig?.ADVANCED_RECOMMENDATION_ENABLED) {
      items.push({ icon: Blend, label: '高級推薦', href: '/advanced-recommendation' });
    }

    if (watchRoomContext?.isEnabled) {
      items.push({ icon: Users, label: '觀影室', href: '/watch-room' });
    }

    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      items.push({ icon: Star, label: '自定義', href: '/douban?type=custom' });
    }

    setMenuItems(items);
  }, [watchRoomContext?.isEnabled]);

  return (
    <SidebarContext.Provider value={contextValue}>
      {/* 桌面端 Netflix 風格頂部導航 */}
      <div className='hidden md:block w-full'>
        <nav
          data-sidebar
          className={`fixed top-0 left-0 w-full h-[68px] transition-colors duration-300 z-[40] flex items-center px-12 ${
            isScrolled ? 'bg-[#141414]' : 'bg-gradient-to-b from-black/80 to-transparent'
          }`}
        >
          <div className='flex h-full flex-row items-center w-full'>
            {/* 顶部 Logo 区域 */}
            <div className='flex-shrink-0 mr-10'>
              <Logo />
            </div>

            {/* 导航菜单 */}
            <div className='flex flex-row items-center gap-5'>
              <Link
                href='/'
                prefetch={false}
                data-active={active === '/'}
                className="text-[15px] transition-colors duration-200 text-[#e5e5e5] hover:text-[#b3b3b3] data-[active=true]:text-white data-[active=true]:font-bold whitespace-nowrap"
              >
                首頁
              </Link>
              <Link
                href='/search'
                data-active={active === '/search'}
                className="text-[15px] transition-colors duration-200 text-[#e5e5e5] hover:text-[#b3b3b3] data-[active=true]:text-white data-[active=true]:font-bold whitespace-nowrap"
              >
                搜尋
              </Link>
              {menuItems.map((item) => {
                const typeMatch = item.href.match(/type=([^&]+)/)?.[1];
                const decodedActive = decodeURIComponent(active);
                const decodedItemHref = decodeURIComponent(item.href);
                const activePathname = decodedActive.split('?')[0];
                const itemPathname = decodedItemHref.split('?')[0];

                const isActive =
                  decodedActive === decodedItemHref ||
                  (decodedActive.startsWith('/douban') &&
                    decodedActive.includes(`type=${typeMatch}`)) ||
                  (!typeMatch && activePathname === itemPathname);

                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    data-active={isActive}
                    className="text-[15px] transition-colors duration-200 text-[#e5e5e5] hover:text-[#b3b3b3] data-[active=true]:text-white data-[active=true]:font-bold whitespace-nowrap"
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>
      </div>
    </SidebarContext.Provider>
  );
};

export default Sidebar;
