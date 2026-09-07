/**
 * M11: 租户 SaaS 配额判定与学期归档核心算法与规则库 (Quota Rules & Deciders)
 * 
 * 包含：
 * 1. 算法 1: 租户有效性与月度工单配额复合安全判定算法 (checkTenantQuotaSafety)
 * 2. 算法 2: 基于 Redis 原子计数器的递增与回滚补偿管理器 (AtomicQuotaManager)
 * 3. 算法 3: 高校自然学期跨度动态切片算法 (resolveAcademicSemester)
 * 4. 算法 4: 历史已办结工单冷数据分批迁移管道算法 (executeChunkedArchiving)
 */

import { ISchoolEntity, QuotaCheckResult } from "../services/school/schoolTypes.js";
import { getRedisClient } from "../shared/cache/redis.js";
import { executeQuery, getMySQLPool } from "../shared/db/mysql.js";
import { TerminalLogger } from "../shared/log/terminalLogger.js";
import { tryCatchErrorToString } from "../shared/flow/result.js";

// ==============================================================================
// 算法 1：租户有效性与月度工单配额复合安全判定算法
// ==============================================================================

/**
 * 校验指定高校的租户状态、合同到期与月度配额健康度
 * 纯函数无副作用，单次执行耗时 O(1) < 0.1ms
 */
export function checkTenantQuotaSafety(
  school: ISchoolEntity,
  currentCount: number
): QuotaCheckResult {
  // 1. 状态位硬性判定 (冻结或软删除)
  if (school.isDeleted === 1 || school.status === 0) {
    return {
      allowed: false,
      code: 403,
      reason: "该高校租户已被系统暂停服务或注销"
    };
  }

  // 2. 合同到期时间判定
  const expireTimestamp = new Date(school.planExpireAt).getTime();
  if (Date.now() > expireTimestamp) {
    return {
      allowed: false,
      code: 402,
      reason: `该高校后勤 SaaS 服务已于 ${school.planExpireAt} 到期，目前处于只读保护状态`
    };
  }

  // 3. 旗舰尊享版直接放行 (无限配额)
  if (school.planType === "unlimited" || school.maxMonthlyPatrols === -1) {
    return {
      allowed: true,
      code: 200,
      currentCount,
      maxLimit: -1
    };
  }

  // 4. 有限额度水位判定 (若当前计数已超过上限，触发熔断)
  if (currentCount > school.maxMonthlyPatrols) {
    return {
      allowed: false,
      code: 429,
      reason: `本月工单提报配额已达上限 (${currentCount - 1}/${school.maxMonthlyPatrols})，请联系后勤管理员增购额度`,
      currentCount: currentCount - 1,
      maxLimit: school.maxMonthlyPatrols
    };
  }

  return {
    allowed: true,
    code: 200,
    currentCount,
    maxLimit: school.maxMonthlyPatrols
  };
}

// ==============================================================================
// 算法 2：基于 Redis 原子计数器的递增与回滚补偿管理器
// ==============================================================================

/**
 * 内存级应急/单测配额计数器存储 (当真实 Redis 未配置时零中断无感接管)
 */
class MemoryQuotaFallback {
  private static store = new Map<string, { count: number; expireAt?: number }>();

  public static async incrby(key: string, amount: number = 1): Promise<number> {
    const item = this.store.get(key);
    const current = item ? item.count : 0;
    const next = current + amount;
    this.store.set(key, { count: next, expireAt: item?.expireAt });
    return next;
  }

  public static async decrby(key: string, amount: number = 1): Promise<number> {
    return this.incrby(key, -amount);
  }

  public static async expire(key: string, seconds: number): Promise<number> {
    const item = this.store.get(key);
    if (!item) return 0;
    item.expireAt = Date.now() + seconds * 1000;
    this.store.set(key, item);
    return 1;
  }

  public static async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expireAt && Date.now() > item.expireAt) {
      this.store.delete(key);
      return null;
    }
    return String(item.count);
  }

  public static clearAll(): void {
    this.store.clear();
  }
}

let customQuotaRedisClient: any = null;

export function setCustomQuotaRedis(client: any): void {
  customQuotaRedisClient = client;
}

export function getActiveQuotaRedis(): {
  incrby: (key: string, amount: number) => Promise<number>;
  decrby: (key: string, amount: number) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  get: (key: string) => Promise<string | null>;
  set?: (key: string, value: string, mode?: string, duration?: number) => Promise<any>;
  del?: (...keys: string[]) => Promise<number>;
} {
  if (customQuotaRedisClient) {
    return customQuotaRedisClient;
  }
  const realClient = getRedisClient();
  if (realClient) {
    return realClient as any;
  }
  return MemoryQuotaFallback;
}

