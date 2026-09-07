/**
 * 高校后勤巡查e速办 v4.0 - M40: 多租户会话大盘双因子综合加权排序算法
 * (Sticky-Priority Weighted Sorter - 算法 2)
 */

export interface ISortableSession {
  chatRoomId: number;
  isPinned: boolean | number;
  lastMessageAt: string | Date | null;
}

export class StickyPriorityWeightedSorter {
  public static readonly PIN_MULTIPLIER = 1e13;

  /**
   * 双因子加权稳定排序：置顶绝对优先，同组内按最后消息时间倒序
   * @param sessions 会话列表数组
   */
  public static sort<T extends ISortableSession>(sessions: T[]): T[] {
    if (!sessions || !Array.isArray(sessions) || sessions.length <= 1) {
      return sessions || [];
    }

    return [...sessions].sort((a, b) => {
      const isPinnedA = Boolean(a.isPinned);
      const isPinnedB = Boolean(b.isPinned);

      const timeA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const timeB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;

      const safeTimeA = isNaN(timeA) ? 0 : timeA;
      const safeTimeB = isNaN(timeB) ? 0 : timeB;

      const weightA = (isPinnedA ? 1 : 0) * StickyPriorityWeightedSorter.PIN_MULTIPLIER + safeTimeA;
      const weightB = (isPinnedB ? 1 : 0) * StickyPriorityWeightedSorter.PIN_MULTIPLIER + safeTimeB;

      return weightB - weightA;
    });
  }
}
