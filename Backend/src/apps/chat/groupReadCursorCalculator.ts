/**
 * 高校后勤巡查e速办 v4.0 - M41 算法 1: 群聊已读游标与差量未读计算器
 * (Group Read Cursor Delta Calculator)
 * 
 * 核心数学模型：
 * 1. 游标单调递增性: C_u' = max(C_u, C_new)，消除乱序与时空倒流风险；
 * 2. 未读数计算: UnreadCount_u = sum_{m in M_R} [m.id > C_u and m.isWithDraw = 0]；
 * 3. 极速 O(1) 更新: 成员进房阅读只需一条 SQL UPDATE 单行游标，彻底消灭 500 人群写放大 (Write Amplification)。
 */

export class GroupReadCursorCalculator {
  /**
   * 计算指定成员在群聊中的有效未读消息数
   * 
   * @param lastReadMessageId 成员当前最后已读消息ID游标
   * @param latestRoomMessageId 群聊当前最新消息ID
   * @param withdrawnMessageIdsInRange 该游标区间内被撤回的消息ID列表 (脱敏防虚增)
   * @returns 真实未读消息数 (非负整数)
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

    // 粗算差量
    const rawDiff = safeLatestId - safeReadId;

    // 过滤落在 (lastReadMessageId, latestRoomMessageId] 区间内的已撤回消息
    const validWithdrawnCount = withdrawnMessageIdsInRange.filter(
      (id) => id > safeReadId && id <= safeLatestId
    ).length;

    // 扣除已撤回消息，防止已撤回气泡计入未读数
    const effectiveDiff = Math.max(0, rawDiff - validWithdrawnCount);
    return effectiveDiff;
  }

  /**
   * 滑动更新游标（保证单调递增，杜绝回退）
   * 
   * @param currentCursor 当前记录的游标ID
   * @param incomingCursor 客户端上报的最新阅读ID
   * @returns 单调递增后的游标值
   */
  public static advanceCursor(currentCursor: number, incomingCursor: number): number {
    const current = Math.max(0, Math.floor(currentCursor || 0));
    const incoming = Math.max(0, Math.floor(incomingCursor || 0));
    return Math.max(current, incoming);
  }

  /**
   * 计算单次已读确认清除的未读差量
   * 
   * @param previousCursor 更新前游标
   * @param newCursor 更新后游标
   * @returns 清除的消息差量
   */
  public static computeClearedCount(previousCursor: number, newCursor: number): number {
    const prev = Math.max(0, Math.floor(previousCursor || 0));
    const next = Math.max(0, Math.floor(newCursor || 0));
    return Math.max(0, next - prev);
  }
}
