/**
 * M17: Flow Lock 业务连续性防错熔断数据契约与接口定义
 */

export interface IFlowLockProbeTarget {
  schoolId: number;
  targetType: "user" | "department" | "tag" | "permission_matrix";
  targetId: number;
  targetName?: string;
}

export interface IActivePatrolProbeResult {
  hasActivePatrols: boolean;
  activeCount: number;
  samplePatrols: Array<{
    id: number;
    orderNo: string;
    title: string;
    status: number;
    priority: number;
    createdAt: string;
  }>;
}

export interface IBlockedWorkOrderSummary {
  patrolId: number;
  orderNo: string;
  title: string;
  status: number;
  statusText: string;
  priority: number;
  priorityText: string;
  createdAt: string;
}

export interface IFlowLockCheckResult {
  isBlocked: boolean;
  schoolId: number;
  targetType: string;
  targetId: number;
  activeCount: number;
  message: string;
  blockedOrders: IBlockedWorkOrderSummary[];
}

export interface IBusinessLockContext {
  targetType: "user" | "department" | "tag" | "category" | "permission_matrix";
  targetId: number;
  targetName: string;
  activeWorkOrderCount?: number;
  activeCount?: number;
  sampleWorkOrders?: Array<{
    id: number;
    orderNo: string;
    title: string;
    statusText: string;
  }>;
  blockedOrders?: IBlockedWorkOrderSummary[];
  suggestedAction?: string;
  redirectRoute?: string;
  handoverUrl?: string;
}

export interface IBusinessLockErrorDto {
  success: false;
  code: 409;
  errorCode: "FLOW_LOCK_BLOCKED";
  message: string;
  data: IBusinessLockContext;
}