export class AtomicQuotaManager {
  /**
   * 原子预扣一次工单配额 (算法 2)
   * 采用悲观原子递增 + 越界立即补偿回退 (Optimistic Increment with Rollback)
   */
  public static async tryConsumeQuota(
    schoolId: number,
    yearMonth: string,
    maxLimit: number
  ): Promise<{ success: boolean; current: number }> {
    const redis = getActiveQuotaRedis();
    const quotaKey = `quota:school:${schoolId}:${yearMonth}`;

    // 1. 原生原子递增
    const current = await redis.incrby(quotaKey, 1);

    // 若是本月第一次写入，设置 60 天自动过期，防止内存积压
    if (current === 1) {
      await redis.expire(quotaKey, 60 * 86400);
    }

    // 2. 判定是否超额
    if (maxLimit !== -1 && current > maxLimit) {
      // 触发原子回滚补偿
      await redis.decrby(quotaKey, 1);
      return { success: false, current: current - 1 };
    }

    return { success: true, current };
  }

  /**
   * 业务提单因表单校验非法或后续流程抛错时的配额返还
   */
  public static async refundQuota(schoolId: number, yearMonth: string): Promise<void> {
    const redis = getActiveQuotaRedis();
    const quotaKey = `quota:school:${schoolId}:${yearMonth}`;
    await redis.decrby(quotaKey, 1);
  }

  /**
   * 获取当前月份已用工单数
   */
  public static async getCurrentQuota(schoolId: number, yearMonth: string): Promise<number> {
    const redis = getActiveQuotaRedis();
    const quotaKey = `quota:school:${schoolId}:${yearMonth}`;
    const raw = await redis.get(quotaKey);
    return raw ? parseInt(raw, 10) || 0 : 0;
  }

  /**
   * 清理内存级配额存储状态 (用于单元测试隔离)
   */
  public static resetMemoryStore(): void {
    MemoryQuotaFallback.clearAll();
  }
}

// ==============================================================================
// 算法 3：高校自然学期跨度动态切片算法
// ==============================================================================

/**
 * 依据高校作息规律将指定公历日期归属到对应的自然学期 (算法 3)
 * 春季学期 (Spring): 2月15日 ~ 7月31日
 * 秋季学期 (Autumn): 8月1日 ~ 次年2月14日
 */
export function resolveAcademicSemester(date: Date = new Date()): {
  semesterCode: string;
  semesterName: string;
  startDate: string;
  endDate: string;
} {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1 ~ 12

  if (month >= 2 && month <= 7) {
    // 春季学期
    return {
      semesterCode: `${year}-SPRING`,
      semesterName: `${year}年春季学期`,
      startDate: `${year}-02-15 00:00:00`,
      endDate: `${year}-07-31 23:59:59`
    };
  } else {
    // 秋季学期
    const startYear = month === 1 ? year - 1 : year;
    const endYear = month === 1 ? year : year + 1;
    return {
      semesterCode: `${startYear}-AUTUMN`,
      semesterName: `${startYear}年秋季学期`,
      startDate: `${startYear}-08-01 00:00:00`,
      endDate: `${endYear}-02-14 23:59:59`
    };
  }
}

// ==============================================================================
// 算法 4：大规模历史工单冷数据分批迁移管道算法
// ==============================================================================

/**
 * 分批游标分片归档冷数据 (算法 4)
 * 单批次 500 条，事务完成后休眠 50ms 让出主库 IOPS，防止长时间锁表
 */
export async function executeChunkedArchiving(
  schoolId: number,
  startTime: string,
  endTime: string,
  options?: { chunkSize?: number }
): Promise<number> {
  let totalMigrated = 0;
  const CHUNK_SIZE = options?.chunkSize || 500;

  try {
    const pool = getMySQLPool();
    if (!pool) {
      // 离线/单测环境无物理数据库连接池，直接安全返回 0
      return 0;
    }

    while (true) {
      // 1. 圈定待归档批次 ID (仅限已评价结案 status=4 且未软删除的数据)
      const selectSql = `
        SELECT id FROM patrols
        WHERE schoolId = ? AND status = 4 AND isDeleted = 0
          AND createdAt >= ? AND createdAt <= ?
        ORDER BY id ASC LIMIT ?
      `;
      const queryRes = await executeQuery<{ id: number }>(selectSql, [
        schoolId,
        startTime,
        endTime,
        CHUNK_SIZE
      ]);

      const rows = queryRes.data || [];
      if (!rows || rows.length === 0) break;

      const ids: number[] = rows.map((r) => r.id);

      // 2. 事务内完成“写入冷库表 patrols_archive + 从热表安全移出”
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          `INSERT INTO patrols_archive SELECT * FROM patrols WHERE id IN (?)`,
          [ids]
        );
        await conn.query(
          `DELETE FROM patrols WHERE id IN (?)`,
          [ids]
        );
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }

      totalMigrated += ids.length;

      // 3. 释放事件循环，为在线巡查高频业务让出 IOPS
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch (err) {
    TerminalLogger.warn(
      `[M11 归档管道] 归档执行中止或脱机运行: ${tryCatchErrorToString(err)}`,
      "ArchiveWorker"
    );
  }

  return totalMigrated;
}
