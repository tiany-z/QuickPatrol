/**
 * 高校后勤巡查e速办 v4.0 - M30: 九维多身份动作操作权限掩码评估器
 * (Action Permission Mask Evaluator)
 */

import { IPatrolActionPermissions } from "./patrolDetailTypes.js";

export interface IEvaluatorUserContext {
  id: number;
  role: number;
  permissions?: string[];
}

export interface IEvaluatorPatrolTarget {
  status: number;
  creatorId: number;
  currentHandlerId?: number | null;
  deadline?: string | Date;
}

/**
 * 九维动作权限掩码权威动态推导
 */
export function evaluatePatrolActionPermissions(
  currentUser: IEvaluatorUserContext,
  patrol: IEvaluatorPatrolTarget,
  hasFeedback: boolean = false
): IPatrolActionPermissions {
  const userId = Number(currentUser.id || 0);
  const userRole = Number(currentUser.role || 0);
  const permissions = currentUser.permissions || [];

  const isCreator = userId === Number(patrol.creatorId);
  const isHandler = Boolean(patrol.currentHandlerId && userId === Number(patrol.currentHandlerId));
  const isAdmin = userRole >= 3 || permissions.includes("admin");
  const isMaster = userRole >= 2;
  const status = Number(patrol.status);

  const nowMs = Date.now();
  const deadlineMs = patrol.deadline ? new Date(patrol.deadline).getTime() : nowMs + 86400000;

  return {
    // 1. 认领抢单：待派单(status=0)、未分配责任人、维修师傅角色
    canTake: status === 0 && (!patrol.currentHandlerId || Number(patrol.currentHandlerId) === 0) && isMaster,

    // 2. 完工交卷：施工中(status=1) 且必须为接单责任师傅
    canHandle: status === 1 && isHandler,

    // 3. 工期顺延：施工中(status=1) 且必须为接单责任师傅
    canDelay: status === 1 && isHandler,

    // 4. 同组转派：施工中(status=1) 且必须为接单责任师傅
    canTransfer: status === 1 && isHandler,

    // 5. 协同聊天：工单已激活(status>=1) 且属于提报人、接单师傅或后勤管理员
    canChat: status >= 1 && (isCreator || isHandler || isAdmin),

    // 6. 质检验收：待复核(status=2) 且严格落实审修分离(非施工师傅) 且具备质检角色/权限
    canReview: status === 2 && !isHandler && (isAdmin || permissions.includes("patrol:review")),

    // 7. 服务评价：已办结(status=3) 且必须为原提报师生 且尚未完成评价
    canFeedback: status === 3 && isCreator && !hasFeedback,

    // 8. 作废废单：工单尚未办结(status<3) 且为管理员或责任师傅
    canAbort: status < 3 && (isAdmin || (isHandler && status === 1)),

    // 9. 催办督办：工单未办结(status<3) 且为原提报人 且当前时间距承诺截止时间不足2小时或已超时
    canUrge: status < 3 && isCreator && nowMs > deadlineMs - 7200 * 1000
  };
}
