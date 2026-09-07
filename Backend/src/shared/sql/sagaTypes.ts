/**
 * 分布式行锁状态数据载荷
 */
export interface RowLockState {
  schoolId: number;
  table: string;
  id: string | number;
  lockType: "UPDATE" | "DELETE";
  ownerRequestId: string;
  lockedAt: number;
}

/**
 * 行锁释放广播状态枚举
 */
export type UnlockStatus =
  | "COMMITTED_UPDATE"
  | "COMMITTED_DELETE"
  | "ROLLED_BACK"
  | "TIMEOUT";

/**
 * 等待行锁结果
 */
export interface LockWaitResult {
  unlocked: boolean;
  finalStatus: UnlockStatus;
}

/**
 * 托管在请求上下文中的行锁记录存根
 */
export interface LockedRowStub {
  schoolId?: number;
  tableName: string;
  targetId: string | number;
  requestId: string;
}

/**
 * Saga 反向补偿撤销闭包函数定义
 */
export type SagaUndoClosure = () => Promise<void>;

/**
 * 独立 Saga 撤销栈容器契约接口
 */
export interface ISagaWithdrawStack {
  /** 压入一个反向补偿闭包 */
  push(closure: SagaUndoClosure): void;
  /** 获取当前栈中累积的闭包数量 */
  size(): number;
  /** LIFO 逆序出栈并执行所有补偿闭包 */
  withdrawAll(): Promise<void>;
  /** 清空栈中所有闭包 */
  clear(): void;
}
