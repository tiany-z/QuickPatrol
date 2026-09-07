import { genUUID } from "../shared/crypto/uuid.js";
import { TerminalLogger } from "../shared/log/terminalLogger.js";
import { publishRedis, subscribeRedis } from "../shared/cache/redis.js";
import { ClusterBroadcastPacket, ClusterBusChannel } from "../shared/cache/cacheTypes.js";
import { AntiEchoFilterEngine } from "../shared/cache/antiEchoEngine.js";

/**
 * M05: RedisWsBridge 跨微服务集群广播桥梁 (Cluster Broadcast Bus Bridge)
 * 基于 Redis Pub/Sub 实现跨多进程 WebSocket 事件广播，通过节点指纹彻底消除本节点回环。
 * 同时支持单例静态调用模式与多虚拟节点实例模式。
 */
export class RedisWsBridge {
  public static readonly CHANNELS: ClusterBusChannel[] = [
    "ws:cluster:direct",
    "ws:cluster:broadcast",
    "ws:cluster:card_mutated",
    "cluster:tenant:force_logout",
    "cluster:config:flush",
  ];

  private nodeId: string;
  private localDispatchCallback?: (packet: ClusterBroadcastPacket) => void;
  private isInitialized = false;

  constructor(nodeId?: string) {
    this.nodeId =
      nodeId ||
      process.env.NODE_ID ||
      `BackendNode-${process.env.HTTP_PORT || "8000"}`;
  }

  /**
   * 获取当前实例节点标识
   */
  public getNodeId(): string {
    return this.nodeId;
  }

  /**
   * 设置当前实例节点标识
   */
  public setNodeId(nodeId: string): void {
    this.nodeId = nodeId;
  }

  /**
   * 初始化实例监听并绑定外部消费回调
   */
  public async initBridge(
    onReceiveExternalBroadcast?: (packet: ClusterBroadcastPacket) => void
  ): Promise<void> {
    if (onReceiveExternalBroadcast) {
      this.localDispatchCallback = onReceiveExternalBroadcast;
    }

    if (!this.isInitialized) {
      this.isInitialized = true;

      for (const ch of RedisWsBridge.CHANNELS) {
        await subscribeRedis(ch, (rawMsg: string) => {
          try {
            const packet: ClusterBroadcastPacket = JSON.parse(rawMsg);

            // 核心算法：防自环指纹过滤
            if (AntiEchoFilterEngine.shouldDropBroadcast(packet, this.getNodeId())) {
              return; // 成功阻断本地自发自收!
            }

            // 放行并交由本地回调投递给当前节点连接的客户端
            if (this.localDispatchCallback) {
              this.localDispatchCallback(packet);
            }
          } catch (err) {
            TerminalLogger.error(
              `[RedisWsBridge] 解析集群广播报文失败: ${err}`,
              "ClusterBus"
            );
          }
        });
      }
    }

    TerminalLogger.info(
      `[M05] Redis 集群广播桥梁就绪 (节点: ${this.getNodeId()})`,
      "ClusterBus"
    );
  }

  /**
   * 跨节点发布广播报文 (自动注入本实例节点特征码与追踪 UUID)
   */
  public async broadcast<T = any>(
    channel: ClusterBusChannel,
    schoolId: number,
    data: T,
    targetUserId?: number | string
  ): Promise<ClusterBroadcastPacket<T>> {
    const packet: ClusterBroadcastPacket<T> = {
      broadcastId: genUUID(),
      originNodeId: this.getNodeId(),
      schoolId,
      channel,
      targetUserId,
      data,
      createdAt: Date.now(),
    };

    await publishRedis(channel, JSON.stringify(packet));
    return packet;
  }

  // -------------------------------------------------------------
  // 静态便捷单例接口 (向后兼容与默认单服务直接使用)
  // -------------------------------------------------------------
  private static defaultInstance: RedisWsBridge = new RedisWsBridge();

  public static getDefaultInstance(): RedisWsBridge {
    return this.defaultInstance;
  }

  public static getNodeId(): string {
    return this.defaultInstance.getNodeId();
  }

  public static setNodeId(nodeId: string | null): void {
    if (nodeId) {
      this.defaultInstance.setNodeId(nodeId);
    } else {
      this.defaultInstance.setNodeId(
        process.env.NODE_ID || `BackendNode-${process.env.HTTP_PORT || "8000"}`
      );
    }
  }

  public static async initBridge(
    onReceiveExternalBroadcast?: (packet: ClusterBroadcastPacket) => void
  ): Promise<void> {
    return this.defaultInstance.initBridge(onReceiveExternalBroadcast);
  }

  public static async broadcast<T = any>(
    channel: ClusterBusChannel,
    schoolId: number,
    data: T,
    targetUserId?: number | string
  ): Promise<ClusterBroadcastPacket<T>> {
    return this.defaultInstance.broadcast(channel, schoolId, data, targetUserId);
  }

  /**
   * 发布派单广播至指定学校的指定人员集合
   */
  public static async broadcastToUsers<T = any>(
    schoolId: number,
    userIds: number[],
    payload: T
  ): Promise<void> {
    for (const uid of userIds) {
      await this.broadcast("ws:cluster:direct", schoolId, payload, uid);
    }
  }

  /**
   * 发布单播派单通知
   */
  public static async sendToUser<T = any>(
    schoolId: number,
    userId: number,
    payload: T
  ): Promise<void> {
    await this.broadcast("ws:cluster:direct", schoolId, payload, userId);
  }

  public static resetBridge(): void {
    this.defaultInstance = new RedisWsBridge();
    AntiEchoFilterEngine.clearTracking();
  }
}
