/**
 * 高校后勤巡查e速办 v4.0 - M46: 学校大模型配置持久化、AES-256-GCM 密文保险箱与脱敏服务
 * (School LLM Configuration & Sensitive Credential Vault Service)
 */

import { AesCryptoEngine } from "../../shared/crypto/aesCrypto.js";
import { executeQuery } from "../../shared/db/mysql.js";
import { delTenantKV } from "../../shared/cache/redis.js";
import { RedisWsBridge } from "../../ws/redisWsBridge.js";
import {
  ILLMProviderPreset,
  ISingleLLMChannelConfig,
  ISchoolLLMSettingsPayload,
  ISchoolLLMConfigViewDto,
  ILLMRuntimeClientOptions
} from "./llmConfigTypes.js";

export class LLMConfigService {
  public static readonly SETTING_KEY = "llm_config";
  private static readonly CACHE_TTL_SECONDS = 3600;

  // 内存级测试沙箱 (保证无外部数据库时 100% 独立离线运行)
  private static mockStore: Map<number, ISchoolLLMSettingsPayload> = new Map();

  /**
   * 预置的工业级大模型厂商元数据模版
   */
  public static readonly PROVIDER_PRESETS: ILLMProviderPreset[] = [
    {
      providerId: "deepseek",
      providerName: "DeepSeek (深度求索)",
      defaultBaseUrl: "https://api.deepseek.com/v1",
      docsUrl: "https://platform.deepseek.com/api-docs",
      isPrivateDeployment: false,
      models: [
        {
          modelId: "deepseek-chat",
          displayName: "DeepSeek-V3 高性能对话模型",
          supportsFunctionCalling: true,
          contextWindowTokens: 65536,
          recommendedTemperature: 0.3
        },
        {
          modelId: "deepseek-reasoner",
          displayName: "DeepSeek-R1 深度推理模型",
          supportsFunctionCalling: false,
          contextWindowTokens: 65536,
          recommendedTemperature: 0.6
        }
      ]
    },
    {
      providerId: "qwen",
      providerName: "阿里云百炼 (通义千问)",
      defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      docsUrl: "https://help.aliyun.com/zh/model-studio",
      isPrivateDeployment: false,
      models: [
        {
          modelId: "qwen-plus",
          displayName: "Qwen-Plus 高性价比通用模型",
          supportsFunctionCalling: true,
          contextWindowTokens: 131072,
          recommendedTemperature: 0.3
        },
        {
          modelId: "qwen-turbo",
          displayName: "Qwen-Turbo 极速低延迟兜底模型",
          supportsFunctionCalling: true,
          contextWindowTokens: 131072,
          recommendedTemperature: 0.2
        },
        {
          modelId: "qwen-max",
          displayName: "Qwen-Max 顶配复杂推理模型",
          supportsFunctionCalling: true,
          contextWindowTokens: 32768,
          recommendedTemperature: 0.4
        }
      ]
    },
    {
      providerId: "zhipu",
      providerName: "智谱清言 (GLM-4)",
      defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
      docsUrl: "https://open.bigmodel.cn/dev/api",
      isPrivateDeployment: false,
      models: [
        {
          modelId: "glm-4-flash",
          displayName: "GLM-4-Flash 极速低延时模型",
          supportsFunctionCalling: true,
          contextWindowTokens: 128000,
          recommendedTemperature: 0.3
        },
        {
          modelId: "glm-4-plus",
          displayName: "GLM-4-Plus 高清决策模型",
          supportsFunctionCalling: true,
          contextWindowTokens: 128000,
          recommendedTemperature: 0.3
        }
      ]
    },
    {
      providerId: "ollama",
      providerName: "校内算力中心私有化 (Ollama / vLLM)",
      defaultBaseUrl: "http://10.0.0.100:11434/v1",
      docsUrl: "https://ollama.com",
      isPrivateDeployment: true,
      models: [
        {
          modelId: "deepseek-r1:32b",
          displayName: "DeepSeek-R1 (32B 私有化版本)",
          supportsFunctionCalling: true,
          contextWindowTokens: 32768,
          recommendedTemperature: 0.3
        },
        {
          modelId: "qwen2.5:72b",
          displayName: "Qwen2.5 (72B 私有化旗舰版本)",
          supportsFunctionCalling: true,
          contextWindowTokens: 65536,
          recommendedTemperature: 0.3
        }
      ]
    },
    {
      providerId: "openai",
      providerName: "OpenAI 官方 (GPT-4o)",
      defaultBaseUrl: "https://api.openai.com/v1",
      docsUrl: "https://platform.openai.com/docs",
      isPrivateDeployment: false,
      models: [
        {
          modelId: "gpt-4o",
          displayName: "GPT-4o 多模态旗舰模型",
          supportsFunctionCalling: true,
          contextWindowTokens: 128000,
          recommendedTemperature: 0.3
        },
        {
          modelId: "gpt-4o-mini",
          displayName: "GPT-4o-Mini 极速模型",
          supportsFunctionCalling: true,
          contextWindowTokens: 128000,
          recommendedTemperature: 0.3
        }
      ]
    }
  ];

