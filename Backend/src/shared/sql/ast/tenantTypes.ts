import { NonEmptyString } from "../type.js";

/**
 * 租户多维鉴权上下文
 */
export interface TenantContext {
  /** 学校/租户 ID (必须为正整数) */
  schoolId: number;
  /** 当前用户 ID */
  userId?: number | string;
  /** 角色: 0学生, 1教职工, 2维修工, 3科室管理员, 4校管, 9超管 */
  role?: number;
  /** 仅限超管 role=9 显式开启跨校豁免注入 */
  bypassTenantFilter?: boolean;
}

/**
 * 表级别租户配置特性
 */
export interface TenantTableMeta {
  tableName: string;
  hasSchoolId: boolean;
  hasIsDeleted: boolean;
  isGlobalTable: boolean;
}

/**
 * 注入器编译最终产物
 */
export interface TenantCompiledSqlResult {
  tableName: string;
  sql: string;
  sqlOnlyId?: string;
  boundParams: any[];
}

/**
 * 系统级全局表白名单 (豁免 schoolId 租户隔离注入)
 */
export const GLOBAL_TABLES: ReadonlySet<string> = new Set([
  "schools",
  "__schema_migrations",
]);

/**
 * 判断指定表是否为系统级全局表
 */
export function isGlobalTable(tableName: string): boolean {
  if (!tableName) return false;
  return GLOBAL_TABLES.has(tableName.trim().toLowerCase());
}

/**
 * 校验租户上下文合法性
 */
export function isValidTenantContext(context?: TenantContext): boolean {
  if (!context) return false;
  if (context.role === 9 && context.bypassTenantFilter === true) {
    return true;
  }
  return (
    typeof context.schoolId === "number" &&
    Number.isInteger(context.schoolId) &&
    context.schoolId > 0
  );
}
