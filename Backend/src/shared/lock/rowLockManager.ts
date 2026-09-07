import EventEmitter from "events";
import {
  getRedisClient,
  getRedisSubClient,
  normalizeTableName,
  publishUnlockEvent,
  releaseLockLua,
  setLockKV,
} from "../cache/redis.js";
import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../flow/result.js";
import { LockWaitResult, RowLockState, UnlockStatus } from "../sql/sagaTypes.js";

export { RowLockState, UnlockStatus, LockWaitResult } from "../sql/sagaTypes.js";

/**
 * 分布式行级排他锁管理器 (Multi-Tenant Row Lock Manager)
 * 采用 Redis SET PX NX 原子锁与 Lua 幂等释放脚本，天然支持租户隔离与重入放行
 */
class MultiTenantRowLockManager {
  // 内存备用锁字典与事件总线 (当 Redis 未连接或单机单元测试时自动平滑降级，保证 100% 独立可用)
  private memoryStore: Map<string, { value: string; expireAt: number }> = new Map();
  private localEmitter: EventEmitter = new EventEmitter();
  private channelListenerCounts: Map<string, number> = new Map();

  public makeLockKey(schoolId: number, table: string, id: string | number): string {
    return `lock:${schoolId}:${normalizeTableName(table)}:${id}`;
  }

  public makeChannelKey(schoolId: number, table: string, id: string | number): string {
    return `unlock:lock:${schoolId}:${normalizeTableName(table)}:${id}`;
  }

  /**
   * 申请行级排他锁 (支持租户 schoolId 显式隔离，兼容单机与集群)
   */
  public async acquireRowLock(
    schoolId: number,
    table: string,
    id: string | number,
    lockType: "UPDATE" | "DELETE",
    requestId: string,
    maxLockAgeMs?: number
  ): Promise<StandardResult<boolean>>;
  public async acquireRowLock(
    table: string,
    id: string | number,
    lockType: "UPDATE" | "DELETE",
    requestId: string,
    maxLockAgeMs?: number
  ): Promise<StandardResult<boolean>>;
  public async acquireRowLock(
    arg1: number | string,
    arg2: string | number,
    arg3: string | number,
    arg4: "UPDATE" | "DELETE" | string,
    arg5?: string | number,
    arg6?: number
  ): Promise<StandardResult<boolean>> {
    try {
      let schoolId: number;
      let table: string;
      let id: string | number;
      let lockType: "UPDATE" | "DELETE";
      let requestId: string;
      let maxLockAgeMs: number;

      if (typeof arg1 === "number") {
        schoolId = arg1;
        table = String(arg2);
        id = arg3;
        lockType = arg4 as "UPDATE" | "DELETE";
        requestId = String(arg5);
        maxLockAgeMs = typeof arg6 === "number" ? arg6 : 10000;
      } else {
        schoolId = 0;
        table = arg1;
        id = arg2;
        lockType = arg3 as "UPDATE" | "DELETE";
        requestId = String(arg4);
        maxLockAgeMs = typeof arg5 === "number" ? arg5 : 10000;
      }

      const lockKey = this.makeLockKey(schoolId, table, id);
      const redis = getRedisClient();

      const payload: RowLockState = {
        schoolId,
        table,
        id,
        lockType,
        ownerRequestId: requestId,
        lockedAt: Date.now(),
      };

      if (redis) {
        // 1. Redis 集群加锁分支
        const existingRaw = await redis.get(lockKey);
        if (existingRaw) {
          try {
            const parsed: RowLockState = JSON.parse(existingRaw);
            if (parsed.ownerRequestId === requestId) {
              return returnSuccess(true); // 同一请求重入放行
            }
            return returnError(
              `[M03 行锁互斥] 记录正被并发请求 [${parsed.ownerRequestId}] 占用处理中 (${parsed.lockType})`
            );
          } catch {}
        }

        const setRes = await setLockKV(lockKey, JSON.stringify(payload), maxLockAgeMs);
        if (setRes.status === 1 && setRes.data) {
          return returnSuccess(true);
        }
        return returnError(`[M03 加锁失败] 记录已被并发请求抢占锁定: ${lockKey}`);
      } else {
        // 2. 内存锁平滑降级分支 (无缝支持单机离线测试)
        const now = Date.now();
        const existing = this.memoryStore.get(lockKey);

        if (existing && existing.expireAt > now) {
          try {
            const parsed: RowLockState = JSON.parse(existing.value);
            if (parsed.ownerRequestId === requestId) {
              return returnSuccess(true); // 重入放行
            }
            return returnError(
              `[M03 行锁互斥] 记录正被并发请求 [${parsed.ownerRequestId}] 占用处理中 (${parsed.lockType})`
            );
          } catch {}
        }

        // 获取锁成功
        this.memoryStore.set(lockKey, {
          value: JSON.stringify(payload),
          expireAt: now + maxLockAgeMs,
        });
        return returnSuccess(true);
      }
    } catch (error) {
      return returnError(`Acquire row lock failed: ${tryCatchErrorToString(error)}`);
    }
  }

