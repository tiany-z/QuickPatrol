/**
 * M17: Flow Lock 熔断探针中间件与切面守卫
 * (Flow Lock Circuit Breaker Interceptor)
 * 
 * 核心功能：
 * 在用户停用/删除、部门撤销、岗位标签注销等高危破坏性操作执行前，
 * 触发拉网式在办工单排查。一旦发现关联在办单据，强力抛出 BusinessLockException (HTTP 409)
 */

import { FlowLockEngine } from "../shared/flow/flowLockEngine.js";
import { BusinessLockException } from "../apps/org/orgException.js";
import { TerminalLogger } from "../shared/index.js";
import { IBlockedWorkOrderSummary } from "../shared/flow/flowLockTypes.js";

const STATUS_TEXTS: Record<number, string> = {
  0: "待派发",
  1: "处理中",
  2: "待复核",
  3: "已办结",
  4: "已驳回注销"
};

const PRIORITY_TEXTS: Record<number, string> = {
  0: "普通",
  1: "加急",
  2: "特急"
};

export class FlowLockInterceptor {
  /**
   * 拦截员工停用/删除高危操作
   */
  public static async interceptUserDestruction(
    schoolId: number,
    targetUserId: number,
    userName?: string
  ): Promise<void> {
    const probe = await FlowLockEngine.probeUserActivePatrols(schoolId, targetUserId);

    if (probe.hasActivePatrols) {
      TerminalLogger.warn(
        `[M17 熔断触发] 用户 [${targetUserId} - ${userName || "员工"}] 名下尚有 ${probe.activeCount} 张在办工单，已成功拦截破坏性操作!`,
        "FlowLock"
      );

      const blockedOrders: IBlockedWorkOrderSummary[] = probe.samplePatrols.map((p) => ({
        patrolId: p.id,
        orderNo: p.orderNo,
        title: p.title,
        status: p.status,
        statusText: STATUS_TEXTS[p.status] || "在办中",
        priority: p.priority,
        priorityText: PRIORITY_TEXTS[p.priority] || "普通",
        createdAt: p.createdAt
      }));

      const sampleWorkOrders = probe.samplePatrols.map((p) => ({
        id: p.id,
        orderNo: p.orderNo,
        title: p.title,
        statusText: STATUS_TEXTS[p.status] || "在办中"
      }));

      const redirectRoute = "/packages/apps/app-org-center/pages/tag-management/index";

      throw new BusinessLockException(
        `该员工名下当前尚有 ${probe.activeCount} 张在办巡查工单正在流转，严禁停用！`,
        {
          targetType: "user",
          targetId: targetUserId,
          targetName: userName || `员工_${targetUserId}`,
          activeCount: probe.activeCount,
          activeWorkOrderCount: probe.activeCount,
          sampleWorkOrders,
          blockedOrders,
          suggestedAction: "请先在【岗位标签中心】将该员工持有的职能标签一键转移给接班人员后再执行停用",
          redirectRoute,
          handoverUrl: redirectRoute
        }
      );
    }
  }

  /**
   * 拦截部门撤销/注销操作 (基于物化路径穿透全子树)
   */
  public static async interceptDepartmentDestruction(
    schoolId: number,
    departmentId: number,
    deptName?: string
  ): Promise<void> {
    const probe = await FlowLockEngine.probeDepartmentSubtreeActivePatrols(schoolId, departmentId);

    if (probe.hasActivePatrols) {
      TerminalLogger.warn(
        `[M17 熔断触发] 部门 [${departmentId} - ${deptName || "科室"}] 及其下属子孙节点尚有 ${probe.activeCount} 张工单未结，阻断撤销!`,
        "FlowLock"
      );

      const blockedOrders: IBlockedWorkOrderSummary[] = probe.samplePatrols.map((p) => ({
        patrolId: p.id,
        orderNo: p.orderNo,
        title: p.title,
        status: p.status,
        statusText: STATUS_TEXTS[p.status] || "在办中",
        priority: p.priority,
        priorityText: PRIORITY_TEXTS[p.priority] || "普通",
        createdAt: p.createdAt
      }));

      const sampleWorkOrders = probe.samplePatrols.map((p) => ({
        id: p.id,
        orderNo: p.orderNo,
        title: p.title,
        statusText: "在办中"
      }));

      const redirectRoute = "/packages/apps/app-org-center/pages/org-tree/index";

      throw new BusinessLockException(
        `该部门及其下属班组名下仍有 ${probe.activeCount} 张未完结工单，严禁删除！`,
        {
          targetType: "department",
          targetId: departmentId,
          targetName: deptName || `部门_${departmentId}`,
          activeCount: probe.activeCount,
          activeWorkOrderCount: probe.activeCount,
          sampleWorkOrders,
          blockedOrders,
          suggestedAction: "请先将相关科室名下的在办工单整体改派移交至其他保障部门",
          redirectRoute,
          handoverUrl: redirectRoute
        }
      );
    }
  }

  /**
   * 拦截岗位职能标签注销操作
   */
  public static async interceptTagDestruction(
    schoolId: number,
    tagId: number,
    tagName?: string
  ): Promise<void> {
    const probe = await FlowLockEngine.probeTagActivePatrols(schoolId, tagId);

    if (probe.hasActivePatrols) {
      TerminalLogger.warn(
        `[M17 熔断触发] 岗位标签 [${tagId} - ${tagName || "标签"}] 名下仍有 ${probe.activeCount} 张在办工单，阻断注销!`,
        "FlowLock"
      );

      const blockedOrders: IBlockedWorkOrderSummary[] = probe.samplePatrols.map((p) => ({
        patrolId: p.id,
        orderNo: p.orderNo,
        title: p.title,
        status: p.status,
        statusText: STATUS_TEXTS[p.status] || "在办中",
        priority: p.priority,
        priorityText: PRIORITY_TEXTS[p.priority] || "普通",
        createdAt: p.createdAt
      }));

      const sampleWorkOrders = probe.samplePatrols.map((p) => ({
        id: p.id,
        orderNo: p.orderNo,
        title: p.title,
        statusText: "在办中"
      }));

      const redirectRoute = "/packages/apps/app-org-center/pages/tag-management/index";

      throw new BusinessLockException(
        `岗位标签 [${tagName || tagId}] 名下仍有 ${probe.activeCount} 张在办工单，必须先结案或改签后方可注销！`,
        {
          targetType: "tag",
          targetId: tagId,
          targetName: tagName || `标签_${tagId}`,
          activeCount: probe.activeCount,
          activeWorkOrderCount: probe.activeCount,
          sampleWorkOrders,
          blockedOrders,
          suggestedAction: "请先将挂靠在该岗位名下的工单移交其他标签",
          redirectRoute,
          handoverUrl: redirectRoute
        }
      );
    }
  }
}
