/**
 * 高校后勤巡查e速办 v4.0 - M46: 大模型极速流式探针与首字往返时延 (TTFT) 测速引擎
 * (LLM Stream Abort Probe & TTFT Evaluator Engine)
 */

import { ILlmPingResponseDto } from "./llmConfigTypes.js";

export class LLMProbeService {
  public static readonly PROBE_TIMEOUT_MS = 5000;

  // 内部沙箱探测 mock 处理器 (供单元测试零外部网络依赖运行)
  private static mockProbeHandler: ((url: string, key: string, model: string) => Promise<ILlmPingResponseDto>) | null = null;

  /**
   * 算法 2: OpenAI 兼容端点自适应补齐与标准化
   */
  public static normalizeEndpointUrl(rawUrl: string): string {
    if (!rawUrl || typeof rawUrl !== "string") {
      throw new Error("端点 URL 不能为空");
    }

    const clean = rawUrl.trim().replace(/\/+$/, "");
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      throw new Error("端点 URL 格式非法，必须以 http:// 或 https:// 开头");
    }

    // SSRF 安全防御：拦截非法云元数据与内部危险端口
    try {
      const urlObj = new URL(clean);
      const host = urlObj.hostname.toLowerCase();
      if (host === "169.254.169.254") {
        throw new Error("SSRF_PROHIBITED: 禁止探测云厂商元数据内部地址");
      }
      if ((host === "127.0.0.1" || host === "localhost") && ["6379", "3306", "27017", "22"].includes(urlObj.port)) {
        throw new Error("SSRF_PROHIBITED: 禁止探测数据库或底层基础设施服务端口");
      }
    } catch (e: any) {
      if (e.message.includes("SSRF_PROHIBITED")) throw e;
    }

    if (clean.endsWith("/chat/completions")) {
      return clean;
    }

    if (/\/v\d+$/.test(clean)) {
      return `${clean}/chat/completions`;
    }

