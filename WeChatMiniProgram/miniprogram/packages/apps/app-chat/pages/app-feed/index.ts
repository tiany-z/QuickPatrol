/**
 * 高校后勤巡查e速办 v4.0 - M44 & M45: 微应用专属卡片流页面与原地变迁引擎
 * (App Card Stream Page Logic & In-Place Mutation Integration)
 */

import { CardInPlaceMutator } from "../../utils/cardInPlaceMutator.js";

Page({
  data: {
    appId: "",
    appName: "微应用助手",
    appIcon: "",
    cards: [] as any[],
    cursor: 0,
    hasMore: true,
    isLoading: true,
    isRefreshing: false
  },

  countdownTimer: null as any,

  onLoad(options: any) {
    const appId = options?.appId || "app-patrol";
    const appName = options?.title ? decodeURIComponent(options.title) : "微应用助手";

    this.setData({ appId, appName });
    wx.setNavigationBarTitle({ title: appName });

    this.loadFirstPage();
    this.startGlobalSlaTicker();
    this.registerWebSocketMutationListener();
  },

  onUnload() {
    this.stopGlobalSlaTicker();
    this.batchAckAllRead();
  },

  /**
   * 下拉刷新
   */
  async onPullDownRefresh() {
    this.setData({ isRefreshing: true, cursor: 0 });
    await this.loadFirstPage();
    wx.stopPullDownRefresh();
  },

  /**
   * 1. 算法 2: 拉取首屏卡片瀑布流
   */
  async loadFirstPage() {
    this.setData({ isLoading: true });
    try {
      const token = wx.getStorageSync ? wx.getStorageSync("token") || "" : "";
      const schoolCode = wx.getStorageSync ? wx.getStorageSync("schoolCode") || "lcu" : "lcu";

      const res: any = await new Promise((resolve, reject) => {
        wx.request({
          url: `https://api.xcesb.cn/api/v4/notification/app-feed?appId=${this.data.appId}&cursorMessageId=0&pageSize=20`,
          method: "GET",
          header: {
            Authorization: "Bearer " + token,
            "x-school-code": schoolCode
          },
          success: (r: any) => resolve(r.data),
          fail: (err: any) => reject(err)
        });
      });

      if (res && res.code === 200 && res.data) {
        this.setData({
          cards: res.data.cards || [],
          cursor: res.data.nextCursorId || 0,
          hasMore: res.data.hasMore,
          appIcon: res.data.appIcon || "",
          appName: res.data.appName || this.data.appName,
          isLoading: false,
          isRefreshing: false
        });
      } else {
        this.setData({ isLoading: false, isRefreshing: false });
      }
    } catch {
      this.setData({ isLoading: false, isRefreshing: false });
    }
  },

  /**
   * 2. 算法 2: 上滑触底加载更早历史卡片
   */
  async onReachBottom() {
    if (!this.data.hasMore || this.data.isLoading) return;

    try {
      const token = wx.getStorageSync ? wx.getStorageSync("token") || "" : "";
      const schoolCode = wx.getStorageSync ? wx.getStorageSync("schoolCode") || "lcu" : "lcu";

      const res: any = await new Promise((resolve, reject) => {
        wx.request({
          url: `https://api.xcesb.cn/api/v4/notification/app-feed?appId=${this.data.appId}&cursorMessageId=${this.data.cursor}&pageSize=20`,
          method: "GET",
          header: {
            Authorization: "Bearer " + token,
            "x-school-code": schoolCode
          },
          success: (r: any) => resolve(r.data),
          fail: (err: any) => reject(err)
        });
      });

      if (res && res.code === 200 && res.data) {
        this.setData({
          cards: [...this.data.cards, ...(res.data.cards || [])],
          cursor: res.data.nextCursorId || 0,
          hasMore: res.data.hasMore
        });
      }
    } catch {
      // 异常隔离
    }
  },

  /**
   * 3. 算法 1: 单心跳循环驱动全屏卡片倒计时推演
   */
  startGlobalSlaTicker() {
    this.stopGlobalSlaTicker();
    this.countdownTimer = setInterval(() => {
      const cards = this.data.cards.map((c: any) => {
        if (c.cardPayload?.slaDeadlineAt) {
          const deadline = new Date(c.cardPayload.slaDeadlineAt).getTime();
          const now = Date.now();
          const diffMin = Math.floor((deadline - now) / 60000);
          return {
            ...c,
            slaInfo: {
              text: diffMin > 0 ? `剩余 ${diffMin} 分钟` : `已逾期 ${Math.abs(diffMin)} 分钟`,
              isUrgent: diffMin <= 30,
              isOverdue: diffMin <= 0
            }
          };
        }
        return c;
      });
      this.setData({ cards });
    }, 30 * 1000);
  },

  stopGlobalSlaTicker() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  },

  /**
   * 4. 离开页面自动批量标记全已读，消除大盘红点
   */
  batchAckAllRead() {
    try {
      const token = wx.getStorageSync ? wx.getStorageSync("token") : null;
      const schoolCode = wx.getStorageSync ? wx.getStorageSync("schoolCode") || "lcu" : "lcu";
      if (!token) return;

      wx.request({
        url: "https://api.xcesb.cn/api/v4/notification/app-feed/ack-read",
        method: "POST",
        header: {
          Authorization: "Bearer " + token,
          "x-school-code": schoolCode
        },
        data: { appId: this.data.appId }
      });
    } catch {
      // 静默容错
    }
  },

  /**
   * 5. 点击现场缩略图全屏原生画廊穿透预览
   */
  onCardPreviewImage(e: any) {
    const { currentUrl, allUrls } = e.detail;
    if (currentUrl) {
      wx.previewImage({
        current: currentUrl,
        urls: allUrls || [currentUrl],
        showmenu: true
      });
    }
  },

  /**
   * 6. M45: 注册 WebSocket 全双工 CARD_MUTATED 原地演进信令监听
   */
  registerWebSocketMutationListener() {
    try {
      const app = getApp ? getApp() : null;
      if (!app || !app.globalData || !app.globalData.wsClient) return;

      app.globalData.wsClient.on("CARD_MUTATED", (data: any) => {
        if (!data || !data.messageId || !data.mutatedCardPayload) return;
        const { messageId, mutatedCardPayload, version } = data;

        // 算法 3 & 4 驱动: 端侧本地卡片数组就地突变与版本仲裁
        const { nextList, success } = CardInPlaceMutator.mutate(
          this.data.cards,
          messageId,
          mutatedCardPayload,
          version
        );

        if (success) {
          this.setData({ cards: nextList });
          setTimeout(() => {
            const clearedList = this.data.cards.map((c: any) =>
              c.messageId === messageId ? { ...c, isMutatingAnim: false } : c
            );
            this.setData({ cards: clearedList });
          }, 800);
        }
      });
    } catch {
      // 容错防止未初始化 wsClient 异常
    }
  },

  /**
   * 7. M45: 点击卡片操作按钮，发起原子变迁并原地重塑卡片
   */
  async onCardActionTap(e: any) {
    const { actionId, messageId, patrolId, payload } = e.detail || {};
    if (!actionId || !messageId || !patrolId) return;

    wx.showLoading({ title: "正在执行..." });

    try {
      const token = wx.getStorageSync ? wx.getStorageSync("token") || "" : "";
      const schoolCode = wx.getStorageSync ? wx.getStorageSync("schoolCode") || "lcu" : "lcu";

      const res: any = await new Promise((resolve, reject) => {
        wx.request({
          url: "https://api.xcesb.cn/api/v4/notification/card-action",
          method: "POST",
          header: {
            Authorization: "Bearer " + token,
            "x-school-code": schoolCode
          },
          data: {
            actionId,
            messageId,
            patrolId,
            actionPayload: payload
          },
          success: (r: any) => resolve(r.data),
          fail: (err: any) => reject(err)
        });
      });

      wx.hideLoading();

      if (res && res.code === 200 && res.data) {
        wx.showToast({ title: "操作成功", icon: "success" });

        // 算法 3 驱动: 本地数组原地覆盖重绘，零整页拉取
        const { nextList, success } = CardInPlaceMutator.mutate(
          this.data.cards,
          messageId,
          res.data.mutatedCardPayload
        );
        if (success) {
          this.setData({ cards: nextList });
          setTimeout(() => {
            const cleared = this.data.cards.map((c: any) =>
              c.messageId === messageId ? { ...c, isMutatingAnim: false } : c
            );
            this.setData({ cards: cleared });
          }, 800);
        }
      } else if (res && res.code === 409) {
        // CAS 竞态落败友好模态提示
        wx.showModal({
          title: "认领提示",
          content: res.message || "手慢了一步，该工单已被其他师傅认领",
          showCancel: false
        });
      } else {
        wx.showToast({
          title: (res && res.message) ? res.message : "操作失败",
          icon: "none"
        });
      }
    } catch {
      wx.hideLoading();
      wx.showToast({ title: "网络连接异常", icon: "none" });
    }
  }
});
