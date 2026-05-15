/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import {
  orchestrateDataSources,
  VideoContext,
} from '@/lib/ai-orchestrator';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { hasFeaturePermission } from '@/lib/permissions';

export const runtime = 'nodejs';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  message: string;
  context?: VideoContext;
  history?: ChatMessage[];
}

/**
 * OpenAI兼容的流式聊天請求
 */
async function streamOpenAIChat(
  messages: ChatMessage[],
  config: {
    apiKey: string;
    baseURL: string;
    model: string;
    temperature: number;
    maxTokens: number;
  },
  enableStreaming = true
): Promise<ReadableStream | Response> {
  const response = await fetch(`${config.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: enableStreaming,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI API error: ${response.status} ${response.statusText}`
    );
  }

  return enableStreaming ? response.body! : response;
}

/**
 * 轉換流為SSE格式
 */
function transformToSSE(
  stream: ReadableStream,
  provider: 'openai' | 'claude' | 'custom'
): ReadableStream {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      let buffer = ''; // 緩衝區，用於保存不完整的行
      let contentBuffer = ''; // 累積的內容，用於處理跨chunk的thinking標籤
      let inThinkingBlock = false; // 是否在thinking塊內

      try {
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
              const data = line.slice(6).trim();

              // 跳過空數據
              if (!data) {
                continue;
              }

              if (data === '[DONE]') {
                controller.enqueue(
                  new TextEncoder().encode('data: [DONE]\n\n')
                );
                continue;
              }

              try {
                const json = JSON.parse(data);

                // 提取文本內容
                let text = '';
                if (provider === 'claude') {
                  // Claude格式
                  if (json.type === 'content_block_delta') {
                    text = json.delta?.text || '';
                  }
                } else {
                  // OpenAI格式
                  text = json.choices?.[0]?.delta?.content || '';
                }

                if (text) {
                  // 累積內容並處理thinking標籤
                  contentBuffer += text;

                  // 檢查是否進入thinking塊
                  if (contentBuffer.includes('<think>')) {
                    inThinkingBlock = true;
                  }

                  // 檢查是否退出thinking塊
                  if (inThinkingBlock && contentBuffer.includes('</think>')) {
                    // 移除thinking塊內容
                    contentBuffer = contentBuffer.replace(/<think>[\s\S]*?<\/think>/g, '');
                    inThinkingBlock = false;
                  }

                  // 只有在不在thinking塊內時才輸出內容
                  if (!inThinkingBlock) {
                    // 輸出非thinking部分的內容
                    const outputText = contentBuffer;
                    if (outputText) {
                      controller.enqueue(
                        new TextEncoder().encode(`data: ${JSON.stringify({ text: outputText })}\n\n`)
                      );
                      contentBuffer = ''; // 清空已輸出的內容
                    }
                  }
                }
              } catch (e) {
                // 只在非空數據解析失敗時打印錯誤
                if (data.length > 0) {
                  console.error('Parse stream chunk error:', e, 'Data:', data.substring(0, 100));
                }
              }
            }
          }
        }

        // 處理緩衝區中剩餘的數據
        if (buffer.trim()) {
          const line = buffer.trim();
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data && data !== '[DONE]') {
              try {
                const json = JSON.parse(data);
                let text = '';
                if (provider === 'claude') {
                  if (json.type === 'content_block_delta') {
                    text = json.delta?.text || '';
                  }
                } else {
                  text = json.choices?.[0]?.delta?.content || '';
                }
                if (text) {
                  contentBuffer += text;
                  // 最後清理一次thinking標籤
                  contentBuffer = contentBuffer.replace(/<think>[\s\S]*?<\/think>/g, '');
                  if (contentBuffer) {
                    controller.enqueue(
                      new TextEncoder().encode(`data: ${JSON.stringify({ text: contentBuffer })}\n\n`)
                    );
                  }
                }
              } catch (e) {
                console.error('Parse final buffer error:', e);
              }
            }
          }
        }
      } catch (error) {
        console.error('Stream error:', error);
        controller.error(error);
      } finally {
        controller.close();
      }
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    // 1. 驗證用戶登錄
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!(await hasFeaturePermission(authInfo.username, 'ai_ask'))) {
      return NextResponse.json({ error: '無權限使用 AI 問片功能' }, { status: 403 });
    }

    // 2. 獲取AI配置
    const adminConfig = await getConfig();
    const aiConfig = adminConfig.AIConfig;

    if (!aiConfig || !aiConfig.Enabled) {
      return NextResponse.json(
        { error: 'AI功能未啟用' },
        { status: 400 }
      );
    }

    // 3. 解析請求參數
    const body = (await request.json()) as ChatRequest;
    const { message, context, history = [] } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: '消息內容不能為空' },
        { status: 400 }
      );
    }

    console.log('📨 收到AI聊天請求:', {
      message: message.slice(0, 50),
      context,
      historyLength: history.length,
    });

    // 4. 使用orchestrator協調數據源
    const orchestrationResult = await orchestrateDataSources(
      message,
      context,
      {
        enableWebSearch: aiConfig.EnableWebSearch,
        webSearchProvider: aiConfig.WebSearchProvider,
        tavilyApiKey: aiConfig.TavilyApiKey,
        serperApiKey: aiConfig.SerperApiKey,
        serpApiKey: aiConfig.SerpApiKey,
        // TMDB 配置
        tmdbApiKey: adminConfig.SiteConfig.TMDBApiKey,
        tmdbProxy: adminConfig.SiteConfig.TMDBProxy,
        tmdbReverseProxy: adminConfig.SiteConfig.TMDBReverseProxy,
        // 決策模型配置（固定使用自定義provider，複用主模型的API配置）
        enableDecisionModel: aiConfig.EnableDecisionModel,
        decisionProvider: 'custom',
        decisionApiKey: aiConfig.CustomApiKey,
        decisionBaseURL: aiConfig.CustomBaseURL,
        decisionModel: aiConfig.DecisionCustomModel,
      }
    );

    console.log('🎯 數據協調完成, systemPrompt長度:', orchestrationResult.systemPrompt.length);

    // 5. 構建消息列表
    const systemPrompt = aiConfig.SystemPrompt
      ? `${aiConfig.SystemPrompt}\n\n${orchestrationResult.systemPrompt}`
      : orchestrationResult.systemPrompt;

    const messages: ChatMessage[] = [
      { role: 'user', content: systemPrompt },
      { role: 'assistant', content: '明白了，我會按照要求回答用戶的問題。' },
      ...history,
      { role: 'user', content: message },
    ];

    // 6. 調用自定義API
    const temperature = aiConfig.Temperature ?? 0.7;
    const maxTokens = aiConfig.MaxTokens ?? 1000;
    const enableStreaming = aiConfig.EnableStreaming !== false; // 默認啟用流式響應

    if (!aiConfig.CustomApiKey || !aiConfig.CustomBaseURL) {
      return NextResponse.json(
        { error: '自定義API配置不完整' },
        { status: 400 }
      );
    }

    const result = await streamOpenAIChat(messages, {
      apiKey: aiConfig.CustomApiKey,
      baseURL: aiConfig.CustomBaseURL,
      model: aiConfig.CustomModel || 'gpt-3.5-turbo',
      temperature,
      maxTokens,
    }, enableStreaming);

    // 7. 根據是否啟用流式響應返回不同格式
    if (enableStreaming) {
      // 流式響應：轉換為SSE格式並返回
      const sseStream = transformToSSE(result as ReadableStream, 'openai');

      return new NextResponse(sseStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } else {
      // 非流式響應：等待完整響應後返回JSON
      const response = result as Response;
      const data = await response.json();
      let content = data.choices?.[0]?.message?.content || '';

      // 移除thinking標籤內容
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '');

      return NextResponse.json({ content });
    }
  } catch (error) {
    console.error('❌ AI聊天API錯誤:', error);
    return NextResponse.json(
      {
        error: 'AI聊天請求失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
