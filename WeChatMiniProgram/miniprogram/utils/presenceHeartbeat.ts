/**
 * 高校后勤巡查e速办 v4.0 - M43: 微信小程序端在线状态感知与心跳保活切面
 * (Presence Heartbeat Client Aspect)
 */

declare const wx: any;
declare const getApp: any;

export class PresenceHeartbeatClient {
  private static timer: any = null;
  private static readonly HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 秒心跳周期

  /**
   * 启动小程序心跳机制 (每 30 秒上报一次保活信号)
   */
  public static start(): void {
    this.stop();
    this.sendPing(true);

    this.timer = setInterval(() => {
      this.sendPing(true);
    }, this.HEARTBEAT_INTERVAL_MS);
  }

  /**
   * 停止小程序心跳机制
   */
  public static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 小程序切入前台活跃通知 (App.onShow: 刷新为 Active，租约 45s)
   */
  public static notifyForeground(): void {
    this.sendPing(true);
  }

  /**
   * 小程序切入后台通知 (App.onHide: 切换为 Idle，缩短租期为 15s)
   */
  public static notifyBackground(): void {
    this.sendPing(false);
  }

  /**
   * 发送心跳数据帧 (长连接优先，HTTP 兜底)
   */
  private static sendPing(isForeground: boolean): void {
    try {
      const token = typeof wx !== "undefined" && typeof wx.getStorageSync === "function"
        ? wx.getStorageSync("token")
        : null;
      if (!token) return;

      // 1. 优先复用当前活跃的 WebSocket 长连接通道发送心跳帧
      if (typeof getApp === "function") {
        const app = getApp();
        if (
          app?.globalData?.wsClient &&
          typeof app.globalData.wsClient.isConnected === "function" &&
          app.globalData.wsClient.isConnected()
        ) {
          app.globalData.wsClient.send({
            action: "HEARTBEAT",
            isForeground
          });
          return;
        }
      }

      // 2. 长连接未就绪时，降级通过 HTTP POST 兜底
      if (typeof wx !== "undefined" && typeof wx.request === "function") {
        const schoolCode = wx.getStorageSync("schoolCode") || "lcu";
        wx.request({
          url: "https://api.xcesb.cn/api/v4/presence/heartbeat",
          method: "POST",
          header: {
            Authorization: "Bearer " + token,
            "x-school-code": schoolCode
          },
          data: { isForeground }
        });
      }
    } catch {
      // 静默容错，心跳上报异常绝不可影响用户正常业务交互
    }
  }
}
