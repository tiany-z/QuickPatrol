/**
 * 高校后勤巡查e速办 v4.0 - M30: 巡查工单综合大宽表视图与全景详情对比轴类型契约
 * 严格遵照 v_patrol_details 预编译视图与九维操作权限掩码规范定义
 */

/**
 * v_patrol_details 只读视图 1:1 强类型契约 (视图 V01)
 */
export interface IVPatrolDetailEntity {
  patrolId: number;
  orderNo: string;
  schoolId: number;
  schoolName: string;
  schoolCode: string;
  campusId: number;
  campusName: string;
  categoryId: number;
  categoryName: string;
  creatorId: number;
  creatorRealName: string;
  creatorPhone: string;
  currentHandlerId: number;
  handlerRealName: string | null;
  handlerPhone: string | null;
  title: string;
  desc: string;
  location1: string;
  location2: string;
  status: number;
  priorityLevel: number;
  isPublic: number;
  deadline: string | Date;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/**
 * 九维多身份动态操作权限掩码契约
 */
export interface IPatrolActionPermissions {
  /** 1. 是否允许抢单认领 (当前为待接单 status=0 且无责任人且师傅角色) */
  canTake: boolean;
  /** 2. 是否允许提交现场完工交卷 (当前为施工中 status=1 且为责任师傅) */
  canHandle: boolean;
  /** 3. 是否允许申请工期顺延 (当前为施工中 status=1 且为责任师傅) */
  canDelay: boolean;
  /** 4. 是否允许申请同组转派改派 (当前为施工中 status=1 且为责任师傅) */
  canTransfer: boolean;
  /** 5. 是否允许进入即时协同聊天室 (status>=1 且当事双方或管理员) */
  canChat: boolean;
  /** 6. 是否允许执行质量复核验收 (status=2 且落实审修分离非责任师傅且具备质检权限) */
  canReview: boolean;
  /** 7. 是否允许提交服务满意度评价 (status=3 且为原提报人且尚未评价) */
  canFeedback: boolean;
  /** 8. 是否允许将工单作废/申请作废 (status<3 且管理员或责任师傅) */
  canAbort: boolean;
  /** 9. 是否允许发起催办督办 (status<3 且原提报人且临近超时2小时内) */
  canUrge: boolean;
}

/**
 * 施工修复前后实拍双图模型
 */
export interface IBeforeAfterPairDto {
  hasPair: boolean;
  beforeImageUrl: string;
  afterImageUrl: string;
}

/**
 * 全息生命周期时间轴单节点模型
 */
export interface IPatrolTimelineNodeDto {
  stageKey: string; // 'CREATED' | 'ACCEPTED' | 'DELAYED' | 'HANDLED' | 'REVIEWED' | 'FEEDBACK' | 'ABORTED'
  title: string;
  timestamp: string;
  operatorName: string;
  summaryText: string;
}

/**
 * 工单全景详情一站式秒开响应载荷 DTO
 */
export interface IPatrolPanoramicDetailDto {
  patrolId: number;
  orderNo: string;
  schoolId: number;
  schoolName: string;
  campusName: string;
  categoryName: string;
  title: string;
  desc: string;
  location: string;
  status: number;
  statusText: string;
  priorityLevel: number;
  priorityText: string;
  deadline: string;
  createdAt: string;

  /** 提报人与接单师傅信息 (按角色权限脱敏) */
  creator: {
    id: number;
    name: string;
    phone: string;
  };
  handler: {
    id: number;
    name: string;
    phone: string;
  } | null;

  /** 九维动态操作权限掩码 */
  permissions: IPatrolActionPermissions;

  /** 施工前后对比图模型 */
  visualPair: IBeforeAfterPairDto;

  /** 原始提报照片集合 */
  images: string[];

  /** 全息全流程时间轴 */
  timeline: IPatrolTimelineNodeDto[];

  /** 关联子流水计数与标志 */
  delayRecordsCount: number;
  handleRoundsCount: number;
  reviewRoundsCount: number;
  hasFeedback: boolean;
}

/**
 * 异常废单作废请求载荷 DTO
 */
export interface IAbortPatrolRequestDto {
  /** 作废客观原因说明 (至少 5 字符) */
  reason: string;
}

/**
 * 异常废单作废响应载荷 DTO
 */
export interface IAbortPatrolResponseDto {
  patrolId: number;
  status: number; // 4: 已废弃
  statusText: string;
  abortedAt: string;
}
