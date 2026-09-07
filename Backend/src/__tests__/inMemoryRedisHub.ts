/**
 * M10: 内存级 Redis 命令拦截器与自环回环模拟器 (In-Memory Redis Mock Hub)
 * 
 * 遵照 M10 算法 3 规范实现：
 * 1. 原生 Map 模拟 Key-Value 读写与 TTL 过期机制 (0 外部 Redis 依赖)
 * 2. 基于 queueMicrotask 微任务调度模拟高保真异步 Pub/Sub 广播总线
 * 3. 一键原子重置沙箱状态 (clearAll)，杜绝测试间交叉污染与内存泄漏
 */

export class InMemoryRedisHub {
  private kvStore = new Map<string, { value: string; expireAt?: number }>();
  private channelSubscribers = new Map<string, Set<(message: string) => void>>();

  /**
   * 读取指定 Key 的缓存值（自动检验 TTL 存活状态）
   */
  public async get(key: string): Promise<string | null> {
    const item = this.kvStore.get(key);
    if (!item) return null;
    if (item.expireAt && Date.now() > item.expireAt) {
      this.kvStore.delete(key);
      return null;
    }
    return item.value;
  }

  /**
   * 写入 Key-Value 缓存，支持 EX 秒级超时
   */
  public async set(
    key: string,
    value: string,
    mode?: string,
    duration?: number
  ): Promise<"OK"> {
    let expireAt: number | undefined;
    if (mode === "EX" && typeof duration === "number" && duration > 0) {
      expireAt = Date.now() + duration * 1000;
    }
    this.kvStore.set(key, { value, expireAt });
    return "OK";
  }

  /**
   * 删除一个或多个 Key
   */
  public async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.kvStore.delete(key)) {
        count++;
      }
    }
    return count;
  }

  /**
   * 检查指定 Key 是否存在且未过期
   */
  public async exists(key: string): Promise<number> {
    const val = await this.get(key);
    return val !== null ? 1 : 0;
  }

  /**
   * 批量获取多个 Key
   */
  public async mget(...keys: string[]): Promise<(string | null)[]> {
    return Promise.all(keys.map((k) => this.get(k)));
  }

  /**
   * 原子递增 Key 的数值 (兼容 Redis INCRBY)
   */
  public async incrby(key: string, increment: number = 1): Promise<number> {
    const item = this.kvStore.get(key);
    let current = 0;
    if (item) {
      if (item.expireAt && Date.now() > item.expireAt) {
        this.kvStore.delete(key);
      } else {
        current = parseInt(item.value, 10) || 0;
      }
    }
    const next = current + increment;
    this.kvStore.set(key, { value: String(next), expireAt: item?.expireAt });
    return next;
  }

  /**
   * 原子递减 Key 的数值 (兼容 Redis DECRBY)
   */
  public async decrby(key: string, decrement: number = 1): Promise<number> {
    return this.incrby(key, -decrement);
  }

  /**
   * 设置 Key 的过期秒数 (兼容 Redis EXPIRE)
   */
  public async expire(key: string, seconds: number): Promise<number> {
    const item = this.kvStore.get(key);
    if (!item) return 0;
    item.expireAt = Date.now() + seconds * 1000;
    this.kvStore.set(key, item);
    return 1;
  }

  /**
   * 模拟 Redis 消息发布 (Pub)
   * 利用 queueMicrotask 保证异步下发与非阻塞执行
   */
  public async publish(channel: string, message: string): Promise<number> {
    const subs = this.channelSubscribers.get(channel);
    if (!subs || subs.size === 0) return 0;

    subs.forEach((cb) => {
      // 模拟微任务异步事件流
      queueMicrotask(() => {
        try {
          cb(message);
        } catch {
          // 容错防止测试回调崩溃影响总线
        }
      });
    });

    return subs.size;
  }

  /**
   * 订阅指定频道 (Sub)
   */
  public subscribe(channel: string, callback: (message: string) => void): void {
    if (!this.channelSubscribers.has(channel)) {
      this.channelSubscribers.set(channel, new Set());
    }
    this.channelSubscribers.get(channel)!.add(callback);
  }

  /**
   * 取消订阅指定频道
   */
  public unsubscribe(channel: string, callback?: (message: string) => void): void {
    if (!this.channelSubscribers.has(channel)) return;
    if (callback) {
      this.channelSubscribers.get(channel)!.delete(callback);
      if (this.channelSubscribers.get(channel)!.size === 0) {
        this.channelSubscribers.delete(channel);
      }
    } else {
      this.channelSubscribers.delete(channel);
    }
  }

  /**
   * 获取当前缓存 Key 总数（包含可能尚未触发惰性删除的键）
   */
  public size(): number {
    return this.kvStore.size;
  }

  /**
   * 获取当前订阅频道总数
   */
  public channelCount(): number {
    return this.channelSubscribers.size;
  }

  /**
   * 清理沙箱全部 KV 缓存与频道监听器，实现 100% 内存抹平
   */
  public clearAll(): void {
    this.kvStore.clear();
    this.channelSubscribers.clear();
  }

  /**
   * 兼容 FLUSHALL 命令
   */
  public async flushall(): Promise<"OK"> {
    this.clearAll();
    return "OK";
  }
}
