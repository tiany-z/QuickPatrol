import { Redis, RedisOptions } from "ioredis";
import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../flow/result.js";

let redisClient: Redis | null = null;
let subClient: Redis | null = null;

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

export async function getKV<T = any>(tableName: string, id: string | number): Promise<StandardResult<T | null>> {
  try {
    if (!redisClient) {
      return returnError("Redis客户端未初始化");
    }
    const key = `${normalizeTableName(tableName)}:${id}`;
    const raw = await redisClient.get(key);
    if (!raw) {
      return returnSuccess(null);
    }
    const parsed = JSON.parse(raw) as T;
    return returnSuccess(parsed);
  } catch (error) {
    return returnError(`Get Redis KV failed: ${tryCatchErrorToString(error)}`);
  }
}

export async function mgetKV<T = any>(
  tableName: string,
  ids: Array<string | number>
): Promise<StandardResult<Record<string | number, T>>> {
  try {
    if (!redisClient) {
      return returnError("Redis客户端未初始化");
    }
    if (ids.length === 0) {
      return returnSuccess({});
    }

    const keys = ids.map((id) => `${normalizeTableName(tableName)}:${id}`);
    const results = await redisClient.mget(...keys);

    const resultMap: Record<string | number, T> = {};
    ids.forEach((id, index) => {
      const raw = results[index];
      if (raw) {
        try {
          resultMap[id] = JSON.parse(raw) as T;
        } catch {}
      }
    });

    return returnSuccess(resultMap);
  } catch (error) {
    return returnError(`MGet Redis KV failed: ${tryCatchErrorToString(error)}`);
  }
}

export async function setKV(
  tableName: string,
  id: string | number,
  value: any,
  ttlSeconds: number = 86400
): Promise<StandardResult<boolean>> {
  try {
    if (!redisClient) {
      return returnError("Redis客户端未初始化");
    }
    const key = `${normalizeTableName(tableName)}:${id}`;
    const serialized = JSON.stringify(value);
    await redisClient.set(key, serialized, "EX", ttlSeconds);
    return returnSuccess(true);
  } catch (error) {
    return returnError(`Set Redis KV failed: ${tryCatchErrorToString(error)}`);
  }
}

export async function delKV(tableName: string, id: string | number): Promise<StandardResult<boolean>> {
  try {
    if (!redisClient) {
      return returnError("Redis客户端未初始化");
    }
    const key = `${normalizeTableName(tableName)}:${id}`;
    await redisClient.del(key);
    return returnSuccess(true);
  } catch (error) {
    return returnError(`Del Redis KV failed: ${tryCatchErrorToString(error)}`);
  }
}

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
    if (!redisClient) {
      return returnError("Redis客户端未初始化");
    }
    const res = await redisClient.publish(channel, message);
    return returnSuccess(res);
  } catch (error) {
    return returnError(`Publish Redis message failed: ${tryCatchErrorToString(error)}`);
  }
}

export async function subscribeRedis(
  channel: string,
  callback: (message: string) => void
): Promise<StandardResult<boolean>> {
  try {
    const sub = getRedisSubClient();
    if (!sub) {
      return returnError("Redis Sub客户端未初始化");
    }

    if (!channelSubscribers.has(channel)) {
      channelSubscribers.set(channel, new Set());
      await sub.subscribe(channel);
    }

    channelSubscribers.get(channel)!.add(callback);

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

    return returnSuccess(true);
  } catch (error) {
    return returnError(`Subscribe Redis channel failed: ${tryCatchErrorToString(error)}`);
  }
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
