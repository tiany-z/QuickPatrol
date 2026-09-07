/**
 * M08: 顶部沉浸式导航与左侧多单位切换抽屉 (Navbar & Tenant Drawer)
 * 后端共享契约与核心算法映射实现 (与小程序端 100% 同构对齐)
 */

export type TenantSessionStatus = "active" | "valid" | "expired";

export interface DeviceAccountRecord {
  schoolId: number;
  schoolName: string;
  schoolCode: string;
  logoUrl: string;
  campusName: string;
  boundPhone: string;
  userId: number;
  realName: string;
  workNo?: string;
  role: number;
  roleName: string;
  token: string;
  tokenExpireAt: string;
  isExpired: boolean;
  sessionStatus: TenantSessionStatus;
  unreadCount?: number;
  lastLoginAt: string;
}

export interface TenantStatusItem {
  schoolId: number;
  schoolName: string;
  campusName: string;
  isExpired: boolean;
  unreadCount: number;
  isActiveTenant: boolean;
  themeColorHsl?: { h: number; s: number; l: number };
}

export interface DeviceTenantsSyncResponse {
  tenants: TenantStatusItem[];
  serverTime: number;
}

/**
 * 算法 1: 同手机号绑定与本机存根双重准入过滤算法 (Dual-Key Access Filter)
 */
export function filterDeviceAccounts(
  deviceAccounts: DeviceAccountRecord[],
  currentPhone: string
): DeviceAccountRecord[] {
  if (!currentPhone) return [];
  return deviceAccounts.filter((account) => account.boundPhone === currentPhone);
}

/**
 * 算法 2: 基于 LRU 活跃度的多校卡片排序算法 (Tenant LRU Sorter)
 * 优先级: 1. 当前使用单位固定首位; 2. 最后登录活跃时间降序
 */
export function sortTenantAccounts(
  accounts: DeviceAccountRecord[],
  activeSchoolId: number
): DeviceAccountRecord[] {
  return [...accounts].sort((a, b) => {
    if (a.schoolId === activeSchoolId) return -1;
    if (b.schoolId === activeSchoolId) return 1;

    const timeA = new Date(a.lastLoginAt).getTime() || 0;
    const timeB = new Date(b.lastLoginAt).getTime() || 0;
    return timeB - timeA;
  });
}

/**
 * 算法 3: 跨校离线未读数聚合与增量比对算法 (Cross-School Unread Diff Pipeline)
 */
export function mergeRemoteTenantState(
  localList: DeviceAccountRecord[],
  remoteStateMap: Record<number, { unreadCount: number; isExpired: boolean }>
): { updatedList: DeviceAccountRecord[]; hasChanges: boolean } {
  let hasChanges = false;
  const updatedList = localList.map((item) => {
    const remote = remoteStateMap[item.schoolId];
    if (!remote) return item;

    if (item.unreadCount !== remote.unreadCount || item.isExpired !== remote.isExpired) {
      hasChanges = true;
      return {
        ...item,
        unreadCount: remote.unreadCount,
        isExpired: remote.isExpired,
        sessionStatus: (remote.isExpired ? "expired" : "valid") as TenantSessionStatus
      };
    }
    return item;
  });

  return { updatedList, hasChanges };
}

/**
 * 算法 4: 胶囊按钮动态避让与标题对称居中度量算法 (Capsule Centering Metric)
 */
export function calculateNavbarCentering(
  screenWidth: number,
  capsule: { width: number; right: number },
  avatarBlockWidth: number = 68
): { symmetricPadding: number; maxTitleWidth: number } {
  const capsuleRightMargin = Math.max(0, screenWidth - capsule.right);
  const capsuleBlockWidth = capsule.width + capsuleRightMargin;

  // 严格水平居中：两翼取最大避让宽度
  const symmetricPadding = Math.max(capsuleBlockWidth, avatarBlockWidth);
  const maxTitleWidth = Math.max(0, screenWidth - 2 * symmetricPadding);

  return {
    symmetricPadding,
    maxTitleWidth
  };
}

/**
 * 本机多租户高校账号存根管理器模拟器 (DeviceAccountStore Contract Simulator)
 */
export class MemoryDeviceAccountStore {
  private static storage: DeviceAccountRecord[] = [];
  private static readonly MAX_SAVED_ACCOUNTS = 20;

  public static getAllRawRecords(): DeviceAccountRecord[] {
    return [...this.storage];
  }

  public static saveAccount(record: DeviceAccountRecord): void {
    const existingIndex = this.storage.findIndex(
      (item) => item.schoolId === record.schoolId && item.boundPhone === record.boundPhone
    );

    const updatedRecord: DeviceAccountRecord = {
      ...record,
      lastLoginAt: record.lastLoginAt || new Date().toISOString()
    };

    if (existingIndex >= 0) {
      this.storage[existingIndex] = updatedRecord;
    } else {
      this.storage.unshift(updatedRecord);
    }

    if (this.storage.length > this.MAX_SAVED_ACCOUNTS) {
      this.storage.pop();
    }
  }

  public static getAccountsByPhone(phone: string): DeviceAccountRecord[] {
    if (!phone) return [];
    return this.storage.filter((item) => item.boundPhone === phone);
  }

  public static markAsExpired(schoolId: number, phone: string): void {
    const target = this.storage.find(
      (item) => item.schoolId === schoolId && item.boundPhone === phone
    );
    if (target) {
      target.isExpired = true;
      target.sessionStatus = "expired";
    }
  }

  public static removeAccount(schoolId: number, phone: string): void {
    this.storage = this.storage.filter(
      (item) => !(item.schoolId === schoolId && item.boundPhone === phone)
    );
  }

  public static clearAll(): void {
    this.storage = [];
  }
}

/**
 * 多租户状态响应式总线模拟器 (TenantStore Contract Simulator)
 */
export class MemoryTenantStore {
  private static currentSchoolId: number = 1;
  private static currentAccount: DeviceAccountRecord | null = null;
  private static listeners: Set<(schoolId: number, account: DeviceAccountRecord) => void> = new Set();
  private static eventListeners: Map<string, Set<Function>> = new Map();

  public static init(initialAccount: DeviceAccountRecord): void {
    this.currentSchoolId = initialAccount.schoolId;
    this.currentAccount = initialAccount;
    MemoryDeviceAccountStore.saveAccount(initialAccount);
  }

  public static getCurrentSchoolId(): number {
    return this.currentSchoolId;
  }

  public static getCurrentAccount(): DeviceAccountRecord | null {
    return this.currentAccount;
  }

  public static async switchTenant(target: DeviceAccountRecord): Promise<boolean> {
    if (target.schoolId === this.currentSchoolId) {
      return true;
    }

    this.currentSchoolId = target.schoolId;
    this.currentAccount = target;
    MemoryDeviceAccountStore.saveAccount(target);

    this.listeners.forEach((fn) => fn(target.schoolId, target));
    this.emit("TENANT_CHANGED", { newSchoolId: target.schoolId, account: target });

    return true;
  }

  public static subscribe(listener: (schoolId: number, account: DeviceAccountRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public static on(event: string, handler: Function): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
    return () => {
      this.eventListeners.get(event)?.delete(handler);
    };
  }

  public static emit(event: string, payload?: any): void {
    this.eventListeners.get(event)?.forEach((fn) => fn(payload));
  }

  public static clearAll(): void {
    this.listeners.clear();
    this.eventListeners.clear();
    this.currentAccount = null;
    this.currentSchoolId = 1;
  }
}
