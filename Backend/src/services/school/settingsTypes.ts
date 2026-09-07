/**
 * M12: 学校个性化设置字典与敏感凭据强类型契约 (Settings Types)
 */

/**
 * 设置字典数据表映射实体 (MySQL: school_settings)
 */
export interface ISchoolSettingEntity {
  id?: number;
  schoolId: number;
  key: string;
  value: string; // 密文三元组或明文字符串
  desc: string;
  isEncrypted: 0 | 1;
  updatedAt?: string;
}

/**
 * 标准常用配置项枚举
 */
export enum StandardSettingKey {
  // 异构大模型接入配置
  AI_PROVIDER      = "ai_provider",      // 提供商: "openai" | "deepseek" | "qwen" | "zhipu"
  AI_BASE_URL      = "ai_base_url",      // API Base 端点 (如 https://api.deepseek.com/v1)
  AI_API_KEY       = "ai_api_key",       // API 认证密钥 (强制加密)
  AI_MODEL         = "ai_model",         // 模型名称 (如 deepseek-chat, gpt-4o-mini)
  AI_TEMPERATURE   = "ai_temperature",   // 采样温度 (0.0 ~ 1.0)

  // 业务流转时效参数
  AUTO_PASS_DAYS   = "auto_pass_days",   // 完工未评价自动好评归档天数 (默认 7)
  DISPATCH_TIMEOUT = "dispatch_timeout", // 抢修超时预警小时数 (默认 2)
  SLA_URGENT_HOURS = "sla_urgent_hours", // 紧急任务 SLA 倒计时时限 (默认 4)

  // 运营策略开关
  PLAZA_COMMENT    = "plaza_comment",    // 校园公共空间评论开关 ("true" | "false")
  SERVICE_PHONE    = "service_phone",    // 后勤 24 小时报修热线电话
  WATERMARK_FORCE  = "watermark_force"   // 是否强制要求实证照防篡改水印 ("true" | "false")
}

/**
 * AES-256-GCM 密文物理存储三元组契约
 */
export interface IEncryptedGcmPayload {
  /** 12 字节 Hex 编码的随机向量 */
  iv: string;
  /** 16 字节 Hex 编码的 GCM 认证标签 */
  authTag: string;
  /** 加密主体 Hex 密文 */
  cipherText: string;
}

/**
 * 前端展示设置传输对象 (对外返回脱敏安全数据)
 */
export interface ISettingItemDto {
  key: string;
  value: string; // 若为敏感加密项，此处为脱敏文本
  desc: string;
  isEncrypted: boolean;
  updatedAt?: string;
}

/**
 * 保存或更新设置入参契约
 */
export interface ISaveSettingRequest {
  key: string;
  value: string;
  desc?: string;
  isEncrypted?: boolean;
}
