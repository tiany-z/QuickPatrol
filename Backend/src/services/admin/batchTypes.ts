/**
 * M19: 移动端用户批量调度与运维审计日志强类型契约定义
 * (Batch Management & Audit Logs Type Contracts)
 */

export interface IOperationLogEntity {
  id: number;
  schoolId: number;
  userId: number; // 操作人 UID
  action: string; // 动作大写枚举: BATCH_SET_DEPARTMENT, BATCH_SET_ROLE, BATCH_BAN_USERS, BATCH_UNBAN_USERS 等
  module: "User" | "Department" | "Tag" | "Permission" | "Patrol" | "AI";
  ip: string;
  payloadJson: string; // JSON 快照
  createdAt: string;
}

export type BatchActionType = "SET_DEPARTMENT" | "SET_ROLE" | "BAN_USERS" | "UNBAN_USERS";

export interface IBatchUpdateUsersRequest {
  targetUserIds: number[];
  actionType: BatchActionType;
  departmentId?: number; // 当 actionType 为 SET_DEPARTMENT 时必填
  role?: number;         // 当 actionType 为 SET_ROLE 时必填
  mode?: "strict" | "resilient"; // strict 强原子回滚 | resilient 容错剪枝 (默认)
  reason?: string;
}

export interface IBlockedUserDetailDto {
  userId: number;
  userName: string;
  activeWorkOrderCount: number;
  reason: string;
}

export interface IBatchUpdateResultDto {
  totalRequested: number;
  successCount: number;
  blockedCount: number;
  affectedUserIds: number[];
  blockedUsers: IBlockedUserDetailDto[];
  auditLogId: number;
}

export interface IAuditLogQueryDto {
  module?: string;
  action?: string;
  operatorUserId?: number;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export interface IAuditLogItemDto {
  logId: number;
  schoolId: number;
  operator: {
    userId: number;
    realName: string;
    phone: string;
  };
  action: string;
  actionDesc?: string;
  module: string;
  ip: string;
  payload: any;
  createdAt: string;
}

export interface IEntityDiff {
  entityId: number;
  changes: Record<string, { before: any; after: any }>;
}

export interface IAuditDiffPayload {
  affectedCount: number;
  affectedUserIds: number[];
  changes: Record<string, any>;
  diffs?: IEntityDiff[];
  reason?: string;
  blockedCount: number;
  blockedList: IBlockedUserDetailDto[];
}

export interface IBatchSelectState {
  isBatchMode: boolean;
  count: number;
}

export type BatchSelectListener = (state: IBatchSelectState) => void;

export class BatchSelectStore {
  private isBatchMode: boolean = false;
  private selectedIds: Set<number> = new Set();
  private listeners: BatchSelectListener[] = [];

  public enterBatchMode(initialUserId?: number): void {
    this.isBatchMode = true;
    this.selectedIds.clear();
    if (initialUserId !== undefined && initialUserId !== null) {
      this.selectedIds.add(initialUserId);
    }
    this.notify();
  }

  public exitBatchMode(): void {
    this.isBatchMode = false;
    this.selectedIds.clear();
    this.notify();
  }

  public toggleSelect(userId: number): void {
    if (this.selectedIds.has(userId)) {
      this.selectedIds.delete(userId);
      if (this.selectedIds.size === 0) {
        this.exitBatchMode();
        return;
      }
    } else {
      this.selectedIds.add(userId);
    }
    this.notify();
  }

  public selectAll(allUserIds: number[]): void {
    this.selectedIds = new Set(allUserIds);
    this.isBatchMode = true;
    this.notify();
  }

  public clearSelection(): void {
    this.selectedIds.clear();
    this.notify();
  }

  public getSelectedUserIds(): number[] {
    return Array.from(this.selectedIds);
  }

  public getSelectedCount(): number {
    return this.selectedIds.size;
  }

  public isBatchModeActive(): boolean {
    return this.isBatchMode;
  }

  public isUserSelected(userId: number): boolean {
    return this.selectedIds.has(userId);
  }

  public subscribe(fn: BatchSelectListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private notify(): void {
    const state: IBatchSelectState = {
      isBatchMode: this.isBatchMode,
      count: this.selectedIds.size
    };
    for (const fn of this.listeners) {
      fn(state);
    }
  }
}

