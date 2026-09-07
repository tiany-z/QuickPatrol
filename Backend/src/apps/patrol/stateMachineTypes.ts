/**
 * 高校后勤巡查e速办 v4.0 - M24: 师傅现场抢修工作台与接单协同状态机类型契约
 * (Master Desk & Patrol State Machine Types)
 */

/**
 * 工单全生命周期核心状态枚举 (对应 patrols.status)
 */
export enum PatrolStatusEnum {
  PENDING = 0,      // 待处理 (抢单池待抢 / 直派待出发)
  IN_PROGRESS = 1,  // 处理中 (已接单，现场抢修施工中)
  UNDER_REVIEW = 2, // 已整改待复核 (师傅已拍照交卷，待质检验收)
  COMPLETED = 3,    // 已办结 (质检专家复核合格)
  CLOSED = 4,       // 已评价结案 (师生完成评价或超时好评归档)
  REWORK = 5        // 复核驳回重新施工 (质检不合格，返回整改)
}

/**
 * 状态机单向流转上下文
 */
export interface IPatrolStateTransitionContext {
  schoolId: number;
  patrolId: number;
  operatorId: number;                     // 触发操作人 UID
  fromStatus: PatrolStatusEnum;           // 期望前置状态
  toStatus: PatrolStatusEnum;             // 目标跃迁状态
  actionName: string;                     // 触发动作 (如: "ACCEPT_CLAIM", "SUBMIT_HANDLE")
  remark?: string;                        // 批注说明
}

/**
 * 师傅接单/抢单请求体契约
 */
export interface IAcceptPatrolRequest {
  patrolId: number;                       // 目标工单 ID
  acceptSource: "TASK_POOL" | "DIRECT_ASSIGNED"; // 来源: 抢单池竞态认领 或 直派直接接单
}

/**
 * 师傅接单成功响应 DTO
 */
export interface IAcceptPatrolResponseDto {
  isSuccess: boolean;
  patrolId: number;
  orderNo: string;
  previousStatus: PatrolStatusEnum;
  currentStatus: PatrolStatusEnum.IN_PROGRESS; // 跃迁至 1
  handlerId: number;                      // 接单师傅 UID
  handlerName: string;                    // 接单师傅姓名
  acceptedAt: string;                     // 接单时间戳 (ISO8601)
  deadline: string;                       // 处理截止倒计时
}

/**
 * 协同改派与转交请求传输对象
 */
export interface ITransferPatrolRequest {
  patrolId: number;
  transferType: "CATEGORY_MISMATCH" | "PEER_HANDOVER"; // CATEGORY_MISMATCH=工种不符改派, PEER_HANDOVER=同组转交
  newCategoryId?: number;                 // 工种不符时重选的新门类 ID
  targetPeerUserId?: number;              // 同组转交时的指定同事 UID
  reason: string;                         // 改派/转交详细客观原因 (必填，>= 5字)
  evidencePhotos?: string[];              // 现场勘验照片凭据 (改派时提供)
}

/**
 * 改派与转交处理结果 DTO
 */
export interface ITransferPatrolResponseDto {
  isSuccess: boolean;
  patrolId: number;
  orderNo: string;
  transferType: "CATEGORY_MISMATCH" | "PEER_HANDOVER";
  message: string;
  newStatus: PatrolStatusEnum;            // 改派重置为 0，同组转交保持为 1
  newHandlerName: string;                 // 新责任人或 "重新派单中..."
  transferCount: number;                  // 累计改派次数
}

/**
 * 师傅工作台四象限未读统计卡片模型
 */
export interface IMasterWorkbenchSummaryDto {
  poolCount: number;                      // 抢单池待认领数量 (currentHandlerId = 0 AND status = 0)
  assignedCount: number;                  // 待出发/直派待接数量 (currentHandlerId = Me AND status = 0)
  inProgressCount: number;                // 施工进行中数量 (currentHandlerId = Me AND status = 1)
  reviewCount: number;                    // 已完工待质检数量 (currentHandlerId = Me AND status = 2)
}

/**
 * 师傅工作台单项任务卡片模型
 */
export interface IMasterTaskCardDto {
  id: number;
  orderNo: string;
  title: string;
  desc: string;
  categoryId: number;
  categoryName: string;
  campusId: number;
  campusName: string;
  location: string;
  priorityLevel: 0 | 1 | 2;
  status: PatrolStatusEnum;
  statusText: string;
  createdAt: string;
  deadline: string;
  remainingHours: number;                 // 距离逾期剩余小时数 (负数表示已逾期)
  isUrgentNotice: boolean;                // 是否红色高亮置顶 (SLA 紧急加权 >= 85)
  slaScore: number;                       // SLA 动态加权分
  images: string[];
  creatorName: string;
}

/**
 * 工作台列表查询入参契约
 */
export interface IMasterWorkbenchQueryDto {
  tab: "pool" | "assigned" | "inProgress" | "review";
  page?: number;
  pageSize?: number;
  campusId?: number;
  categoryId?: number;
}
