/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { AlertCircle, CheckCircle, Eye, EyeOff, User, Lock } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { CURRENT_VERSION } from '@/lib/version';
import { checkForUpdates, UpdateStatus } from '@/lib/version_check';

import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

// 版本顯示組件
function VersionDisplay() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const status = await checkForUpdates();
        setUpdateStatus(status);
      } catch (_) {
        // do nothing
      } finally {
        setIsChecking(false);
      }
    };

    checkUpdate();
  }, []);

  return (
    <button
      onClick={() =>
        window.open('https://github.com/mtvpls/MoonTVPlus', '_blank')
      }
      className='absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 transition-colors cursor-pointer'
    >
      <span className='font-mono'>v{CURRENT_VERSION}</span>
      {!isChecking && updateStatus !== UpdateStatus.FETCH_FAILED && (
        <div
          className={`flex items-center gap-1.5 ${updateStatus === UpdateStatus.HAS_UPDATE
            ? 'text-yellow-600 dark:text-yellow-400'
            : updateStatus === UpdateStatus.NO_UPDATE
              ? 'text-green-600 dark:text-green-400'
              : ''
            }`}
        >
          {updateStatus === UpdateStatus.HAS_UPDATE && (
            <>
              <AlertCircle className='w-3.5 h-3.5' />
              <span className='font-semibold text-xs'>有新版本</span>
            </>
          )}
          {updateStatus === UpdateStatus.NO_UPDATE && (
            <>
              <CheckCircle className='w-3.5 h-3.5' />
              <span className='font-semibold text-xs'>已是最新</span>
            </>
          )}
        </div>
      )}
    </button>
  );
}

function RegisterPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const [siteConfig, setSiteConfig] = useState<any>(null);
  const [turnstileWidgetId, setTurnstileWidgetId] = useState<string | null>(null);
  const [backgroundImage, setBackgroundImage] = useState<string>('');

  const { siteName } = useSite();

  // 在客戶端掛載後設置配置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const runtimeConfig = (window as any).RUNTIME_CONFIG;

      // 設置背景圖（支持多張隨機選擇）
      const registerBg = runtimeConfig?.REGISTER_BACKGROUND_IMAGE;
      if (registerBg) {
        const urls = registerBg
          .split('\n')
          .map((url: string) => url.trim())
          .filter((url: string) => url !== '');

        if (urls.length > 0) {
          // 隨機選擇一張背景圖
          const randomIndex = Math.floor(Math.random() * urls.length);
          setBackgroundImage(urls[randomIndex]);
        }
      }

      // 設置站點配置
      const config = {
        EnableRegistration: runtimeConfig?.ENABLE_REGISTRATION || false,
        RequireRegistrationInviteCode: runtimeConfig?.REQUIRE_REGISTRATION_INVITE_CODE || false,
        RegistrationRequireTurnstile: runtimeConfig?.REGISTRATION_REQUIRE_TURNSTILE || false,
        TurnstileSiteKey: runtimeConfig?.TURNSTILE_SITE_KEY || '',
      };
      setSiteConfig(config);

      // 如果未開啟註冊，重定向到登錄頁
      if (!config.EnableRegistration) {
        router.replace('/login');
      }
    }
  }, [router]);

  // 加載Cloudflare Turnstile腳本
  useEffect(() => {
    if (!siteConfig?.RegistrationRequireTurnstile || !siteConfig?.TurnstileSiteKey) {
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      setTurnstileLoaded(true);
    };
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, [siteConfig]);

  // 渲染Turnstile組件
  useEffect(() => {
    if (!turnstileLoaded || !siteConfig?.TurnstileSiteKey) {
      return;
    }

    const container = document.getElementById('turnstile-container');
    if (container && (window as any).turnstile) {
      const widgetId = (window as any).turnstile.render('#turnstile-container', {
        sitekey: siteConfig.TurnstileSiteKey,
        callback: (token: string) => {
          setTurnstileToken(token);
        },
      });
      setTurnstileWidgetId(widgetId);
    }
  }, [turnstileLoaded, siteConfig]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!username || !password || !confirmPassword) {
      setError('請填寫所有字段');
      return;
    }

    if (siteConfig?.RequireRegistrationInviteCode && !inviteCode.trim()) {
      setError('請輸入邀請碼');
      return;
    }

    if (password !== confirmPassword) {
      setError('兩次輸入的密碼不一致');
      return;
    }

    if (password.length < 6) {
      setError('密碼長度至少為6位');
      return;
    }

    // 檢查Turnstile驗證
    if (siteConfig?.RegistrationRequireTurnstile && !turnstileToken) {
      setError('請完成人機驗證');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          inviteCode: siteConfig?.RequireRegistrationInviteCode ? inviteCode.trim() : undefined,
          turnstileToken: siteConfig?.RegistrationRequireTurnstile ? turnstileToken : undefined,
        }),
      });

      if (res.ok) {
        // 註冊成功，跳轉到登錄頁
        const redirect = searchParams.get('redirect') || '/login';
        router.replace(redirect);
      } else {
        // 註冊失敗，重置Turnstile
        if (siteConfig?.RegistrationRequireTurnstile && turnstileWidgetId !== null && (window as any).turnstile) {
          (window as any).turnstile.reset(turnstileWidgetId);
          setTurnstileToken(null);
        }

        if (res.status === 400) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || '註冊失敗');
        } else if (res.status === 409) {
          setError('用戶名已存在');
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? '服務器錯誤');
        }
      }
    } catch (error) {
      // 網絡錯誤，重置Turnstile
      if (siteConfig?.RegistrationRequireTurnstile && turnstileWidgetId !== null && (window as any).turnstile) {
        (window as any).turnstile.reset(turnstileWidgetId);
        setTurnstileToken(null);
      }
      setError('網絡錯誤，請稍後重試');
    } finally {
      setLoading(false);
    }
  };

  // 如果配置未加載或未開啟註冊，顯示加載中
  if (!siteConfig) {
    return (
      <div className='relative min-h-screen flex items-center justify-center px-4'>
        <div className='text-gray-500 dark:text-gray-400'>加載中...</div>
      </div>
    );
  }

  return (
    <div
      className='relative min-h-screen flex items-center justify-center px-4 overflow-hidden'
      style={backgroundImage ? {
        backgroundImage: `url(${backgroundImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      } : undefined}
    >
      <div className='absolute top-4 right-4'>
        <ThemeToggle />
      </div>
      <div className='relative z-10 w-full max-w-md rounded-3xl bg-gradient-to-b from-white/90 via-white/70 to-white/40 dark:from-zinc-900/90 dark:via-zinc-900/70 dark:to-zinc-900/40 shadow-2xl p-10 dark:border dark:border-zinc-800'>
        <h1 className='text-green-600 tracking-tight text-center text-3xl font-extrabold mb-2 bg-clip-text drop-shadow-sm'>
          {siteName}
        </h1>
        <p className='text-center text-sm text-gray-600 dark:text-gray-400 mb-8'>
          創建新賬號
        </p>
        <form onSubmit={handleSubmit} className='space-y-6'>
          <div>
            <label htmlFor='username' className='sr-only'>
              用戶名
            </label>
            <div className='relative'>
              <div className='absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none'>
                <User className='h-5 w-5 text-gray-400 dark:text-gray-500' />
              </div>
              <input
                id='username'
                type='text'
                autoComplete='username'
                className='block w-full rounded-lg border-0 py-3 pl-10 pr-4 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60'
                placeholder='輸入用戶名'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label htmlFor='password' className='sr-only'>
              密碼
            </label>
            <div className='relative'>
              <div className='absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none'>
                <Lock className='h-5 w-5 text-gray-400 dark:text-gray-500' />
              </div>
              <input
                id='password'
                type={showPassword ? 'text' : 'password'}
                autoComplete='new-password'
                className='block w-full rounded-lg border-0 py-3 pl-10 pr-12 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60'
                placeholder='輸入密碼（至少6位）'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type='button'
                className='absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff className='h-5 w-5' />
                ) : (
                  <Eye className='h-5 w-5' />
                )}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor='confirmPassword' className='sr-only'>
              確認密碼
            </label>
            <div className='relative'>
              <div className='absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none'>
                <Lock className='h-5 w-5 text-gray-400 dark:text-gray-500' />
              </div>
              <input
                id='confirmPassword'
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete='new-password'
                className='block w-full rounded-lg border-0 py-3 pl-10 pr-12 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60'
                placeholder='再次輸入密碼'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <button
                type='button'
                className='absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? (
                  <EyeOff className='h-5 w-5' />
                ) : (
                  <Eye className='h-5 w-5' />
                )}
              </button>
            </div>
          </div>

          {siteConfig?.RequireRegistrationInviteCode && (
            <div>
              <label htmlFor='inviteCode' className='sr-only'>
                邀請碼
              </label>
              <div className='relative'>
                <div className='absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none'>
                  <User className='h-5 w-5 text-gray-400 dark:text-gray-500' />
                </div>
                <input
                  id='inviteCode'
                  type='text'
                  className='block w-full rounded-lg border-0 py-3 pl-10 pr-4 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60'
                  placeholder='輸入邀請碼'
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Cloudflare Turnstile */}
          {siteConfig?.RegistrationRequireTurnstile && siteConfig?.TurnstileSiteKey && (
            <div id='turnstile-container' className='flex justify-center'></div>
          )}

          {error && (
            <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
          )}

          {/* 註冊按鈕 */}
          <button
            type='submit'
            disabled={
              !username || !password || !confirmPassword || loading ||
              (siteConfig?.RequireRegistrationInviteCode && !inviteCode.trim()) ||
              (siteConfig?.RegistrationRequireTurnstile && !turnstileToken)
            }
            className='inline-flex w-full justify-center rounded-lg bg-green-600 py-3 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:from-green-600 hover:to-blue-600 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {loading ? '註冊中...' : '註冊'}
          </button>

          {/* 返回登錄鏈接 */}
          <div className='text-center'>
            <button
              type='button'
              onClick={() => router.push('/login')}
              className='text-sm text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 transition-colors'
            >
              已有賬號？返回登錄
            </button>
          </div>
        </form>
      </div>

      {/* 版本信息顯示 */}
      <VersionDisplay />
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RegisterPageClient />
    </Suspense>
  );
}
