/**
 * 高校后勤巡查e速办 v4.0 - M46: 各校自主配置异构大模型与连通测试 20 项专项单元测试套件
 * (M46 School LLM Config & Ping Probe Test Suite)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TestHarness } from "./testHarness.js";
import { LLMConfigService } from "../services/llm/llmConfigService.js";
import { LLMProbeService } from "../services/llm/llmProbeService.js";
import { SchoolLLMConfigController } from "../controllers/schoolLlmConfigController.js";
import { AesCryptoEngine } from "../shared/crypto/aesCrypto.js";
import llmApiEndpoint from "../api/school/settings/llm/index.js";
import testLlmApiEndpoint from "../api/school/settings/test-llm/index.js";
import { handleGetLlmConfig, handleSaveLlmConfig } from "../api/school/settings/llm/handler.js";
import { handleTestLlmConnectivity } from "../api/school/settings/test-llm/handler.js";

describe("[M46] 各校自主配置异构大模型与连通测试测试套件", () => {
  let configService: LLMConfigService;
  let probeService: LLMProbeService;
  let configController: SchoolLLMConfigController;

  beforeEach(() => {
    TestHarness.resetSandbox();
    configService = new LLMConfigService();
    probeService = new LLMProbeService();
    configController = new SchoolLLMConfigController(configService, probeService);
  });

  // =========================================================================
  // 1. 敏感凭据脱敏算法与规范化校验 (用例 01 ~ 07)
  // =========================================================================

  it("[M46-01] 敏感凭据脱敏算法: 大于等于12位字符串保留前4后3并中间掩码(sk-d****def)", () => {
    const rawKey = "sk-deepseek-1234567890abcdef";
    const masked = LLMConfigService.maskApiKey(rawKey);
    expect(masked).toBe("sk-d****def");
    expect(masked).not.toContain("1234567890");
  });

  it("[M46-02] 敏感凭据脱敏算法: 6~11位字符串保留前2后2(ad****23)，小于6位显示全掩码(******)，空值安全返回空串", () => {
    expect(LLMConfigService.maskApiKey("admin123")).toBe("ad****23");
    expect(LLMConfigService.maskApiKey("12345")).toBe("******");
    expect(LLMConfigService.maskApiKey("")).toBe("");
    expect(LLMConfigService.maskApiKey(null)).toBe("");
    expect(LLMConfigService.maskApiKey(undefined)).toBe("");
  });

  it("[M46-03] 端点URL自适应标准化: 基础裸域名自动补全为 /v1/chat/completions", () => {
    const res1 = LLMProbeService.normalizeEndpointUrl("https://api.deepseek.com");
    expect(res1).toBe("https://api.deepseek.com/v1/chat/completions");

    const res2 = LLMProbeService.normalizeEndpointUrl("https://api.deepseek.com/");
    expect(res2).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("[M46-04] 端点URL自适应标准化: 已带有版本路径(/v1/)自动拼接 /chat/completions", () => {
    const res = LLMProbeService.normalizeEndpointUrl("https://dashscope.aliyuncs.com/compatible-mode/v1");
    expect(res).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");

    const resV4 = LLMProbeService.normalizeEndpointUrl("https://open.bigmodel.cn/api/paas/v4/");
    expect(resV4).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
  });

  it("[M46-05] 端点URL自适应标准化: 已带有完整 /chat/completions 保持不变，并清除多余斜杠", () => {
    const res = LLMProbeService.normalizeEndpointUrl("https://api.openai.com/v1/chat/completions///");
    expect(res).toBe("https://api.openai.com/v1/chat/completions");

    expect(() => LLMProbeService.normalizeEndpointUrl("ftp://invalid-domain.com")).toThrow("端点 URL 格式非法");
  });

  it("[M46-06] SSRF内网探测安全防御: 目标为169.254.169.254云元数据或数据库敏感端口时强力拦截", () => {
    expect(() => {
      LLMProbeService.normalizeEndpointUrl("http://169.254.169.254/latest/meta-data");
    }).toThrow("SSRF_PROHIBITED");

    expect(() => {
      LLMProbeService.normalizeEndpointUrl("http://127.0.0.1:6379/v1");
    }).toThrow("SSRF_PROHIBITED");
  });

  it("[M46-07] 厂商预设模版校验: 内置 DeepSeek、通义千问、智谱、Ollama、OpenAI 等主流厂商元数据与模型推荐", () => {
    const presets = configService.getProviderPresets();
    expect(presets.length).toBeGreaterThanOrEqual(5);

    const deepseek = presets.find(p => p.providerId === "deepseek");
    expect(deepseek).toBeDefined();
    expect(deepseek?.defaultBaseUrl).toBe("https://api.deepseek.com/v1");
    expect(deepseek?.models.some(m => m.modelId === "deepseek-chat")).toBe(true);

    const ollama = presets.find(p => p.providerId === "ollama");
    expect(ollama?.isPrivateDeployment).toBe(true);
  });

  // =========================================================================
  // 2. AES-256-GCM 密文保险箱与配置存取测试 (用例 08 ~ 12)
  // =========================================================================

  it("[M46-08] 配置保存与 AES-256-GCM 硬件级密文入库: 传入明文 Key 保存后，底层存储仅为密文三元组", async () => {
    const schoolId = 1;
    const rawApiKey = "sk-deepseek-sec-token-123456789";

    await configService.saveSchoolLLMConfig(schoolId, 101, {
      primary: {
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        temperature: 0.3,
        maxTokens: 2048,
        stream: true,
        timeoutMs: 15000
      },
      primaryApiKeyCandidate: rawApiKey,
      enableFallback: false
    });

    const rawPayload = await configService.getRawEncryptedPayload(schoolId);
    expect(rawPayload).toBeDefined();
    expect(rawPayload?.primaryEncryptedKey.cipherText).toBeDefined();
    expect(rawPayload?.primaryEncryptedKey.iv).toBeDefined();
    expect(rawPayload?.primaryEncryptedKey.authTag).toBeDefined();
    // 严密断言：底层落库存储绝对不能含有原始明文 Key
    expect(JSON.stringify(rawPayload)).not.toContain(rawApiKey);

    // 验证可通过 AesCryptoEngine 成功还原密文
    const fullStr = `${rawPayload!.primaryEncryptedKey.iv}:${rawPayload!.primaryEncryptedKey.authTag}:${rawPayload!.primaryEncryptedKey.cipherText}`;
    const decrypted = AesCryptoEngine.decrypt(fullStr);
    expect(decrypted).toBe(rawApiKey);
  });

  it("[M46-09] 脱敏视图查询: 获取学校配置时，API Key 强制输出脱敏掩码，且 hasConfiguredKey 正确置为 true", async () => {
    const schoolId = 1;
    await configService.saveSchoolLLMConfig(schoolId, 101, {
      primary: {
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        temperature: 0.3,
        maxTokens: 2048,
        stream: true,
        timeoutMs: 15000
      },
      primaryApiKeyCandidate: "sk-deepseek-live-secret-8888",
      enableFallback: false
    });

    const view = await configService.getSchoolLLMConfigView(schoolId);
    expect(view).toBeDefined();
    expect(view?.schoolId).toBe(1);
    expect(view?.primary.hasConfiguredKey).toBe(true);
    expect(view?.primary.maskedApiKey).toBe("sk-d****888");
    expect(view?.primary.maskedApiKey).not.toContain("live-secret");
  });

  it("[M46-10] 内部受控解密: getRuntimeDecryptedConfig 正确解密主选通道明文凭据以供运行时调度", async () => {
    const schoolId = 1;
    const rawApiKey = "sk-runtime-auth-token-9999";
    await configService.saveSchoolLLMConfig(schoolId, 101, {
      primary: {
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        temperature: 0.3,
        maxTokens: 2048,
        stream: true,
        timeoutMs: 15000
      },
      primaryApiKeyCandidate: rawApiKey,
      enableFallback: false
    });

    const runtime = await configService.getRuntimeDecryptedConfig(schoolId, "primary");
    expect(runtime.apiKeyPlain).toBe(rawApiKey);
    expect(runtime.modelName).toBe("deepseek-chat");
    expect(runtime.baseUrl).toBe("https://api.deepseek.com/v1");
  });

  it("[M46-11] 备用容灾通道解密: 启用 Fallback 时正确解密备用模型配置与明文 Key", async () => {
    const schoolId = 1;
    await configService.saveSchoolLLMConfig(schoolId, 101, {
      primary: {
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        temperature: 0.3,
        maxTokens: 2048,
        stream: true,
        timeoutMs: 15000
      },
      primaryApiKeyCandidate: "sk-primary-key-1111",
      enableFallback: true,
      fallback: {
        providerId: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        modelName: "qwen-turbo",
        temperature: 0.2,
        maxTokens: 1024,
        stream: true,
        timeoutMs: 8000
      },
      fallbackApiKeyCandidate: "sk-qwen-fallback-key-2222"
    });

    const fallbackRuntime = await configService.getRuntimeDecryptedConfig(schoolId, "fallback");
    expect(fallbackRuntime.apiKeyPlain).toBe("sk-qwen-fallback-key-2222");
    expect(fallbackRuntime.modelName).toBe("qwen-turbo");
    expect(fallbackRuntime.timeoutMs).toBe(8000);
  });

  it("[M46-12] 备用容灾通道异常保护: 未启用 Fallback 时请求解密备用通道抛出明确业务异常", async () => {
    const schoolId = 1;
    await configService.saveSchoolLLMConfig(schoolId, 101, {
      primary: {
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        temperature: 0.3,
        maxTokens: 2048,
        stream: true,
        timeoutMs: 15000
      },
      primaryApiKeyCandidate: "sk-primary-key-1111",
      enableFallback: false
    });

    await expect(configService.getRuntimeDecryptedConfig(schoolId, "fallback")).rejects.toThrow("未启用备选容灾模型通道");
  });

  // =========================================================================
  // 3. 流式探针 (TTFT Probe) 与异常诊断测试 (用例 13 ~ 17)
  // =========================================================================

  it("[M46-13] 轻量流式截断探针(TTFT): 模拟首个 SSE 数据帧到达时立即 abort，测出毫秒级 TTFT 耗时并返回成功", async () => {
    // 构造模拟 ReadableStream 模拟 SSE 流
    const mockChunk = new TextEncoder().encode('data: {"id":"chat-1","choices":[{"delta":{"content":"P"}}]}\n\n');
    let aborted = false;

    const mockFetch = vi.fn(async (_url: string, init: any) => {
      // 监听 signal abort
      init.signal?.addEventListener("abort", () => {
        aborted = true;
      });

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(mockChunk);
        }
      });

      return {
        status: 200,
        body: stream
      } as any;
    });

    const result = await probeService.pingModelEndpoint(
      "https://api.deepseek.com/v1",
      "sk-test-key-12345",
      "deepseek-chat",
      mockFetch as any
    );

    expect(result.success).toBe(true);
    expect(result.httpStatusCode).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.diagnosticMessage).toContain("连通成功");
    expect(aborted).toBe(true); // 核心精髓断言：首字到达后已立即触发 abort() 挂断网络
  });

  it("[M46-14] 探针鉴权失败诊断: 目标端点返回 401 时精确识别为 API Key 无效并附带友好指引", async () => {
    const mockFetch = vi.fn(async () => ({
      status: 401,
      text: async () => '{"error":{"message":"Invalid API key provided"}}'
    } as any));

    const result = await probeService.pingModelEndpoint(
      "https://api.deepseek.com/v1",
      "sk-invalid-key",
      "deepseek-chat",
      mockFetch
    );

    expect(result.success).toBe(false);
    expect(result.httpStatusCode).toBe(401);
    expect(result.diagnosticMessage).toContain("鉴权失败 (401 Unauthorized)");
  });

  it("[M46-15] 探针权限受限与配额耗尽诊断: 目标端点返回 403 / 429 时准确诊断欠费或频控", async () => {
    const mockFetch429 = vi.fn(async () => ({
      status: 429,
      text: async () => '{"error":{"message":"Rate limit reached or quota exceeded"}}'
    } as any));

    const result = await probeService.pingModelEndpoint(
      "https://api.deepseek.com/v1",
      "sk-quota-exhausted-key",
      "deepseek-chat",
      mockFetch429
    );

    expect(result.success).toBe(false);
    expect(result.httpStatusCode).toBe(429);
    expect(result.diagnosticMessage).toContain("请求配额耗尽或受限 (429 Too Many Requests)");
  });

  it("[M46-16] 探针 5000ms 超时强制熔断: 模拟假死连接在 5000ms 触发 AbortController 并返回 504 诊断", async () => {
    // 模拟挂起永不返回的假死连接
    const mockFetchTimeout = vi.fn(async (_url: string, init: any) => {
      return new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    // 局部加速超时时限供测试快速收敛
    const originalTimeout = LLMProbeService.PROBE_TIMEOUT_MS;
    (LLMProbeService as any).PROBE_TIMEOUT_MS = 100; // 缩短为 100ms 测试超时逻辑

    try {
      const result = await probeService.pingModelEndpoint(
        "https://api.deepseek.com/v1",
        "sk-hanging-key",
        "deepseek-chat",
        mockFetchTimeout as any
      );

      expect(result.success).toBe(false);
      expect(result.httpStatusCode).toBe(504);
      expect(result.diagnosticMessage).toContain("连通超时");
    } finally {
      (LLMProbeService as any).PROBE_TIMEOUT_MS = originalTimeout;
    }
  });

  it("[M46-17] 探针使用数据库持久化已保存 Key 自动解密测试: apiKeyCandidate 留空或为 __USE_PERSISTED_KEY__ 时自动解密测试", async () => {
    const schoolId = 1;
    const rawApiKey = "sk-persisted-secret-key-6666";
    await configService.saveSchoolLLMConfig(schoolId, 101, {
      primary: {
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        temperature: 0.3,
        maxTokens: 2048,
        stream: true,
        timeoutMs: 15000
      },
      primaryApiKeyCandidate: rawApiKey,
      enableFallback: false
    });

    let passedKey = "";
    LLMProbeService.setMockProbeHandler(async (_url, key, model) => {
      passedKey = key;
      return {
        success: true,
        latencyMs: 120,
        httpStatusCode: 200,
        modelFingerprint: model,
        diagnosticMessage: "测试成功",
        timestamp: new Date().toISOString()
      };
    });

    const res = await configController.testConnectivity({
      schoolId: 1,
      userId: 101,
      body: {
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        apiKeyCandidate: "__USE_PERSISTED_KEY__",
        channelType: "primary"
      }
    });

    expect(res.code).toBe(200);
    expect(res.data.success).toBe(true);
    expect(passedKey).toBe(rawApiKey); // 成功自动解密出已保存的持久化 Key
  });

  // =========================================================================
  // 4. Controller 与 Gateway 路由闭环测试 (用例 18 ~ 20)
  // =========================================================================

  it("[M46-18] Controller 多租户校验与参数合法性拦截: 缺少 schoolId 返回 401，缺少主模型必填字段返回 400", async () => {
    const resNoSchool = await configController.getConfig({ schoolId: 0, userId: 101 });
    expect(resNoSchool.code).toBe(401);

    const resNoBaseUrl = await configController.saveConfig({
      schoolId: 1,
      userId: 101,
      body: {
        primary: { providerId: "deepseek", baseUrl: "", modelName: "" }
      }
    });
    expect(resNoBaseUrl.code).toBe(400);
    expect(resNoBaseUrl.message).toContain("必填项");
  });

  it("[M46-19] 网关路由端点 POST /api/school/settings/llm 与 GET /api/school/settings/llm 鉴权及分发测试", async () => {
    // 1. 未登录拦截
    const unauthRes = await llmApiEndpoint.handler(
      { query: {} } as any,
      { userPayload: null } as any
    );
    expect(unauthRes.status).toBe(0);
    expect(unauthRes.content).toBe("请先登录");

    // 2. 正常查询
    const getRes = await handleGetLlmConfig({ schoolId: 1, userId: 88, userRole: 5 });
    expect(getRes.code).toBe(200);

    // 3. 正常保存
    const saveRes = await handleSaveLlmConfig(
      { schoolId: 1, userId: 88, userRole: 5 },
      {
        primary: {
          providerId: "deepseek",
          baseUrl: "https://api.deepseek.com/v1",
          modelName: "deepseek-chat"
        },
        primaryApiKeyCandidate: "sk-gateway-save-key-7777",
        enableFallback: false
      }
    );
    expect(saveRes.code).toBe(200);
    expect(saveRes.message).toContain("安全加密持久化");
  });

  it("[M46-20] 网关路由端点 POST /api/school/settings/test-llm 端到端闭环探测测试", async () => {
    LLMProbeService.setMockProbeHandler(async (_url, key, model) => {
      return {
        success: true,
        latencyMs: 380,
        httpStatusCode: 200,
        modelFingerprint: model,
        diagnosticMessage: "连通成功！首字往返时延: 380ms",
        timestamp: new Date().toISOString()
      };
    });

    const testRes = await handleTestLlmConnectivity(
      { schoolId: 1, userId: 88, userRole: 5 },
      {
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        apiKeyCandidate: "sk-gateway-ping-key-8888",
        channelType: "primary"
      }
    );

    expect(testRes.code).toBe(200);
    expect(testRes.data.success).toBe(true);
    expect(testRes.data.latencyMs).toBe(380);
    expect(testRes.data.modelFingerprint).toBe("deepseek-chat");

    // 网关 handler 封装调用
    const endpointRes = await testLlmApiEndpoint.handler(
      {
        body: {
          baseUrl: "https://api.deepseek.com/v1",
          modelName: "deepseek-chat",
          apiKeyCandidate: "sk-gateway-ping-key-8888"
        }
      } as any,
      { userPayload: { schoolId: 1, userId: 88, role: 5 } } as any
    );
    expect((endpointRes as any).code).toBe(200);
    expect((endpointRes as any).data.success).toBe(true);
  });
});
