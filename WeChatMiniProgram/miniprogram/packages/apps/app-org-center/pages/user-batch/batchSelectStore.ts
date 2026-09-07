/**
 * M19: 微信小程序端长按手势多选与浮动操作岛状态机 (Batch Select Store)
 * 
 * 核心交互特性：
 * 1. 长按 350ms 触感震动反馈并进入多选模式 (Batch Mode)
 * 2. 动态维护选中的用户 ID 集合 (Set<number>)
 * 3. 支持反选、全选、一键清空与自动退出
 * 4. 观察者订阅模式，支持浮动操作岛组件响应式感知数量与显隐
 */

export interface IBatchSelectState {
  isBatchMode: boolean;
  count: number;
}

export type BatchSelectListener = (state: IBatchSelectState) => void;

export class BatchSelectStore {
  private isBatchMode: boolean = false;
  private selectedIds: Set<number> = new Set();
  private listeners: BatchSelectListener[] = [];

  /**
   * 进入多选模式 (可携带触发长按的首个用户)
   */
  public enterBatchMode(initialUserId?: number): void {
    this.isBatchMode = true;
    this.selectedIds.clear();
    if (initialUserId !== undefined && initialUserId !== null) {
      this.selectedIds.add(initialUserId);
    }
    this.notify();
  }

  /**
   * 退出多选模式并清空选中态
   */
  public exitBatchMode(): void {
    this.isBatchMode = false;
    this.selectedIds.clear();
    this.notify();
  }

  /**
   * 切换指定人员的勾选状态
   * 若反选后已选人数为 0，自动安全退出多选态
   */
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

  /**
   * 全选列表中的全部人员
   */
  public selectAll(allUserIds: number[]): void {
    this.selectedIds = new Set(allUserIds);
    this.isBatchMode = true;
    this.notify();
  }

  /**
   * 清除所有选中项（但不一定退出多选态）
   */
  public clearSelection(): void {
    this.selectedIds.clear();
    this.notify();
  }

  /**
   * 获取当前已选人员 ID 数组
   */
  public getSelectedUserIds(): number[] {
    return Array.from(this.selectedIds);
  }

  /**
   * 获取当前已选人员数量
   */
  public getSelectedCount(): number {
    return this.selectedIds.size;
  }

  /**
   * 判断当前是否处于多选模式
   */
  public isBatchModeActive(): boolean {
    return this.isBatchMode;
  }

  /**
   * 判断指定用户是否已被选中
   */
  public isUserSelected(userId: number): boolean {
    return this.selectedIds.has(userId);
  }

  /**
   * 订阅状态变更通知
   */
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

export const batchSelectStore = new BatchSelectStore();
