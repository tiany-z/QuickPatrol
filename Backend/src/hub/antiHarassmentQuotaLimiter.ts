/**
 * 高校后勤巡查e速办 v4.0 - M43: 多维度动态防骚扰风控与配额限流算法
 * (Anti-Harassment Quota Rate Limiter - Algorithm 3)
 */

import { IRedisPipelineClient } from "../shared/resilience/tokenBucketLimiter.js";

export class AntiHarassmentQuotaLimiter {
  public static readonly MAX_DAILY_SMS = 3;   // 单人单日最多 3 条硬顶
  public static readonly COOLDOWN_SEC = 300;  // 5 分钟 (300 秒) 冷却期

  // 内存沙箱风控存储 (用于无 Redis 依赖与单元测试环境)
  private static readonly memoryDailyQuota: Map<string, number> = new Map();
  private static readonly memoryCooldown: Map<string, number> = new Map();

  /**
   * 校验并原子扣减短信配额与加持冷却锁
   * @param redis Redis 客户端实例 (可选)
   * @param schoolId 高校租户 ID
   * @param userId 接收人自然人 ID
   */
  public static async checkAndConsumeSmsQuota(
    redis: IRedisPipelineClient | any,
    schoolId: number,
    userId: number
  ): Promise<{ allowed: boolean; reason?: string }> {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const quotaKey = `sms_quota_daily:${schoolId}:${userId}:${today}`;
    const cooldownKey = `sms_cooldown:${schoolId}:${userId}`;

    // 1. 若 Redis 可用且支持 eval，执行分布式原子 Lua 脚本
    if (redis && typeof redis.eval === "function") {
      try {
        const lua = `
          local cd = redis.call('EXISTS', KEYS[2])
          if cd == 1 then
            return -1
          end
          local current = redis.call('INCR', KEYS[1])
          if current == 1 then
            redis.call('EXPIRE', KEYS[1], 86400)
          end
          if current > tonumber(ARGV[1]) then
            return -2
          end
          redis.call('SET', KEYS[2], '1', 'EX', ARGV[2])
          return 1
        `;

        const status = await redis.eval(
          lua,
          2,
          quotaKey,
          cooldownKey,
          String(this.MAX_DAILY_SMS),
          String(this.COOLDOWN_SEC)
        );

        const statusCode = Number(status);
        if (statusCode === -1) {
          return { allowed: false, reason: "处于 300 秒短信防刷冷却期中" };
        }
        if (statusCode === -2) {
          return { allowed: false, reason: `已达单人单日最大限制 (${this.MAX_DAILY_SMS} 条)` };
        }
        if (statusCode === 1) {
          // 同步记录内存以备兜底
          this.recordMemoryConsumption(quotaKey, cooldownKey);
          return { allowed: true };
        }
      } catch {
        // 降级至内存沙箱
      }
    }

    // 2. 内存沙箱执行防骚扰风控校验
    return this.checkAndConsumeInMemory(quotaKey, cooldownKey);
  }

  private static checkAndConsumeInMemory(
    quotaKey: string,
    cooldownKey: string
  ): { allowed: boolean; reason?: string } {
    const now = Date.now();

    // 检查 300s 冷却锁
    const cooldownExpire = this.memoryCooldown.get(cooldownKey);
    if (cooldownExpire && now < cooldownExpire) {
      return { allowed: false, reason: "处于 300 秒短信防刷冷却期中" };
    }

    // 检查单人每日配额
    const currentCount = this.memoryDailyQuota.get(quotaKey) || 0;
    if (currentCount >= this.MAX_DAILY_SMS) {
      return { allowed: false, reason: `已达单人单日最大限制 (${this.MAX_DAILY_SMS} 条)` };
    }

    // 扣减配额并加持 300s 冷却锁
    this.memoryDailyQuota.set(quotaKey, currentCount + 1);
    this.memoryCooldown.set(cooldownKey, now + this.COOLDOWN_SEC * 1000);

    return { allowed: true };
  }

  private static recordMemoryConsumption(quotaKey: string, cooldownKey: string): void {
    const currentCount = this.memoryDailyQuota.get(quotaKey) || 0;
    this.memoryDailyQuota.set(quotaKey, currentCount + 1);
    this.memoryCooldown.set(cooldownKey, Date.now() + this.COOLDOWN_SEC * 1000);
  }

  /**
   * 重置内存风控沙箱
   */
  public static resetMockData(): void {
    this.memoryDailyQuota.clear();
    this.memoryCooldown.clear();
  }
}
