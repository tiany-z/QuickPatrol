import { DeviceAccountRecord } from "../typings/tenant.js";
import { DeviceAccountStore } from "../utils/deviceAccountStore.js";
import { QpWsClient } from "../utils/wsClient.js";

export type TenantListener = (schoolId: number, account: DeviceAccountRecord) => void;

/**
 * M08: 全局多租户切换中枢与响应式总线 (TenantStore)
 * 支持 0 白屏秒级热切、WebSocket 长连接重绑与 EventBus 事件广播
 */
export class TenantStore {
  private static currentSchoolId: number = 1;
  private static currentAccount: DeviceAccountRecord | null = null;
  private static listeners: Set<TenantListener> = new Set();
  private static eventListeners: Map<string, Set<Function>> = new Map();

  public static init(initialAccount: DeviceAccountRecord): void {
    this.currentSchoolId = initialAccount.schoolId;
    this.currentAccount = initialAccount;
    DeviceAccountStore.saveAccount(initialAccount);
  }

  public static getCurrentSchoolId(): number {
    return this.currentSchoolId;
  }

  public static getCurrentAccount(): DeviceAccountRecord | null {
    return this.currentAccount;
  }

  /**
   * 0 白屏秒级局部热切核心管道
   */
  public static async switchTenant(target: DeviceAccountRecord): Promise<boolean> {
    if (target.schoolId === this.currentSchoolId) {
      return true;
    }

    try {
      this.currentSchoolId = target.schoolId;
      this.currentAccount = target;

      // 1. 更新本机存储活跃时间
      DeviceAccountStore.saveAccount(target);

      // 2. 长连接 WebSocket 热重连
      try {
        const app = typeof getApp === "function" ? getApp<{ globalData: { wsUrl: string } }>() : null;
        if (app && app.globalData && app.globalData.wsUrl) {
          QpWsClient.connect(app.globalData.wsUrl, target.schoolId, target.token);
        }
      } catch (wsErr) {
        console.warn("[M08] WebSocket 重连提醒:", wsErr);
      }

      // 3. 广播给全应用订阅者完成局部更新
      this.listeners.forEach((listener) => {
        try {
          listener(target.schoolId, target);
        } catch (e) {
          console.error("[M08] 监听器执行异常", e);
        }
      });

      // 4. 发送 EventBus TENANT_CHANGED 事件
      this.emit("TENANT_CHANGED", { newSchoolId: target.schoolId, account: target });

      console.log(`[M08] ⚡ 0 白屏热切至高校: ${target.schoolName} (ID: ${target.schoolId})`);
      return true;
    } catch (err) {
      console.error("[M08] 切校异常", err);
      return false;
    }
  }

  public static subscribe(listener: TenantListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public static on(event: string, handler: Function): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  public static off(event: string, handler: Function): void {
    const handlers = this.eventListeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  public static emit(event: string, payload?: any): void {
    const handlers = this.eventListeners.get(event);
    if (handlers) {
      handlers.forEach((fn) => {
        try {
          fn(payload);
        } catch (e) {
          console.error(`[M08] EventBus ${event} 异常`, e);
        }
      });
    }
  }

  public static clearAll(): void {
    this.listeners.clear();
    this.eventListeners.clear();
    this.currentAccount = null;
    this.currentSchoolId = 1;
  }
}
