/**
 * 高校后勤巡查e速办 v4.0 - M27: 现场施工整改交卷与 Saga 逆序补偿领域类型契约
 * (Patrol Handle & Saga Rollback Types & Contracts)
 */

/**
 * 物理表 patrols_handle (表 16) 强类型实体契约
 */
export interface IPatrolHandleEntity {
  /** 整改记录主键ID (自增) */
  id: number;
  /** 所属学校ID (租户隔离) */
  schoolId: number;
  /** 关联工单主表ID (逻辑关联 patrols.id) */
  patrolId: number;
  /** 实际施工师傅用户ID (逻辑关联 users.id) */
  handlerId: number;
  /** 整改措施及现场处理过程详细说明 */
  content: string;
  /** 完工现场照片相对路径列表 (JSON Array / 字符串数组) */
  imagesJson: string[];
  /** 本次整改实际消耗工时 (单位: 小时, DECIMAL(6,2)) */
  durationHours: number;
  /** 提交整改时间戳 ISO8601 */
  createdAt: string;
}

/**
 * 师傅提交完工交卷请求载荷 DTO
 */
export interface ISubmitPatrolHandleRequestDto {
  /** 工单ID (可选，若URL已包含) */
  patrolId?: number;
  /** 施工整改措施说明 (必填, 5~1000 字符) */
  content: string;
  /** 现场实拍照片 URL 列表 (1~9 张) */
  images: string[];
  /** 实际施工耗时 (小时, 范围 0.1 ~ 120.0) */
  durationHours: number;
}

/**
 * 师傅完工交卷响应 DTO
 */
export interface ISubmitPatrolHandleResponseDto {
  /** 生成的整改记录ID */
  handleId: number;
  /** 工单ID */
  patrolId: number;
  /** 工单跃迁后的最新状态 (固定为 2: 已整改待复核) */
  status: number;
  /** 状态描述文本 */
  statusText: string;
  /** 完工提交时间 ISO8601 */
  submittedAt: string;
}

/**
 * 单条整改历史视图项
 */
export interface IPatrolHandleItemDto {
  handleId: number;
  handlerId: number;
  handlerName: string;
  handlerPhone: string;
  content: string;
  images: string[];
  durationHours: number;
  createdAt: string;
}

/**
 * 工单施工整改历史聚合大盘 DTO
 */
export interface IPatrolHandleHistoryResponseDto {
  patrolId: number;
  /** 累计施工轮次 */
  totalRounds: number;
  /** 累计总维修工时 (小时) */
  cumulativeDurationHours: number;
  /** 施工流水列表 (按 ID 倒序排列，首项为最新一次交卷) */
  records: IPatrolHandleItemDto[];
}

/**
 * M27 完工交卷 Saga 回滚上下文载荷
 */
export interface IPatrolHandleSagaContext {
  schoolId: number;
  patrolId: number;
  handleId: number;
  originalStatus: number;
  handlerId: number;
}
