/**
 * 高校后勤巡查e速办 v4.0 - 小程序端: 群聊已读游标与差量未读计算工具
 * (Group Read Cursor Delta Calculator for WeChat MiniProgram)
 */

export class GroupReadCursorCalculator {
  /**
   * 计算指定成员在群聊中的有效未读消息数
   */
  public static calculateUnread(
    lastReadMessageId: number,
    latestRoomMessageId: number,
    withdrawnMessageIdsInRange: number[] = []
  ): number {
    const safeReadId = Math.max(0, Math.floor(lastReadMessageId || 0));
    const safeLatestId = Math.max(0, Math.floor(latestRoomMessageId || 0));

    if (safeLatestId <= safeReadId) {
      return 0;
    }

    const rawDiff = safeLatestId - safeReadId;
    const validWithdrawnCount = withdrawnMessageIdsInRange.filter(
      (id) => id > safeReadId && id <= safeLatestId
    ).length;

    return Math.max(0, rawDiff - validWithdrawnCount);
  }

  /**
   * 滑动更新游标（保证单调递增）
   */
  public static advanceCursor(currentCursor: number, incomingCursor: number): number {
    const current = Math.max(0, Math.floor(currentCursor || 0));
    const incoming = Math.max(0, Math.floor(incomingCursor || 0));
    return Math.max(current, incoming);
  }
}
