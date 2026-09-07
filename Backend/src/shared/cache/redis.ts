import { Redis, RedisOptions } from "ioredis";
import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../flow/result.js";
import { TerminalLogger } from "../log/terminalLogger.js";
import { CacheReadOptions } from "./cacheTypes.js";
import { buildTenantKey, calculateJitterTtl } from "./tenantCacheKey.js";

let redisClient: Redis | null = null;
let subClient: Redis | null = null;

// 内存降级存储 (当 Redis 未启动或单元测试脱机环境下自动平滑接管)
const memoryCacheStore: Map<string, { data: string; expireAt: number }> = new Map();

export function initRedisClient(options?: RedisOptions): StandardResult<Redis> {
  try {
    if (redisClient) {
      return returnSuccess(redisClient);
    }

    const host = process.env.REDIS_HOST || "192.168.1.8";
    const port = parseInt(process.env.REDIS_PORT || "6379", 10);
    const password = process.env.REDIS_PASSWORD || "root";

    redisClient = new Redis({
      host,
      port,
      password,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      ...options,
    });

    redisClient.on("error", (err) => {
      console.error("[RedisClient Error]", err);
    });

    return returnSuccess(redisClient);
  } catch (error) {
    return returnError(`Init Redis Client failed: ${tryCatchErrorToString(error)}`);
  }
}

export function getRedisClient(): Redis | null {
  return redisClient;
}

export function getRedisSubClient(): Redis | null {
  if (subClient) {
    return subClient;
  }
  if (!redisClient) {
    return null;
  }
  subClient = redisClient.duplicate();
  subClient.on("error", (err) => {
    console.error("[RedisSubClient Error]", err);
  });
  return subClient;
}

