import { NextRequest, NextResponse } from 'next/server';

import { generateAIComments, AIComment } from '@/lib/ai-comment-generator';
import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

interface AICommentsResponse {
  comments: AIComment[];
  total: number;
  movieName: string;
  isAiGenerated: true;
  generatedAt: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const movieName = searchParams.get('name');
    const movieInfo = searchParams.get('info');
    const count = parseInt(searchParams.get('count') || '10');

    // 參數驗證
    if (!movieName) {
      return NextResponse.json(
        { error: '缺少影片名稱參數' },
        { status: 400 }
      );
    }

    if (count < 1 || count > 50) {
      return NextResponse.json(
        { error: '評論數量必須在1-50之間' },
        { status: 400 }
      );
    }

    // 讀取AI配置
    const config = await getConfig();
    const aiConfig = config.AIConfig;

    // 檢查AI功能是否啟用
    if (!aiConfig?.Enabled) {
      return NextResponse.json(
        { error: 'AI功能未啟用' },
        { status: 403 }
      );
    }

    // 檢查AI評論功能是否啟用
    if (!aiConfig?.EnableAIComments) {
      return NextResponse.json(
        { error: 'AI評論功能未啟用' },
        { status: 403 }
      );
    }

    // 檢查必要的配置
    if (!aiConfig.CustomApiKey || !aiConfig.CustomBaseURL || !aiConfig.CustomModel) {
      return NextResponse.json(
        { error: 'AI配置不完整，請在管理面板配置' },
        { status: 500 }
      );
    }

    // 生成AI評論
    const comments = await generateAIComments({
      movieName,
      movieInfo: movieInfo || undefined,
      count,
      aiConfig: {
        CustomApiKey: aiConfig.CustomApiKey,
        CustomBaseURL: aiConfig.CustomBaseURL,
        CustomModel: aiConfig.CustomModel,
        Temperature: aiConfig.Temperature,
        MaxTokens: aiConfig.MaxTokens,
        EnableWebSearch: aiConfig.EnableWebSearch,
        WebSearchProvider: aiConfig.WebSearchProvider,
        TavilyApiKey: aiConfig.TavilyApiKey,
        SerperApiKey: aiConfig.SerperApiKey,
        SerpApiKey: aiConfig.SerpApiKey,
      },
    });

    // 返回結果
    const response: AICommentsResponse = {
      comments,
      total: comments.length,
      movieName,
      isAiGenerated: true,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('AI評論生成失敗:', error);

    // 返回友好的錯誤信息
    const errorMessage = error instanceof Error ? error.message : 'AI評論生成失敗';

    return NextResponse.json(
      {
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined
      },
      { status: 500 }
    );
  }
}
