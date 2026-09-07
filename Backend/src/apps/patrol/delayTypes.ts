/**
 * 高校后勤巡查e速办 v4.0 - M26: 多次动态延期申请与多级审批流实体契约与传输契约
 * (Patrol Delay Approval & Lifecycle Extension Types)
 */

/**
 * 延期申请审批状态枚举
 */
export enum PatrolDelayStatusEnum {
  /** 0: 待审核 (在审态) */
  PENDING = 0,
  /** 1: 已同意延期 (顺延生效) */
  APPROVED = 1,
  /** 2: 已驳回申请 (维持原状) */
  REJECTED = 2,
}

/**
 * patrol_delay_records 物理表实体契约 (表 19)
 */
export interface IPatrolDelayRecordEntity {
  /** 延期申请ID (主键自增) */
  id: number;
  /** 所属学校ID (租户隔离) */
  schoolId: number;
  /** 关联工单主表ID (逻辑关联 patrols.id) */
  patrolId: number;
  /** 申请责任人ID (逻辑关联 users.id) */
  applicantId: number;
  /** 申请延期客观详细原因 (文字陈述 + 图文凭证快照 JSON) */
  reason: string;
  /** 申请延期时长 (单位: 小时, CHECK > 0) */
  delayHours: number;
  /** 原处理截止时限 (ISO / Date) */
  oldDeadline: string;
  /** 申请目标截止时限 (ISO / Date) */
  newDeadline: string;
  /** 审批状态: 0待审核, 1已同意, 2已驳回 */
  status: PatrolDelayStatusEnum;
  /** 审批人ID (学校管理员 users.id, 初始为 0) */
  reviewerId: number;
  /** 审批意见批注 (最大256字符) */
  reviewRemark: string;
  /** 审批时间 (DATETIME, 初始为 null) */
  reviewedAt: string | null;
  /** 申请发起时间 (DATETIME) */
  createdAt: string;
}

/**
 * 师傅端发起延期申请 DTO
 */
export interface ICreateDelayApplyRequestDto {
  /** 工单ID */
  patrolId: number;
  /** 申请延期时长 (单位: 小时, 范围: 1 ~ 168) */
  delayHours: number;
  /** 申请延期的客观详细原因 */
  reason: string;
  /** 现场客观佐证照片 (OSS相对路径列表, 最多 6 张) */
  evidenceImages?: string[];
}

/**
 * 延期申请创建成功响应 DTO
 */
export interface ICreateDelayApplyResponseDto {
  /** 生成的延期申请记录ID */
  applyId: number;
  /** 工单ID */
  patrolId: number;
  /** 申请状态 (0: 待审核) */
  status: PatrolDelayStatusEnum;
  /** 原截止时间 ISO8601 */
  oldDeadline: string;
  /** 预期目标截止时间 ISO8601 */
  predictedDeadline: string;
  /** 申请创建时间 */
  createdAt: string;
}

/**
 * 管理员端审核延期申请 DTO
 */
export interface IReviewDelayApplyRequestDto {
  /** 申请ID */
  applyId: number;
  /** 审批动作: 1同意延期, 2驳回延期 */
  action: PatrolDelayStatusEnum.APPROVED | PatrolDelayStatusEnum.REJECTED;
  /** 审批意见批注 (驳回时必填, 最长 256 字符) */
  reviewRemark: string;
}

/**
 * 审核处理成功响应 DTO
 */
export interface IReviewDelayApplyResponseDto {
  /** 延期申请记录ID */
  applyId: number;
  /** 工单ID */
  patrolId: number;
  /** 最终审批状态 (1: 同意, 2: 驳回) */
  finalStatus: PatrolDelayStatusEnum;
  /** 工单生效的最新截止时间 ISO8601 */
  effectiveDeadline: string;
  /** 审批人姓名 */
  reviewerName: string;
  /** 审批时间 ISO8601 */
  reviewedAt: string;
}

/**
 * 单条延期审批历史明细视图对象
 */
export interface IPatrolDelayItemDto {
  applyId: number;
  applicantId: number;
  applicantName: string;
  applicantPhone: string;
  reason: string;
  evidenceImages: string[];
  delayHours: number;
  oldDeadline: string;
  newDeadline: string;
  status: PatrolDelayStatusEnum;
  statusText: string;
  reviewerId: number;
  reviewerName: string;
  reviewRemark: string;
  reviewedAt: string | null;
  createdAt: string;
}

/**
 * 某工单全量延期历史聚合指标 DTO
 */
export interface IPatrolDelayHistoryResponseDto {
  patrolId: number;
  /** 历史申请总次数 */
  totalApplyCount: number;
  /** 成功获批次数 */
  approvedCount: number;
  /** 累计顺延总工期 (单位: 小时) */
  cumulativeDelayHours: number;
  /** 是否存在正在审批中的记录 */
  hasPendingApply: boolean;
  /** 历史延期申请流水列表 (按创建时间倒序) */
  records: IPatrolDelayItemDto[];
}

/**
 * 穿透至 M25 即时聊天室的工单延期系统卡片载荷
 */
export interface IDelayChatCardPayload {
  cardType: "DELAY_APPROVED" | "DELAY_REJECTED";
  patrolId: number;
  patrolTitle: string;
  delayHours: number;
  newDeadlineFormatted: string;
  reason: string;
  reviewerName: string;
  reviewRemark: string;
  timestamp: number;
}
