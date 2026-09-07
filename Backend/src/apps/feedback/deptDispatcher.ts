/**
 * 高校后勤巡查e速办 v4.0 - M32: 智能科室预分派与督办计算引擎
 * (Department Intelligent Dispatcher & SLA Engine)
 */

import crypto from "crypto";
import {
  IDeptRule,
  IDispatchResult,
  ISlaCountdownResult,
  IEtagCheckResult,
  ThanksCardType
} from "./officialReplyTypes.js";

export class DeptDispatcher {
  /**
   * 全校科室职能标签与关键词拓扑知识库
   */
  public static readonly RULES: IDeptRule[] = [
    {
      deptId: 3,
      name: "饮食服务中心",
      keywords: ["食堂", "饭菜", "窗口", "阿姨", "菜价", "生熟", "异物", "包子", "米饭", "餐盘", "打饭", "早点", "档口", "餐饮", "卫生"],
      categoryBias: "canteen"
    },
    {
      deptId: 4,
      name: "学生公寓管理服务中心",
      keywords: ["宿舍", "宿管", "大爷", "阿姨", "门禁", "熄灯", "洗澡", "水温", "吹风机", "查寝", "断电", "违章电器", "宿舍楼", "楼管"],
      categoryBias: "dorm"
    },
    {
      deptId: 5,
      name: "后勤动力与修缮工程中心",
      keywords: ["漏水", "水管", "电闸", "跳闸", "插座", "路灯", "路面", "坑洼", "空调", "暖气", "电梯", "瓷砖", "下水道", "报修", "门锁"],
      categoryBias: "service"
    },
    {
      deptId: 6,
      name: "校园环境与交通管理中心",
      keywords: ["摆渡车", "校车", "班车", "单车", "乱停", "保洁", "垃圾桶", "除草", "树木", "落叶", "草坪", "违停", "绿化", "杂草"],
      categoryBias: "traffic"
    }
  ];

  /**
   * 算法 1: 基于关键词拓扑与职能标签的科室智能自动预分派算法
   * 
   * @param title 诉求标题
   * @param content 诉求详细正文
   * @param categoryType 前端选择的大类
   */
  public static dispatch(
    title: string,
    content: string,
    categoryType: string
  ): IDispatchResult {
    const combinedText = `${title || ""} ${title || ""} ${content || ""}`.toLowerCase();
    let bestDeptId = 1; // 默认 1 为后勤管理处综合办公室公海池
    let bestDeptName = "后勤管理处综合办公室";
    let maxScore = 0;
    let totalScore = 0;

    for (const rule of this.RULES) {
      let score = 0;

      // 分类强吻合加分
      if (rule.categoryBias === categoryType) {
        score += 10;
      }

      // 关键词词频加权
      for (const kw of rule.keywords) {
        const matches = combinedText.split(kw.toLowerCase()).length - 1;
        if (matches > 0) {
          score += matches * (kw.length >= 3 ? 3 : 2);
        }
      }

      totalScore += score;
      if (score > maxScore) {
        maxScore = score;
        bestDeptId = rule.deptId;
        bestDeptName = rule.name;
      }
    }

    const confidence = totalScore > 0 ? parseFloat((maxScore / totalScore).toFixed(2)) : 0;

    // 置信度过低或总分过低时安全降级至综合办公室人工分派池
    if (confidence < 0.4 && maxScore < 15) {
      return {
        recommendedDeptId: 1,
        recommendedDeptName: "后勤管理处综合办公室",
        confidence: 0
      };
    }

    return {
      recommendedDeptId: bestDeptId,
      recommendedDeptName: bestDeptName,
      confidence
    };
  }

