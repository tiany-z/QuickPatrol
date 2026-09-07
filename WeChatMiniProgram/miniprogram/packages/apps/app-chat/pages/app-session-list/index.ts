/**
 * 高校后勤巡查e速办 v4.0 - M42: 微应用通知会话聚合列表页面
 * (App Notification Session List Page)
 */

Page({
  data: {
    sessions: [] as any[],
    totalUnread: 0,
    isLoading: true
  },

  onShow() {
    this.fetchAppSessions();
  },

  onPullDownRefresh() {
    this.fetchAppSessions().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  async fetchAppSessions() {
    return new Promise<void>((resolve) => {
      const token = wx.getStorageSync ? wx.getStorageSync("qp_token") || wx.getStorageSync("token") : "";
      wx.request({
        url: "https://api.xcesb.cn/api/v4/notification/sessions",
        method: "GET",
        header: {
          Authorization: "Bearer " + token,
          "x-school-code": "lcu",
          "content-type": "application/json"
        },
        success: (res: any) => {
          if (res.data?.status === 1 && res.data.data) {
            this.setData({
              sessions: res.data.data.sessions || [],
              totalUnread: res.data.data.totalUnread || 0,
              isLoading: false
            });
          } else if (res.data?.code === 200 && res.data.data) {
            this.setData({
              sessions: res.data.data.sessions || [],
              totalUnread: res.data.data.totalUnread || 0,
              isLoading: false
            });
          } else {
            this.setData({ isLoading: false });
          }
          resolve();
        },
        fail: () => {
          this.setData({ isLoading: false });
          resolve();
        }
      });
    });
  },

  /**
   * 点击某个微应用服务号条目，跳转进入 M44 卡片流页面
   */
  onTapAppSession(e: any) {
    const session = e.detail?.session || e.currentTarget?.dataset?.session;
    if (!session) return;
    const { appCode, appName } = session;
    wx.navigateTo({
      url: `/packages/apps/app-chat/pages/app-feed/index?appId=${appCode}&title=${encodeURIComponent(appName)}`
    });
  }
});
