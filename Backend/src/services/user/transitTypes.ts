/**
 * M14: 自然人多身份独立存储与多校会话穿梭 强类型接口契约与数据模型定义
 */

export interface IDeviceAccountRecord {
  /** 所属高校学校 ID */
  schoolId: number;
  /** 高校标准全称 (如 "聊城大学") */
  schoolName: string;
  /** 高校字母代号 (如 "LCU") */
  schoolCode: string;
  /** 高校矢量校徽图标 URL */
  logoUrl: string;
  /** 绑定的自然人主手机号 (用于过滤同手机号账号) */
  boundPhone: string;
  /** 用户在目标大学中的物理自增主键 */
  userId: number;
  /** 用户实名姓名 */
  realName: string;
  /** 物理角色 (0学生, 1教工, 2师傅, 3科室主管, 4校管, 9超管) */
  role: number;
  /** 物理角色文字描述 (如 "水电暖维修师傅") */
  roleName: string;
  /** 所在校区名称 (如 "东校区") */
  campusName: string;
  /** 该高校当前有效的租户 JWT Token (密文字符串) */
  token: string;
  /** Token 绝对过期时间 ISO 字符串 */
  tokenExpireAt: string;
  /** 是否已被标记为过期 */
  isExpired: boolean;
  /** 会话状态: 'active'当前激活 | 'valid'有效未激活 | 'expired'已过期 */
  sessionStatus: "active" | "valid" | "expired";
  /** 在本设备上的最后活跃使用时间 */
  lastLoginAt: string;
}

export interface ICrossTenantItemDto {
  schoolId: number;
  schoolName: string;
  schoolCode: string;
  logoUrl: string;
  userId: number;
  realName: string;
  role: number;
  roleName: string;
  campusName: string;
  badgeCount: number;
  sessionStatus: "active" | "valid" | "expired";
  isCurrent: boolean;
}

export interface IDeviceTenantsResponse {
  currentPhone: string;
  accounts: ICrossTenantItemDto[];
  totalBadgeCount: number;
}

export interface ISwitchTenantRequest {
  /** 期望切换的目标高校 ID */
  targetSchoolId: number;
}

export interface ISwitchTenantResponse {
  /** 目标高校全新签发的 30 天安全 Token */
  token: string;
  /** 目标学校 ID */
  targetSchoolId: number;
  /** 目标用户在目标学校的 userId */
  targetUserId: number;
  /** 目标学校物理角色 */
  targetRole: number;
  /** 目标学校默认活动工作视角 (1师生端, 2师傅端) */
  activeType: 1 | 2;
}

export interface IQuickRenewRequest {
  /** 目标高校 ID */
  targetSchoolId: number;
  /** 目标用户手机号 */
  phone?: string;
  /** 微信手机号快速授权 code 或 短信 4 位验证码 */
  authCode?: string;
  /** 授权类型: 'wx_phone' | 'sms' */
  authType?: "wx_phone" | "sms";
}

export interface IQuickRenewResponse {
  token: string;
  schoolId: number;
  userId: number;
  realName: string;
}
