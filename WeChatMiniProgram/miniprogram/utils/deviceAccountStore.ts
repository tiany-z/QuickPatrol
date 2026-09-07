import { DeviceAccountRecord } from "../typings/tenant.js";

const STORAGE_KEY = "xcesb_device_accounts";
const MAX_SAVED_ACCOUNTS = 20;

/**
 * M08: 本机多租户高校账号存根管理器 (DeviceAccountStore)
 * 遵循同手机号门禁隔离与 LRU 20 容量硬上限
 */
export class DeviceAccountStore {
  /**
   * 获取本地全量存根 (内部原生持久化层)
   */
  public static getAllRawRecords(): DeviceAccountRecord[] {
    try {
      return (wx.getStorageSync ? wx.getStorageSync(STORAGE_KEY) : []) || [];
    } catch {
      return [];
    }
  }

  /**
   * 保存/更新某个高校的本地存根 (自动执行同手机号归集与 LRU 淘汰)
   */
  public static saveAccount(record: DeviceAccountRecord): void {
    const list = this.getAllRawRecords();
    const existingIndex = list.findIndex(
      (item) => item.schoolId === record.schoolId && item.boundPhone === record.boundPhone
    );

    const updatedRecord: DeviceAccountRecord = {
      ...record,
      lastLoginAt: record.lastLoginAt || new Date().toISOString()
    };

    if (existingIndex >= 0) {
      list[existingIndex] = updatedRecord;
    } else {
      list.unshift(updatedRecord);
    }

    // LRU 淘汰保护：最多保留 20 所大学
    if (list.length > MAX_SAVED_ACCOUNTS) {
      list.pop();
    }

    try {
      if (wx.setStorageSync) {
        wx.setStorageSync(STORAGE_KEY, list);
      }
    } catch (e) {
      console.error("[M08] 写入本机存根失败", e);
    }
  }

  /**
   * 获取经过“同手机号绑定”严格门禁过滤后的展示账号列表
   */
  public static getAccountsByPhone(phone: string): DeviceAccountRecord[] {
    if (!phone) return [];
    const list = this.getAllRawRecords();
    return list.filter((item) => item.boundPhone === phone);
  }

  /**
   * 标记某学校已过期 (Gentle Sign-out)
   */
  public static markAsExpired(schoolId: number, phone: string): void {
    const list = this.getAllRawRecords();
    const target = list.find((item) => item.schoolId === schoolId && item.boundPhone === phone);
    if (target) {
      target.isExpired = true;
      target.sessionStatus = "expired";
      try {
        if (wx.setStorageSync) {
          wx.setStorageSync(STORAGE_KEY, list);
        }
      } catch (e) {
        console.error("[M08] 更新过期状态失败", e);
      }
    }
  }

  /**
   * 从本机物理删除某个高校存根 (仅影响本地设备，不影响云端)
   */
  public static removeAccount(schoolId: number, phone: string): void {
    let list = this.getAllRawRecords();
    list = list.filter((item) => !(item.schoolId === schoolId && item.boundPhone === phone));
    try {
      if (wx.setStorageSync) {
        wx.setStorageSync(STORAGE_KEY, list);
      }
    } catch (e) {
      console.error("[M08] 删除存根失败", e);
    }
  }

  /**
   * 标记某个高校为当前活跃状态 (Active)
   */
  public static markActive(schoolId: number): void {
    const list = this.getAllRawRecords();
    list.forEach((item) => {
      if (item.schoolId === schoolId) {
        item.sessionStatus = "active";
        item.lastLoginAt = new Date().toISOString();
        item.isExpired = false;
      } else if (item.sessionStatus === "active") {
        item.sessionStatus = "valid";
      }
    });

    try {
      if (wx.setStorageSync) {
        wx.setStorageSync(STORAGE_KEY, list);
      }
    } catch (e) {
      console.error("[M14] 更新激活状态失败", e);
    }
  }

  /**
   * 清空所有本机存根 (登出清理/测试用)
   */
  public static clearAll(): void {
    try {
      if (wx.removeStorageSync) {
        wx.removeStorageSync(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }
}

/**
 * M14 算法 4：本机设备存根容量 LRU 自动淘汰算法 (最大上限 20)
 */
export function applyLruEviction<T extends { lastLoginAt: string }>(accounts: T[], maxLimit: number = 20): T[] {
  if (accounts.length <= maxLimit) {
    return accounts;
  }

  // 按活跃时间升序排序 (最陈旧的在首位)
  accounts.sort((a, b) => new Date(a.lastLoginAt).getTime() - new Date(b.lastLoginAt).getTime());

  // 丢弃超出限额的最老记录，保留最新的 maxLimit 项
  return accounts.slice(accounts.length - maxLimit);
}

