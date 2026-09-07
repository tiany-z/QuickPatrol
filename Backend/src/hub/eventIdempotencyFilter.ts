/**
 * 高校后勤巡查e速办 v4.0 - M42: 算法 1 - 事件全局唯一指纹与 Redis 幂等去重过滤器
 * (Event Idempotency Fingerprint Filter)
 */

import crypto from "crypto";
import { IAppNotificationEvent } from "./notificationTypes.js";

export class EventIdempotencyFilter {
  public static readonly DEFAULT_TTL_SECONDS = 5;
  private static readonly memoryLocks: Map<string, number> = new Map();

  /**
   * 计算事件确定性特征哈希指纹 (SHA-256)
   */
  public static computeFingerprint(event: IAppNotificationEvent): string {
    if (event.idempotentKey && typeof event.idempotentKey === "string" && event.idempotentKey.trim()) {
      return crypto.createHash("sha256").update(event.idempotentKey.trim()).digest("hex");
    }

    const rawStr = [
      event.schoolId,
      event.appId,
      event.receiverId,
      event.patrolId || 0,
      event.title || ""
    ].join(":");

    return crypto.createHash("sha256").update(rawStr).digest("hex");
  }

  /**
   * 原子核验并加锁。
   * 若加锁成功返回 true (初次事件放行)；
   * 若已存在有效锁返回 false (5秒内重复事件短路丢弃)。
   */
  public static async checkAndLock(
    redisOrMemoryClient: any,
    event: IAppNotificationEvent,
    ttlSeconds: number = EventIdempotencyFilter.DEFAULT_TTL_SECONDS
  ): Promise<boolean> {
    const fingerprint = this.computeFingerprint(event);
    const redisKey = `notif:fp:${event.schoolId}:${fingerprint}`;

    // 1. 若提供了 Redis 客户端且支持 eval 或 set/get
    if (redisOrMemoryClient) {
      try {
        if (typeof redisOrMemoryClient.eval === "function") {
          const res = await redisOrMemoryClient.eval(
            `return redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX')`,
            1,
            redisKey,
            String(ttlSeconds)
          );
          if (res === "OK" || res === 1 || res === true) {
            return true;
          }
          return false;
        }

        if (typeof redisOrMemoryClient.get === "function" && typeof redisOrMemoryClient.set === "function") {
          const existing = await redisOrMemoryClient.get(redisKey);
          if (existing !== null && existing !== undefined) {
            return false;
          }
          await redisOrMemoryClient.set(redisKey, "1", "EX", ttlSeconds);
          return true;
        }
      } catch {
        // Redis 调用异常降级走内存加锁
      }
    }

    // 2. 内存沙箱原子加锁自愈 (支持纯单元测试或脱机离线环境)
    const now = Date.now();
    const expireAt = this.memoryLocks.get(redisKey);

    if (expireAt && expireAt > now) {
      return false; // 锁仍有效，重复拦截
    }

    this.memoryLocks.set(redisKey, now + ttlSeconds * 1000);
    return true;
  }

  /**
   * 清理内存锁 (供测试重置沙箱)
   */
  public static resetMemoryLocks(): void {
    this.memoryLocks.clear();
  }
}
