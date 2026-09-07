/**
 * 高校后勤巡查e速办 v4.0 - M43: 时间轮定时扫描守护 Worker
 * (Presence Delay Worker Daemon)
 */

import { DistributedDelayWheel } from "./distributedDelayWheel.js";
import { FallbackChannel } from "./fallbackChannel.js";
import { IFallbackDelayTaskPayload } from "./presenceTypes.js";
import { IRedisPipelineClient } from "../shared/resilience/tokenBucketLimiter.js";

export class PresenceDelayWorker {
  private isRunning: boolean = false;
  private timer: any = null;

  constructor(
    private readonly redis: IRedisPipelineClient | any,
    private readonly fallbackChannel: FallbackChannel,
    private readonly schoolIdList: number[] = [1]
  ) {}

  /**
   * 启动时间轮守护扫描线程 (每 1000ms 轮询一次)
   */
  public start(intervalMs: number = 1000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNextTick(intervalMs);
  }

  /**
   * 停止时间轮扫描守护线程
   */
  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * 触发一次即时全租户时间轮到期任务扫描 (支持测试环境受控触发)
   */
  public async scanOnce(): Promise<number> {
    return this.scanAndExecuteExpiredTasks();
  }

  private scheduleNextTick(intervalMs: number): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      try {
        await this.scanAndExecuteExpiredTasks();
      } finally {
        if (this.isRunning) {
          this.scheduleNextTick(intervalMs);
        }
      }
    }, intervalMs);
  }

  /**
   * 扫描所有关联高校租户的时间轮到期任务
   */
  private async scanAndExecuteExpiredTasks(): Promise<number> {
    let totalProcessed = 0;

    for (const schoolId of this.schoolIdList) {
      try {
        const readyTasks = await DistributedDelayWheel.pollReadyTasks(this.redis, schoolId, 50);
        for (const taskStr of readyTasks) {
          try {
            const task: IFallbackDelayTaskPayload = JSON.parse(taskStr);
            await this.fallbackChannel.executeFallbackPenetration(
              task.schoolId,
              task.receiverId,
              task.messageId,
              task.priority
            );
            totalProcessed++;
          } catch {
            // 单任务失败隔离，不影响队列中后续任务的消费
          }
        }
      } catch {
        // 单校租户扫描异常隔离
      }
    }

    return totalProcessed;
  }
}
