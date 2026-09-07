/**
 * M23: 智能网格派单与职能标签广播匹配强类型数据契约
 * (Grid Dispatch & Auto-Routing Domain Types)
 */

/**
 * 智能网格派单引擎决策输出模型
 */
export interface IDispatchDecisionResult {
  patrolId: number;                       // 工单主键 ID
  orderNo: string;                        // 工单流水编号 (如: LCU-20260905-0001)
  dispatchMode: 'DIRECT_USER' | 'TAG_POOL' | 'ORPHAN_FALLBACK'; // 调度模式
  assignedUserId: number;                 // 最终确定的承接师傅 ID (若为抢单池模式则为 0)
  assignedUserName: string;               // 师傅姓名 (或 "公共抢单池 (xxx)")
  targetTagId?: number;                   // 命中的岗位职能标签 ID
  targetTagName?: string;                 // 命中的岗位职能标签名称 (如: "水暖应急抢险班")
  matchedRuleLevel: 0 | 1 | 2 | 3;        // 命中的特异性得分 (3专属, 2校区, 1分类, 0兜底)
  candidateUserIds: number[];             // 本次通知触达的所有候选在岗师傅 UID 列表
  dispatchedAt: string;                   // 决策完成绝对时间戳 (ISO8601)
  isFallback: boolean;                    // 是否触发了防漏单自愈兜底
  fallbackReason?: string;                // 兜底触发原因说明
}

/**
 * 管理员手动指定派单请求
 */
export interface IManualDispatchRequest {
  patrolId: number;                       // 工单 ID
  targetUserId: number;                   // 指定责任师傅 ID
  assignRemark?: string;                  // 派单批注说明
}

/**
 * 师傅协同改派/转派申请请求
 */
export interface IReassignRequest {
  patrolId: number;
  targetTagId?: number;                   // 跨工种转给新岗位标签
  targetUserId?: number;                  // 转给指定同事
  transferReason: string;                 // 申请改派/转派原因
}

/**
 * 推送至师傅手机端 WebSocket 消息体
 */
export interface IDispatchWsBroadcastPayload {
  event: 'WORK_ORDER_DISPATCHED';
  schoolId: number;
  patrolId: number;
  orderNo: string;
  title: string;
  campusName: string;
  location: string;
  categoryName: string;
  priorityLevel: 0 | 1 | 2;
  deadline: string;
  dispatchType: 'DIRECT' | 'POOL_BROADCAST'; // DIRECT=直派给你, POOL_BROADCAST=公共抢单
  vibratePattern: 'heavy' | 'medium';     // 震动级别 (加急重度, 普通中度)
  soundAlert: boolean;                    // 是否播放警报音
}

/**
 * 维修师傅在办负荷评估快照
 */
export interface IHandlerWorkloadSnapshot {
  userId: number;
  realName: string;
  activeWorkOrderCount: number;           // 未结案工单总数 (status 1, 2)
  urgentOrderCount: number;               // 其中特急工单数 (priorityLevel = 2)
  weightedScore: number;                  // 加权综合负荷得分
  lastAssignedTimestamp: number;          // 上次派单时间戳
}
