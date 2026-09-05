import {
  getRedisClient,
  getRedisSubClient,
  normalizeTableName,
  publishUnlockEvent,
  releaseLockLua,
  setLockKV,
} from "../cache/redis.js";
import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../flow/result.js";

export interface RowLockState {
  table: string;
  id: string | number;
  lockType: "UPDATE" | "DELETE";
  ownerRequestId: string;
  lockedAt: number;
}

export type UnlockStatus = "COMMITTED_UPDATE" | "COMMITTED_DELETE" | "ROLLED_BACK" | "TIMEOUT";

export interface LockWaitResult {
  unlocked: boolean;
  finalStatus: UnlockStatus;
}

class RowLockManagerImpl {
  private makeLockKey(table: string, id: string | number): string {
    return `lock:${normalizeTableName(table)}:${id}`;
  }

  private makeChannelKey(table: string, id: string | number): string {
    return `unlock:lock:${normalizeTableName(table)}:${id}`;
  }

  public async acquireRowLock(
    table: string,
    id: string | number,
    lockType: "UPDATE" | "DELETE",
    requestId: string,
    maxLockAgeMs: number = 10000
  ): Promise<StandardResult<boolean>> {
    try {
      const lockKey = this.makeLockKey(table, id);
      const redis = getRedisClient();

      if (!redis) {
        return returnError("Redis客户端未初始化，无法获取分布式行锁");
      }

      // 1. 检查既有锁 (重入判断)
      const existingRaw = await redis.get(lockKey);
      if (existingRaw) {
        try {
          const parsed: RowLockState = JSON.parse(existingRaw);
          if (parsed.ownerRequestId === requestId) {
            return returnSuccess(true);
          }
          return returnError(`行锁已被请求 [${parsed.ownerRequestId}] 占用，类型为 ${parsed.lockType}`);
        } catch {}
      }

      // 2. 执行 SET lock:table:id payload PX maxLockAgeMs NX 原子抢锁
      const payload: RowLockState = {
        table,
        id,
        lockType,
        ownerRequestId: requestId,
        lockedAt: Date.now(),
      };

      const setRes = await setLockKV(lockKey, JSON.stringify(payload), maxLockAgeMs);
      if (setRes.status === 1 && setRes.data) {
        return returnSuccess(true);
      }

      return returnError(`行锁 ${lockKey} 被其他请求占用，加锁失败`);
    } catch (error) {
      return returnError(`Acquire row lock failed: ${tryCatchErrorToString(error)}`);
    }
  }

  public async releaseRowLock(
    table: string,
    id: string | number,
    requestId: string,
    isCommitted: boolean
  ): Promise<StandardResult<boolean>> {
    try {
      const lockKey = this.makeLockKey(table, id);
      const channel = this.makeChannelKey(table, id);
      const redis = getRedisClient();

      if (!redis) {
        return returnError("Redis客户端未初始化，无法释放分布式行锁");
      }

      // 1. 调用 Lua 脚本进行身份比对并安全删除 Key
      const luaRes = await releaseLockLua(lockKey, requestId);
      if (luaRes.status === 0 || !luaRes.data) {
        return returnSuccess(true);
      }

      const lockType = luaRes.data as "UPDATE" | "DELETE";
      let status: UnlockStatus = "ROLLED_BACK";
      if (isCommitted) {
        status = lockType === "DELETE" ? "COMMITTED_DELETE" : "COMMITTED_UPDATE";
      }

      // 2. 发送 Redis Pub/Sub 广播通知所有等待节点
      await publishUnlockEvent(channel, status);

      return returnSuccess(true);
    } catch (error) {
      return returnError(`Release row lock failed: ${tryCatchErrorToString(error)}`);
    }
  }

  public async isRowLocked(table: string, id: string | number): Promise<boolean> {
    try {
      const lockKey = this.makeLockKey(table, id);
      const redis = getRedisClient();
      if (!redis) {
        return false;
      }
      const exists = await redis.exists(lockKey);
      return exists === 1;
    } catch {
      return false;
    }
  }

  private channelListenerCounts: Map<string, number> = new Map();

  public async waitForUnlock(
    table: string,
    id: string | number,
    timeoutMs: number = 3000
  ): Promise<StandardResult<LockWaitResult>> {
    try {
      const lockKey = this.makeLockKey(table, id);
      const channel = this.makeChannelKey(table, id);
      const redis = getRedisClient();

      if (!redis) {
        return returnError("Redis客户端未初始化，无法等待行锁解锁");
      }

      const exists = await redis.exists(lockKey);
      if (!exists) {
        return returnSuccess<LockWaitResult>({
          unlocked: true,
          finalStatus: "COMMITTED_UPDATE",
        });
      }

      const sub = getRedisSubClient();
      if (!sub) {
        return returnError("Redis订阅客户端未初始化，无法等待行锁解锁");
      }

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
    } catch (error) {
      return returnError(`Wait for unlock failed: ${tryCatchErrorToString(error)}`);
    }
  }
}

export const RowLockManager = new RowLockManagerImpl();
