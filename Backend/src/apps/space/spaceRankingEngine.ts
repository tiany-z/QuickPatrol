/**
 * M33: 校园公开空间核心算法引擎 (Space Ranking Engine)
 * 包含：
 * 1. 基于 Hacker News 与衰减重力的公开热榜推荐算法 (Gravity Ranking)
 * 2. 双列不规则瀑布流等高智能对齐排版算法 (Masonry Column Height Balancer)
 * 3. 敏感信息与位置多级脱敏过滤工具 (Masking Engine)
 */

import { ISpaceFeedCardDto, IRankingScoreItem } from "./spaceFeedTypes.js";

export class SpaceRankingEngine {
  /**
   * 算法 2: 基于 Hacker News 衰减重力的热榜得分推导
   * Score = (P - 1) / (T + 2)^G
   * 
   * @param item 候选项
   * @param currentTimeMs 当前计算时间戳 (毫秒)
   * @param gravity 重力系数 G，默认 1.6
   */
  public static calculateGravityScore(
    item: IRankingScoreItem,
    currentTimeMs: number = Date.now(),
    gravity: number = 1.6
  ): number {
    let officialBonus = 0;
    if (item.isTop) {
      officialBonus += 1000.0; // 官方置顶霸榜
    }
    if (item.hasOfficialReply) {
      officialBonus += 15.0; // 官方正式答复加权
    }
    if (item.hasThanksCard) {
      officialBonus += 25.0; // 师生感谢卡正向加权
    }

    const p =
      item.likeCount * 2.0 +
      item.commentCount * 3.0 +
      item.viewCount * 0.1 +
      officialBonus;

    const createdTimeMs =
      typeof item.createdAt === "number"
        ? item.createdAt
        : new Date(item.createdAt).getTime();

    const diffHours = Math.max(0, (currentTimeMs - createdTimeMs) / (3600 * 1000));
    const denominator = Math.pow(diffHours + 2, gravity);
    const score = (p - 1) / denominator;

    return Math.round(score * 10000) / 10000;
  }

  /**
   * 估算卡片排版物理高度 (用于双列瀑布流等高平衡分配)
   */
  public static estimateCardHeight(card: ISpaceFeedCardDto): number {
    const basePadding = 48;
    const titleLength = (card.title || "").length;
    const textHeight = Math.ceil(titleLength / 11) * 22 + 20;
    const footerHeight = 36;

    let mediaHeight = 0;
    if (card.trackType === "REPAIR") {
      mediaHeight = 180;
    } else if (card.trackType === "OFFICIAL_REPLY") {
      mediaHeight = 110;
    } else {
      mediaHeight = 80;
    }

    if (card.albumImages && card.albumImages.length > 0) {
      mediaHeight += 120;
    }

    return basePadding + textHeight + footerHeight + mediaHeight;
  }

  /**
   * 算法 1: 双列不规则瀑布流等高智能对齐排版算法 (Masonry Column Height Balancer)
   * 运用贪心策略将下一个卡片分配到“当前累积高度较矮的一列”
   */
  public static distributeMasonryColumns(
    cards: ISpaceFeedCardDto[],
    initialLeftH: number = 0,
    initialRightH: number = 0
  ): {
    leftCards: ISpaceFeedCardDto[];
    rightCards: ISpaceFeedCardDto[];
    leftHeight: number;
    rightHeight: number;
  } {
    const leftCards: ISpaceFeedCardDto[] = [];
    const rightCards: ISpaceFeedCardDto[] = [];
    let leftH = initialLeftH;
    let rightH = initialRightH;

    for (const card of cards) {
      const h = this.estimateCardHeight(card);
      if (leftH <= rightH) {
        leftCards.push(card);
        leftH += h;
      } else {
        rightCards.push(card);
        rightH += h;
      }
    }

    return {
      leftCards,
      rightCards,
      leftHeight: leftH,
      rightHeight: rightH
    };
  }

  /**
   * 中文姓名隐私脱敏
   * 张三 -> 张*
   * 李晓华 -> 李*华
   * 诸葛孔明 -> 诸**明
   */
  public static maskChineseName(name: string): string {
    if (!name || typeof name !== "string") return "热心师生";
    const trimmed = name.trim();
    if (trimmed.length <= 1) return trimmed;
    if (trimmed.length === 2) {
      return trimmed[0] + "*";
    }
    if (trimmed.length === 3) {
      return trimmed[0] + "*" + trimmed[2];
    }
    return trimmed[0] + "*".repeat(trimmed.length - 2) + trimmed[trimmed.length - 1];
  }

  /**
   * 手机号隐私脱敏 (13812345678 -> 138****5678)
   */
  public static maskPhoneNumber(text: string): string {
    if (!text || typeof text !== "string") return "";
    return text.replace(/(1[3-9]\d)\d{4}(\d{4})/g, "$1****$2");
  }

  /**
   * 宿舍与个人空间门牌号脱敏 (325室 -> 3**室, 1204寝室 -> 12**寝室)
   * 保留公共区域
   */
  public static maskDormRoom(text: string): string {
    if (!text || typeof text !== "string") return "";
    return text.replace(/(\d{1,2})\d{2}(室|号|寝室|房间)/g, "$1**$2");
  }

  /**
   * 综合敏感信息清洗管道 (算法 4)
   */
  public static sanitizePublicText(text: string): string {
    if (!text || typeof text !== "string") return "";
    let clean = this.maskPhoneNumber(text);
    clean = this.maskDormRoom(clean);
    return clean;
  }
}
