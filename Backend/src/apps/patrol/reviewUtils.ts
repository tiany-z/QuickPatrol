/**
 * 高校后勤巡查e速办 v4.0 - M28: 质检复核到场核验校验与工具函数
 * 落实审修分离、状态硬门禁、权限校验与不合格说明防御机制
 */

export interface IReviewerContext {
  id: number;
  role: number; // 1: 师生, 2: 维修师傅, 3: 宿管/质检主管, 4: 片区负责人, 5: 校级总监, 9: 超级管理员
  permissions?: string[];
}

export interface IPatrolReviewTarget {
  id: number;
  status: number;
  currentHandlerId?: number | null;
  schoolId?: number;
  title?: string;
}

/**
 * 质检复核核心准入前置硬门禁断言
 * 1. 状态硬门禁：必须处于 status === 2 (已整改待复核)
 * 2. 审修分离硬门禁：接单施工师傅严禁自检自验自身工单
 * 3. 权限硬门禁：必须具备 role >= 3 或拥有 'patrol:review' 质检复核专属权限
 */
export function assertCanReviewPatrol(
  reviewer: IReviewerContext,
  patrol: IPatrolReviewTarget
): void {
  // 1. 校验工单物理状态 (仅 status === 2 允许复核)
  if (Number(patrol.status) !== 2) {
    throw new Error(
      `STATUS_CONFLICT: 当前工单状态不可进行质检复核 (当前状态: ${patrol.status})`
    );
  }

  // 2. 严格落实审修分离原则 (Segregation of Duties)
  if (patrol.currentHandlerId && Number(reviewer.id) === Number(patrol.currentHandlerId)) {
    throw new Error(
      "FORBIDDEN_SELF_REVIEW: 审修分离原则：接单施工责任人严禁复核自检自身工单"
    );
  }

  // 3. 质检角色及权限校验 (role >= 3 或具备 patrol:review 权限)
  const userRole = Number(reviewer.role || 0);
  const permissions = reviewer.permissions || [];
  const hasRole = userRole >= 3;
  const hasPerm =
    permissions.includes("patrol:review") ||
    permissions.includes("patrol:quality_check") ||
    permissions.includes("admin");

  if (!hasRole && !hasPerm) {
    throw new Error("INSUFFICIENT_REVIEW_PERMISSION: 您无权进行质检复核操作");
  }
}

/**
 * 校验并过滤质检实证图片 (最多支持 9 张)
 */
export function verifyReviewImages(images?: string[]): string[] {
  if (!images || !Array.isArray(images)) {
    return [];
  }

  if (images.length > 9) {
    throw new Error("PARAM_ERROR: 质检复核现场核验图片最多上传 9 张");
  }

  return images
    .filter((img) => typeof img === "string" && img.trim().length > 0)
    .map((img) => img.trim());
}

/**
 * 校验质检审核说明并做防御式规范化
 * 当 isPassed === 0 (驳回) 时，理由必填且 >= 5 字符
 */
export function validateReviewRemark(isPassed: number, remark?: string): string {
  const cleanRemark = (remark || "").trim();

  if (Number(isPassed) === 0) {
    if (cleanRemark.length < 5) {
      throw new Error("REJECT_REASON_REQUIRED: 质检驳回必须填写不合格说明 (至少5个字符)");
    }
    return cleanRemark;
  }

  return cleanRemark.length > 0 ? cleanRemark : "质检合格通过";
}
