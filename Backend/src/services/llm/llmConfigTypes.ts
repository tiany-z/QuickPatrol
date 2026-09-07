/**
 * 高校后勤巡查e速办 v4.0 - M46: 各校自主配置异构大模型与连通测试 强类型契约
 * (School LLM Configuration & Ping Probe Contracts)
 */

/**
 * 大模型单项规格选项定义
 */
export interface ILLMModelOption {
  /** 模型唯一标识 (传递给 API 的 model 参数，如 'deepseek-chat') */
  modelId: string;
  /** 管理端前端展示的友好名称 */
  displayName: string;
  /** 该模型是否支持 Function Calling 工具回调 (M48 强依赖) */
  supportsFunctionCalling: boolean;
  /** 上下文窗口大小 (以 Token 为单位，如 32768, 65536) */
  contextWindowTokens: number;
  /** 默认温度系数 (后勤系统严谨推荐 0.3) */
  recommendedTemperature: number;
}

/**
 * 厂商预设模版契约
 */
export interface ILLMProviderPreset {
  /** 厂商代号: 'deepseek' | 'qwen' | 'zhipu' | 'openai' | 'ollama_custom' */
  providerId: string;
  /** 厂商中文显示名称 */
  providerName: string;
  /** 预设的标准 API BaseURL */
  defaultBaseUrl: string;
  /** 厂商开发者官方申请文档外链 */
  docsUrl: string;
  /** 是否属于校内局域网私有化部署类型 */
  isPrivateDeployment: boolean;
  /** 该厂商推荐的主流模型列表 */
  models: ILLMModelOption[];
}

/**
 * 单个大模型连接通道核心配置
 */
export interface ISingleLLMChannelConfig {
  /** 所选厂商预设 ID */
  providerId: string;
  /** API BaseURL (如 https://api.deepseek.com/v1) */
  baseUrl: string;
  /** 选定的运行模型名称 */
  modelName: string;
  /** 模型温度采样系数 (0.0 ~ 1.0) */
  temperature: number;
  /** 单次最大回复 Token 数 (默认 2048) */
  maxTokens: number;
  /** 启用流式响应开关 (默认 true) */
  stream: boolean;
  /** 超时断开时限 (毫秒，默认 15000) */
  timeoutMs: number;
}

/**
 * 物理存储于 school_settings.valueJson 的全量数据快照 (含加密凭据)
 */
export interface ISchoolLLMSettingsPayload {
  /** 主选大模型参数 */
  primary: ISingleLLMChannelConfig;
  /** AES-256-GCM 加密后的主模型 API Key 载荷 */
  primaryEncryptedKey: {
    cipherText: string;
    iv: string;
    authTag: string;
  };
  /** 是否启用了容灾备用模型 */
  enableFallback: boolean;
  /** 备选大模型参数 (可选) */
  fallback?: ISingleLLMChannelConfig;
  /** AES-256-GCM 加密后的备用模型 API Key 载荷 (可选) */
  fallbackEncryptedKey?: {
    cipherText: string;
    iv: string;
    authTag: string;
  };
  /** 最后修改人 userId */
  updatedBy: number;
  /** 最后更新时间 ISO8601 */
  updatedAt: string;
}

/**
 * 下发给前端管理界面的安全展示 DTO (已彻底脱敏)
 */
export interface ISchoolLLMConfigViewDto {
  schoolId: number;
  primary: ISingleLLMChannelConfig & {
    /** 脱敏后的掩码 Key，如 "sk-de****xyz" */
    maskedApiKey: string;
    /** 标识当前后端数据库中是否已配置有效的 Key */
    hasConfiguredKey: boolean;
  };
  enableFallback: boolean;
  fallback?: ISingleLLMChannelConfig & {
    maskedApiKey: string;
    hasConfiguredKey: boolean;
  };
  updatedAt: string;
}

/**
 * 连通性测试请求 DTO
 */
export interface ILlmPingRequestDto {
  /** 学校 ID (从 JWT 上下文提取，防跨校) */
  schoolId: number;
  /** 被测试的端点 BaseURL */
  baseUrl: string;
  /** 被测试的模型名称 */
  modelName: string;
  /**
   * 待测试的 API Key：
   * 1. 若管理员在界面填入了新输入的明文，则直接传明文进行即时测试；
   * 2. 若留空或传 "__USE_PERSISTED_KEY__"，则表示后端自动解密数据库已保存的密钥进行测试。
   */
  apiKeyCandidate?: string;
  /** 目标通道类型: 'primary' | 'fallback' */
  channelType?: "primary" | "fallback";
}

/**
 * 连通性测试响应结果 DTO
 */
export interface ILlmPingResponseDto {
  /** 探测最终是否连通成功 */
  success: boolean;
  /** 端到端首字往返耗时 (毫秒) */
  latencyMs: number;
  /** HTTP 状态码 (200, 401, 404, 504 等) */
  httpStatusCode: number;
  /** 返回的模型元数据指纹 (来自 choices[0].delta 或模型头信息) */
  modelFingerprint?: string;
  /** 诊断与错误提示信息 (中文友好展示) */
  diagnosticMessage: string;
  /** 探测完成时间 ISO8601 */
  timestamp: string;
}

/**
 * 底层执行器解密后装配的运行时配置 (供给 M47, M48 调度器)
 */
export interface ILLMRuntimeClientOptions {
  schoolId: number;
  baseUrl: string;
  apiKeyPlain: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

/**
 * 探针沙箱执行返回契约
 */
export interface ILLMProbeResult {
  isHealthy: boolean;
  ttftMs: number;
  statusCode: number;
  rawError?: string;
  diagnosticMsg: string;
}
