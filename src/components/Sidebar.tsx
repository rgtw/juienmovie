/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Blend, Cat, Clover, Container, Film, Globe, Home, Menu, Search, Star, Tv, TvMinimalPlay, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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

// ?�替?�為你自己�? logo ?��?
const Logo = () => {
  const { siteName } = useSite();
  return (
    <Link
      href='/'
      className='flex items-center justify-center h-16 select-none hover:opacity-80 transition-opacity duration-200'
    >
      <span className='text-2xl font-bold text-primary-500 tracking-tight'>
        {siteName}
      </span>
    </Link>
  );
};

interface SidebarProps {
  onToggle?: (collapsed: boolean) => void;
  activePath?: string;
}

// ?��?覽器?��?下通�??��??��?緩�??��??�態�??��?組件?�新?�載?�出?��?始值閃??declare global {
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
  // ?��?一�?SPA 會�?中已經讀?��??��??�態�??�直?��??��??��??��?
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (
      typeof window !== 'undefined' &&
      typeof window.__sidebarCollapsed === 'boolean'
    ) {
      return window.__sidebarCollapsed;
    }
    return false; // 默認展�?
  });

  // 首次?�載?�讀??localStorage，以便刷?��?仍�??��?次�??��??��?  useLayoutEffect(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    if (saved !== null) {
      const val = JSON.parse(saved);
      setIsCollapsed(val);
      window.__sidebarCollapsed = val;
    }
  }, []);

  // 當�??�狀?��??�時，�?步到 <html> data 屬性�?供�?�?CSS 使用
  useLayoutEffect(() => {
    if (typeof document !== 'undefined') {
      if (isCollapsed) {
        document.documentElement.dataset.sidebarCollapsed = 'true';
      } else {
        delete document.documentElement.dataset.sidebarCollapsed;
      }
    }
  }, [isCollapsed]);

  const [active, setActive] = useState(activePath);

  useEffect(() => {
    // 立即?�據當�?路�??�新?�態�?不�?待頁?��?�?    const getCurrentFullPath = () => {
      const queryString = searchParams.toString();
      return queryString ? `${pathname}?${queryString}` : pathname;
    };
    const fullPath = getCurrentFullPath();
    setActive(fullPath);
  }, [pathname, searchParams]);

  const handleToggle = useCallback(() => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem('sidebarCollapsed', JSON.stringify(newState));
    if (typeof window !== 'undefined') {
      window.__sidebarCollapsed = newState;
    }
    onToggle?.(newState);
  }, [isCollapsed, onToggle]);

  const contextValue = {
    isCollapsed,
  };

  const [menuItems, setMenuItems] = useState([
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

    // ?��??��?項�?不�??��?影室�?    const items = [
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

    setMenuItems(items);
  }, [watchRoomContext?.isEnabled]);

  return (
    <SidebarContext.Provider value={contextValue}>
      {/* ?�移?�端?��?側邊??*/}
      <div className='hidden md:flex'>
        <aside
          data-sidebar
          className={`fixed top-0 left-0 h-screen bg-white/40 backdrop-blur-xl transition-all duration-300 border-r border-gray-200/50 z-10 shadow-lg dark:bg-gray-900/70 dark:border-gray-700/50 ${isCollapsed ? 'w-16' : 'w-64'
            }`}
          style={{
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className='flex h-full flex-col'>
            {/* 頂部 Logo ?��? */}
            <div className='relative h-16'>
              <div
                className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isCollapsed ? 'opacity-0' : 'opacity-100'
                  }`}
              >
                <div className='w-[calc(100%-4rem)] flex justify-center'>
                  {!isCollapsed && <Logo />}
                </div>
              </div>
              <button
                onClick={handleToggle}
                className={`absolute top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100/50 transition-colors duration-200 z-10 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700/50 ${isCollapsed ? 'left-1/2 -translate-x-1/2' : 'right-2'
                  }`}
              >
                <Menu className='h-4 w-4' />
              </button>
            </div>

            {/* 首頁?��?索導??*/}
            <nav className='px-2 mt-4 space-y-1'>
              <Link
                href='/'
                prefetch={false}
                onClick={(e) => {
                  // 確�??�擊事件立即?��?，�?被其他狀?�更?�阻�?                  e.currentTarget.blur();
                }}
                data-active={active === '/'}
                className={`group flex items-center rounded-lg px-2 py-2 pl-4 text-gray-700 hover:bg-gray-100/30 hover:text-primary-500 data-[active=true]:bg-primary-500/20 data-[active=true]:text-primary-500 font-medium transition-colors duration-200 min-h-[40px] dark:text-gray-300 dark:hover:text-primary-500 dark:data-[active=true]:bg-primary-500/10 dark:data-[active=true]:text-primary-500 ${isCollapsed ? 'w-full max-w-none mx-0' : 'mx-0'
                  } gap-3 justify-start`}
              >
                <div className='w-4 h-4 flex items-center justify-center'>
                  <Home className='h-4 w-4 text-gray-500 group-hover:text-primary-500 data-[active=true]:text-primary-500 dark:text-gray-400 dark:group-hover:text-primary-500 dark:data-[active=true]:text-primary-500' />
                </div>
                {!isCollapsed && (
                  <span className='whitespace-nowrap transition-opacity duration-200 opacity-100'>
                    首頁
                  </span>
                )}
              </Link>
              <Link
                href='/search'
                data-active={active === '/search'}
                className={`group flex items-center rounded-lg px-2 py-2 pl-4 text-gray-700 hover:bg-gray-100/30 hover:text-primary-500 data-[active=true]:bg-primary-500/20 data-[active=true]:text-primary-500 font-medium transition-colors duration-200 min-h-[40px] dark:text-gray-300 dark:hover:text-primary-500 dark:data-[active=true]:bg-primary-500/10 dark:data-[active=true]:text-primary-500 ${isCollapsed ? 'w-full max-w-none mx-0' : 'mx-0'
                  } gap-3 justify-start`}
              >
                <div className='w-4 h-4 flex items-center justify-center'>
                  <Search className='h-4 w-4 text-gray-500 group-hover:text-primary-500 data-[active=true]:text-primary-500 dark:text-gray-400 dark:group-hover:text-primary-500 dark:data-[active=true]:text-primary-500' />
                </div>
                {!isCollapsed && (
                  <span className='whitespace-nowrap transition-opacity duration-200 opacity-100'>
                    ?�索
                  </span>
                )}
              </Link>
            </nav>

            {/* ?��?�?*/}
            <div className='flex-1 overflow-y-auto px-2 pt-4'>
              <div className='space-y-1'>
                {menuItems.map((item) => {
                  // 檢?��??�路徑是?�匹?��?個�??�項
                  const typeMatch = item.href.match(/type=([^&]+)/)?.[1];

                  // �??URL以�?行正確�?比�?
                  const decodedActive = decodeURIComponent(active);
                  const decodedItemHref = decodeURIComponent(item.href);

                  // ?��?路�??��?不�??�查詢�??��?
                  const activePathname = decodedActive.split('?')[0];
                  const itemPathname = decodedItemHref.split('?')[0];

                  const isActive =
                    decodedActive === decodedItemHref ||
                    (decodedActive.startsWith('/douban') &&
                      decodedActive.includes(`type=${typeMatch}`)) ||
                    // 對�?沒�?type?�數?�路徑�??��?較路徑�?
                    (!typeMatch && activePathname === itemPathname);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      data-active={isActive}
                      className={`group flex items-center rounded-lg px-2 py-2 pl-4 text-sm text-gray-700 hover:bg-gray-100/30 hover:text-primary-500 data-[active=true]:bg-primary-500/20 data-[active=true]:text-primary-500 transition-colors duration-200 min-h-[40px] dark:text-gray-300 dark:hover:text-primary-500 dark:data-[active=true]:bg-primary-500/10 dark:data-[active=true]:text-primary-500 ${isCollapsed ? 'w-full max-w-none mx-0' : 'mx-0'
                        } gap-3 justify-start`}
                    >
                      <div className='w-4 h-4 flex items-center justify-center'>
                        <Icon className='h-4 w-4 text-gray-500 group-hover:text-primary-500 data-[active=true]:text-primary-500 dark:text-gray-400 dark:group-hover:text-primary-500 dark:data-[active=true]:text-primary-500' />
                      </div>
                      {!isCollapsed && (
                        <span className='whitespace-nowrap transition-opacity duration-200 opacity-100'>
                          {item.label}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
        <div
          className={`transition-all duration-300 sidebar-offset ${isCollapsed ? 'w-16' : 'w-64'
            }`}
        ></div>
      </div>
    </SidebarContext.Provider>
  );
};

export default Sidebar;