  /**
   * 释放行级排他锁 (Lua 幂等安全校验 + 跨节点广播)
   */
  public async releaseRowLock(
    schoolId: number,
    table: string,
    id: string | number,
    requestId: string,
    isCommitted: boolean
  ): Promise<StandardResult<boolean>>;
  public async releaseRowLock(
    table: string,
    id: string | number,
    requestId: string,
    isCommitted: boolean
  ): Promise<StandardResult<boolean>>;
  public async releaseRowLock(
    arg1: number | string,
    arg2: string | number,
    arg3: string | number,
    arg4: string | boolean,
    arg5?: boolean
  ): Promise<StandardResult<boolean>> {
    try {
      let schoolId: number;
      let table: string;
      let id: string | number;
      let requestId: string;
      let isCommitted: boolean;

      if (typeof arg1 === "number") {
        schoolId = arg1;
        table = String(arg2);
        id = arg3;
        requestId = String(arg4);
        isCommitted = Boolean(arg5);
      } else {
        schoolId = 0;
        table = arg1;
        id = arg2;
        requestId = String(arg3);
        isCommitted = Boolean(arg4);
      }

      const lockKey = this.makeLockKey(schoolId, table, id);
      const channel = this.makeChannelKey(schoolId, table, id);
      const redis = getRedisClient();

      if (redis) {
        // 1. 调用 Lua 脚本进行身份比对并安全删除 Key
        const luaRes = await releaseLockLua(lockKey, requestId);
        if (luaRes.status === 0 || !luaRes.data) {
          return returnSuccess(true); // 幂等放行 (非持有者或已超时，安全不报错)
        }

        const lockType = luaRes.data as "UPDATE" | "DELETE";
        let status: UnlockStatus = "ROLLED_BACK";
        if (isCommitted) {
          status = lockType === "DELETE" ? "COMMITTED_DELETE" : "COMMITTED_UPDATE";
        }

        await publishUnlockEvent(channel, status);
        return returnSuccess(true);
      } else {
        // 2. 内存锁降级释放
        const existing = this.memoryStore.get(lockKey);
        if (!existing) {
          return returnSuccess(true); // 幂等放行
        }

        try {
          const parsed: RowLockState = JSON.parse(existing.value);
          // 仅当锁持有者匹配时，方允许释放
          if (parsed.ownerRequestId === requestId) {
            this.memoryStore.delete(lockKey);
            const lockType = parsed.lockType;
            let status: UnlockStatus = "ROLLED_BACK";
            if (isCommitted) {
              status = lockType === "DELETE" ? "COMMITTED_DELETE" : "COMMITTED_UPDATE";
            }
            this.localEmitter.emit(channel, status);
          }
        } catch {
          this.memoryStore.delete(lockKey);
        }

        return returnSuccess(true);
      }
    } catch (error) {
      return returnError(`Release row lock failed: ${tryCatchErrorToString(error)}`);
    }
  }

