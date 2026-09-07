/**
 * 高校后勤巡查e速办 v4.0 - M43: 用户在线状态感知引擎 (Presence Engine)
 * (Presence Heartbeat Lease Evaluator - Algorithm 1)
 */

import {
  UserPresenceStatus,
  IUserPresenceState,
  IFallbackDelayTaskPayload
} from "./presenceTypes.js";
import { DistributedDelayWheel } from "./distributedDelayWheel.js";
import { IRedisPipelineClient } from "../shared/resilience/tokenBucketLimiter.js";

interface IMemoryPresenceItem {
  status: UserPresenceStatus;
  expireAt: number;
  lastHeartbeatAt: string;
}

export class PresenceEngine {
  public static readonly PRESENCE_PREFIX = "user_presence";

  // 内存沙箱在线状态存储 (保证无外部 Redis/脱机单元测试环境可用)
  private static readonly memoryPresenceMap: Map<string, IMemoryPresenceItem> = new Map();

  constructor(private readonly redis?: IRedisPipelineClient | any) {}

  /**
   * 刷新用户在线心跳 (客户端每 30 秒周期性上报)
   * @param schoolId 高校租户 ID
   * @param userId 自然人用户 ID
   * @param isForeground 是否为小程序前台活跃 (true: Active TTL 45s, false: Idle TTL 15s)
   */
  public async refreshHeartbeat(
    schoolId: number,
    userId: number,
    isForeground: boolean = true
  ): Promise<void> {
    const key = `${PresenceEngine.PRESENCE_PREFIX}:${schoolId}:${userId}`;
    const ttl = isForeground ? 45 : 15;
    const nowIso = new Date().toISOString();

    // 1. 若提供了 Redis 客户端，优先通过 Redis 刷新租期
    if (this.redis) {
      try {
        if (typeof this.redis.eval === "function") {
          await this.redis.eval(
            `redis.call('SET', KEYS[1], '1', 'EX', ARGV[1])`,
            1,
            key,
            String(ttl)
          );
        } else if (typeof this.redis.set === "function") {
          await this.redis.set(key, "1", "EX", ttl);
        }
      } catch {
        // 降级使用内存沙箱
      }
    }

    // 2. 同步写入内存沙箱
    PresenceEngine.memoryPresenceMap.set(key, {
      status: isForeground ? UserPresenceStatus.ONLINE_ACTIVE : UserPresenceStatus.ONLINE_IDLE,
      expireAt: Date.now() + ttl * 1000,
      lastHeartbeatAt: nowIso
    });
  }

  /**
   * 探测指定用户当前是否处于在网活跃状态 (P99 <= 2ms)
   * @param schoolId 高校租户 ID
   * @param userId 待探测用户 ID
   */
  public async isUserOnline(schoolId: number, userId: number): Promise<boolean> {
    const key = `${PresenceEngine.PRESENCE_PREFIX}:${schoolId}:${userId}`;

    // 1. 优先查 Redis
    if (this.redis) {
      try {
        if (typeof this.redis.eval === "function") {
          const exists = await this.redis.eval(
            `return redis.call('EXISTS', KEYS[1])`,
            1,
            key
          );
          if (Number(exists) === 1) return true;
        } else if (typeof this.redis.exists === "function") {
          const exists = await this.redis.exists(key);
          if (Number(exists) === 1) return true;
        }
      } catch {
        // Redis 异常时回退至内存沙箱
      }
    }

    // 2. 回退查内存沙箱
    const item = PresenceEngine.memoryPresenceMap.get(key);
    if (item && Date.now() < item.expireAt) {
      return true;
    }

    return false;
  }

  /**
   * 获取用户当前完整的在线状态元数据
   */
  public async getUserPresenceState(
    schoolId: number,
    userId: number
  ): Promise<IUserPresenceState> {
    const isOnline = await this.isUserOnline(schoolId, userId);
    const key = `${PresenceEngine.PRESENCE_PREFIX}:${schoolId}:${userId}`;
    const mem = PresenceEngine.memoryPresenceMap.get(key);

    return {
      schoolId,
      userId,
      status: isOnline
        ? mem?.status || UserPresenceStatus.ONLINE_ACTIVE
        : UserPresenceStatus.OFFLINE,
      lastHeartbeatAt: mem?.lastHeartbeatAt || new Date().toISOString()
    };
  }

  /**
   * 处理统一消息中枢 NotificationHub 派发的新事件：执行状态感知与穿透分流决策
   * @param schoolId 高校租户 ID
   * @param receiverId 接收人 ID
   * @param messageId 站内通知物理主键
   * @param priority 优先级 ('low' | 'normal' | 'urgent')
   */
  public async dispatchNotificationPresence(
    schoolId: number,
    receiverId: number,
    messageId: number,
    priority: "low" | "normal" | "urgent" = "normal"
  ): Promise<{ directOnline: boolean }> {
    // 1. 算法 1: 毫秒级探测用户在线状态
    const isOnline = await this.isUserOnline(schoolId, receiverId);
    if (isOnline) {
      // 在线绝对静默：只要用户正在使用小程序，物理阻断任何外部短信与服务通知
      return { directOnline: true };
    }

    // 2. 算法 2: 离线状态，推入分布式延迟时间轮
    // 特急工单 (urgent) 仅防抖 10 秒；普通工单 (normal/low) 享受 180 秒黄金防抖缓冲池
    const delayMs = priority === "urgent" ? 10 * 1000 : 180 * 1000;
    const taskPayload: IFallbackDelayTaskPayload = {
      taskId: `TASK_${messageId}`,
      schoolId,
      receiverId,
      messageId,
      priority,
      createdAt: new Date().toISOString(),
      scheduledTriggerAt: new Date(Date.now() + delayMs).toISOString()
    };

    await DistributedDelayWheel.schedule(
      this.redis,
      schoolId,
      JSON.stringify(taskPayload),
      delayMs
    );

    return { directOnline: false };
  }

  /**
   * 重置内存在线沙箱
   */
  public static resetMockData(): void {
    this.memoryPresenceMap.clear();
  }
}