  /**
   * 算法 4: 动态前后缀敏感 API Key 脱敏掩码算法
   */
  public static maskApiKey(plainKey: string | undefined | null): string {
    if (!plainKey || plainKey.trim() === "") {
      return "";
    }
    const clean = plainKey.trim();
    const len = clean.length;
    if (len >= 12) {
      return `${clean.substring(0, 4)}****${clean.substring(len - 3)}`;
    } else if (len >= 6) {
      return `${clean.substring(0, 2)}****${clean.substring(len - 2)}`;
    }
    return "******";
  }

  /**
   * 获取所有厂商预设模版
   */
  public getProviderPresets(): ILLMProviderPreset[] {
    return LLMConfigService.PROVIDER_PRESETS;
  }

  /**
   * 获取指定学校的大模型管理端视图配置 (彻底脱敏，绝不泄漏明文)
   */
  public async getSchoolLLMConfigView(schoolId: number): Promise<ISchoolLLMConfigViewDto | null> {
    if (!schoolId || schoolId <= 0) {
      throw new Error("缺少高校租户标识");
    }

    const rawPayload = await this.getRawEncryptedPayload(schoolId);
    if (!rawPayload) {
      return null;
    }

    let primaryMasked = "";
    if (rawPayload.primaryEncryptedKey?.cipherText) {
      try {
        const fullPayloadStr = `${rawPayload.primaryEncryptedKey.iv}:${rawPayload.primaryEncryptedKey.authTag}:${rawPayload.primaryEncryptedKey.cipherText}`;
        const decryptedPlain = AesCryptoEngine.decrypt(fullPayloadStr);
        primaryMasked = LLMConfigService.maskApiKey(decryptedPlain);
      } catch {
        primaryMasked = "****** (解密验签异常)";
      }
    }

    let fallbackMasked = "";
    if (rawPayload.fallbackEncryptedKey?.cipherText) {
      try {
        const fullPayloadStr = `${rawPayload.fallbackEncryptedKey.iv}:${rawPayload.fallbackEncryptedKey.authTag}:${rawPayload.fallbackEncryptedKey.cipherText}`;
        const decryptedPlain = AesCryptoEngine.decrypt(fullPayloadStr);
        fallbackMasked = LLMConfigService.maskApiKey(decryptedPlain);
      } catch {
        fallbackMasked = "****** (解密验签异常)";
      }
    }

    return {
      schoolId,
      primary: {
        ...rawPayload.primary,
        maskedApiKey: primaryMasked,
        hasConfiguredKey: Boolean(rawPayload.primaryEncryptedKey?.cipherText)
      },
      enableFallback: Boolean(rawPayload.enableFallback),
      fallback: rawPayload.fallback
        ? {
            ...rawPayload.fallback,
            maskedApiKey: fallbackMasked,
            hasConfiguredKey: Boolean(rawPayload.fallbackEncryptedKey?.cipherText)
          }
        : undefined,
      updatedAt: rawPayload.updatedAt
    };
  }