  /**
   * 探查指定记录当前是否正处于加锁态
   */
  public async isRowLocked(
    schoolId: number,
    table: string,
    id: string | number
  ): Promise<boolean>;
  public async isRowLocked(table: string, id: string | number): Promise<boolean>;
  public async isRowLocked(
    arg1: number | string,
    arg2: string | number,
    arg3?: string | number
  ): Promise<boolean> {
    try {
      const schoolId = typeof arg1 === "number" ? arg1 : 0;
      const table = typeof arg1 === "number" ? String(arg2) : arg1;
      const id = typeof arg1 === "number" ? arg3! : arg2;

      const lockKey = this.makeLockKey(schoolId, table, id);
      const redis = getRedisClient();

      if (redis) {
        return (await redis.exists(lockKey)) === 1;
      }

      const existing = this.memoryStore.get(lockKey);
      if (!existing) return false;
      if (existing.expireAt <= Date.now()) {
        this.memoryStore.delete(lockKey);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 等待指定行的锁释放 (支持超时唤醒与状态识别)
   */
  public async waitForUnlock(
    schoolId: number,
    table: string,
    id: string | number,
    timeoutMs?: number
  ): Promise<StandardResult<LockWaitResult>>;
  public async waitForUnlock(
    table: string,
    id: string | number,
    timeoutMs?: number
  ): Promise<StandardResult<LockWaitResult>>;
  public async waitForUnlock(
    arg1: number | string,
    arg2: string | number,
    arg3?: string | number,
    arg4?: number
  ): Promise<StandardResult<LockWaitResult>> {
    try {
      const schoolId = typeof arg1 === "number" ? arg1 : 0;
      const table = typeof arg1 === "number" ? String(arg2) : arg1;
      const id = typeof arg1 === "number" ? arg3! : arg2;
      const timeoutMs = typeof arg1 === "number" ? (arg4 || 3000) : (typeof arg3 === "number" ? arg3 : 3000);

      const isLocked = await this.isRowLocked(schoolId, table, id);
      if (!isLocked) {
        return returnSuccess<LockWaitResult>({
          unlocked: true,
          finalStatus: "COMMITTED_UPDATE",
        });
      }

      const channel = this.makeChannelKey(schoolId, table, id);
      const redis = getRedisClient();
      const sub = getRedisSubClient();

      if (redis && sub) {
        // Redis Pub/Sub 等待分支
        return new Promise((resolve) => {
          let timer: NodeJS.Timeout | null = null;
          let cleanedUp = false;

          const cleanup = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            if (timer) clearTimeout(timer);
            sub.removeListener("message", onMessage);

            const currentCount = this.channelListenerCounts.get(channel) || 1;
            if (currentCount <= 1) {
              this.channelListenerCounts.delete(channel);
              sub.unsubscribe(channel).catch(() => {});
            } else {
              this.channelListenerCounts.set(channel, currentCount - 1);
            }
          };

          const onUnlockResolved = (status: UnlockStatus) => {
            cleanup();
            resolve(
              returnSuccess<LockWaitResult>({
                unlocked: true,
                finalStatus: status,
              })
            );
          };

          const onMessage = (ch: string, message: string) => {
            if (ch === channel) {
              onUnlockResolved(message as UnlockStatus);
            }
          };

          const currentCount = this.channelListenerCounts.get(channel) || 0;
          this.channelListenerCounts.set(channel, currentCount + 1);
          if (currentCount === 0) {
            sub.subscribe(channel).catch(() => {});
          }

          sub.on("message", onMessage);

          timer = setTimeout(() => {
            cleanup();
            resolve(
              returnSuccess<LockWaitResult>({
                unlocked: false,
                finalStatus: "TIMEOUT",
              })
            );
          }, timeoutMs);
        });
      } else {
        // 本地 Event 监听等待分支
        return new Promise((resolve) => {
          let timer: NodeJS.Timeout | null = null;
          const onUnlock = (status: UnlockStatus) => {
            if (timer) clearTimeout(timer);
            this.localEmitter.removeListener(channel, onUnlock);
            resolve(
              returnSuccess<LockWaitResult>({
                unlocked: true,
                finalStatus: status,
              })
            );
          };

          this.localEmitter.once(channel, onUnlock);

          timer = setTimeout(() => {
            this.localEmitter.removeListener(channel, onUnlock);
            resolve(
              returnSuccess<LockWaitResult>({
                unlocked: false,
                finalStatus: "TIMEOUT",
              })
            );
          }, timeoutMs);
        });
      }
    } catch (error) {
      return returnError(`Wait for unlock failed: ${tryCatchErrorToString(error)}`);
    }
  }

  /**
   * 清理本地所有降级内存锁 (主要用于测试清理与故障重置)
   */
  public clearMemoryLocks(): void {
    this.memoryStore.clear();
    this.localEmitter.removeAllListeners();
  }
}

export const RowLockManager = new MultiTenantRowLockManager();
