import { Radio, X } from 'lucide-react';
import Image from 'next/image';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ActionItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: (e?: React.MouseEvent) => void | Promise<void>;
  color?: 'default' | 'danger' | 'primary';
  disabled?: boolean;
}

interface MobileActionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  actions: ActionItem[];
  poster?: string;
  sources?: string[]; // 播放源信息
  isAggregate?: boolean; // 是否為聚合內容
  sourceName?: string; // 播放源名稱
  directLinkUrl?: string; // 直鏈播放完整鏈接
  currentEpisode?: number; // 當前集數
  totalEpisodes?: number; // 總集數
  origin?: 'vod' | 'live';
  onPosterClick?: () => void; // 海報點擊回調
}

const MobileActionSheet: React.FC<MobileActionSheetProps> = ({
  isOpen,
  onClose,
  title,
  actions,
  poster,
  sources,
  isAggregate,
  sourceName,
  directLinkUrl,
  currentEpisode,
  totalEpisodes,
  origin = 'vod',
  onPosterClick,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isTitleOverflowing, setIsTitleOverflowing] = useState(false);
  const backdropPressStarted = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // 確保組件在客戶端掛載後才渲染 Portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // 控制動畫狀態
  useEffect(() => {
    let animationId: number;
    let timer: NodeJS.Timeout;

    if (isOpen) {
      backdropPressStarted.current = false;
      setIsVisible(true);
      // 使用雙重 requestAnimationFrame 確保DOM完全渲染
      animationId = requestAnimationFrame(() => {
        animationId = requestAnimationFrame(() => {
          setIsAnimating(true);
        });
      });
    } else {
      backdropPressStarted.current = false;
      setIsAnimating(false);
      // 等待動畫完成後隱藏組件
      timer = setTimeout(() => {
        setIsVisible(false);
      }, 200);
    }

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isOpen]);

  // 阻止背景滾動
  useEffect(() => {
    if (isVisible) {
      // 保存當前滾動位置
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      const body = document.body;
      const html = document.documentElement;

      // 獲取滾動條寬度
      const scrollBarWidth = window.innerWidth - html.clientWidth;

      // 保存原始樣式
      const originalBodyStyle = {
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        paddingRight: body.style.paddingRight,
        overflow: body.style.overflow,
      };

      // 設置body樣式來阻止滾動，但保持原位置
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = `-${scrollX}px`;
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
      body.style.paddingRight = `${scrollBarWidth}px`;

      return () => {
        // 恢復所有原始樣式
        body.style.position = originalBodyStyle.position;
        body.style.top = originalBodyStyle.top;
        body.style.left = originalBodyStyle.left;
        body.style.right = originalBodyStyle.right;
        body.style.width = originalBodyStyle.width;
        body.style.paddingRight = originalBodyStyle.paddingRight;
        body.style.overflow = originalBodyStyle.overflow;

        // 使用 requestAnimationFrame 確保樣式恢復後再滾動
        requestAnimationFrame(() => {
          window.scrollTo(scrollX, scrollY);
        });
      };
    }
  }, [isVisible]);

  useEffect(() => {
    const element = titleRef.current;
    if (!element || !isVisible) {
      setIsTitleOverflowing(false);
      return;
    }

    const checkOverflow = () => {
      setIsTitleOverflowing(element.scrollWidth > element.clientWidth + 1);
    };

    checkOverflow();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', checkOverflow);
      return () => window.removeEventListener('resize', checkOverflow);
    }

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [isVisible, title]);

  // ESC鍵關閉
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }
  }, [isVisible, onClose]);

  if (!isVisible || !mounted) return null;

  const getActionColor = (color: ActionItem['color']) => {
    switch (color) {
      case 'danger':
        return 'text-red-600 dark:text-red-400';
      case 'primary':
        return 'text-green-600 dark:text-green-400';
      default:
        return 'text-gray-700 dark:text-gray-300';
    }
  };

  const getActionHoverColor = (color: ActionItem['color']) => {
    switch (color) {
      case 'danger':
        return 'hover:bg-red-50/50 dark:hover:bg-red-900/10';
      case 'primary':
        return 'hover:bg-green-50/50 dark:hover:bg-green-900/10';
      default:
        return 'hover:bg-gray-50/50 dark:hover:bg-gray-800/20';
    }
  };

  const armBackdropClose = () => {
    backdropPressStarted.current = true;
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 菜單打開前那次長按的鬆手會產生一個“懸空 click”，
    // 這次 click 並不是從遮罩開始按下的，所以不能拿來關閉菜單。
    if (!backdropPressStarted.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    backdropPressStarted.current = false;
    onClose();
  };

  const content = (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center"
      onTouchMove={(e) => {
        // 阻止最外層容器的觸摸移動，防止背景滾動
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        touchAction: 'none', // 禁用所有觸摸操作
      }}
    >
      {/* 背景遮罩 */}
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ease-out ${isAnimating ? 'opacity-100' : 'opacity-0'
          }`}
        onPointerDown={armBackdropClose}
        onTouchStart={armBackdropClose}
        onClick={handleBackdropClick}
        onTouchMove={(e) => {
          // 只阻止滾動，允許其他觸摸事件（包括點擊）
          e.preventDefault();
        }}
        onWheel={(e) => {
          // 阻止滾輪滾動
          e.preventDefault();
        }}
        style={{
          backdropFilter: 'blur(4px)',
          willChange: 'opacity',
          touchAction: 'none', // 禁用所有觸摸操作
        }}
      />

      {/* 操作表單 */}
      <div
        className="relative w-full max-w-lg mx-4 mb-4 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl transition-all duration-200 ease-out"
        onTouchMove={(e) => {
          // 允許操作表單內部滾動，阻止事件冒泡到外層
          e.stopPropagation();
        }}
        style={{
          marginBottom: 'calc(1rem + env(safe-area-inset-bottom))',
          willChange: 'transform, opacity',
          backfaceVisibility: 'hidden', // 避免閃爍
          transform: isAnimating
            ? 'translateY(0) translateZ(0)'
            : 'translateY(100%) translateZ(0)', // 組合變換保持滑入效果和硬件加速
          opacity: isAnimating ? 1 : 0,
          touchAction: 'auto', // 允許操作表單內的正常觸摸操作
        }}
      >
        {/* 頭部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {poster && (
              <div
                className="relative w-12 h-16 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 flex-shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  onPosterClick?.();
                }}
              >
                <Image
                  src={poster}
                  alt={title}
                  fill
                  className={origin === 'live' ? 'object-contain' : 'object-cover'}
                  loading="lazy"
                />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1 min-w-0">
                <div className="relative min-w-0 flex-1 group/title">
                  <h3
                    ref={titleRef}
                    className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate"
                  >
                    {title}
                  </h3>
                  {isTitleOverflowing && (
                    <div className="absolute bottom-full left-1/2 z-10 mb-2 w-max max-w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg bg-gray-800 px-3 py-2 text-center text-sm text-white shadow-xl opacity-0 invisible transition-all duration-200 ease-out whitespace-normal break-words pointer-events-none group-hover/title:opacity-100 group-hover/title:visible dark:bg-gray-900">
                      {title}
                      <div className="absolute top-full left-1/2 h-0 w-0 -translate-x-1/2 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800 dark:border-t-gray-900"></div>
                    </div>
                  )}
                </div>
                {sourceName && (
                  <span className="flex-shrink-0 text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800">
                    {origin === 'live' && (
                      <Radio size={12} className="inline-block text-gray-500 dark:text-gray-400 mr-1.5" />
                    )}
                    {sourceName}
                  </span>
                )}
              </div>
              {directLinkUrl && (
                <p className="mb-2 text-xs text-gray-500 dark:text-gray-400 break-all">
                  {directLinkUrl}
                </p>
              )}
              <p className="text-sm text-gray-500 dark:text-gray-400">
                選擇操作
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-150"
          >
            <X size={20} className="text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* 操作列表 */}
        <div className="px-4 py-2">
          {actions.map((action, index) => (
            <div key={action.id}>
              <button
                onClick={() => {
                  action.onClick();
                  onClose();
                }}
                disabled={action.disabled}
                className={`
                  w-full flex items-center gap-4 py-4 px-2 transition-all duration-150 ease-out
                  ${action.disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : `${getActionHoverColor(action.color)} active:scale-[0.98]`
                  }
                `}
                style={{ willChange: 'transform, background-color' }}
              >
                {/* 圖標 - 使用線條風格 */}
                <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                  <span className={`transition-colors duration-150 ${action.disabled
                    ? 'text-gray-400 dark:text-gray-600'
                    : getActionColor(action.color)
                    }`}>
                    {action.icon}
                  </span>
                </div>

                {/* 文字 */}
                <span className={`
                  text-left font-medium text-base flex-1
                  ${action.disabled
                    ? 'text-gray-400 dark:text-gray-600'
                    : 'text-gray-900 dark:text-gray-100'
                  }
                `}>
                  {action.label}
                </span>

                {/* 播放進度 - 只在播放按鈕且有播放記錄時顯示 */}
                {action.id === 'play' && currentEpisode && totalEpisodes && (
                  <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                    {currentEpisode}/{totalEpisodes}
                  </span>
                )}


              </button>

              {/* 分割線 - 最後一項不顯示 */}
              {index < actions.length - 1 && (
                <div className="border-b border-gray-100 dark:border-gray-800 ml-10"></div>
              )}
            </div>
          ))}
        </div>

        {/* 播放源信息展示區域 */}
        {isAggregate && sources && sources.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
            {/* 標題區域 */}
            <div className="mb-3">
              <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                可用播放源
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                共 {sources.length} 個播放源
              </p>
            </div>

            {/* 播放源列表 */}
            <div className="max-h-32 overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                {sources.map((source, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 py-2 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/30 dark:bg-gray-800/30"
                  >
                    <div className="w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full flex-shrink-0" />
                    <span className="text-xs text-gray-600 dark:text-gray-400 truncate">
                      {source}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // 使用 Portal 將組件渲染到 document.body
  return createPortal(content, document.body);
};

export default MobileActionSheet;
