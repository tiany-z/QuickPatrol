/**
 * 高校后勤巡查e速办 v4.0 - M47: 小程序专属 AI 流式问答工作台 (SSE Copilot UI) 单元测试套件
 * 覆盖 20 项核心功能、算法推导、安全防护与端到端流式链路断言
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { aiChatService, AIChatService } from "../services/aiChatService.js";
import { aiChatController, AIChatController } from "../controllers/aiChatController.js";
import { llmConfigService, LLMConfigService } from "../services/llm/llmConfigService.js";
import {
  CopilotSSEEventType,
  ICopilotChatRequestDto
} from "../contracts/copilotContract.js";
import {
  getValidUTF8PrefixLength,
  concatUint8Array,
  IsomorphicStreamDecoder,
  calculateTypewriterStep,
  evaluateViewportLock,
  formatElapsedSeconds
} from "../services/llm/copilotAlgorithms.js";
import api from "../api/v1/ai/chat/index.js";
import EventEmitter from "events";

describe("M47: 小程序专属 AI 流式问答工作台 (SSE Copilot UI)", () => {
  beforeEach(() => {
    LLMConfigService.resetMockData();
    AIChatService.resetMock();
    vi.restoreAllMocks();
  });

  it("[M47-01] SSE 响应头协议契约: 建立流式问答长连接时必须注入 text/event-stream 与 X-Accel-Buffering: no 标头", async () => {
    const writtenHeaders: Record<string, any> = {};
    let writtenStatus = 0;

    const mockReq: any = new EventEmitter();
    const mockRes: any = {
      headersSent: false,
      writableEnded: false,
      writeHead: vi.fn((status: number, headers: any) => {
        writtenStatus = status;
        Object.assign(writtenHeaders, headers);
        mockRes.headersSent = true;
      }),
      write: vi.fn(),
      end: vi.fn(() => {
        mockRes.writableEnded = true;
      })
    };

    // 预置 M46 学校大模型配置
    await llmConfigService.saveConfig(1, 88, {
      selectedProvider: "deepseek",
      primary: {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        apiKeyPlain: "sk-test-valid-key-8888",
        temperature: 0.3,
        maxTokens: 1024
      }
    });

    // Mock fetch 返回简单流
    AIChatService.mockFetch = vi.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"choices":[{"delta":{"content":"您好！"}}]}\n\ndata: [DONE]\n\n')
          );
          controller.close();
        }
      });
      return {
        ok: true,
        status: 200,
        body: stream
      } as any;
    });

    await aiChatController.handleStreamChat(
      mockReq,
      mockRes,
      { prompt: "宿舍水管漏水了" },
      { schoolId: 1, userId: 101, role: 0 }
    );

    expect(writtenStatus).toBe(200);
    expect(writtenHeaders["Content-Type"]).toBe("text/event-stream; charset=utf-8");
    expect(writtenHeaders["X-Accel-Buffering"]).toBe("no");
    expect(writtenHeaders["Cache-Control"]).toBe("no-cache, no-transform");
    expect(writtenHeaders["Connection"]).toBe("keep-alive");
    expect(mockRes.write).toHaveBeenCalled();
    expect(mockRes.end).toHaveBeenCalled();
  });

  it("[M47-02] 思考链 reasoning_content 帧转换: 准确识别 DeepSeek-R1 推理流并转为 think_delta 帧", async () => {
    await llmConfigService.saveConfig(1, 88, {
      selectedProvider: "deepseek",
      primary: {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-reasoner",
        apiKeyPlain: "sk-deepseek-r1-key",
        temperature: 0.3,
        maxTokens: 2048
      }
    });

    const eventsRecorded: Array<{ event: string; data: any }> = [];
    const sseEmitter = {
      sendEvent: (event: string, data: any) => {
        eventsRecorded.push({ event, data });
      },
      close: vi.fn()
    };

    AIChatService.mockFetch = vi.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"reasoning_content":"正在深度推演后勤报修时效与安全级别..."}}]}\n\n' +
              'data: {"choices":[{"delta":{"content":"水管漏水已受理。"}}]}\n\n' +
              'data: [DONE]\n\n'
            )
          );
          controller.close();
        }
      });
      return { ok: true, status: 200, body: stream } as any;
    });

    const abortController = new AbortController();

    await aiChatService.processCopilotChatStream({
      schoolId: 1,
      userId: 101,
      prompt: "水管漏水属于什么级别？",
      history: [],
      sseEmitter,
      abortSignal: abortController.signal
    });

    const thinkEvents = eventsRecorded.filter((e) => e.event === CopilotSSEEventType.THINK_DELTA);
    expect(thinkEvents.length).toBe(2); // 首包 initial + 增量包
    expect(thinkEvents[0].data.isInitial).toBe(true);
    expect(thinkEvents[0].data.title).toContain("正在深度思考");
    expect(thinkEvents[1].data.delta).toBe("正在深度推演后勤报修时效与安全级别...");
  });

  it("[M47-03] 正式文本 content 逐包流式推送: 将模型生成的回答正文按 text_delta 帧实时分发", async () => {
    await llmConfigService.saveConfig(1, 88, {
      selectedProvider: "deepseek",
      primary: {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        apiKeyPlain: "sk-test-key",
        temperature: 0.3,
        maxTokens: 1024
      }
    });

    const textEvents: string[] = [];
    const sseEmitter = {
      sendEvent: (event: string, data: any) => {
        if (event === CopilotSSEEventType.TEXT_DELTA) {
          textEvents.push(data.delta);
        }
      },
      close: vi.fn()
    };

    AIChatService.mockFetch = vi.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"同"}}]}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"学你好，"}}]}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"已通知电工。"}}]}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        }
      });
      return { ok: true, status: 200, body: stream } as any;
    });

    await aiChatService.processCopilotChatStream({
      schoolId: 1,
      userId: 101,
      prompt: "配电箱跳闸",
      history: [],
      sseEmitter,
      abortSignal: new AbortController().signal
    });

    expect(textEvents.join("")).toBe("同学你好，已通知电工。");
  });

  it("[M47-04] 多工具调用序列帧分发: 捕获 tool_calls 并转换为 tool_start 帧供前端渲染检索态", async () => {
    await llmConfigService.saveConfig(1, 88, {
      selectedProvider: "deepseek",
      primary: {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        apiKeyPlain: "sk-test-key"
      }
    });

    const toolEvents: any[] = [];
    const sseEmitter = {
      sendEvent: (event: string, data: any) => {
        if (event === CopilotSSEEventType.TOOL_START) {
          toolEvents.push(data);
        }
      },
      close: vi.fn()
    };

    AIChatService.mockFetch = vi.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"query_patrol_list"}}]}}]}\n\n' +
              'data: [DONE]\n\n'
            )
          );
          controller.close();
        }
      });
      return { ok: true, status: 200, body: stream } as any;
    });

    await aiChatService.processCopilotChatStream({
      schoolId: 1,
      userId: 101,
      prompt: "查一下工单",
      history: [],
      sseEmitter,
      abortSignal: new AbortController().signal
    });

    expect(toolEvents.length).toBe(1);
    expect(toolEvents[0].toolInfo.toolName).toBe("query_patrol_list");
    expect(toolEvents[0].toolInfo.pillTitle).toContain("query_patrol_list");
  });

  it("[M47-05] 快捷追问推荐气泡智能生成: 针对供水报修场景自动推荐供水专班电话与时效承诺", async () => {
    const suggestions = aiChatService.generateContextualSuggestions("西校区浴室水管爆裂漏水严重");
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    expect(suggestions.some((s) => s.includes("水"))).toBe(true);
  });

  it("[M47-06] 快捷追问推荐气泡智能生成: 针对电力跳闸场景自动推荐应急供电与电工值班", async () => {
    const suggestions = aiChatService.generateContextualSuggestions("宿舍空调突然跳闸断电了");
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    expect(suggestions.some((s) => s.includes("电") || s.includes("跳闸"))).toBe(true);
  });

  it("[M47-07] 通用提问兜底快捷追问: 针对常规问答返回工单流水核验与人工客服入口", async () => {
    const suggestions = aiChatService.generateContextualSuggestions("校园一卡通去哪里充值？");
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    expect(suggestions.some((s) => s.includes("工单") || s.includes("客服"))).toBe(true);
  });

  it("[M47-08] 正常会话完结帧 (DONE) 与审计指标: 返回 done 帧并附带耗时与模型名称", async () => {
    await llmConfigService.saveConfig(1, 88, {
      selectedProvider: "deepseek",
      primary: {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        apiKeyPlain: "sk-test-key"
      }
    });

    let donePayload: any = null;
    const sseEmitter = {
      sendEvent: (event: string, data: any) => {
        if (event === CopilotSSEEventType.DONE) {
          donePayload = data;
        }
      },
      close: vi.fn()
    };

    AIChatService.mockFetch = vi.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"测试完毕"}}]}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        }
      });
      return { ok: true, status: 200, body: stream } as any;
    });

    await aiChatService.processCopilotChatStream({
      schoolId: 1,
      userId: 101,
      prompt: "测试",
      history: [],
      sseEmitter,
      abortSignal: new AbortController().signal
    });

    expect(donePayload).toBeDefined();
    expect(donePayload.metrics.modelName).toBe("deepseek-chat");
    expect(donePayload.metrics.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("[M47-09] 客户端主动 Abort 级联中断: 触发 AbortController 时立即调用 reader.cancel() 释放资源", async () => {
    await llmConfigService.saveConfig(1, 88, {
      selectedProvider: "deepseek",
      primary: {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        apiKeyPlain: "sk-test-key"
      }
    });

    let cancelCalled = false;
    const abortController = new AbortController();

    AIChatService.mockFetch = vi.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n'));
          // 模拟客户端中途点击中止
          abortController.abort();
        },
        cancel() {
          cancelCalled = true;
        }
      });
      return { ok: true, status: 200, body: stream } as any;
    });

    const sseEmitter = { sendEvent: vi.fn(), close: vi.fn() };

    await aiChatService.processCopilotChatStream({
      schoolId: 1,
      userId: 101,
      prompt: "长篇大论生成测试",
      history: [],
      sseEmitter,
      abortSignal: abortController.signal
    });

    expect(abortController.signal.aborted).toBe(true);
    expect(cancelCalled).toBe(true);
  });

  it("[M47-10] 上游大模型非 200 异常拦截: 目标端点返回 500 时服务抛出带有状态码的异常", async () => {
    await llmConfigService.saveConfig(1, 88, {
      selectedProvider: "deepseek",
      primary: {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        apiKeyPlain: "sk-test-key"
      }
    });

    AIChatService.mockFetch = vi.fn(async () => {
      return {
        ok: false,
        status: 500,
        text: async () => '{"error":"Internal server error on upstream"}'
      } as any;
    });

    const sseEmitter = { sendEvent: vi.fn(), close: vi.fn() };

    await expect(
      aiChatService.processCopilotChatStream({
        schoolId: 1,
        userId: 101,
        prompt: "测试错误",
        history: [],
        sseEmitter,
        abortSignal: new AbortController().signal
      })
    ).rejects.toThrow(/上游大模型响应异常.*500/);
  });

  it("[M47-11] 算法 1: UTF-8 截断探测函数 getValidUTF8PrefixLength 准确计算合法前缀与残片", () => {
    // 纯 ASCII "abc"
    const ascii = new TextEncoder().encode("abc");
    expect(getValidUTF8PrefixLength(ascii)).toBe(3);

    // 完整中文 "你好" (3字节 + 3字节 = 6字节)
    const chinese = new TextEncoder().encode("你好");
    expect(chinese.length).toBe(6);
    expect(getValidUTF8PrefixLength(chinese)).toBe(6);

    // 汉字 "好" 被切断：取前 5 字节 (完整"你" 3字节 + "好"的前2字节)
    const truncated = chinese.subarray(0, 5);
    const validLen = getValidUTF8PrefixLength(truncated);
    expect(validLen).toBe(3); // 只有前 3 字节是完整汉字，后 2 字节为待拼接残片
  });

  it("[M47-12] 算法 1: concatUint8Array 二进制合并在空数组与有效数组边界上表现正确", () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4, 5]);
    const merged = concatUint8Array(a, b);
    expect(Array.from(merged)).toEqual([1, 2, 3, 4, 5]);

    const empty = new Uint8Array(0);
    expect(concatUint8Array(empty, a)).toBe(a);
    expect(concatUint8Array(b, empty)).toBe(b);
  });

  it("[M47-13] 算法 1: IsomorphicStreamDecoder 跨分包 UTF-8 解码零乱码自愈闭环", () => {
    const decoder = new IsomorphicStreamDecoder();
    const receivedMessages: string[] = [];

    // 完整报文: event: text_delta\ndata: {"delta":"西校区配电房"}\n\n
    const fullText = 'event: text_delta\ndata: {"delta":"西校区配电房"}\n\n';
    const fullBytes = new TextEncoder().encode(fullText);

    // 故意在汉字 "校" 的内部截断切分成两个 ArrayBuffer
    // "西" = 3字节, "校" = 3字节。在第 35 字节切分
    const splitIndex = 35;
    const chunk1 = fullBytes.slice(0, splitIndex).buffer;
    const chunk2 = fullBytes.slice(splitIndex).buffer;

    // 分别模拟两包到达
    const frames1 = decoder.decodeAndExtractFrames(chunk1);
    expect(frames1.length).toBe(0); // 尚未封口，不触发
    expect(decoder.getRemainderBytes().length).toBeGreaterThan(0); // 截断碎片存入残余缓冲区

    const frames2 = decoder.decodeAndExtractFrames(chunk2);
    expect(frames2.length).toBe(1);
    expect(frames2[0].event).toBe("text_delta");
    expect(frames2[0].data.delta).toBe("西校区配电房"); // 乱码自愈，文本百分之百还原！
  });

  it("[M47-14] 算法 2: 打字机自适应阻尼步长推导 (calculateTypewriterStep)", () => {
    // 空队列
    expect(calculateTypewriterStep(0)).toBe(0);

    // 积压 1~7 字 -> 步长为 1 (优雅单字流出)
    expect(calculateTypewriterStep(1)).toBe(1);
    expect(calculateTypewriterStep(5)).toBe(1);
    expect(calculateTypewriterStep(7)).toBe(1);

    // 积压 20 字 -> floor(20/8) + 1 = 3
    expect(calculateTypewriterStep(20)).toBe(3);

    // 积压 32 字 -> floor(32/8) + 1 = 5
    expect(calculateTypewriterStep(32)).toBe(5);

    // 积压 80 字 -> 达到最大上限 6，防止肉眼无法捕捉
    expect(calculateTypewriterStep(80)).toBe(6);
  });

  it("[M47-15] 算法 3: 视口触底锁定与反向滑动探测 (evaluateViewportLock)", () => {
    // 距离底部 20px (<= 40px) -> 触底锁定态
    const locked = evaluateViewportLock(20, 40);
    expect(locked.isLocked).toBe(true);
    expect(locked.showBtn).toBe(false);

    // 距离底部 80px (> 40px) -> 用户正在反向阅读，解除锁定并浮现按钮
    const free = evaluateViewportLock(80, 40);
    expect(free.isLocked).toBe(false);
    expect(free.showBtn).toBe(true);
  });

  it("[M47-16] 算法 4: Thinking 耗时秒表精确格式化 (formatElapsedSeconds)", () => {
    const t0 = 10000;
    expect(formatElapsedSeconds(t0, 10000)).toBe("0.0s");
    expect(formatElapsedSeconds(t0, 12400)).toBe("2.4s");
    expect(formatElapsedSeconds(t0, 15850)).toBe("5.8s");
  });

  it("[M47-17] 租户安全鉴权拦截: 未携带学校租户或用户身份时 Controller 返回 401", async () => {
    const mockReq: any = new EventEmitter();
    let writtenStatus = 0;
    const mockRes: any = {
      headersSent: false,
      writableEnded: false,
      writeHead: vi.fn((status: number) => {
        writtenStatus = status;
      }),
      end: vi.fn()
    };

    await aiChatController.handleStreamChat(
      mockReq,
      mockRes,
      { prompt: "你好" },
      { schoolId: 0, userId: 0 } // 无效身份
    );

    expect(writtenStatus).toBe(401);
  });

  it("[M47-18] 空提问输入参数校验: 提交空文本时 Controller 拦截并返回 400", async () => {
    const mockReq: any = new EventEmitter();
    let writtenStatus = 0;
    const mockRes: any = {
      headersSent: false,
      writableEnded: false,
      writeHead: vi.fn((status: number) => {
        writtenStatus = status;
      }),
      end: vi.fn()
    };

    await aiChatController.handleStreamChat(
      mockReq,
      mockRes,
      { prompt: "   " }, // 空格
      { schoolId: 1, userId: 101 }
    );

    expect(writtenStatus).toBe(400);
  });

  it("[M47-19] Controller 异常捕获向流中发送 error 帧", async () => {
    const mockReq: any = new EventEmitter();
    const writtenChunks: string[] = [];
    const mockRes: any = {
      headersSent: false,
      writableEnded: false,
      writeHead: vi.fn(),
      write: vi.fn((chunk: string) => {
        writtenChunks.push(chunk);
      }),
      end: vi.fn()
    };

    // 模拟 Service 崩溃
    vi.spyOn(aiChatService, "processCopilotChatStream").mockRejectedValueOnce(
      new Error("模拟大模型连接超时")
    );

    await aiChatController.handleStreamChat(
      mockReq,
      mockRes,
      { prompt: "发生异常的请求" },
      { schoolId: 1, userId: 101 }
    );

    const fullOutput = writtenChunks.join("");
    expect(fullOutput).toContain("event: error");
    expect(fullOutput).toContain("模拟大模型连接超时");
    expect(mockRes.end).toHaveBeenCalled();
  });

  it("[M47-20] 网关端点 /api/v1/ai/chat 路由集成测试: 验证网关鉴权与分发器协同", async () => {
    // 缺少登录身份
    const resNoAuth = await api.handler(
      { req: {} as any, body: { prompt: "你好" }, query: {} },
      { requestId: "req-1", withdrawStack: null as any, lockedRows: [], userPayload: null }
    );
    expect(resNoAuth.status).toBe(0);
    expect(resNoAuth.content).toContain("登录");

    // 携带合法租户
    let streamTriggered = false;
    vi.spyOn(aiChatController, "handleStreamChat").mockImplementationOnce(async () => {
      streamTriggered = true;
    });

    const resAuth = await api.handler(
      {
        req: {} as any,
        res: {} as any,
        body: { prompt: "西区水管漏水" },
        query: {}
      },
      {
        requestId: "req-2",
        withdrawStack: null as any,
        lockedRows: [],
        userPayload: { schoolId: 1, userId: 88, role: 0 }
      }
    );

    expect(resAuth.status).toBe(1);
    expect(streamTriggered).toBe(true);
  });
});
