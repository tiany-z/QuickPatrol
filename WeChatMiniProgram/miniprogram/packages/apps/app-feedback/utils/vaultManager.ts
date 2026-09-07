/**
 * 高校后勤巡查e速办 v4.0 - M31: 微信小程序端绝对匿名保险箱凭证卡管理器
 * (Client-Side Vault Token Manager)
 */

declare const wx: any;

export interface ILocalVaultTokenItem {
  postId: number;
  schoolId: number;
  token: string;
  title: string;
  createdAt: number;
}

const STORAGE_KEY = "quickpatrol_confidential_vault_tokens";
const MAX_CAPACITY = 50;

export class VaultManager {
  /**
   * 保存新的凭证卡至本地 Storage (LRU 队列管理)
   */
  public static saveVaultToken(item: ILocalVaultTokenItem): void {
    try {
      const list: ILocalVaultTokenItem[] = wx.getStorageSync(STORAGE_KEY) || [];
      // 去重
      const filtered = list.filter((i) => i.postId !== item.postId);
      // 最新凭证置顶
      filtered.unshift(item);

      // 上限 50 项淘汰
      const finalItems = filtered.slice(0, MAX_CAPACITY);
      wx.setStorageSync(STORAGE_KEY, finalItems);
    } catch (err) {
      console.error("保存 VaultToken 失败:", err);
    }
  }

  /**
   * 获取所有本地保存的凭证卡 Token 列表 (用于批量追溯办理进度)
   */
  public static getAllTokens(): string[] {
    try {
      const list: ILocalVaultTokenItem[] = wx.getStorageSync(STORAGE_KEY) || [];
      return list.map((i) => i.token);
    } catch {
      return [];
    }
  }

  /**
   * 获取凭证卡全量条目
   */
  public static getAllItems(): ILocalVaultTokenItem[] {
    try {
      return wx.getStorageSync(STORAGE_KEY) || [];
    } catch {
      return [];
    }
  }

  /**
   * 移除指定凭证
   */
  public static removeToken(postId: number): void {
    try {
      const list: ILocalVaultTokenItem[] = wx.getStorageSync(STORAGE_KEY) || [];
      const filtered = list.filter((i) => i.postId !== postId);
      wx.setStorageSync(STORAGE_KEY, filtered);
    } catch (err) {
      console.error("移除 VaultToken 失败:", err);
    }
  }
}
