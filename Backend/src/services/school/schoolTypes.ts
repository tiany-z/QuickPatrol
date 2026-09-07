/**
 * M11: 多校 SaaS 配额熔断与学期自动归档 (Tenant SaaS & Quota)
 * 强类型接口契约与数据模型定义
 */

import { RequestContext } from "../../dispatcher/gatewayTypes.js";

/**
 * 学校租户实体契约 (映射 MySQL schools 核心主表)
 */
export interface ISchoolEntity {
  id: number;
  code: string;
  name: string;
  shortName: string;
  logo: string;
  domain: string;
  /** 租户状态: 1正常启用, 0已冻结/暂停, -1已退订/到期锁定 */
  status: -1 | 0 | 1;
  /** 付费版本级别: 0免费体验版, 1基础专业版, 2旗舰尊享版 */
  planLevel: 0 | 1 | 2;
  /** 配额模式: limited(有限配额), unlimited(无限配额) */
  planType: "limited" | "unlimited";
  /** 每月允许提报工单总配额: -1为无限制, >0为具体额度上限 */
  maxMonthlyPatrols: number;
  /** 专属 OSS 存储容量上限配额 (单位: MB, -1为无限) */
  storageQuotaMb: number;
  /** 付费服务有效到期时间 (ISO 格式或 YYYY-MM-DD HH:mm:ss) */
  planExpireAt: string;
  /** 学校个性化扩展配置 (JSON 格式) */
  configJson?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  /** 软删除标记: 0正常, 1已删除 */
  isDeleted: 0 | 1;
}

/**
 * 租户配额健康状态报表契约 (用于看板与宏观大盘展示)
 */
export interface ITenantQuotaHealthReport {
  schoolId: number;
  schoolName: string;
  planLevel: number;
  planLevelName: string;
  planType: "limited" | "unlimited";
  yearMonth: string;
  usedPatrolCount: number;
  maxMonthlyPatrols: number;
  /** 使用比率 (0.00 ~ 1.00) */
  usageRatio: number;
  /** 水位告警状态: HEALTHY(正常绿灯), WARNING(预警黄灯>=80%), EXCEEDED(熔断红灯>=100%) */
  watermarkStatus: "HEALTHY" | "WARNING" | "EXCEEDED";
  isExpired: boolean;
  expireDate: string;
  daysRemaining: number;
  storageUsedMb: number;
  storageQuotaMb: number;
}

/**
 * 学期归档任务入参契约
 */
export interface ISemesterArchiveParams {
  schoolId: number;
  /** 学期代号 (如 "2026-SPRING", "2026-AUTUMN") */
  semesterCode: string;
  customStartDate?: string;
  customEndDate?: string;
  operatorId: number;
}

/**
 * 学期归档任务执行报告契约
 */
export interface ISemesterArchiveResult {
  taskId: string;
  schoolId: number;
  semesterCode: string;
  migratedPatrolCount: number;
  freedStorageKb: number;
  elapsedMs: number;
  completedAt: string;
}

/**
 * 配额复合安全判定结果契约 (算法 1 输出)
 */
export interface QuotaCheckResult {
  allowed: boolean;
  code: number;
  reason?: string;
  currentCount?: number;
  maxLimit?: number;
}

/**
 * 拦截器检查通过后注入的上下文扩展契约
 */
export interface IQuotaCheckedContext extends RequestContext {
  schoolTenant: ISchoolEntity;
  currentQuotaUsage: {
    yearMonth: string;
    usedCount: number;
    maxLimit: number;
  };
}
