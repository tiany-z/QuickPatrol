/**
 * 高校后勤巡查e速办 v4.0 - M40: 全局多会话未读角标原子累加与差量同步算法
 * (Global Unread Badge Delta Synchronizer - 算法 3)
 */

export class GlobalUnreadBadgeDeltaSynchronizer {
  public static calculateAfterClear(currentTotal: number, clearedRoomCount: number): number {
    const safeTotal = Math.max(0, currentTotal || 0);
    const safeCleared = Math.max(0, clearedRoomCount || 0);
    return Math.max(0, safeTotal - safeCleared);
  }

  public static calculateAfterIncrement(currentTotal: number, delta: number = 1): number {
    const safeTotal = Math.max(0, currentTotal || 0);
    const safeDelta = Math.max(0, delta || 0);
    return safeTotal + safeDelta;
  }

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