export function normalizeTableName(tableName: string): string {
  if (!tableName) return "";
  const clean = tableName.replace(/[`"]/g, "").trim().toLowerCase();
  return clean.includes(".") ? clean.split(".").pop()! : clean;
}

function makeCacheKey(
  schoolId: number | undefined,
  tableName: string,
  id: string | number
): string {
  const normTable = normalizeTableName(tableName);
  if (schoolId !== undefined && schoolId > 0) {
    return `cache:${schoolId}:${normTable}:${id}`;
  }
  return `${normTable}:${id}`;
}

export async function getKV<T = any>(
  schoolId: number,
  tableName: string,
  id: string | number
): Promise<StandardResult<T | null>>;
export async function getKV<T = any>(
  tableName: string,
  id: string | number
): Promise<StandardResult<T | null>>;
export async function getKV<T = any>(
  arg1: number | string,
  arg2: string | number,
  arg3?: string | number
): Promise<StandardResult<T | null>> {
  try {
    const schoolId = typeof arg1 === "number" ? arg1 : undefined;
    const tableName = typeof arg1 === "number" ? String(arg2) : arg1;
    const id = typeof arg1 === "number" ? arg3! : arg2;

    const key = makeCacheKey(schoolId, tableName, id);

    if (redisClient) {
      const raw = await redisClient.get(key);
      if (!raw) return returnSuccess(null);
      const parsed = JSON.parse(raw) as T;
      return returnSuccess(parsed);
    }

    // 内存降级
    const item = memoryCacheStore.get(key);
    if (!item) return returnSuccess(null);
    if (item.expireAt <= Date.now()) {
      memoryCacheStore.delete(key);
      return returnSuccess(null);
    }
    const parsed = JSON.parse(item.data) as T;
    return returnSuccess(parsed);
  } catch (error) {
    return returnError(`Get Redis KV failed: ${tryCatchErrorToString(error)}`);
  }
}

export async function mgetKV<T = any>(
  schoolId: number,
  tableName: string,
  ids: Array<string | number>
): Promise<StandardResult<Record<string | number, T>>>;
export async function mgetKV<T = any>(
  tableName: string,
  ids: Array<string | number>
): Promise<StandardResult<Record<string | number, T>>>;
export async function mgetKV<T = any>(
  arg1: number | string,
  arg2: string | Array<string | number>,
  arg3?: Array<string | number>
): Promise<StandardResult<Record<string | number, T>>> {
  try {
    const schoolId = typeof arg1 === "number" ? arg1 : undefined;
    const tableName = typeof arg1 === "number" ? String(arg2) : (arg1 as string);
    const ids = typeof arg1 === "number" ? arg3! : (arg2 as Array<string | number>);

    if (!ids || ids.length === 0) {
      return returnSuccess({});
    }

    const resultMap: Record<string | number, T> = {};

    if (redisClient) {
      const keys = ids.map((id) => makeCacheKey(schoolId, tableName, id));
      const results = await redisClient.mget(...keys);

      ids.forEach((id, index) => {
        const raw = results[index];
        if (raw) {
          try {
            resultMap[id] = JSON.parse(raw) as T;
          } catch {}
        }
      });

      return returnSuccess(resultMap);
    }

    // 内存降级
    const now = Date.now();
    for (const id of ids) {
      const key = makeCacheKey(schoolId, tableName, id);
      const item = memoryCacheStore.get(key);
      if (item && item.expireAt > now) {
        try {
          resultMap[id] = JSON.parse(item.data) as T;
        } catch {}
      }
    }

    return returnSuccess(resultMap);
  } catch (error) {
    return returnError(`MGet Redis KV failed: ${tryCatchErrorToString(error)}`);
  }
}

export async function setKV(
  schoolId: number,
  tableName: string,
  id: string | number,
  value: any,
  ttlSeconds?: number
): Promise<StandardResult<boolean>>;
export async function setKV(
  tableName: string,
  id: string | number,
  value: any,
  ttlSeconds?: number
): Promise<StandardResult<boolean>>;
export async function setKV(
  arg1: number | string,
  arg2: string | number,
  arg3: any,
  arg4?: any,
  arg5?: number
): Promise<StandardResult<boolean>> {
  try {
    const schoolId = typeof arg1 === "number" ? arg1 : undefined;
    const tableName = typeof arg1 === "number" ? String(arg2) : arg1;
    const id = typeof arg1 === "number" ? (arg3 as string | number) : arg2;
    const value = typeof arg1 === "number" ? arg4 : arg3;
    const ttlSeconds = typeof arg1 === "number" ? (arg5 || 86400) : (arg4 || 86400);

    const key = makeCacheKey(schoolId, tableName, id);
    const serialized = JSON.stringify(value);

    if (redisClient) {
      await redisClient.set(key, serialized, "EX", ttlSeconds);
      return returnSuccess(true);
    }

    // 内存降级
    memoryCacheStore.set(key, {
      data: serialized,
      expireAt: Date.now() + ttlSeconds * 1000,
    });
    return returnSuccess(true);
  } catch (error) {
    return returnError(`Set Redis KV failed: ${tryCatchErrorToString(error)}`);
  }
}

export async function delKV(
  schoolId: number,
  tableName: string,
  id: string | number
): Promise<StandardResult<boolean>>;
export async function delKV(
  tableName: string,
  id: string | number
): Promise<StandardResult<boolean>>;
export async function delKV(
  arg1: number | string,
  arg2: string | number,
  arg3?: string | number
): Promise<StandardResult<boolean>> {
  try {
    const schoolId = typeof arg1 === "number" ? arg1 : undefined;
    const tableName = typeof arg1 === "number" ? String(arg2) : arg1;
    const id = typeof arg1 === "number" ? arg3! : arg2;

    const key = makeCacheKey(schoolId, tableName, id);

    if (redisClient) {
      await redisClient.del(key);
      return returnSuccess(true);
    }

    // 内存降级
    memoryCacheStore.delete(key);
    return returnSuccess(true);
  } catch (error) {
    return returnError(`Del Redis KV failed: ${tryCatchErrorToString(error)}`);
  }
}

// -------------------------------------------------------------
// M05 多租户专属增强 API (Tenant Namespace Enhanced APIs)
// -------------------------------------------------------------

/**
 * 获取多租户缓存记录
 * 自动识别防穿透空标记 ({ _nullSentinel: true }) 并安全返回 null
 */
export async function getTenantKV<T = any>(
  schoolId: number,
  module: string,
  id: string | number,
  _options?: CacheReadOptions
): Promise<StandardResult<T | null>> {
  try {
    const key = buildTenantKey(schoolId, module, id);

    if (redisClient) {
      const raw = await redisClient.get(key);
      if (!raw) return returnSuccess(null);
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed._nullSentinel === true) {
          return returnSuccess(null);
        }
        return returnSuccess(parsed as T);
      } catch {
        return returnSuccess(null);
      }
    }

    // 内存降级存储
    const item = memoryCacheStore.get(key);
    if (!item) return returnSuccess(null);
    if (item.expireAt <= Date.now()) {
      memoryCacheStore.delete(key);
      return returnSuccess(null);
    }

    try {
      const parsed = JSON.parse(item.data);
      if (parsed && typeof parsed === "object" && parsed._nullSentinel === true) {
        return returnSuccess(null);
      }
      return returnSuccess(parsed as T);
    } catch {
      return returnSuccess(null);
    }
  } catch (error) {
    return returnError(`Get Tenant KV failed: ${tryCatchErrorToString(error)}`);
  }
}

/**
 * 写入多租户缓存记录 (自动计算 ±10% TTL Jitter 抖动防雪崩)
 */
export async function setTenantKV(
  schoolId: number,
  module: string,
  id: string | number,
  value: any,
  baseTtlSeconds: number = 86400
): Promise<StandardResult<boolean>> {
  try {
    const key = buildTenantKey(schoolId, module, id);
    const ttlSeconds = calculateJitterTtl(baseTtlSeconds);
    const serialized = JSON.stringify(value);

    if (redisClient) {
      await redisClient.set(key, serialized, "EX", ttlSeconds);
      return returnSuccess(true);
    }

    // 内存降级
    memoryCacheStore.set(key, {
      data: serialized,
      expireAt: Date.now() + ttlSeconds * 1000,
    });
    return returnSuccess(true);
  } catch (error) {
    return returnError(`Set Tenant KV failed: ${tryCatchErrorToString(error)}`);
  }
}

/**
 * 写入防穿透空标记哨兵 (60 秒短 TTL)
 */
export async function setNullSentinel(
  schoolId: number,
  module: string,
  id: string | number,
  ttlSeconds: number = 60
): Promise<StandardResult<boolean>> {
  try {
    const key = buildTenantKey(schoolId, module, id);
    const payload = JSON.stringify({ _nullSentinel: true });

    if (redisClient) {
      await redisClient.set(key, payload, "EX", ttlSeconds);
      return returnSuccess(true);
    }

    // 内存降级
    memoryCacheStore.set(key, {
      data: payload,
      expireAt: Date.now() + ttlSeconds * 1000,
    });
    return returnSuccess(true);
  } catch (error) {
    return returnError(`Set Null Sentinel failed: ${tryCatchErrorToString(error)}`);
  }
}

/**
 * 移除多租户缓存记录
 */
export async function delTenantKV(
  schoolId: number,
  module: string,
  id: string | number
): Promise<StandardResult<boolean>> {
  try {
    const key = buildTenantKey(schoolId, module, id);

    if (redisClient) {
      await redisClient.del(key);
      return returnSuccess(true);
    }

    // 内存降级
    memoryCacheStore.delete(key);
    return returnSuccess(true);
  } catch (error) {
    return returnError(`Del Tenant KV failed: ${tryCatchErrorToString(error)}`);
  }
}

/**
 * 批量获取多租户缓存记录 (MGET)
 */
export async function mgetTenantKV<T = any>(
  schoolId: number,
  module: string,
  ids: Array<string | number>
): Promise<StandardResult<Record<string | number, T>>> {
  try {
    if (!ids || ids.length === 0) {
      return returnSuccess({});
    }

    const resultMap: Record<string | number, T> = {};
    const keys = ids.map((id) => buildTenantKey(schoolId, module, id));

    if (redisClient) {
      const rawValues = await redisClient.mget(...keys);
      ids.forEach((id, index) => {
        const raw = rawValues[index];
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (!parsed || parsed._nullSentinel !== true) {
              resultMap[id] = parsed as T;
            }
          } catch {}
        }
      });
      return returnSuccess(resultMap);
    }

    // 内存降级
    const now = Date.now();
    ids.forEach((id) => {
      const key = buildTenantKey(schoolId, module, id);
      const item = memoryCacheStore.get(key);
      if (item && item.expireAt > now) {
        try {
          const parsed = JSON.parse(item.data);
          if (!parsed || parsed._nullSentinel !== true) {
            resultMap[id] = parsed as T;
          }
        } catch {}
      }
    });

    return returnSuccess(resultMap);
  } catch (error) {
    return returnError(`MGet Tenant KV failed: ${tryCatchErrorToString(error)}`);
  }
}

/**
 * 基于 SCAN 游标的单校全域缓存安全清退算法 (Tenant Purge Pipeline)
 * 严禁 KEYS * 阻塞主线程，采用非阻塞 SCAN + Pipeline 批处理
 */
export async function purgeTenantCache(schoolId: number): Promise<StandardResult<number>> {
  try {
    if (!schoolId || schoolId <= 0) {
      return returnError(`[M05 命名空间阻断] 清退全域缓存必须提供合法的 schoolId: ${schoolId}`);
    }

    const matchPattern = `tenant:${schoolId}:*`;
    let totalDeleted = 0;

    if (redisClient) {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redisClient.scan(
          cursor,
          "MATCH",
          matchPattern,
          "COUNT",
          100
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          const pipeline = redisClient.pipeline();
          keys.forEach((k) => pipeline.del(k));
          await pipeline.exec();
          totalDeleted += keys.length;
        }
      } while (cursor !== "0");

      TerminalLogger.info(
        `[M05] 成功清退学校 [${schoolId}] 全域缓存，共安全删除 ${totalDeleted} 个键`,
        "TenantPurge"
      );
      return returnSuccess(totalDeleted);
    }

    // 内存降级清退
    const prefix = `tenant:${schoolId}:`;
    for (const key of Array.from(memoryCacheStore.keys())) {
      if (key.startsWith(prefix)) {
        memoryCacheStore.delete(key);
        totalDeleted++;
      }
    }

    TerminalLogger.info(
      `[M05] (内存降级) 成功清退学校 [${schoolId}] 全域缓存，共安全删除 ${totalDeleted} 个键`,
      "TenantPurge"
    );
    return returnSuccess(totalDeleted);
  } catch (error) {
    return returnError(`Purge Tenant Cache failed: ${tryCatchErrorToString(error)}`);
  }
}

// -------------------------------------------------------------
// 分布式锁与 Pub/Sub 原有能力
// -------------------------------------------------------------

export async function setLockKV(key: string, payloadJson: string, ttlMs: number): Promise<StandardResult<boolean>> {
  try {
    if (!redisClient) {
      return returnError("Redis客户端未初始化");
    }
    const res = await redisClient.set(key, payloadJson, "PX", ttlMs, "NX");
    return returnSuccess(res === "OK");
  } catch (error) {
    return returnError(`Set Lock KV failed: ${tryCatchErrorToString(error)}`);
  }
}

export async function releaseLockLua(key: string, ownerRequestId: string): Promise<StandardResult<string | null>> {
  try {
    if (!redisClient) {
      return returnError("Redis客户端未初始化");
    }
    const luaScript = `
      local val = redis.call('get', KEYS[1])
      if val then
          local ok, data = pcall(cjson.decode, val)
          if ok and data and data.ownerRequestId == ARGV[1] then
              local lockType = data.lockType or 'UPDATE'
              redis.call('del', KEYS[1])
              return lockType
          end
      end
      return nil
    `;
    const res = (await redisClient.eval(luaScript, 1, key, ownerRequestId)) as string | null;
    return returnSuccess(res);
  } catch (error) {
    return returnError(`Release Lock Lua failed: ${tryCatchErrorToString(error)}`);
  }
}

export async function publishUnlockEvent(channel: string, message: string): Promise<StandardResult<number>> {
  try {
    if (!redisClient) {
      return returnError("Redis客户端未初始化");
    }
    const res = await redisClient.publish(channel, message);
    return returnSuccess(res);
  } catch (error) {
    return returnError(`Publish Unlock Event failed: ${tryCatchErrorToString(error)}`);
  }
}

const channelSubscribers: Map<string, Set<(message: string) => void>> = new Map();
let isSubListening = false;

export async function publishRedis(channel: string, message: string): Promise<StandardResult<number>> {
  try {
    if (redisClient) {
      const res = await redisClient.publish(channel, message);
      return returnSuccess(res);
    }

    // 内存降级 Pub/Sub (脱机测试与单机平滑运行)
    const cbs = channelSubscribers.get(channel);
    if (cbs && cbs.size > 0) {
      for (const cb of cbs) {
        try {
          cb(message);
        } catch (e) {
          console.error("[InMemorySub Callback Error]", e);
        }
      }
      return returnSuccess(cbs.size);
    }
    return returnSuccess(0);
  } catch (error) {
    return returnError(`Publish Redis message failed: ${tryCatchErrorToString(error)}`);
  }
}

export async function subscribeRedis(
  channel: string,
  callback: (message: string) => void
): Promise<StandardResult<boolean>> {
  try {
    if (!channelSubscribers.has(channel)) {
      channelSubscribers.set(channel, new Set());
    }
    channelSubscribers.get(channel)!.add(callback);

    const sub = getRedisSubClient();
    if (sub) {
      await sub.subscribe(channel);

      if (!isSubListening) {
        isSubListening = true;
        sub.on("message", (ch: string, msg: string) => {
          const cbs = channelSubscribers.get(ch);
          if (cbs) {
            for (const cb of cbs) {
              try {
                cb(msg);
              } catch (e) {
                console.error("[RedisSub Callback Error]", e);
              }
            }
          }
        });
      }
    }

    return returnSuccess(true);
  } catch (error) {
    return returnError(`Subscribe Redis channel failed: ${tryCatchErrorToString(error)}`);
  }
}

export function clearChannelSubscribers(): void {
  channelSubscribers.clear();
}

export async function closeRedisClient(): Promise<StandardResult<boolean>> {
  try {
    if (subClient) {
      await subClient.quit().catch(() => {});
      subClient = null;
    }
    if (redisClient) {
      await redisClient.quit();
      redisClient = null;
    }
    return returnSuccess(true);
  } catch (error) {
    return returnError(`Close Redis Client failed: ${tryCatchErrorToString(error)}`);
  }
}

export function clearMemoryCache(): void {
  memoryCacheStore.clear();
}