  /**
   * 快捷配置保存接口 (自动适配简易参数)
   */
  public async saveConfig(
    schoolId: number,
    userId: number,
    payload: any
  ): Promise<void> {
    return this.saveSchoolLLMConfig(schoolId, userId, {
      primary: {
        providerId: payload.primary?.providerId || payload.primary?.provider || payload.selectedProvider || "deepseek",
        baseUrl: payload.primary?.baseUrl || "https://api.deepseek.com/v1",
        modelName: payload.primary?.modelName || "deepseek-chat",
        temperature: payload.primary?.temperature,
        maxTokens: payload.primary?.maxTokens,
        timeoutMs: payload.primary?.timeoutMs,
        stream: payload.primary?.stream ?? true
      },
      primaryApiKeyCandidate: payload.primaryApiKeyCandidate || payload.primary?.apiKeyPlain,
      enableFallback: Boolean(payload.enableFallback),
      fallback: payload.fallback,
      fallbackApiKeyCandidate: payload.fallbackApiKeyCandidate || payload.fallback?.apiKeyPlain
    });
  }

  /**
   * 保存或更新指定学校的大模型配置 (执行 AES-256-GCM 硬件级认证加密落库)
   */
  public async saveSchoolLLMConfig(
    schoolId: number,
    userId: number,
    input: {
      primary: ISingleLLMChannelConfig;
      primaryApiKeyCandidate?: string;
      enableFallback: boolean;
      fallback?: ISingleLLMChannelConfig;
      fallbackApiKeyCandidate?: string;
    }
  ): Promise<void> {
    if (!schoolId || schoolId <= 0) {
      throw new Error("缺少高校租户标识");
    }
    if (!userId || userId <= 0) {
      throw new Error("无效操作人身份");
    }
    if (!input.primary || !input.primary.baseUrl || !input.primary.modelName) {
      throw new Error("主选大模型端点 BaseURL 与模型名称为必填项");
    }

    const existing = await this.getRawEncryptedPayload(schoolId);

    // 1. 处理主通道 Key 加密
    let primaryEnc = existing?.primaryEncryptedKey;
    if (input.primaryApiKeyCandidate && input.primaryApiKeyCandidate.trim() !== "") {
      const encryptedStr = AesCryptoEngine.encrypt(input.primaryApiKeyCandidate.trim());
      const [iv, authTag, cipherText] = encryptedStr.split(":");
      primaryEnc = { cipherText, iv, authTag };
    }

    if (!primaryEnc || !primaryEnc.cipherText) {
      throw new Error("未配置主选大模型 API Key 凭据");
    }

    // 2. 处理备选容灾通道 Key 加密
    let fallbackEnc = existing?.fallbackEncryptedKey;
    if (input.enableFallback && input.fallback) {
      if (input.fallbackApiKeyCandidate && input.fallbackApiKeyCandidate.trim() !== "") {
        const encryptedStr = AesCryptoEngine.encrypt(input.fallbackApiKeyCandidate.trim());
        const [iv, authTag, cipherText] = encryptedStr.split(":");
        fallbackEnc = { cipherText, iv, authTag };
      }
    }

    const newPayload: ISchoolLLMSettingsPayload = {
      primary: {
        providerId: input.primary.providerId || "custom",
        baseUrl: input.primary.baseUrl.trim(),
        modelName: input.primary.modelName.trim(),
        temperature: input.primary.temperature !== undefined ? Number(input.primary.temperature) : 0.3,
        maxTokens: input.primary.maxTokens ? Number(input.primary.maxTokens) : 2048,
        stream: input.primary.stream !== undefined ? Boolean(input.primary.stream) : true,
        timeoutMs: input.primary.timeoutMs ? Number(input.primary.timeoutMs) : 15000
      },
      primaryEncryptedKey: primaryEnc,
      enableFallback: Boolean(input.enableFallback),
      fallback: input.enableFallback && input.fallback
        ? {
            providerId: input.fallback.providerId || "custom",
            baseUrl: input.fallback.baseUrl.trim(),
            modelName: input.fallback.modelName.trim(),
            temperature: input.fallback.temperature !== undefined ? Number(input.fallback.temperature) : 0.3,
            maxTokens: input.fallback.maxTokens ? Number(input.fallback.maxTokens) : 2048,
            stream: input.fallback.stream !== undefined ? Boolean(input.fallback.stream) : true,
            timeoutMs: input.fallback.timeoutMs ? Number(input.fallback.timeoutMs) : 15000
          }
        : undefined,
      fallbackEncryptedKey: input.enableFallback ? fallbackEnc : undefined,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    };

    // 3. 写入内存沙箱
    LLMConfigService.mockStore.set(schoolId, newPayload);

    // 4. 持久化到 MySQL school_settings 表
    const payloadJson = JSON.stringify(newPayload);
    try {
      const sql = `
        INSERT INTO school_settings (schoolId, \`key\`, valueJson, isEncrypted, createdAt, updatedAt)
        VALUES (?, ?, ?, 1, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          valueJson = VALUES(valueJson),
          isEncrypted = 1,
          updatedAt = NOW()
      `;
      await executeQuery(sql, [schoolId, LLMConfigService.SETTING_KEY, payloadJson]);
    } catch {
      // 容错降级
    }

    // 5. 刷新 Redis 缓存与集群广播
    try {
      await delTenantKV(schoolId, "settings", LLMConfigService.SETTING_KEY);
      await RedisWsBridge.broadcast("cluster:config:flush", schoolId, {
        key: LLMConfigService.SETTING_KEY,
        updatedAt: Date.now()
      });
    } catch {
      // 容错
    }
  }

