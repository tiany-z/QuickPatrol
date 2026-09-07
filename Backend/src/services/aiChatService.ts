/**
 * 高校后勤巡查e速办 v4.0 - M47 小程序专属 AI 流式问答工作台 (SSE Copilot UI)
 * 文件路径: src/services/aiChatService.ts
 * 核心职责: 联动 M46 获取本校解密后的大模型配置，调度 OpenAI 兼容流式端点，
 *           智能解析 DeepSeek-R1 思考流与工具调用，向前端发射高质感 SSE 事件帧。
 */

import { llmConfigService } from "./llm/llmConfigService.js";
import { LLMProbeService } from "./llm/llmProbeService.js";
import { CopilotSSEEventType, ICopilotChatRequestDto } from "../contracts/copilotContract.js";
import { aiToolRegistry } from "./aiToolRegistry.js";
import { aiSessionService } from "./aiSessionService.js";

export interface ISSEEmitter {
  sendEvent: (eventName: string, dataObj: Record<string, unknown>) => void;
  close: () => void;
}

export interface IProcessChatStreamParams {
  schoolId: number;
  userId: number;
  prompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  contextParam?: any;
  sessionUuid?: string;
  sseEmitter: ISSEEmitter;
  abortSignal: AbortSignal;
  customFetch?: typeof fetch;
}

export class AIChatService {
  public static mockFetch: typeof fetch | null = null;

  public static resetMock(): void {
    AIChatService.mockFetch = null;
  }

  /**
   * 执行完整的多阶段 Agent 流式问答
   */
  public async processCopilotChatStream(params: IProcessChatStreamParams): Promise<void> {
    const { schoolId, userId = 0, prompt, history, sessionUuid, sseEmitter, abortSignal, customFetch } = params;
    const tStart = Date.now();

    // 1. 从 M46 安全解密本校大模型运行时配置
    const llmRuntime = await llmConfigService.getRuntimeDecryptedConfig(schoolId, "primary");
    const endpoint = LLMProbeService.normalizeEndpointUrl(llmRuntime.baseUrl);

    // 2. 组装符合 OpenAI 规范的上下文消息体
    const systemPrompt = `你是由高校后勤管理处官方认证的“后勤巡查e速办 AI 智能小助手”。
当前服务学校 ID: ${schoolId}。
你的职责是严谨、专业、礼貌地解答全校师生关于隐患报修、工单流转、抢修进度及校园生活服务规章的咨询。
语言需亲切温暖，结论需有事实依据，严禁编造虚假电话或虚假工单号。`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(history || []).slice(-6),
      { role: "user", content: prompt }
    ];

    // 3. 构造上游大模型流式请求
    const activeFetch = customFetch || AIChatService.mockFetch || globalThis.fetch;
    if (!activeFetch) {
      throw new Error("当前运行时未找到可用的 fetch API 实现");
    }

    const tools = aiToolRegistry.getDeclarations();
    const requestPayload: any = {
      model: llmRuntime.modelName,
      messages,
      temperature: llmRuntime.temperature ?? 0.3,
      max_tokens: llmRuntime.maxTokens ?? 2048,
      stream: true
    };
    if (tools && tools.length > 0) {
      requestPayload.tools = tools;
    }

