/* eslint-disable react-hooks/exhaustive-deps */

import React, { useEffect, useRef, useState } from 'react';

interface CapsuleSwitchProps {
  options: { label: string; value: string; icon?: React.ReactNode }[];
  active: string;
  onChange: (value: string) => void;
  className?: string;
}

const CapsuleSwitch: React.FC<CapsuleSwitchProps> = ({
  options,
  active,
  onChange,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const hasDraggedRef = useRef(false);
  const [indicatorStyle, setIndicatorStyle] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  const activeIndex = options.findIndex((opt) => opt.value === active);

  // 更新指示器位置（僅更新位置，不觸發滾動）
  const updateIndicatorPosition = (autoScroll = false) => {
    if (
      activeIndex >= 0 &&
      buttonRefs.current[activeIndex] &&
      containerRef.current &&
      scrollContainerRef.current
    ) {
      const button = buttonRefs.current[activeIndex];
      const scrollContainer = scrollContainerRef.current;

      if (button) {
        const buttonOffsetLeft = button.offsetLeft;
        const buttonWidth = button.offsetWidth;

        setIndicatorStyle({
          left: buttonOffsetLeft,
          width: buttonWidth,
        });

        // 只在需要自動滾動時才執行
        if (autoScroll && !isScrollingRef.current) {
          const buttonRect = button.getBoundingClientRect();
          const scrollContainerRect = scrollContainer.getBoundingClientRect();
          const isVisible =
            buttonRect.left >= scrollContainerRect.left &&
            buttonRect.right <= scrollContainerRect.right;

          if (!isVisible) {
            // 將選中項滾動到視圖中心
            const scrollToPosition =
              buttonOffsetLeft -
              scrollContainer.offsetWidth / 2 +
              buttonWidth / 2;
            scrollContainer.scrollTo({
              left: scrollToPosition,
              behavior: 'smooth',
            });
          }
        }
      }
    }
  };

  // 組件掛載時立即計算初始位置並滾動到選中項
  useEffect(() => {
    const timeoutId = setTimeout(() => updateIndicatorPosition(true), 0);
    return () => clearTimeout(timeoutId);
  }, []);

  // 監聽選中項變化，自動滾動到新選中項
  useEffect(() => {
    const timeoutId = setTimeout(() => updateIndicatorPosition(true), 0);
    return () => clearTimeout(timeoutId);
  }, [activeIndex]);

  // 監聽滾動事件，僅更新指示器位置
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      // 標記正在滾動
      isScrollingRef.current = true;

      // 清除之前的超時
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // 僅更新指示器位置，不觸發自動滾動
      updateIndicatorPosition(false);

      // 滾動結束後重置標記
      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false;
      }, 150);
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [activeIndex]);

  // 鼠標拖動功能
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      hasDraggedRef.current = false;
      startXRef.current = e.pageX - scrollContainer.offsetLeft;
      scrollLeftRef.current = scrollContainer.scrollLeft;
      scrollContainer.style.cursor = 'grabbing';
      scrollContainer.style.userSelect = 'none';
    };

    const handleMouseLeave = () => {
      isDraggingRef.current = false;
      scrollContainer.style.cursor = 'grab';
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      scrollContainer.style.cursor = 'grab';
      // 短暫延遲後重置拖動標記，防止點擊事件被觸發
      setTimeout(() => {
        hasDraggedRef.current = false;
      }, 50);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      const x = e.pageX - scrollContainer.offsetLeft;
      const walk = (x - startXRef.current) * 1.5; // 調整拖動速度

      // 如果移動距離超過5px，標記為已拖動
      if (Math.abs(walk) > 5) {
        hasDraggedRef.current = true;
      }

      scrollContainer.scrollLeft = scrollLeftRef.current - walk;
    };

    scrollContainer.style.cursor = 'grab';
    scrollContainer.addEventListener('mousedown', handleMouseDown);
    scrollContainer.addEventListener('mouseleave', handleMouseLeave);
    scrollContainer.addEventListener('mouseup', handleMouseUp);
    scrollContainer.addEventListener('mousemove', handleMouseMove);

    return () => {
      scrollContainer.removeEventListener('mousedown', handleMouseDown);
      scrollContainer.removeEventListener('mouseleave', handleMouseLeave);
      scrollContainer.removeEventListener('mouseup', handleMouseUp);
      scrollContainer.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex bg-gray-300/80 rounded-full p-1 dark:bg-gray-700 max-w-full ${
        className || ''
      }`}
    >
      {/* 可滾動容器 */}
      <div
        ref={scrollContainerRef}
        className='relative flex overflow-x-auto scrollbar-hide'
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {/* 滑動的白色背景指示器 */}
        {indicatorStyle.width > 0 && (
          <div
            className='absolute top-0 bottom-0 bg-white dark:bg-gray-500 rounded-full shadow-sm transition-all duration-300 ease-out pointer-events-none'
            style={{
              left: `${indicatorStyle.left}px`,
              width: `${indicatorStyle.width}px`,
            }}
          />
        )}

        {options.map((opt, index) => {
          const isActive = active === opt.value;
          return (
            <button
              key={opt.value}
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              onClick={(e) => {
                // 如果正在拖動，阻止點擊
                if (hasDraggedRef.current) {
                  e.preventDefault();
                  return;
                }
                onChange(opt.value);
              }}
              className={`relative z-10 flex items-center justify-center gap-1.5 px-3 py-1 text-xs sm:px-4 sm:py-2 sm:text-sm rounded-full font-medium transition-all duration-200 cursor-pointer whitespace-nowrap flex-shrink-0 ${
                isActive
                  ? 'text-gray-900 dark:text-gray-100'
                  : 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
              }`}
            >
              {opt.icon && <span className='inline-flex items-center'>{opt.icon}</span>}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CapsuleSwitch;
