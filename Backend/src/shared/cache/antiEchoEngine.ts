import { ClusterBroadcastPacket } from "./cacheTypes.js";

/**
 * M05: 基于节点指纹的防自环广播过滤引擎 (Anti-Echo Filter Engine)
 * 在多微服务多进程集群环境下彻底阻断本节点自发自收，并基于滑动窗口进行网络抖动去重
 */
export class AntiEchoFilterEngine {
  private static recentBroadcastIds: Set<string> = new Set();
  private static readonly MAX_TRACKING = 10000;

  /**
   * 判定是否应当丢弃本条广播报文
   * @param packet 广播数据包
   * @param currentNodeId 当前节点唯一标识
   * @returns true: 应当丢弃(自环或重复); false: 应当放行
   */
  public static shouldDropBroadcast(
    packet: ClusterBroadcastPacket,
    currentNodeId: string
  ): boolean {
    if (!packet) {
      return true;
    }

    // 1. 发送源自身防环判定 (Skip Local Echo)
    if (packet.originNodeId && packet.originNodeId === currentNodeId) {
      return true;
    }

    // 2. 检查广播包基础有效性
    if (!packet.broadcastId) {
      return false;
    }

    // 3. 重复投递去重判定 (网络抖动与多副本重复投递防护)
    if (this.recentBroadcastIds.has(packet.broadcastId)) {
      return true;
    }

    // 4. 记录已处理指纹至滑动窗口
    this.recentBroadcastIds.add(packet.broadcastId);
    if (this.recentBroadcastIds.size > this.MAX_TRACKING) {
      const firstItem = this.recentBroadcastIds.values().next().value;
      if (firstItem) {
        this.recentBroadcastIds.delete(firstItem);
      }
    }

    return false;
  }

  /**
   * 重置已跟踪指纹记录 (单元测试或隔离维护时调用)
   */
  public static clearTracking(): void {
    this.recentBroadcastIds.clear();
  }

  /**
   * 获取当前缓存已跟踪指纹数量
   */
  public static getTrackedCount(): number {
    return this.recentBroadcastIds.size;
  }
}
