import { NextRequest, NextResponse } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { EmailService } from '@/lib/email.service';

export const runtime = 'nodejs';

/**
 * GET - 獲取郵件配置
 */
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const storage = getStorage();
    const userInfo = await storage.getUserInfoV2?.(authInfo.username);

    // 只有管理員和站長可以訪問
    if (!userInfo || (userInfo.role !== 'admin' && userInfo.role !== 'owner')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const adminConfig = await getConfig();
    const emailConfig = adminConfig?.EmailConfig || {
      enabled: false,
      provider: 'smtp' as const,
    };

    // 不返回敏感信息（密碼、API Key）
    const safeConfig = {
      enabled: emailConfig.enabled,
      provider: emailConfig.provider,
      smtp: emailConfig.smtp
        ? {
            host: emailConfig.smtp.host,
            port: emailConfig.smtp.port,
            secure: emailConfig.smtp.secure,
            user: emailConfig.smtp.user,
            from: emailConfig.smtp.from,
            password: emailConfig.smtp.password ? '******' : '',
          }
        : undefined,
      resend: emailConfig.resend
        ? {
            from: emailConfig.resend.from,
            apiKey: emailConfig.resend.apiKey ? '******' : '',
          }
        : undefined,
    };

    return NextResponse.json(safeConfig);
  } catch (error) {
    console.error('獲取郵件配置失敗:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * POST - 保存郵件配置或發送測試郵件
 */
export async function POST(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const storage = getStorage();
    const userInfo = await storage.getUserInfoV2?.(authInfo.username);

    // 只有管理員和站長可以訪問
    if (!userInfo || (userInfo.role !== 'admin' && userInfo.role !== 'owner')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { action, config, testEmail } = body;

    // 發送測試郵件
    if (action === 'test') {
      if (!testEmail) {
        return NextResponse.json(
          { error: '請提供測試郵箱地址' },
          { status: 400 }
        );
      }

      const emailConfig = config as AdminConfig['EmailConfig'];
      if (!emailConfig || !emailConfig.enabled) {
        return NextResponse.json(
          { error: '郵件配置未啟用' },
          { status: 400 }
        );
      }

      try {
        const adminConfig = await getConfig();
        const siteName = adminConfig?.SiteConfig?.SiteName || 'MoonTVPlus';
        await EmailService.sendTestEmail(emailConfig, testEmail, siteName);
        return NextResponse.json({ success: true, message: '測試郵件發送成功' });
      } catch (error) {
        console.error('發送測試郵件失敗:', error);
        return NextResponse.json(
          { error: `發送失敗: ${(error as Error).message}` },
          { status: 500 }
        );
      }
    }

    // 保存郵件配置
    if (action === 'save') {
      const emailConfig = config as AdminConfig['EmailConfig'];
      if (!emailConfig) {
        return NextResponse.json(
          { error: '郵件配置不能為空' },
          { status: 400 }
        );
      }

      // 驗證配置
      if (emailConfig.enabled) {
        if (emailConfig.provider === 'smtp') {
          if (!emailConfig.smtp?.host || !emailConfig.smtp?.port || !emailConfig.smtp?.user || !emailConfig.smtp?.from) {
            return NextResponse.json(
              { error: 'SMTP配置不完整' },
              { status: 400 }
            );
          }
        } else if (emailConfig.provider === 'resend') {
          if (!emailConfig.resend?.apiKey || !emailConfig.resend?.from) {
            return NextResponse.json(
              { error: 'Resend配置不完整' },
              { status: 400 }
            );
          }
        }
      }

      // 獲取現有配置
      const adminConfig = await getConfig();
      if (!adminConfig) {
        return NextResponse.json(
          { error: '管理員配置不存在' },
          { status: 500 }
        );
      }

      // 如果密碼或API Key是佔位符，保留原有值
      if (emailConfig.smtp?.password === '******') {
        const oldConfig = adminConfig.EmailConfig;
        if (oldConfig?.smtp?.password) {
          emailConfig.smtp.password = oldConfig.smtp.password;
        }
      }

      if (emailConfig.resend?.apiKey === '******') {
        const oldConfig = adminConfig.EmailConfig;
        if (oldConfig?.resend?.apiKey) {
          emailConfig.resend.apiKey = oldConfig.resend.apiKey;
        }
      }

      // 更新配置
      adminConfig.EmailConfig = emailConfig;
      await storage.setAdminConfig(adminConfig);

      return NextResponse.json({ success: true, message: '郵件配置保存成功' });
    }

    return NextResponse.json(
      { error: '無效的操作' },
      { status: 400 }
    );
  } catch (error) {
    console.error('處理郵件配置失敗:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
