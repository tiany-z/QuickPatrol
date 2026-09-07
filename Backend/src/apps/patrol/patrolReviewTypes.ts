/**
 * 高校后勤巡查e速办 v4.0 - M28: 质检复核到场核验与合格/驳回状态机类型契约
 * 严格遵照模块架构设计，覆盖 Table 17 patrols_review 实体定义与 DTO 契约
 */

export enum PatrolReviewPassedEnum {
  REJECTED = 0, // 质检不合格驳回 (工单退回 status=1 施工中进行返工)
  PASSED = 1    // 质检合格通过 (工单晋级 status=3 已结案待评价)
}

/**
 * 数据库 Table 17 patrols_review 物理实体映射
 */
export interface IPatrolReviewEntity {
  id: number;
  schoolId: number;
  patrolId: number;
  reviewerId: number;
  isPassed: number; // 0 或 1
  remark: string;
  imagesJson: string[]; // 质检现场证据照片
  createdAt: string;
}

/**
 * 提交质检复核结果请求载荷 DTO
 */
export interface ISubmitPatrolReviewRequestDto {
  isPassed: number; // 0: 驳回, 1: 合格通过
  remark?: string; // 驳回时必填 (>= 5 字符)；合格时选填 (默认'质检合格通过')
  images?: string[]; // 质检复核核验照片 (0~9 张合规 URL)
}

/**
 * 提交质检复核结果响应载荷 DTO
 */
export interface ISubmitPatrolReviewResponseDto {
  reviewId: number;
  patrolId: number;
  isPassed: number;
  newStatus: number; // 1: 返工处理中; 3: 结案待评价
  reviewedAt: string;
  autoFeedbackScheduledAt?: string; // 若合格通过，记录 7 天后自动好评触发时间
}

/**
 * 质检复核历史单条明细 DTO
 */
export interface IPatrolReviewItemDto {
  id: number;
  schoolId: number;
  patrolId: number;
  reviewerId: number;
  reviewerName?: string;
  isPassed: number;
  remark: string;
  images: string[];
  createdAt: string;
}

/**
 * 质检复核完整历史明细流水响应载荷 DTO
 */
export interface IPatrolReviewHistoryResponseDto {
  patrolId: number;
  totalRounds: number;
  latestStatus: number; // 当前工单最新状态 (1/2/3 等)
  records: IPatrolReviewItemDto[];
}
