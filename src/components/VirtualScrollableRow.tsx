'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface VirtualScrollableRowProps {
  children: React.ReactNode[];
  maxVisible?: number; // 最大可見數量
  className?: string; // 額外的 CSS 類名
}

export default function VirtualScrollableRow({
  children,
  maxVisible = 30, // 默認最多顯示 30 個項目
  className = '',
}: VirtualScrollableRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: maxVisible });

  // 檢查滾動狀態
  const checkScroll = () => {
    if (!containerRef.current) return;

    const { scrollLeft, scrollWidth, clientWidth } = containerRef.current;
    const canScrollLeft = scrollLeft > 0;
    const canScrollRight = scrollLeft + clientWidth < scrollWidth - 10;

    setShowLeftScroll(canScrollLeft);
    setShowRightScroll(canScrollRight);

    // 計算可見範圍（基於滾動位置）
    const itemWidth = 208; // 每個項目約 200px + 8px gap
    const scrolledItems = Math.floor(scrollLeft / itemWidth);
    const visibleItems = Math.ceil(clientWidth / itemWidth);

    // 擴展渲染範圍（當前可見 + 前後緩衝）
    const bufferSize = 5;
    const newStart = Math.max(0, scrolledItems - bufferSize);
    const newEnd = Math.min(children.length, scrolledItems + visibleItems + bufferSize);

    setVisibleRange({ start: newStart, end: newEnd });
  };

  useEffect(() => {
    checkScroll();
    const container = containerRef.current;

    if (container) {
      container.addEventListener('scroll', checkScroll);
      return () => container.removeEventListener('scroll', checkScroll);
    }
  }, [children.length]);

  // 監聽窗口大小變化
  useEffect(() => {
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, []);

  const scrollLeft = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({
        left: -400,
        behavior: 'smooth',
      });
    }
  };

  const scrollRight = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({
        left: 400,
        behavior: 'smooth',
      });
    }
  };

  // 渲染可見項目
  const visibleChildren = children.slice(visibleRange.start, visibleRange.end);

  return (
    <div className="relative group">
      {/* 左側滾動按鈕 */}
      {showLeftScroll && (
        <button
          onClick={scrollLeft}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-[600] bg-white/90 dark:bg-gray-800/90 p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white dark:hover:bg-gray-700"
          aria-label="向左滾動"
        >
          <ChevronLeft className="w-6 h-6 text-gray-700 dark:text-gray-200" />
        </button>
      )}

      {/* 滾動容器 */}
      <div
        ref={containerRef}
        className={`flex gap-2 overflow-x-auto scrollbar-hide scroll-smooth ${className}`}
        style={{ scrollBehavior: 'smooth', paddingTop: '20px', paddingBottom: '20px', marginTop: '-20px', marginBottom: '-20px' }}
      >
        {/* 左側佔位符（用於保持滾動位置） */}
        {visibleRange.start > 0 && (
          <div style={{ minWidth: visibleRange.start * 208, flexShrink: 0 }} />
        )}

        {/* 渲染可見項目 */}
        {visibleChildren}

        {/* 右側佔位符 */}
        {visibleRange.end < children.length && (
          <div style={{ minWidth: (children.length - visibleRange.end) * 208, flexShrink: 0 }} />
        )}
      </div>

      {/* 右側滾動按鈕 */}
      {showRightScroll && (
        <button
          onClick={scrollRight}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-[600] bg-white/90 dark:bg-gray-800/90 p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white dark:hover:bg-gray-700"
          aria-label="向右滾動"
        >
          <ChevronRight className="w-6 h-6 text-gray-700 dark:text-gray-200" />
        </button>
      )}
    </div>
  );
}
