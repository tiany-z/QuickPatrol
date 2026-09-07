/**
 * M18: 四维业务权限最特异优先精确匹配算法与位掩码法定能力判定
 * (Specificity Matcher & Bitmask Capability Check)
 * 
 * 核心设计：
 * 特异度得分计算公式：
 * Score(R) = (R.campusId != 0 && R.campusId == targetCampus ? 2 : 0) +
 *            (R.categoryId != 0 && R.categoryId == targetCategory ? 1 : 0)
 * 
 * 分数区间：
 * 3: EXACT_BOTH (精确校区 + 精确分类)
 * 2: CAMPUS_ONLY (精确校区 + 全分类通配)
 * 1: CATEGORY_ONLY (全校通配 + 精确分类)
 * 0: GLOBAL_FALLBACK (全校通配 + 全分类通配)
 */

export interface IPermissionCandidate {
  id: number;
  userId: number;
  tagId: number | null;
  campusId: number;
  categoryId: number;
  type: 1 | 2 | 3;
}

export interface IMatchResult {
  winnerRule: IPermissionCandidate;
  score: number;
  matchType: "EXACT_BOTH" | "CAMPUS_ONLY" | "CATEGORY_ONLY" | "GLOBAL_FALLBACK";
}

export class SpecificityMatcher {
  /**
   * 最特异匹配优选器
   */
  public static pickBestRule(
    candidates: IPermissionCandidate[],
    targetCampusId: number,
    targetCategoryId: number
  ): IMatchResult | null {
    if (!candidates || candidates.length === 0) return null;

    let bestRule: IPermissionCandidate | null = null;
    let highestScore = -1;

    for (const rule of candidates) {
      // 必须满足校区与分类有效匹配条件 (命中目标或为通配符 0)
      const campusMatches = rule.campusId === 0 || rule.campusId === targetCampusId;
      const categoryMatches = rule.categoryId === 0 || rule.categoryId === targetCategoryId;
      if (!campusMatches || !categoryMatches) {
        continue;
      }

      let score = 0;
      if (rule.campusId !== 0 && rule.campusId === targetCampusId) {
        score += 2;
      }
      if (rule.categoryId !== 0 && rule.categoryId === targetCategoryId) {
        score += 1;
      }

      if (score > highestScore) {
        highestScore = score;
        bestRule = rule;
      }
    }

    if (!bestRule) return null;

    const matchTypes: Record<number, "EXACT_BOTH" | "CAMPUS_ONLY" | "CATEGORY_ONLY" | "GLOBAL_FALLBACK"> = {
      3: "EXACT_BOTH",
      2: "CAMPUS_ONLY",
      1: "CATEGORY_ONLY",
      0: "GLOBAL_FALLBACK"
    };

    return {
      winnerRule: bestRule,
      score: highestScore,
      matchType: matchTypes[highestScore]
    };
  }
}

/**
 * 角色法定能力位掩码定义
 */
export enum RoleCapabilityMask {
  CAN_REPORT_PATROL    = 1 << 0, // 0x01: 师生提报与评价 (role >= 0)
  CAN_MAINTENANCE_WORK = 1 << 1, // 0x02: 接单施工打卡 (role >= 2)
  CAN_MANAGE_ORG       = 1 << 2, // 0x04: 维护组织树与人员 (role >= 3)
  CAN_GRANT_PERMISSIONS= 1 << 3, // 0x08: 棋盘网格授权与审批延期 (role >= 4)
  CAN_MANAGE_PLATFORM  = 1 << 4  // 0x10: 平台级高校纳管与开户 (role >= 9)
}

/**
 * 获取角色能力位掩码
 */
export function getRoleCapabilities(role: number): number {
  let mask = 0;
  if (role >= 0) mask |= RoleCapabilityMask.CAN_REPORT_PATROL;
  if (role >= 2) mask |= RoleCapabilityMask.CAN_MAINTENANCE_WORK;
  if (role >= 3) mask |= RoleCapabilityMask.CAN_MANAGE_ORG;
  if (role >= 4) mask |= RoleCapabilityMask.CAN_GRANT_PERMISSIONS;
  if (role >= 9) mask |= RoleCapabilityMask.CAN_MANAGE_PLATFORM;
  return mask;
}

/**
 * 校验角色是否具备指定法定能力
 */
export function hasCapability(role: number, capability: RoleCapabilityMask): boolean {
  return (getRoleCapabilities(role) & capability) === capability;
}
