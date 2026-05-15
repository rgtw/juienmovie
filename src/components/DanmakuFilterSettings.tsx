/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { Plus, ToggleLeft, ToggleRight,Trash2, X } from 'lucide-react';
import { useEffect, useRef,useState } from 'react';

import { getDanmakuFilterConfig, saveDanmakuFilterConfig } from '@/lib/db.client';
import { DanmakuFilterConfig, DanmakuFilterRule } from '@/lib/types';

interface DanmakuFilterSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigUpdate?: (config: DanmakuFilterConfig) => void;
  onShowToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

export default function DanmakuFilterSettings({
  isOpen,
  onClose,
  onConfigUpdate,
  onShowToast,
}: DanmakuFilterSettingsProps) {
  const [config, setConfig] = useState<DanmakuFilterConfig>({ rules: [] });
  const [newKeyword, setNewKeyword] = useState('');
  const [newType, setNewType] = useState<'normal' | 'regex'>('normal');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [inputKey, setInputKey] = useState(0); // 用於強制重新渲染輸入框
  const inputRef = useRef<HTMLInputElement>(null); // 用於直接操作輸入框 DOM

  // 控制動畫狀態
  useEffect(() => {
    let animationId: number;
    let timer: NodeJS.Timeout;

    if (isOpen) {
      setIsVisible(true);
      // 使用雙重 requestAnimationFrame 確保DOM完全渲染
      animationId = requestAnimationFrame(() => {
        animationId = requestAnimationFrame(() => {
          setIsAnimating(true);
        });
      });
    } else {
      setIsAnimating(false);
      // 等待動畫完成後隱藏組件
      timer = setTimeout(() => {
        setIsVisible(false);
      }, 300);
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

  // 加載配置
  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const loadedConfig = await getDanmakuFilterConfig();
      if (loadedConfig) {
        setConfig(loadedConfig);
      } else {
        setConfig({ rules: [] });
      }
    } catch (error) {
      console.error('加載彈幕過濾配置失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  // 保存配置
  const handleSave = async () => {
    setSaving(true);
    try {
      await saveDanmakuFilterConfig(config);
      if (onConfigUpdate) {
        onConfigUpdate(config);
      }
      if (onShowToast) {
        onShowToast('保存成功！', 'success');
      }
      // 延遲關閉面板，讓用戶看到toast
      setTimeout(() => {
        onClose();
      }, 300);
    } catch (error) {
      console.error('保存彈幕過濾配置失敗:', error);
      if (onShowToast) {
        onShowToast('保存失敗，請重試', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  // 添加規則
  const handleAddRule = () => {
    if (!newKeyword.trim()) {
      if (onShowToast) {
        onShowToast('請輸入關鍵字', 'info');
      }
      return;
    }

    const newRule: DanmakuFilterRule = {
      keyword: newKeyword.trim(),
      type: newType,
      enabled: true,
      id: Date.now().toString(),
    };

    setConfig((prev) => ({
      rules: [...prev.rules, newRule],
    }));

    // 清空輸入框並強制重新渲染
    setNewKeyword('');

    // 使用 setTimeout 確保在狀態更新後操作 DOM
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.value = ''; // 直接清空 DOM 值
        inputRef.current.blur(); // 失去焦點，阻止自動填充
      }
      setInputKey(prev => prev + 1); // 強制重新渲染輸入框
    }, 0);
  };

  // 刪除規則
  const handleDeleteRule = (id: string | undefined) => {
    if (!id) return;
    setConfig((prev) => ({
      rules: prev.rules.filter((rule) => rule.id !== id),
    }));
  };

  // 切換規則啟用狀態
  const handleToggleRule = (id: string | undefined) => {
    if (!id) return;
    setConfig((prev) => ({
      rules: prev.rules.map((rule) =>
        rule.id === id ? { ...rule, enabled: !rule.enabled } : rule
      ),
    }));
  };

  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-end justify-center"
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
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ease-out ${
          isAnimating ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
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

      {/* 彈窗主體 */}
      <div
        className="relative w-full bg-white dark:bg-gray-900 rounded-t-3xl shadow-2xl transition-all duration-300 ease-out max-h-[85vh]"
        onTouchMove={(e) => {
          // 允許彈窗內部滾動，阻止事件冒泡到外層
          e.stopPropagation();
        }}
        style={{
          marginBottom: 'calc(0rem + env(safe-area-inset-bottom))',
          willChange: 'transform, opacity',
          backfaceVisibility: 'hidden', // 避免閃爍
          transform: isAnimating
            ? 'translateY(0) translateZ(0)'
            : 'translateY(100%) translateZ(0)', // 組合變換保持滑入效果和硬件加速
          opacity: isAnimating ? 1 : 0,
          touchAction: 'auto', // 允許彈窗內的正常觸摸操作
        }}
      >
        {/* 頂部拖拽指示器 */}
        <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 pt-3 pb-2">
          <div className="flex justify-center">
            <div className="w-12 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
          </div>
        </div>

        {/* 頭部 */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            彈幕關鍵字屏蔽設置
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-150"
          >
            <X size={20} className="text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* 內容區域 */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* 添加規則 */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              添加屏蔽規則
            </h3>
            <div className="space-y-3">
              <input
                key={inputKey}
                ref={inputRef}
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddRule()}
                placeholder="輸入要屏蔽的關鍵字"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                data-form-type="other"
                data-lpignore="true"
                className="w-full px-4 py-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg border border-gray-200 dark:border-gray-600 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all duration-200"
              />
              <div className="flex gap-2">
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as 'normal' | 'regex')}
                  className="flex-1 px-4 py-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg border border-gray-200 dark:border-gray-600 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all duration-200"
                >
                  <option value="normal">普通模式</option>
                  <option value="regex">正則模式</option>
                </select>
                <button
                  onClick={handleAddRule}
                  className="px-6 py-3 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white rounded-lg transition-all duration-200 flex items-center gap-2 active:scale-[0.98] shadow-sm hover:shadow-md"
                >
                  <Plus size={18} />
                  <span className="font-medium">添加</span>
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              💡 普通模式：包含關鍵字即屏蔽<br/>
              🔧 正則模式：支持正則表達式匹配
            </p>
          </div>

          {/* 規則列表 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                當前規則
              </h3>
              <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-full">
                {config.rules.length}
              </span>
            </div>
            
            {loading ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <div className="inline-flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-gray-300 border-t-teal-500 rounded-full animate-spin"></div>
                  <span>加載中...</span>
                </div>
              </div>
            ) : config.rules.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <div className="inline-flex flex-col items-center gap-3">
                  <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                    <Plus size={24} className="text-gray-400" />
                  </div>
                  <div>
                    <p className="font-medium">暫無屏蔽規則</p>
                    <p className="text-sm mt-1">點擊上方添加關鍵字</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {config.rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 flex items-center gap-3 active:bg-gray-100 dark:active:bg-gray-750 transition-colors duration-150"
                  >
                    {/* 啟用/禁用按鈕 */}
                    <button
                      onClick={() => handleToggleRule(rule.id)}
                      className="flex-shrink-0 active:scale-95 transition-transform duration-150"
                    >
                      {rule.enabled ? (
                        <ToggleRight
                          size={28}
                          className="text-teal-500 hover:text-teal-400 transition-colors duration-150"
                        />
                      ) : (
                        <ToggleLeft
                          size={28}
                          className="text-gray-400 hover:text-gray-300 transition-colors duration-150"
                        />
                      )}
                    </button>

                    {/* 關鍵字 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col gap-1.5">
                        <span
                          className={`font-mono text-sm break-all leading-relaxed ${
                            rule.enabled ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'
                          }`}
                        >
                          {rule.keyword}
                        </span>
                        <span
                          className={`inline-flex items-center self-start text-xs px-2.5 py-1 rounded-full font-medium ${
                            rule.type === 'regex'
                              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                              : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                          }`}
                        >
                          {rule.type === 'regex' ? '🔧 正則' : '💬 普通'}
                        </span>
                      </div>
                    </div>

                    {/* 刪除按鈕 */}
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      className="flex-shrink-0 p-2 text-red-500 hover:text-red-600 active:text-red-700 active:scale-90 transition-all duration-150"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 底部按鈕 */}
        <div className="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 px-4 py-4">
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 dark:active:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl font-medium transition-all duration-200 active:scale-[0.98]"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-3 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 disabled:bg-gray-300 disabled:cursor-not-allowed dark:disabled:bg-gray-700 text-white rounded-xl font-medium transition-all duration-200 active:scale-[0.98] shadow-sm hover:shadow-md disabled:shadow-none"
            >
              {saving ? (
                <span className="inline-flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  保存中...
                </span>
              ) : (
                '保存'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
