/**
 * M05: Redis 多租户命名空间缓存与分布式广播总线 - 强类型契约定义
 */

/** 广播事件通道定义 */
export type ClusterBusChannel =
  | "ws:cluster:direct"
  | "ws:cluster:broadcast"
  | "ws:cluster:card_mutated"
  | "cluster:tenant:force_logout"
  | "cluster:config:flush";

/** 集群广播统一强类型报文 */
export interface ClusterBroadcastPacket<T = any> {
  broadcastId: string;
  originNodeId: string;
  schoolId: number;
  channel: ClusterBusChannel;
  targetUserId?: number | string;
  data: T;
  createdAt: number;
}

/** 缓存读取配置 */
export interface CacheReadOptions {
  ttlSeconds?: number;
  allowEmptySentinel?: boolean;
}

/** 多租户解析键元信息 */
export interface TenantKeyInfo {
  schoolId: number;
  module: string;
  subKey: string;
}
