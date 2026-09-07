/**
 * 高校后勤巡查e速办 v4.0 - M38: 类 QQ 2分钟消息撤回与审计存根
 * (Bubble In-Place Mutation Machine - 算法 4)
 */

export interface ILocalBubbleModel {
  id: number | string;
  type: number;
  content: string;
  isSelf?: boolean;
  isWithDraw: 0 | 1 | boolean;
  canReEdit?: boolean;
  originalText?: string;
  animState?: 'fade-out' | 'fade-in' | 'stable';
  [key: string]: any;
}

export class BubbleInPlaceMutationMachine {
  /**
   * 处理撤回信令就地置换 (算法 4)
   * 零整页重载、零滚动抖动，局部 Model 响应式更新
   */
  public static mutate(
    list: ILocalBubbleModel[],
    withdrawnMessageId: number | string,
    operatorId: number,
    currentUserId: number,
    originalTextIfSelf?: string,
    isSystemRecall: boolean = false
  ): { updatedList: ILocalBubbleModel[]; hitIndex: number } {
    const hitIndex = list.findIndex(
      (item) => String(item.id) === String(withdrawnMessageId)
    );
    if (hitIndex === -1) {
      return { updatedList: list, hitIndex: -1 };
    }

    const target = list[hitIndex];
    const isOperatorSelf = (operatorId === currentUserId) || Boolean(target.isSelf);

    let displayContent: string;
    if (isSystemRecall) {
      displayContent = "【系统管理员】撤回了一条违规消息";
    } else if (isOperatorSelf) {
      displayContent = "你撤回了一条消息";
    } else {
      displayContent = "对方撤回了一条消息";
    }

    // 若是自己撤回的文本消息，赋予“重新编辑”特权
    const canReEdit = isOperatorSelf && target.type === 0 && Boolean(originalTextIfSelf || target.content);
    const originalText = canReEdit ? (originalTextIfSelf || target.content) : undefined;

    const mutatedItem: ILocalBubbleModel = {
      ...target,
      isWithDraw: 1,
      animState: 'fade-in',
      content: displayContent,
      canReEdit,
      originalText
    };

    const nextList = [...list];
    nextList[hitIndex] = mutatedItem;

    return { updatedList: nextList, hitIndex };
  }
}