  /**
   * 内部受控解密获取运行时配置 (专供下游 M47 SSE 工作台与 M48 工具箱在微任务中安全调用)
   */
  public async getRuntimeDecryptedConfig(
    schoolId: number,
    targetChannel: "primary" | "fallback" = "primary"
  ): Promise<ILLMRuntimeClientOptions> {
    const payload = await this.getRawEncryptedPayload(schoolId);
    if (!payload) {
      throw new Error(`未找到学校 [ID: ${schoolId}] 的大模型配置信息，请先在管理端完成配置`);
    }

    if (targetChannel === "fallback") {
      if (!payload.enableFallback || !payload.fallback || !payload.fallbackEncryptedKey) {
        throw new Error(`学校 [ID: ${schoolId}] 未启用备选容灾模型通道`);
      }
      const fullPayloadStr = `${payload.fallbackEncryptedKey.iv}:${payload.fallbackEncryptedKey.authTag}:${payload.fallbackEncryptedKey.cipherText}`;
      const plainKey = AesCryptoEngine.decrypt(fullPayloadStr);

      return {
        schoolId,
        baseUrl: payload.fallback.baseUrl,
        modelName: payload.fallback.modelName,
        apiKeyPlain: plainKey,
        temperature: payload.fallback.temperature,
        maxTokens: payload.fallback.maxTokens,
        timeoutMs: payload.fallback.timeoutMs
      };
    }

    // 默认解密主选通道
    const fullPayloadStr = `${payload.primaryEncryptedKey.iv}:${payload.primaryEncryptedKey.authTag}:${payload.primaryEncryptedKey.cipherText}`;
    const plainKey = AesCryptoEngine.decrypt(fullPayloadStr);

    return {
      schoolId,
      baseUrl: payload.primary.baseUrl,
      modelName: payload.primary.modelName,
      apiKeyPlain: plainKey,
      temperature: payload.primary.temperature,
      maxTokens: payload.primary.maxTokens,
      timeoutMs: payload.primary.timeoutMs
    };
  }

  /**
   * 底层受控方法：获取原始加密实体快照
   */
  public async getRawEncryptedPayload(schoolId: number): Promise<ISchoolLLMSettingsPayload | null> {
    // 优先查本地沙箱
    if (LLMConfigService.mockStore.has(schoolId)) {
      return LLMConfigService.mockStore.get(schoolId)!;
    }

    // 查 MySQL
    try {
      const sql = `SELECT valueJson FROM school_settings WHERE schoolId = ? AND \`key\` = ? LIMIT 1`;
      const res = await executeQuery<{ valueJson: string }>(sql, [schoolId, LLMConfigService.SETTING_KEY]);
      if (res.status === 1 && res.data && res.data.length > 0) {
        const payload = JSON.parse(res.data[0].valueJson) as ISchoolLLMSettingsPayload;
        LLMConfigService.mockStore.set(schoolId, payload);
        return payload;
      }
    } catch {
      // 容错
    }

    return null;
  }

  // =========================================================================
  // 沙箱管理桩点 (供单元测试与离线隔离)
  // =========================================================================

  public static mockSetPayload(schoolId: number, payload: ISchoolLLMSettingsPayload): void {
    this.mockStore.set(schoolId, payload);
  }

  public static resetMockData(): void {
    this.mockStore.clear();
  }
}

export const llmConfigService = new LLMConfigService();