    return `${clean}/v1/chat/completions`;
  }

  /**
   * 算法 1: 执行 5 秒超时轻量流式截断探针 (TTFT Probe)
   */
  public async pingModelEndpoint(
    rawBaseUrl: string,
    apiKeyPlain: string,
    modelName: string,
    customFetch?: typeof fetch
  ): Promise<ILlmPingResponseDto> {
    const timestamp = new Date().toISOString();

    // 0. 若存在沙箱 Mock 探针拦截器，直接交付 Mock
    if (LLMProbeService.mockProbeHandler) {
      return LLMProbeService.mockProbeHandler(rawBaseUrl, apiKeyPlain, modelName);
    }

    // 1. 规范化补齐端点 URL
    let targetEndpoint: string;
    try {
      targetEndpoint = LLMProbeService.normalizeEndpointUrl(rawBaseUrl);
    } catch (err: any) {
      return {
        success: false,
        latencyMs: 0,
        httpStatusCode: 400,
        diagnosticMessage: `端点地址格式不合法: ${err.message}`,
        timestamp
      };
    }

    // 2. 初始化 5000ms 超时熔断控制器
    const controller = new AbortController();
    let isTimeout = false;
    let firstTokenAborted = false;

    const timeoutTimer = setTimeout(() => {
      isTimeout = true;
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }, LLMProbeService.PROBE_TIMEOUT_MS);

    // 3. 记录纳秒高精度系统时钟起始戳
    const tStart = process.hrtime.bigint();
    const fetchFn = customFetch || globalThis.fetch;

    try {
      const response = await fetchFn(targetEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKeyPlain ? apiKeyPlain.trim() : ""}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream"
        },
        body: JSON.stringify({
          model: modelName ? modelName.trim() : "default",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          stream: true
        }),
        signal: controller.signal
      });

      // 4. HTTP 异常状态码快速拦截
      if (response.status !== 200) {
        clearTimeout(timeoutTimer);
        const tEnd = process.hrtime.bigint();
        const latencyMs = Number((tEnd - tStart) / BigInt(1_000_000));
        let errorBody = "";
        try {
          errorBody = await response.text();
        } catch {
          // ignore
        }

        return this.diagnoseHttpFailure(response.status, latencyMs, errorBody, timestamp);
      }

      // 5. 200 OK 正常响应，开始捕获首字并执行极速流式截断
      const body: any = response.body;
      if (!body) {
        clearTimeout(timeoutTimer);
        return {
          success: false,
          latencyMs: 0,
          httpStatusCode: 500,
          diagnosticMessage: "服务端返回 200 但响应流为空，无法完成首包验证",
          timestamp
        };
      }

      let modelFingerprint: string | undefined = modelName;

      // 针对 Web ReadableStream 的首字探测
      if (typeof body.getReader === "function") {
        const reader = body.getReader();
        const decoder = new TextDecoder("utf-8");

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunkText = decoder.decode(value, { stream: true });
          if (chunkText.includes("data:")) {
            const tFirst = process.hrtime.bigint();
            clearTimeout(timeoutTimer);
            firstTokenAborted = true;

            // 尝试提取大模型指纹
            try {
              const dataLine = chunkText
                .split("\n")
                .find(line => line.startsWith("data:") && !line.includes("[DONE]"));
              if (dataLine) {
                const parsed = JSON.parse(dataLine.replace(/^data:\s*/, ""));
                if (parsed.model) modelFingerprint = parsed.model;
              }
            } catch {
              // 容错
            }

            // 核心精髓：立即中止流，仅耗费 1 Token！
            try {
              controller.abort();
            } catch {
              // ignore
            }

            const latencyMs = Number((tFirst - tStart) / BigInt(1_000_000));
            return {
              success: true,
              latencyMs,
              httpStatusCode: 200,
              modelFingerprint,
              diagnosticMessage: `连通成功！首字往返时延 (TTFT): ${latencyMs}ms，通道握手正常。`,
              timestamp
            };
          }
        }
      } else if (typeof body[Symbol.asyncIterator] === "function") {
        // Node.js 原生 ReadableStream 异步迭代器支持
        for await (const chunk of body) {
          const chunkText = chunk.toString("utf-8");
          if (chunkText.includes("data:")) {
            const tFirst = process.hrtime.bigint();
            clearTimeout(timeoutTimer);
            firstTokenAborted = true;

            try {
              controller.abort();
            } catch {
              // ignore
            }

            const latencyMs = Number((tFirst - tStart) / BigInt(1_000_000));
            return {
              success: true,
              latencyMs,
              httpStatusCode: 200,
              modelFingerprint,
              diagnosticMessage: `连通成功！首字往返时延 (TTFT): ${latencyMs}ms，通道握手正常。`,
              timestamp
            };
          }
        }
      }

      clearTimeout(timeoutTimer);
      return {
        success: false,
        latencyMs: 0,
        httpStatusCode: 502,
        diagnosticMessage: "连接已建立但未收到符合 SSE 格式的数据帧，请检查端点是否兼容 OpenAI 规范。",
        timestamp
      };
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      const tEnd = process.hrtime.bigint();
      const latencyMs = Number((tEnd - tStart) / BigInt(1_000_000));

      if (isTimeout) {
        return {
          success: false,
          latencyMs: LLMProbeService.PROBE_TIMEOUT_MS,
          httpStatusCode: 504,
          diagnosticMessage: `连通超时 (>${LLMProbeService.PROBE_TIMEOUT_MS}ms)：目标端点未在限定时间内返回首包，请检查网络或更换端点。`,
          timestamp
        };
      }

      // 若为首次抓取到首字后主动调用的 abort()，视为成功
      if (firstTokenAborted || (err.name === "AbortError" && !isTimeout && latencyMs < LLMProbeService.PROBE_TIMEOUT_MS)) {
        return {
          success: true,
          latencyMs: latencyMs > 0 ? latencyMs : 50,
          httpStatusCode: 200,
          modelFingerprint: modelName,
          diagnosticMessage: "首字已成功捕获并安全截断。",
          timestamp
        };
      }

      return {
        success: false,
        latencyMs,
        httpStatusCode: 500,
        diagnosticMessage: `网络通信异常: ${err.message || "未知连接错误"}`,
        timestamp
      };
    }
  }

  /**
   * HTTP 状态码细粒度语义化诊断映射
   */
  public diagnoseHttpFailure(
    status: number,
    latencyMs: number,
    errorBody: string,
    timestamp: string
  ): ILlmPingResponseDto {
    let msg = `请求失败 (HTTP ${status})`;
    if (status === 401) {
      msg = "鉴权失败 (401 Unauthorized)：所填写的 API Key 无效、已过期或格式错误。";
    } else if (status === 403) {
      msg = "访问受限 (403 Forbidden)：无权访问该大模型资源，请检查账号权限。";
    } else if (status === 404) {
      msg = "端点未找到 (404 Not Found)：BaseURL 路径错误或指定模型名称在服务商处不存在。";
    } else if (status === 429) {
      msg = "请求配额耗尽或受限 (429 Too Many Requests)：账号已欠费或触发了 API 频次并发限制。";
    } else if (status === 500 || status === 502 || status === 503) {
      msg = `大模型提供商服务端故障 (HTTP ${status})：模型服务器暂时过载或维护中。`;
    }

    if (errorBody && errorBody.length < 300) {
      msg += ` 详细原因: ${errorBody}`;
    }

    return {
      success: false,
      latencyMs,
      httpStatusCode: status,
      diagnosticMessage: msg,
      timestamp
    };
  }

  // =========================================================================
  // 测试沙箱桩点管理
  // =========================================================================

  public static setMockProbeHandler(
    handler: (url: string, key: string, model: string) => Promise<ILlmPingResponseDto>
  ): void {
    this.mockProbeHandler = handler;
  }

  public static resetMock(): void {
    this.mockProbeHandler = null;
  }
}

export const llmProbeService = new LLMProbeService();
