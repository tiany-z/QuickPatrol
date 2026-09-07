import { DeviceAccountStore } from "./deviceAccountStore.js";
import { API_BASE } from "../config/env.js";

/**
 * M14: 小程序端多校会话穿梭协调器 (TenantTransitManager)
 * 协调 Storage 会话置换、WebSocket 换乘与工作台 0 白屏局部热刷新
 */
export class TenantTransitManager {
  /**
   * 执行 0 白屏秒级会话热切
   */
  public static async executeSwitch(targetSchoolId: number): Promise<boolean> {
    const currentToken = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";
    if (!currentToken) return false;

    try {
      if (wx.showLoading) {
        wx.showLoading({ title: "切换单位中...", mask: true });
      }

      const res = await new Promise<any>((resolve) => {
        if (!wx.request) {
          resolve({ success: false });
          return;
        }
        wx.request({
          url: `${API_BASE}/api/user/tenants/switch`,
          method: "POST",
          header: { Authorization: `Bearer ${currentToken}` },
          data: { targetSchoolId },
          success: (r: any) => resolve(r.data),
          fail: () => resolve({ success: false })
        });
      });

      if (wx.hideLoading) wx.hideLoading();

      if (res?.success && res.data?.token) {
        const { token, targetUserId } = res.data;

        // 1. 本地 Token 与学校上下文无缝覆盖
        if (wx.setStorageSync) {
          wx.setStorageSync("qp_token", token);
          wx.setStorageSync("qp_current_school_id", targetSchoolId);
        }

        // 2. 更新本机存根活跃标记
        DeviceAccountStore.markActive(targetSchoolId);

        // 3. 发出全局热切事件通知工作台局部重载 (不重新冷启动)
        const app = typeof getApp === "function" ? getApp() : null;
        if (app && app.eventBus) {
          app.eventBus.emit("TENANT_CHANGED", { schoolId: targetSchoolId, userId: targetUserId });
        }

        if (wx.showToast) {
          wx.showToast({ title: "已切换至该单位", icon: "success" });
        }
        return true;
      } else {
        if (wx.showModal) {
          wx.showModal({
            title: "切换失败",
            content: res?.message || "无法切换至该单位",
            showCancel: false
          });
        }
        return false;
      }
    } catch {
      if (wx.hideLoading) wx.hideLoading();
      return false;
    }
  }
}
