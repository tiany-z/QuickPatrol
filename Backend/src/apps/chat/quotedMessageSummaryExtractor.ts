/**
 * 高校后勤巡查e速办 v4.0 - M39: 聊天消息长按引用回复与源消息联动
 * (Quoted Message Summary Extractor - 算法 1)
 */

export class QuotedMessageSummaryExtractor {
  private static readonly MAX_TEXT_LENGTH = 30;

  /**
   * 提取被引用源消息精简摘要 (算法 1)
   * 支持多类型意图转义、文本 30 字自适应截断、以及撤回降级脱敏
   * @param type 消息类型 (0 文本, 1 图片, 2 工单卡片, 3 系统通知)
   * @param content 原始消息内容
   * @param isWithDraw 撤回状态标记
   */
  public static extract(
    type: number,
    content: string,
    isWithDraw: boolean | number
  ): { summary: string; isWithdrawn: boolean } {
    if (Boolean(isWithDraw)) {
      return {
        summary: "[原消息已被发信人撤回]",
        isWithdrawn: true
      };
    }

    let summary = "";
    switch (type) {
      case 0: { // TEXT
        const cleaned = (content || "").replace(/[\r\n\t]+/g, " ").trim();
        if (cleaned.length > this.MAX_TEXT_LENGTH) {
          summary = cleaned.substring(0, this.MAX_TEXT_LENGTH) + "...";
        } else {
          summary = cleaned || "[空文本]";
        }
        break;
      }
      case 1: // IMAGE
        summary = "[现场图片]";
        break;
      case 2: // PATROL_CARD
        summary = "[工单协同卡片]";
        break;
      case 3: // SYSTEM
        summary = "[系统通知]";
        break;
      default:
        summary = "[消息]";
        break;
    }

    return { summary, isWithdrawn: false };
  }
}