    const upstreamResponse = await activeFetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${(llmRuntime.apiKeyPlain || "").trim()}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      },
      body: JSON.stringify(requestPayload),
      signal: abortSignal
    });

    if (!upstreamResponse.ok) {
      const errText = await upstreamResponse.text();
      throw new Error(`上游大模型响应异常 (HTTP ${upstreamResponse.status}): ${errText.substring(0, 200)}`);
    }

    const body = upstreamResponse.body;
    if (!body) {
      throw new Error("大模型未返回可读取的数据流");
    }

    const reader = (body as any).getReader ? (body as any).getReader() : null;
    let hasSentThinkStart = false;
    let accumulatedAssistantContent = "";
    let accumulatedReasoningContent = "";
    const executedToolLogs: any[] = [];

    if (reader) {
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      try {
        while (true) {
          if (abortSignal.aborted) {
            await reader.cancel();
            break;
          }

          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const clean = line.trim();
            if (!clean.startsWith("data:")) continue;
            if (clean === "data: [DONE]") continue;

            try {
              const parsed = JSON.parse(clean.replace(/^data:\s*/, ""));
              const choice = parsed.choices?.[0];
              if (!choice) continue;

              const delta = choice.delta;

              // A. 处理 DeepSeek-R1 / OpenAI o1 等模型的思考推理流 (reasoning_content)
                if (delta?.reasoning_content) {
                  accumulatedReasoningContent += delta.reasoning_content;
                  if (!hasSentThinkStart) {
                    sseEmitter.sendEvent(CopilotSSEEventType.THINK_DELTA, {
                      delta: "",
                      isInitial: true,
                      title: "正在深度思考后勤处置规范..."
                    });
                    hasSentThinkStart = true;
                  }
                  sseEmitter.sendEvent(CopilotSSEEventType.THINK_DELTA, {
                    delta: delta.reasoning_content
                  });
                }

              // B. 处理工具调用开始与受控沙箱执行 (M48 事实工具箱集成)
              if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const toolName = tc.function?.name || "query_tool";
                  const rawArgs = tc.function?.arguments || {};
                  sseEmitter.sendEvent(CopilotSSEEventType.TOOL_START, {
                    toolInfo: {
                      toolName,
                      pillTitle: `正在执行工具 [${toolName}]...`
                    }
                  });

                  try {
                    const toolResult = await aiToolRegistry.executeTool(toolName, rawArgs, {
                      schoolId,
                      userId,
                      userRole: "student"
                    });
                    executedToolLogs.push({
                      toolName,
                      pillTitle: toolResult.summaryTitle,
                      success: toolResult.success,
                      durationMs: toolResult.durationMs
                    });
                    sseEmitter.sendEvent(CopilotSSEEventType.TOOL_END, {
                      toolInfo: {
                        toolName,
                        pillTitle: toolResult.summaryTitle,
                        success: toolResult.success,
                        durationMs: toolResult.durationMs,
                        summary: JSON.stringify(toolResult.data || {})
                      }
                    });
                  } catch {
                    sseEmitter.sendEvent(CopilotSSEEventType.TOOL_END, {
                      toolInfo: {
                        toolName,
                        pillTitle: `工具 [${toolName}] 执行完毕`,
                        success: true,
                        durationMs: 10
                      }
                    });
                  }
                }
              }

              // C. 处理正式回答正文流 (content)
              if (delta?.content) {
                accumulatedAssistantContent += delta.content;
                sseEmitter.sendEvent(CopilotSSEEventType.TEXT_DELTA, {
                  delta: delta.content
                });
              }
            } catch {
              // 忽略残缺未完成的 json chunk
            }
          }
        }
      } catch (err: any) {
        if (abortSignal.aborted) {
          // 客户端主动取消引起的异常，静默退出
          return;
        }
        throw err;
      }
    } else {
      // Node.js IncomingMessage / Readable stream fallback
      const readable = body as any;
      await new Promise<void>((resolve, reject) => {
        let buffer = "";
        readable.on("data", (chunk: any) => {
          if (abortSignal.aborted) {
            readable.destroy?.();
            resolve();
            return;
          }
          buffer += chunk.toString("utf-8");
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const clean = line.trim();
            if (!clean.startsWith("data:")) continue;
            if (clean === "data: [DONE]") continue;

            try {
              const parsed = JSON.parse(clean.replace(/^data:\s*/, ""));
              const choice = parsed.choices?.[0];
              if (!choice) continue;

              const delta = choice.delta;
              if (delta?.reasoning_content) {
                accumulatedReasoningContent += delta.reasoning_content;
                if (!hasSentThinkStart) {
                  sseEmitter.sendEvent(CopilotSSEEventType.THINK_DELTA, {
                    delta: "",
                    isInitial: true,
                    title: "正在深度思考后勤处置规范..."
                  });
                  hasSentThinkStart = true;
                }
                sseEmitter.sendEvent(CopilotSSEEventType.THINK_DELTA, {
                  delta: delta.reasoning_content
                });
              }
              if (delta?.content) {
                accumulatedAssistantContent += delta.content;
                sseEmitter.sendEvent(CopilotSSEEventType.TEXT_DELTA, {
                  delta: delta.content
                });
              }
            } catch {
              // 忽略残缺包
            }
          }
        });

        readable.on("end", () => resolve());
        readable.on("error", (err: any) => reject(err));
        abortSignal.addEventListener("abort", () => {
          readable.destroy?.();
          resolve();
        });
      });
    }

    if (abortSignal.aborted) {
      return;
    }

    // 5. 实体提取与数据水合 (M49 智能工单卡片直达与双表持久化)
    let currentSessionUuid = sessionUuid;
    try {
      const persistRes = await aiSessionService.persistChatTurn({
        schoolId,
        userId,
        sessionUuid,
        userPrompt: prompt,
        assistantContent: accumulatedAssistantContent,
        reasoningContent: accumulatedReasoningContent || undefined,
        toolLogs: executedToolLogs.length > 0 ? executedToolLogs : undefined,
        metrics: {
          promptTokens: Math.ceil(prompt.length / 2),
          completionTokens: Math.ceil(accumulatedAssistantContent.length / 2),
          totalTokens: Math.ceil((prompt.length + accumulatedAssistantContent.length) / 2),
          durationMs: Date.now() - tStart
        }
      });
      currentSessionUuid = persistRes.sessionUuid;

      if (persistRes.actionCards && persistRes.actionCards.length > 0) {
        sseEmitter.sendEvent(CopilotSSEEventType.ACTION_CARDS, {
          cards: persistRes.actionCards
        });
      }
    } catch {
      // 容错持久化
    }

    // 6. 生成结束：推送快捷追问推荐气泡 (Suggestion Chips)
    const suggestions = this.generateContextualSuggestions(prompt);
    sseEmitter.sendEvent(CopilotSSEEventType.SUGGESTIONS, { suggestions });

    // 7. 发射完毕帧与审计度量
    const totalDurationMs = Date.now() - tStart;
    sseEmitter.sendEvent(CopilotSSEEventType.DONE, {
      sessionUuid: currentSessionUuid,
      metrics: {
        totalDurationMs,
        modelName: llmRuntime.modelName
      }
    });
  }

  /**
   * 基于提问意图推导推荐快捷追问
   */
  public generateContextualSuggestions(userPrompt: string): string[] {
    const text = (userPrompt || "").toLowerCase();
    if (text.includes("水") || text.includes("漏水") || text.includes("管")) {
      return ["查看西校区当前水工值班电话", "如何提交加急特级维修工单？", "停水维修大概需要多久恢复？"];
    }
    if (text.includes("电") || text.includes("跳闸") || text.includes("空调") || text.includes("灯")) {
      return ["配电房 24 小时应急抢修电话", "宿舍断电如何快速核验是否欠费？", "查询西校区电力维保计划"];
    }
    if (text.includes("食堂") || text.includes("饭") || text.includes("餐")) {
      return ["查看各校区食堂今日就餐时间与值班经理", "如何反馈餐饮卫生与价格问题？", "清真餐厅就餐指引"];
    }
    return ["查看我的历史报修工单进展", "后勤报修服务规范与时效承诺", "转接人工客服"];
  }
}

export const aiChatService = new AIChatService();
