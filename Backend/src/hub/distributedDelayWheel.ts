/**
 * 高校后勤巡查e速办 v4.0 - M43: 基于 Redis ZSet 的分布式毫秒级延迟时间轮调度器
 * (Distributed Delay Wheel Scheduler - Algorithm 2)
 */

import { IRedisPipelineClient } from "../shared/resilience/tokenBucketLimiter.js";

interface IMemoryWheelItem {
  task: string;
  triggerAt: number;
}

export class DistributedDelayWheel {
  public static readonly WHEEL_KEY_PREFIX = "notif_delay_wheel";

  // 内存沙箱延迟时间轮存储 (供无外部 Redis 依赖/单元测试环境下自愈运行)
  private static readonly memoryDelayWheels: Map<number, IMemoryWheelItem[]> = new Map();

  /**
   * 将任务推入分布式延迟时间轮
   * @param redis Redis 客户端 (可选)
   * @param schoolId 高校租户 ID
   * @param taskIdOrPayload 任务标识或 JSON 序列化载荷
   * @param delayMs 延迟时间 (毫秒)
   */
  public static async schedule(
    redis: IRedisPipelineClient | any,
    schoolId: number,
    taskIdOrPayload: string,
    delayMs: number
  ): Promise<void> {
    const triggerAt = Date.now() + delayMs;
    const wheelKey = `${this.WHEEL_KEY_PREFIX}:${schoolId}`;

    // 1. 若 Redis 存在且支持 eval，执行分布式 ZADD
    if (redis && typeof redis.eval === "function") {
      try {
        await redis.eval(
          `redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])`,
          1,
          wheelKey,
          String(triggerAt),
          taskIdOrPayload
        );
      } catch {
        // Redis 异常时记录至内存沙箱
        this.scheduleInMemory(schoolId, taskIdOrPayload, triggerAt);
        return;
      }
    }

    // 2. 内存沙箱同步备份与自愈存储
    this.scheduleInMemory(schoolId, taskIdOrPayload, triggerAt);
  }

  /**
   * 扫描并原子提取已到期的任务集合 (Lua 脚本 ZRANGEBYSCORE + ZREM 原子消费)
   * @param redis Redis 客户端 (可选)
   * @param schoolId 高校租户 ID
   * @param batchSize 单批次最大消费数量 (默认 50)
   */
  public static async pollReadyTasks(
    redis: IRedisPipelineClient | any,
    schoolId: number,
    batchSize: number = 50
  ): Promise<string[]> {
    const now = Date.now();
    const wheelKey = `${this.WHEEL_KEY_PREFIX}:${schoolId}`;

    // 1. 若 Redis 客户端存在且支持 eval，执行原子 Lua 消费
    if (redis && typeof redis.eval === "function") {
      try {
        const lua = `
          local tasks = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1], 'LIMIT', 0, ARGV[2])
          if #tasks > 0 then
            redis.call('ZREM', KEYS[1], unpack(tasks))
          end
          return tasks
        `;
        const res = await redis.eval(lua, 1, wheelKey, String(now), String(batchSize));
        if (Array.isArray(res) && res.length > 0) {
          // 同步移除内存中对应项
          this.removeBatchInMemory(schoolId, res);
          return res as string[];
        }
      } catch {
        // 降级至内存沙箱执行
      }
    }

    // 2. 内存沙箱执行提取与原子弹出
    return this.pollReadyTasksInMemory(schoolId, now, batchSize);
  }

  /**
   * 手动从时间轮中取消任务 (支持已读自愈熔断的主动清除)
   */
  public static async removeTask(
    redis: IRedisPipelineClient | any,
    schoolId: number,
    taskIdOrPayload: string
  ): Promise<void> {
    const wheelKey = `${this.WHEEL_KEY_PREFIX}:${schoolId}`;
    if (redis && typeof redis.eval === "function") {
      try {
        await redis.eval(
          `redis.call('ZREM', KEYS[1], ARGV[1])`,
          1,
          wheelKey,
          taskIdOrPayload
        );
      } catch {
        // 忽略错误
      }
    }
    this.removeInMemory(schoolId, taskIdOrPayload);
  }

  // =========================================================================
  // 内部内存沙箱辅助实现 (保证脱机测试 100% 稳定性)
  // =========================================================================

  private static scheduleInMemory(schoolId: number, task: string, triggerAt: number): void {
    let queue = this.memoryDelayWheels.get(schoolId);
    if (!queue) {
      queue = [];
      this.memoryDelayWheels.set(schoolId, queue);
    }
    // 幂等防重检查
    const existingIndex = queue.findIndex(item => item.task === task);
    if (existingIndex >= 0) {
      queue[existingIndex].triggerAt = triggerAt;
    } else {
      queue.push({ task, triggerAt });
    }
  }

  private static pollReadyTasksInMemory(schoolId: number, now: number, batchSize: number): string[] {
    const queue = this.memoryDelayWheels.get(schoolId);
    if (!queue || queue.length === 0) return [];

    // 找出所有已到期的任务
    const readyIndices: number[] = [];
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].triggerAt <= now) {
        readyIndices.push(i);
        if (readyIndices.length >= batchSize) break;
      }
    }

    if (readyIndices.length === 0) return [];

    const result: string[] = [];
    // 逆序移除保证索引不漂移
    for (let i = readyIndices.length - 1; i >= 0; i--) {
      const idx = readyIndices[i];
      result.unshift(queue[idx].task);
      queue.splice(idx, 1);
    }

    return result;
  }

  private static removeInMemory(schoolId: number, task: string): void {
    const queue = this.memoryDelayWheels.get(schoolId);
    if (!queue) return;
    const idx = queue.findIndex(item => item.task === task);
    if (idx >= 0) {
      queue.splice(idx, 1);
    }
  }

  private static removeBatchInMemory(schoolId: number, tasks: string[]): void {
    const queue = this.memoryDelayWheels.get(schoolId);
    if (!queue) return;
    const taskSet = new Set(tasks);
    this.memoryDelayWheels.set(
      schoolId,
      queue.filter(item => !taskSet.has(item.task))
    );
  }

  /**
   * 重置内存时间轮沙箱
   */
  public static resetMockData(): void {
    this.memoryDelayWheels.clear();
  }
}
