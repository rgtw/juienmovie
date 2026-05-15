/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { Bot, Loader2, Send, Sparkles, Trash2,X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { VideoContext } from '@/lib/ai-orchestrator';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AIChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  context?: VideoContext;
  welcomeMessage?: string;
  onStreamingChange?: (isStreaming: boolean) => void;
  useDrawer?: boolean;
  drawerWidth?: string;
}

export default function AIChatPanel({
  isOpen,
  onClose,
  context,
  welcomeMessage = '你好！我是MoonTVPlus的AI影視助手，有什麼可以幫你的嗎？',
  onStreamingChange,
  useDrawer = false,
  drawerWidth = 'w-full md:w-[25%]',
}: AIChatPanelProps) {
  const pathname = usePathname();

  // 使用 useMemo 穩定 storage key，只在實際內容變化時才改變
  const storageKey = useMemo(() => {
    if (context?.title) {
      return `ai-chat-${context.title}-${context.year || ''}-${context.type || ''}`;
    }
    return 'ai-chat-general';
  }, [context?.title, context?.year, context?.type]);

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: welcomeMessage },
  ]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [currentUsername, setCurrentUsername] = useState('用戶');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevStorageKeyRef = useRef<string>(storageKey);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasLoadedRef = useRef(false);

  // 將《》包裹的影視名稱轉換為鏈接
  const convertTitleToLink = (content: string): string => {
    return content.replace(/《([^》]+)》/g, (match, title) => {
      const encodedTitle = encodeURIComponent(title);
      return `[《${title}》](/play?title=${encodedTitle})`;
    });
  };

  // 自動滾動到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const authInfo = getAuthInfoFromBrowserCookie();
    setCurrentUsername(authInfo?.username || '用戶');
  }, []);

  const userAvatarText = currentUsername.trim().charAt(0).toUpperCase() || '用';

  // 從sessionStorage加載消息記錄
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 如果已經加載過當前 storageKey，跳過
    if (hasLoadedRef.current) return;

    const savedMessages = sessionStorage.getItem(storageKey);

    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      } catch (error) {
        console.error('加載聊天記錄失敗:', error);
      }
    }

    // 標記為已加載
    hasLoadedRef.current = true;
  }, [storageKey]); // 當 storageKey 變化時重新加載

  // 保存消息記錄到sessionStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages));
    } catch (error) {
      console.error('保存聊天記錄失敗:', error);
    }
  }, [messages, storageKey]); // 消息變化時保存

  // 檢測VideoContext變化，清除舊的聊天記錄
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (prevStorageKeyRef.current !== storageKey) {
      // 上下文變化了，取消正在進行的請求
      if (abortControllerRef.current) {
        console.log('視頻上下文變化，取消正在進行的AI請求');
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        setIsStreaming(false);
      }

      // 清除消息並重置為歡迎消息
      console.log('視頻上下文變化，清除聊天記錄');
      setMessages([{ role: 'assistant', content: welcomeMessage }]);

      // 重置加載標記，允許加載新視頻的聊天記錄
      hasLoadedRef.current = false;

      prevStorageKeyRef.current = storageKey;
    }
  }, [storageKey, welcomeMessage]); // 監聽 storageKey 變化

  // 通知父組件 streaming 狀態變化
  useEffect(() => {
    onStreamingChange?.(isStreaming);
  }, [isStreaming, onStreamingChange]);

  // 自動聚焦輸入框和防止背景滾動
  useEffect(() => {
    if (isOpen) {
      // 檢測是否為移動設備
      const checkMobile = () => {
        setIsMobile(window.innerWidth < 768);
      };
      checkMobile();

      // 只在非移動設備上聚焦輸入框
      if (inputRef.current && window.innerWidth >= 768) {
        inputRef.current.focus();
      }

      // 只在非抽屜模式下防止背景滾動
      if (!useDrawer) {
        const originalOverflow = document.body.style.overflow;
        const originalPaddingRight = document.body.style.paddingRight;

        // 獲取滾動條寬度
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

        document.body.style.overflow = 'hidden';
        document.body.style.paddingRight = `${scrollbarWidth}px`;

        return () => {
          document.body.style.overflow = originalOverflow;
          document.body.style.paddingRight = originalPaddingRight;
        };
      }
    }
  }, [isOpen, useDrawer]);

  const handleSendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput('');

    // 添加用戶消息
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);

    // 開始流式響應
    setIsStreaming(true);

    // 先添加一個空的助手消息用於流式更新或顯示錯誤
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    // 創建新的 AbortController
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          context,
    history: messages.filter((m) => m.role !== 'assistant' || m.content !== welcomeMessage),
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
     const errorMsg = errorData.error || errorData.details || `請求失敗 (${response.status})`;
        throw new Error(errorMsg);
      }

      // 檢查響應類型：流式(text/event-stream)或非流式(application/json)
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('text/event-stream')) {
        // 處理流式響應
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error('無法讀取響應流');
        }

        let assistantMessage = '';
        let buffer = ''; // 緩衝區，用於保存不完整的行

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          // 將新chunk與緩衝區拼接
          const text = buffer + chunk;
          // 按換行符分割，最後一個元素可能是不完整的行
          const parts = text.split('\n');
          // 保存最後一個不完整的行到緩衝區
          buffer = parts.pop() || '';

          // 處理完整的行
          const lines = parts.filter((line) => line.trim() !== '');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);

              if (data === '[DONE]') {
                break;
              }

              try {
                const json = JSON.parse(data);
                const text = json.text || '';

                if (text) {
                  assistantMessage += text;

              // 更新最後一條消息
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = {
                      role: 'assistant',
                      content: assistantMessage,
               };
                    return newMessages;
                  });
                }
              } catch (e) {
                console.error('解析SSE數據失敗:', e);
              }
            }
          }
        }

        // 處理緩衝區中剩餘的數據
        if (buffer.trim()) {
          const line = buffer.trim();
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data && data !== '[DONE]') {
              try {
                const json = JSON.parse(data);
                const text = json.text || '';
                if (text) {
                  assistantMessage += text;
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = {
                      role: 'assistant',
                      content: assistantMessage,
                    };
                    return newMessages;
                  });
                }
              } catch (e) {
                console.error('解析最終緩衝區數據失敗:', e);
              }
            }
          }
        }
      } else {
        // 處理非流式響應
        const data = await response.json();
        const content = data.content || '';

        // 更新最後一條消息為完整響應
        setMessages((prev) => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1] = {
            role: 'assistant',
            content: content,
          };
          return newMessages;
        });
      }
    } catch (error) {
      // 如果是主動取消的請求（切換視頻或其他原因），不顯示錯誤
      if ((error as Error).name === 'AbortError') {
        console.log('請求已取消');
        return;
      }

      console.error('發送消息失敗:', error);

      // 更新最後一條空消息為錯誤消息
      setMessages((prev) => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = {
          role: 'assistant',
          content: `❌ 抱歉，出現了錯誤：\n\n${(error as Error).message}\n\n請檢查：\n- AI服務配置是否正確\n- API密鑰是否有效\n- 網絡連接是否正常`,
        };
        return newMessages;
      });
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // 清空聊天上下文
  const handleClearContext = () => {
    if (typeof window === 'undefined') return;

    // 清除sessionStorage
    sessionStorage.removeItem(storageKey);

    // 重置消息為歡迎消息
    setMessages([{ role: 'assistant', content: welcomeMessage }]);

    console.log('已清空聊天上下文');
  };

  const modalContent = useDrawer ? (
    // 抽屜模式
    <div
      className={`fixed inset-0 z-[1002] flex items-center justify-end transition-opacity duration-200 pointer-events-none ${
        isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div
        className={`relative ${drawerWidth} h-full bg-white dark:bg-gray-900 shadow-2xl flex flex-col transition-transform duration-300 ease-out pointer-events-auto ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* 頭部 */}
        <div className='flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700'>
          <div className='flex items-center gap-3 min-w-0 flex-1'>
            <div className='flex h-10 w-10 items-center justify-center rounded-full bg-purple-500 flex-shrink-0'>
              <Sparkles size={20} className='text-white' />
            </div>
            <div className='min-w-0 flex-1'>
              <h2 className='text-lg font-semibold text-gray-900 dark:text-white'>
                AI影視助手
              </h2>
              {context?.title && (
                <p className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                  正在討論: {context.title}
                  {context.year && ` (${context.year})`}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className='rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 flex-shrink-0'
          >
            <X size={20} />
          </button>
        </div>

        {/* 消息列表 */}
        <div className='flex-1 overflow-y-auto p-4'>
          <div className='space-y-4'>
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`flex max-w-[80%] gap-3 ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  {/* 頭像 */}
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      message.role === 'user'
                        ? 'bg-blue-500'
                        : 'bg-purple-500'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <span className='text-xs font-semibold text-white'>
                        {userAvatarText}
                      </span>
                    ) : (
                      <Bot size={16} className='text-white' />
                    )}
                  </div>

                  {/* 消息內容 */}
                  <div
                    className={`rounded-2xl px-4 py-2 ${
                      message.role === 'user'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <p className='whitespace-pre-wrap break-words text-sm leading-relaxed'>
                        {message.content}
                      </p>
                    ) : (
                      <div className='prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-p:leading-relaxed prose-pre:bg-gray-800 prose-pre:text-gray-100 dark:prose-pre:bg-gray-900 prose-code:text-purple-600 dark:prose-code:text-purple-400 prose-code:bg-purple-50 dark:prose-code:bg-purple-900/20 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-a:text-inherit dark:prose-a:text-inherit prose-a:no-underline hover:prose-a:underline prose-strong:text-gray-900 dark:prose-strong:text-white prose-ul:my-2 prose-ol:my-2 prose-li:my-1'>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm as any]}
                          components={{
                            a: ({ node, href, children, ...props }) => {
                              // 如果是內部鏈接（以 / 開頭），使用 Next.js Link
                              if (href?.startsWith('/')) {
                                // 如果當前在 /play 頁面且鏈接也是 /play，不做處理（返回純文本）
                                if (pathname === '/play' && href.startsWith('/play')) {
                                  return <span>{children}</span>;
                                }
                                return (
                                  <Link href={href} {...props}>
                                    {children}
                                  </Link>
                                );
                              }
                              // 外部鏈接使用普通 a 標籤
                              return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
                            }
                          }}
                        >
                          {convertTitleToLink(message.content)}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* 加載指示器 */}
            {isStreaming && (
              <div className='flex justify-start'>
                <div className='flex max-w-[80%] gap-3'>
                  <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-500'>
                    <Bot size={16} className='text-white' />
                  </div>
                  <div className='flex items-center gap-2 rounded-2xl bg-gray-100 px-4 py-2 dark:bg-gray-800'>
                    <Loader2 size={16} className='animate-spin text-gray-500' />
                    <span className='text-sm text-gray-500 dark:text-gray-400'>
                      AI正在思考...
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 輸入區域 */}
        <div className='border-t border-gray-200 p-4 dark:border-gray-700'>
          <div className='flex gap-2'>
            <button
              onClick={handleClearContext}
              className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gray-300 text-gray-500 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800'
              title='清空聊天記錄'
              disabled={isStreaming}
            >
              <Trash2 size={20} />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isMobile ? '輸入你的問題...' : '輸入你的問題... (Shift+Enter換行)'}
              disabled={isStreaming}
              rows={1}
              className='flex-1 resize-none rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 dark:focus:border-purple-400'
              style={{
                minHeight: '48px',
                maxHeight: '120px',
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
              }}
            />
            <button
              onClick={handleSendMessage}
              disabled={!input.trim() || isStreaming}
              className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-500 text-white transition-colors hover:bg-purple-600 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {isStreaming ? (
                <Loader2 size={20} className='animate-spin' />
              ) : (
                <Send size={20} />
              )}
            </button>
          </div>

          {/* 快捷提示 */}
          {messages.length === 1 && !isStreaming && (
            <div className='mt-3 flex flex-wrap gap-2'>
              <button
                onClick={() => setInput('推薦一些高分電影')}
                className='rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
              >
                推薦高分電影
              </button>
              <button
                onClick={() => setInput('最近有什麼新電影上映？')}
                className='rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
              >
                最新上映
              </button>
              {context?.title && (
                <button
                  onClick={() =>
                    setInput(`${context.title}講的是什麼故事？`)
                  }
                  className='rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                >
                  劇情介紹
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  ) : (
    // 原有的居中彈窗模式
    <div
      className={`fixed inset-0 z-[1002] flex items-center justify-center bg-black/50 backdrop-blur-sm overflow-hidden transition-opacity duration-200 ${
        isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      onClick={(e) => {
        // 點擊遮罩層關閉彈窗
        if (e.target === e.currentTarget && isOpen) {
          onClose();
        }
      }}
    >
      <div className='relative mx-4 my-auto flex h-[85vh] sm:h-[80vh] max-h-[90vh] sm:max-h-[600px] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-gray-900'>
        {/* 頭部 */}
        <div className='flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700'>
          <div className='flex items-center gap-3 min-w-0 flex-1'>
            <div className='flex h-10 w-10 items-center justify-center rounded-full bg-purple-500 flex-shrink-0'>
              <Sparkles size={20} className='text-white' />
            </div>
            <div className='min-w-0 flex-1'>
        <h2 className='text-lg font-semibold text-gray-900 dark:text-white'>
                AI影視助手
              </h2>
              {context?.title && (
                <p className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                  正在討論: {context.title}
                  {context.year && ` (${context.year})`}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className='rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 flex-shrink-0'
          >
         <X size={20} />
          </button>
        </div>

        {/* 消息列表 */}
        <div className='flex-1 overflow-y-auto p-4'>
          <div className='space-y-4'>
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`flex max-w-[80%] gap-3 ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  {/* 頭像 */}
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      message.role === 'user'
                        ? 'bg-blue-500'
                        : 'bg-purple-500'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <span className='text-xs font-semibold text-white'>
                        {userAvatarText}
                      </span>
                    ) : (
                      <Bot size={16} className='text-white' />
                    )}
                  </div>

                  {/* 消息內容 */}
                  <div
                    className={`rounded-2xl px-4 py-2 ${
                      message.role === 'user'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <p className='whitespace-pre-wrap break-words text-sm leading-relaxed'>
                        {message.content}
                      </p>
                    ) : (
                      <div className='prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-p:leading-relaxed prose-pre:bg-gray-800 prose-pre:text-gray-100 dark:prose-pre:bg-gray-900 prose-code:text-purple-600 dark:prose-code:text-purple-400 prose-code:bg-purple-50 dark:prose-code:bg-purple-900/20 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-a:text-inherit dark:prose-a:text-inherit prose-a:no-underline hover:prose-a:underline prose-strong:text-gray-900 dark:prose-strong:text-white prose-ul:my-2 prose-ol:my-2 prose-li:my-1'>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm as any]}
                          components={{
                            a: ({ node, href, children, ...props }) => {
                              // 如果是內部鏈接（以 / 開頭），使用 Next.js Link
                              if (href?.startsWith('/')) {
                                // 如果當前在 /play 頁面且鏈接也是 /play，不做處理（返回純文本）
                                if (pathname === '/play' && href.startsWith('/play')) {
                                  return <span>{children}</span>;
                                }
                                return (
                                  <Link href={href} {...props}>
                                    {children}
                                  </Link>
                                );
                              }
                              // 外部鏈接使用普通 a 標籤
                              return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
                            }
                          }}
                        >
                          {convertTitleToLink(message.content)}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* 加載指示器 */}
            {isStreaming && (
              <div className='flex justify-start'>
                <div className='flex max-w-[80%] gap-3'>
                  <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-500'>
                    <Bot size={16} className='text-white' />
                  </div>
                  <div className='flex items-center gap-2 rounded-2xl bg-gray-100 px-4 py-2 dark:bg-gray-800'>
                    <Loader2 size={16} className='animate-spin text-gray-500' />
                    <span className='text-sm text-gray-500 dark:text-gray-400'>
                      AI正在思考...
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 輸入區域 */}
        <div className='border-t border-gray-200 p-4 dark:border-gray-700'>
          <div className='flex gap-2'>
            <button
              onClick={handleClearContext}
              className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gray-300 text-gray-500 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800'
              title='清空聊天記錄'
              disabled={isStreaming}
            >
              <Trash2 size={20} />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isMobile ? '輸入你的問題...' : '輸入你的問題... (Shift+Enter換行)'}
              disabled={isStreaming}
              rows={1}
              className='flex-1 resize-none rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 dark:focus:border-purple-400'
              style={{
                minHeight: '48px',
                maxHeight: '120px',
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
              }}
            />
            <button
              onClick={handleSendMessage}
              disabled={!input.trim() || isStreaming}
              className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-500 text-white transition-colors hover:bg-purple-600 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {isStreaming ? (
                <Loader2 size={20} className='animate-spin' />
              ) : (
                <Send size={20} />
              )}
            </button>
          </div>

          {/* 快捷提示 */}
          {messages.length === 1 && !isStreaming && (
            <div className='mt-3 flex flex-wrap gap-2'>
              <button
                onClick={() => setInput('推薦一些高分電影')}
                className='rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
              >
                推薦高分電影
              </button>
              <button
                onClick={() => setInput('最近有什麼新電影上映？')}
                className='rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
              >
                最新上映
              </button>
              {context?.title && (
                <button
                  onClick={() =>
                    setInput(`${context.title}講的是什麼故事？`)
                  }
                  className='rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                >
                  劇情介紹
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return typeof window !== 'undefined'
    ? createPortal(modalContent, document.body)
    : null;
}
