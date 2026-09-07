/**
 * 高校后勤巡查e速办 v4.0 - M40: 全局多会话未读角标原子累加与差量同步算法
 * (Global Unread Badge Delta Synchronizer - 算法 3)
 *
 * 核心数学公式：
 * U_new = max(0, U_total - U_room_cleared)
 * 端侧展示格式化公式:
 * BadgeText(U) =
 *   "99+", U > 99
 *   String(U), 0 < U <= 99
 *   null (移除角标), U <= 0
 */

export class GlobalUnreadBadgeDeltaSynchronizer {
  /**
   * 计算消除某个房间未读后的全局剩余未读数
   */
  public static calculateAfterClear(currentTotal: number, clearedRoomCount: number): number {
    const safeTotal = Math.max(0, currentTotal || 0);
    const safeCleared = Math.max(0, clearedRoomCount || 0);
    return Math.max(0, safeTotal - safeCleared);
  }

  /**
   * 计算接收到新消息增量后的全局最新未读数
   */
  public static calculateAfterIncrement(currentTotal: number, delta: number = 1): number {
    const safeTotal = Math.max(0, currentTotal || 0);
    const safeDelta = Math.max(0, delta || 0);
    return safeTotal + safeDelta;
  }

  /**
   * 将未读数字符串化为微信原生 TabBarBadge 文本格式
   * @param unreadCount 当前全局未读总数
   * @returns "99+" | "1"~"99" | null (代表应调用 removeTabBarBadge)
   */
  public static formatBadgeText(unreadCount: number): string | null {
    const safeCount = Math.max(0, unreadCount || 0);
    if (safeCount <= 0) {
      return null;
    }
    if (safeCount > 99) {
      return "99+";
    }
    return String(safeCount);
  }
}
