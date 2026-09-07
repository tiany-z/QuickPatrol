/**
 * 高校后勤巡查e速办 v4.0 - M45: 小程序端侧卡片原地就地突变与微状态机引擎
 * (Client In-Place Card Mutation & Version Vector Engine)
 */

export interface IInPlaceCardItem {
  messageId: number;
  cardPayload: any;
  version?: number;
  isMutatingAnim?: boolean;
  [key: string]: any;
}

export class CardInPlaceMutator {
  /**
   * 算法 3 & 算法 4: 在端侧卡片数组中就地覆写快照并执行版本向量仲裁
   */
  public static mutate(
    cardList: IInPlaceCardItem[],
    targetMessageId: number,
    nextPayload: any,
    incomingVersion?: number
  ): { nextList: IInPlaceCardItem[]; success: boolean; reason?: string; hitIndex: number } {
    const hitIndex = cardList.findIndex((item) => item.messageId === targetMessageId);
    if (hitIndex === -1) {
      return { nextList: cardList, success: false, reason: "NOT_FOUND", hitIndex: -1 };
    }

    const current = cardList[hitIndex];

    // 算法 4: 版本向量防乱序仲裁 (若接收版本小于等于本地版本，判定为迟到废包并静默丢弃)
    if (
      incomingVersion !== undefined &&
      current.version !== undefined &&
      incomingVersion <= current.version
    ) {
      return { nextList: cardList, success: false, reason: "OUTDATED_VERSION", hitIndex };
    }

    const nextList = [...cardList];
    nextList[hitIndex] = {
      ...current,
      cardPayload: nextPayload,
      version: incomingVersion !== undefined ? incomingVersion : ((current.version || 1) + 1),
      isMutatingAnim: true
    };

    return { nextList, success: true, hitIndex };
  }
}
