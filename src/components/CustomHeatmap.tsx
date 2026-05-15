'use client';

import React, { useCallback,useEffect, useRef, useState } from 'react';

interface DanmakuData {
  time: number;
  text: string;
  [key: string]: any;
}

interface CustomHeatmapProps {
  danmakuList: DanmakuData[];
  duration: number;
  currentTime: number;
  enabled: boolean;
  onSeek?: (time: number) => void;
  className?: string;
}

const CustomHeatmap: React.FC<CustomHeatmapProps> = ({
  danmakuList,
  duration,
  currentTime,
  enabled,
  onSeek,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [heatmapData, setHeatmapData] = useState<number[]>([]);
  const [isHovering, setIsHovering] = useState(false);
  const [hoverTime, setHoverTime] = useState(0);

  // 計算熱力圖數據
  const calculateHeatmapData = useCallback(() => {
    if (!duration || duration <= 0 || danmakuList.length === 0) {
      return [];
    }

    // 將視頻時長分成若干個時間段（每秒一個）
    const segments = Math.ceil(duration);
    const heatData = new Array(segments).fill(0);

    // 統計每個時間段的彈幕數量
    danmakuList.forEach((danmaku) => {
      const segmentIndex = Math.floor(danmaku.time);
      if (segmentIndex >= 0 && segmentIndex < segments) {
        heatData[segmentIndex]++;
      }
    });

    // 歸一化數據到 0-1 範圍
    const maxCount = Math.max(...heatData, 1);
    return heatData.map((count) => count / maxCount);
  }, [danmakuList, duration]);

  // 當彈幕列表或時長變化時重新計算熱力圖數據
  useEffect(() => {
    const data = calculateHeatmapData();
    setHeatmapData(data);
  }, [calculateHeatmapData]);

  // 繪製熱力圖
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || heatmapData.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // 清空畫布
    ctx.clearRect(0, 0, width, height);

    // 計算每個柱子的寬度
    const barWidth = width / heatmapData.length;
    const progressRatio = duration > 0 ? currentTime / duration : 0;

    // 繪製熱力圖柱狀圖
    heatmapData.forEach((value, index) => {
      const x = index * barWidth;
      const barHeight = value * height;
      const y = height - barHeight;

      // 判斷是否已播放
      const isPlayed = (index / heatmapData.length) <= progressRatio;

      // 使用灰色透明，已播放的部分深色一點
      const opacity = isPlayed ? 0.5 + value * 0.3 : 0.2 + value * 0.3;
      const color = `rgba(128, 128, 128, ${opacity})`;

      ctx.fillStyle = color;
      ctx.fillRect(x, y, Math.ceil(barWidth) + 1, barHeight);
    });

    // 繪製當前播放位置指示器
    if (duration > 0) {
      const progressX = (currentTime / duration) * width;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillRect(progressX - 1, 0, 2, height);
    }
  }, [heatmapData, currentTime, duration]);

  // 處理鼠標移動
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container || !duration) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const time = percentage * duration;

    setHoverTime(time);
    setIsHovering(true);
  };

  // 處理鼠標離開
  const handleMouseLeave = () => {
    setIsHovering(false);
  };

  // 處理點擊跳轉
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container || !duration || !onSeek) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const time = percentage * duration;

    onSeek(time);
  };

  // 格式化時間顯示
  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // 獲取懸停位置的彈幕密度
  const getHoverDensity = (): string => {
    if (!isHovering || heatmapData.length === 0) return '';

    const segmentIndex = Math.floor(hoverTime);
    if (segmentIndex >= 0 && segmentIndex < heatmapData.length) {
      const density = heatmapData[segmentIndex];
      if (density < 0.2) return '低';
      if (density < 0.5) return '中';
      if (density < 0.8) return '高';
      return '極高';
    }
    return '';
  };

  if (!enabled) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={`custom-heatmap ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        cursor: 'pointer',
      }}
    >
      <canvas
        ref={canvasRef}
        width={1000}
        height={30}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />

      {/* 懸停提示 */}
      {isHovering && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: `${(hoverTime / duration) * 100}%`,
            transform: 'translateX(-50%)',
            marginBottom: '8px',
            padding: '4px 8px',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            fontSize: '12px',
            borderRadius: '4px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {formatTime(hoverTime)} - 彈幕密度: {getHoverDensity()}
        </div>
      )}
    </div>
  );
};

export default CustomHeatmap;
