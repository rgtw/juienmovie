import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const oidcSessionCookie = request.cookies.get('oidc_session')?.value;

    if (!oidcSessionCookie) {
      return NextResponse.json(
        { error: 'OIDC會話不存在' },
        { status: 404 }
      );
    }

    let oidcSession;
    try {
      oidcSession = JSON.parse(oidcSessionCookie);
    } catch {
      return NextResponse.json(
        { error: 'OIDC會話無效' },
        { status: 400 }
      );
    }

    // 檢查session是否過期(10分鐘)
    if (Date.now() - oidcSession.timestamp > 600000) {
      return NextResponse.json(
        { error: 'OIDC會話已過期' },
        { status: 400 }
      );
    }

    // 返回用戶信息(不包含sub)
    return NextResponse.json({
      email: oidcSession.email,
      name: oidcSession.name,
      trust_level: oidcSession.trust_level,
    });
  } catch (error) {
    return NextResponse.json(
      { error: '服務器錯誤' },
      { status: 500 }
    );
  }
}
