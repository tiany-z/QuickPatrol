/**
 * M34: 基于 Redis + Lua 脚本的高性能分布式令牌桶限流器 (Token Bucket Limiter)
 * 具备：
 * 1. 单个 Lua 脚本原子执行，消除时间窗口临界突发双倍击穿漏洞；
 * 2. 时钟漂移与时钟回拨保护 (math.max(0, now - lastTime))；
 * 3. 内存沙箱平滑兜底，在 Redis 脱机或单元测试环境下无感自愈。
 */

export interface IRedisPipelineClient {
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<any>;
}

interface IInMemoryBucket {
  tokens: number;
  lastTime: number; // 秒级时间戳
}

export class TokenBucketLimiter {
  private static readonly memoryStore: Map<string, IInMemoryBucket> = new Map();

  /**
   * Redis 原子 Lua 令牌桶脚本
   */
  public static readonly LUA_SCRIPT = `
    local key = KEYS[1]
    local capacity = tonumber(ARGV[1])
    local refillRate = tonumber(ARGV[2])
    local now = tonumber(ARGV[3])
    local requested = tonumber(ARGV[4])

    local data = redis.call('HMGET', key, 'tokens', 'lastTime')
    local tokens = tonumber(data[1])
    local lastTime = tonumber(data[2])

    if tokens == nil then
      tokens = capacity
      lastTime = now
    else
      local delta = math.max(0, now - lastTime)
      tokens = math.min(capacity, tokens + delta * refillRate)
      lastTime = now
    end

    if tokens >= requested then
      tokens = tokens - requested
      redis.call('HMSET', key, 'tokens', tokens, 'lastTime', lastTime)
      redis.call('EXPIRE', key, 300)
      return 1
    else
      redis.call('HMSET', key, 'tokens', tokens, 'lastTime', lastTime)
      redis.call('EXPIRE', key, 300)
      return 0
    end
  `;

  /**
   * 尝试申请令牌
   * @param redis Redis 客户端实例 (可选，留空则使用内存沙箱)
   * @param key 限制维度 Key (如 space:token_bucket:ip_192.168.1.1)
   * @param capacity 桶最大容量 (默认 3)
   * @param refillRate 令牌生成速率 (每秒生成令牌数，默认 2条/60秒 = 0.0333)
   * @param requested 本次消费令牌数 (默认 1)
   */
  public static async tryAcquire(
    redis?: IRedisPipelineClient | null,
    key: string = "default",
    capacity: number = 3,
    refillRate: number = 0.0333,
    requested: number = 1
  ): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);

    // 1. 若提供了有效的 Redis 客户端且支持 eval，执行分布式 Lua
    if (redis && typeof redis.eval === "function") {
      try {
        const result = await redis.eval(
          this.LUA_SCRIPT,
          1,
          key,
          capacity,
          refillRate,
          now,
          requested
        );
        return Number(result) === 1;
      } catch {
        // Redis 执行异常时降级至内存沙箱
        return this.tryAcquireInMemory(key, capacity, refillRate, requested, now);
      }
    }

    // 2. 纯内存沙箱执行
    return this.tryAcquireInMemory(key, capacity, refillRate, requested, now);
  }

  private static tryAcquireInMemory(
    key: string,
    capacity: number,
    refillRate: number,
    requested: number,
    now: number
  ): boolean {
    let bucket = this.memoryStore.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, lastTime: now };
    } else {
      const delta = Math.max(0, now - bucket.lastTime);
      bucket.tokens = Math.min(capacity, bucket.tokens + delta * refillRate);
      bucket.lastTime = now;
    }

    if (bucket.tokens >= requested) {
      bucket.tokens -= requested;
      this.memoryStore.set(key, bucket);
      return true;
    }

    this.memoryStore.set(key, bucket);
    return false;
  }

  /**
   * 清理内存存储 (供单元测试沙箱正交复位)
   */
  public static resetMemoryStore(): void {
    this.memoryStore.clear();
  }
}
