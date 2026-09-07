import { TenantKeyInfo } from "./cacheTypes.js";

/**
 * 确定性派生多租户命名空间缓存键
 * 格式: tenant:{schoolId}:{module}:{subKey}
 */
export function buildTenantKey(
  schoolId: number,
  module: string,
  subKey: string | number
): string {
  if (!schoolId || schoolId <= 0) {
    throw new Error(`[M05 命名空间阻断] 派生 Redis 缓存键必须提供有效的 schoolId，当前为: ${schoolId}`);
  }
  const cleanModule = (module || "").trim().toLowerCase();
  const cleanSubKey = String(subKey).trim();
  return `tenant:${schoolId}:${cleanModule}:${cleanSubKey}`;
}

/**
 * 反向解析多租户缓存键
 */
export function parseTenantKey(rawKey: string): TenantKeyInfo | null {
  if (!rawKey || typeof rawKey !== "string") {
    return null;
  }
  const parts = rawKey.split(":");
  if (parts.length < 4 || parts[0] !== "tenant") {
    return null;
  }
  const schoolId = parseInt(parts[1], 10);
  if (isNaN(schoolId) || schoolId <= 0) {
    return null;
  }
  return {
    schoolId,
    module: parts[2],
    subKey: parts.slice(3).join(":")
  };
}

/**
 * 统一多租户缓存键名工厂
 */
export class TenantCacheKeyFactory {
  public static forUser(schoolId: number, userId: number | string): string {
    return buildTenantKey(schoolId, "users", userId);
  }

  public static forPatrol(schoolId: number, patrolId: number | string): string {
    return buildTenantKey(schoolId, "patrols", patrolId);
  }

  public static forSettings(schoolId: number, settingKey: string): string {
    return buildTenantKey(schoolId, "settings", settingKey);
  }

  public static forMonthlyQuota(schoolId: number, yearMonth: string): string {
    if (!schoolId || schoolId <= 0) {
      throw new Error(`[M05 命名空间阻断] 派生月度配额键必须提供有效的 schoolId，当前为: ${schoolId}`);
    }
    return `quota:school:${schoolId}:${yearMonth}`;
  }

  public static forUserPresence(schoolId: number, userId: number | string): string {
    if (!schoolId || schoolId <= 0) {
      throw new Error(`[M05 命名空间阻断] 派生在线心跳键必须提供有效的 schoolId，当前为: ${schoolId}`);
    }
    return `presence:${schoolId}:${userId}`;
  }
}

/**
 * TTL 随机抖动散列算法 (TTL Jitter Dispersion)
 * 防止大批量缓存在同一毫秒集中过期引发缓存雪崩 (Cache Avalanche)
 * 在 baseTtlSeconds 基础上浮动 ±10%
 */
export function calculateJitterTtl(baseTtlSeconds: number = 86400): number {
  if (baseTtlSeconds <= 0) return 0;
  const variation = Math.random() * 0.2 - 0.1; // -10% ~ +10% 随机浮动
  return Math.max(1, Math.floor(baseTtlSeconds * (1 + variation)));
}
