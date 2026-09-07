/**
 * 高校后勤巡查e速办 v4.0 - M41 算法 2: 突发险情一键拉群多部门职能标签智能推荐算法
 * (Incident Tag-Based Member Matcher)
 * 
 * 核心设计：
 * 1. 结合工单报修类目 (CategoryId / 险情类型) 智能提取必选岗位职能标签 (M16);
 * 2. 在同租户 (schoolId) 与同校区片区 (campusId) 候选人池中精准匹配持岗在编人员;
 * 3. 强制加入网格主管、值班主任与工单主责处理人;
 * 4. 100% 绝对多租户安全约束：严格剔除所有外部学校非法跨租户候选人。
 */

export interface ICandidateUser {
  id: number;
  schoolId: number;
  campusId?: number;
  role: number;
  realName: string;
  isBan?: number;
  isDeleted?: number;
}

export interface IMatchOptions {
  schoolId: number;
  campusId?: number;
  categoryId?: number;
  categoryName?: string;
  dutyLeaderIds?: number[];
  patrolHandlerId?: number;
}

export class IncidentTagMemberMatcher {
  /**
   * 突发险情类型与推荐标签名称映射表 (标准化预定义规则库)
   */
  private static readonly CATEGORY_TAG_RULES: Record<string, string[]> = {
    // 强电 / 消防 / 火灾隐患
    electric: ["强电班组", "安全生产监督员", "应急抢险突击队", "电工"],
    // 供水 / 排水 / 防汛内涝
    water: ["水暖应急抢险班", "抽水排水组", "应急抢险突击队", "管工"],
    // 房屋建筑 / 土建瓦工
    civil: ["土建维修组", "安全生产监督员", "瓦工木工组"],
    // 供暖 / 热力管网
    heating: ["水暖应急抢险班", "锅炉热力班", "应急抢险突击队"],
    // 通用突发特急
    default: ["应急抢险突击队", "后勤综合调度班", "安全生产监督员"]
  };

  /**
   * 依据工单类目推导所需的职能标签名称集合
   */
  public static resolveRequiredTagNames(categoryName: string = ""): string[] {
    const lower = (categoryName || "").toLowerCase();
    if (lower.includes("电") || lower.includes("火") || lower.includes("气")) {
      return this.CATEGORY_TAG_RULES.electric;
    }
    if (lower.includes("水") || lower.includes("汛") || lower.includes("漏") || lower.includes("涝")) {
      return this.CATEGORY_TAG_RULES.water;
    }
    if (lower.includes("房") || lower.includes("瓦") || lower.includes("墙") || lower.includes("窗")) {
      return this.CATEGORY_TAG_RULES.civil;
    }
    if (lower.includes("暖") || lower.includes("热") || lower.includes("气管")) {
      return this.CATEGORY_TAG_RULES.heating;
    }
    return this.CATEGORY_TAG_RULES.default;
  }

  /**
   * 核心匹配推荐算法
   * 
   * @param options 险情与租户片区选项
   * @param candidates 候选人员池 (包含租户与基础属性)
   * @param userTagNamesMap 用户ID到持岗标签名称集合的映射 (通常来自 M16 TagService)
   * @returns 去重且安全合规的目标推荐入群人员 ID 集合
   */
  public static matchRecommendedMembers(
    options: IMatchOptions,
    candidates: ICandidateUser[],
    userTagNamesMap: Map<number, string[]>
  ): number[] {
    const { schoolId, campusId, categoryName = "", dutyLeaderIds = [], patrolHandlerId = 0 } = options;

    if (!schoolId || schoolId <= 0) {
      return [];
    }

    const requiredTags = new Set(this.resolveRequiredTagNames(categoryName));
    const matchedUserIds = new Set<number>();

    // 1. 过滤同校合法活跃用户池 (物理多租户与封禁防御)
    const validPool = candidates.filter(
      (u) =>
        u.schoolId === schoolId &&
        u.isBan !== 1 &&
        u.isDeleted !== 1 &&
        (campusId === undefined || u.campusId === undefined || u.campusId === campusId)
    );

    // 2. 匹配职能标签
    for (const user of validPool) {
      const userTags = userTagNamesMap.get(user.id) || [];
      const hasMatchedTag = userTags.some((t) => requiredTags.has(t));
      if (hasMatchedTag) {
        matchedUserIds.add(user.id);
      }
    }

    // 3. 强制加入工单主责处理人 (若属于同租户)
    if (patrolHandlerId > 0) {
      const handlerUser = candidates.find((u) => u.id === patrolHandlerId && u.schoolId === schoolId);
      if (handlerUser && handlerUser.isBan !== 1 && handlerUser.isDeleted !== 1) {
        matchedUserIds.add(patrolHandlerId);
      }
    }

    // 4. 强制加入值班网格长与总指挥 (若属于同租户)
    for (const leaderId of dutyLeaderIds) {
      if (leaderId > 0) {
        const leader = candidates.find((u) => u.id === leaderId && u.schoolId === schoolId);
        if (leader && leader.isBan !== 1 && leader.isDeleted !== 1) {
          matchedUserIds.add(leaderId);
        }
      }
    }

    return Array.from(matchedUserIds);
  }
}