  /**
   * 算法 2: 整改承诺动态 SLA 倒计时与红黄绿三色督办推导算法
   * 
   * @param repliedAt 官方出具答复时间戳或 ISO 字符串
   * @param promiseDays 承诺整改天数 (1 ~ 15 天)
   * @param isClosed 诉求是否已彻底核销办结
   * @param currentTime 当前系统比对时间戳
   */
  public static calculateSla(
    repliedAt: string | number,
    promiseDays: number,
    isClosed: boolean = false,
    currentTime: number = Date.now()
  ): ISlaCountdownResult {
    const repliedAtMs = typeof repliedAt === "number" ? repliedAt : new Date(repliedAt).getTime();
    const effectiveDays = Math.max(1, Math.min(15, promiseDays || 3));
    const deadline = repliedAtMs + effectiveDays * 86400 * 1000;

    if (isClosed) {
      return {
        slaStatus: "GREEN",
        remainingHours: 0,
        penaltyScore: 0,
        statusText: "整改已核销办结"
      };
    }

    const remainingHours = parseFloat(((deadline - currentTime) / (3600 * 1000)).toFixed(1));

    if (remainingHours > 24.0) {
      const remainingDays = Math.ceil(remainingHours / 24.0);
      return {
        slaStatus: "GREEN",
        remainingHours,
        penaltyScore: 0,
        statusText: `科室已承诺整改，剩余 ${remainingDays} 天完成，正按计划落实`
      };
    }

    if (remainingHours > 0.0) {
      return {
        slaStatus: "YELLOW",
        remainingHours,
        penaltyScore: 0,
        statusText: `整改临期预警: 仅剩 ${Math.floor(remainingHours)} 小时`
      };
    }

    // 超期违约
    const overdueHours = Math.abs(remainingHours);
    const penaltyScore = parseFloat(Math.min(5.0, 2.0 + 0.5 * (overdueHours / 24.0)).toFixed(2));

    return {
      slaStatus: "RED",
      remainingHours,
      penaltyScore,
      statusText: `严重超时违约: 超期 ${Math.floor(overdueHours)} 小时`
    };
  }

  /**
   * 算法 3: 师生文创感谢卡加权口碑与科室月度治理效能评分
   * 
   * @param thanksCards 接收到的感谢卡清单
   * @param totalRepliedCount 累计答复诉求总量
   */
  public static calculateGratitudeScore(
    thanksCards: Array<{ cardType: ThanksCardType | string }>,
    totalRepliedCount: number
  ): { monthlyReputationScore: number; starLevel: number } {
    const CARD_WEIGHTS: Record<string, number> = {
      SPEED: 5.0,
      WARMTH: 5.0,
      ACTION: 6.0,
      PRAISE: 8.0
    };

    // 1. 基础答复履职分 (最高40分)
    const baseScore = Math.min(40, (totalRepliedCount / 20) * 40);

    // 2. 感谢卡加权得分 (最高60分)
    let sumWeight = 0;
    for (const card of thanksCards) {
      sumWeight += CARD_WEIGHTS[card.cardType] || 5.0;
    }
    const gratitudeBonus = Math.min(60, sumWeight * 1.5);

    const finalScore = Math.max(0, Math.min(100, Math.round(baseScore + gratitudeBonus)));

    let starLevel = 2;
    if (finalScore >= 90) {
      starLevel = 5;
    } else if (finalScore >= 80) {
      starLevel = 4;
    } else if (finalScore >= 60) {
      starLevel = 3;
    }

    return {
      monthlyReputationScore: finalScore,
      starLevel
    };
  }

  /**
   * 算法 4: 匿名诉求无状态 ETag 增量版本比对算法
   * 
   * @param post 诉求实体
   * @param latestOfficialReply 最新官方答复
   * @param clientETag 客户端携带的 If-None-Match
   */
  public static checkETag(
    post: { id: number; status: number; updatedAt: string },
    latestOfficialReply?: { id: number; createdAt: string } | null,
    clientETag?: string
  ): IEtagCheckResult {
    const hasReply = latestOfficialReply ? 1 : 0;
    const replyTimestamp = latestOfficialReply?.createdAt || 0;
    const fingerprint = `p:${post.id}_s:${post.status}_u:${post.updatedAt}_r:${hasReply}_rt:${replyTimestamp}`;
    const md5Hash = crypto.createHash("md5").update(fingerprint).digest("hex");
    const currentETag = `"${md5Hash}"`;

    const isModified = !clientETag || clientETag !== currentETag;
    return {
      isModified,
      currentETag
    };
  }
}
