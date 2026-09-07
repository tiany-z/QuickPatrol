/**
 * 高校后勤巡查e速办 v4.0 - M40: 协同会话大盘页面控制器 (Session List Page)
 * Tab 1 消息协同中枢大盘
 */

import { StickyPriorityWeightedSorter } from "../../utils/stickyPriorityWeightedSorter.js";
import { GlobalUnreadBadgeDeltaSynchronizer } from "../../utils/globalUnreadBadgeDeltaSynchronizer.js";

import { API_BASE } from "../../../../../config/env.js";

Page({
  data: {
    sessions: [] as any[],
    totalUnread: 0,
    isLoading: true,
    isRefreshing: false
  },

  onShow() {
    this.fetchSessionList();
    this.registerWebSocketBadgeListener();
  },

  /**
   * 1. 拉取大盘会话列表与未读总数
   */
  async fetchSessionList() {
    const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";
    if (!wx.request) return;

    wx.request({
      url: `${API_BASE}/api/v4/chat/sessions`,
      method: "GET",
      header: {
        "content-type": "application/json",
        token,
        Authorization: `Bearer ${token}`
      },
      success: (res: any) => {
        if (res?.data?.status === 1 && res.data.data) {
          const { sessions, totalUnread } = res.data.data;
          const sortedList = StickyPriorityWeightedSorter.sort(sessions || []);

          this.setData({
            sessions: sortedList,
            totalUnread: totalUnread || 0,
            isLoading: false,
            isRefreshing: false
          });

          // 同步微信原生 TabBarBadge (算法 3)
          this.syncNativeTabBarBadge(totalUnread || 0);
        } else {
          this.setData({ isLoading: false, isRefreshing: false });
        }
      },
      fail: () => {
        this.setData({ isLoading: false, isRefreshing: false });
      }
    });
  },

  /**
   * 2. 监听 WebSocket 跨端红点与会话事件
   */
  registerWebSocketBadgeListener() {
    const app = getApp ? getApp() : null;
    if (!app || !app.globalData?.socketTask) return;

    try {
      app.globalData.socketTask.onMessage((res: any) => {
        try {
          const payload = JSON.parse(res.data);
          if (payload.event === "CHAT_ROOM_READ_CLEARED") {
            const { chatRoomId, remainingTotalUnread } = payload;

            // 本地将该会话的未读数归零
            const updated = this.data.sessions.map((s: any) => {
              if (s.chatRoomId === chatRoomId) {
                return { ...s, unreadCount: 0 };
              }
              return s;
            });

            this.setData({
              sessions: updated,
              totalUnread: remainingTotalUnread
            });

            this.syncNativeTabBarBadge(remainingTotalUnread);
          } else if (payload.event === "CHAT_MESSAGE_ARRIVED") {
            // 新消息到达，刷新大盘
            this.fetchSessionList();
          }
        } catch {
          // 忽略非 JSON
        }
      });
    } catch {
      // 降级忽略
    }
  },

  /**
   * 3. 同步微信原生底部导航红点角标 (算法 3)
   */
  syncNativeTabBarBadge(unread: number) {
    if (!wx.setTabBarBadge || !wx.removeTabBarBadge) return;

    const badgeText = GlobalUnreadBadgeDeltaSynchronizer.formatBadgeText(unread);
    if (badgeText !== null) {
      wx.setTabBarBadge({
        index: 1, // Tab 1 消息协同中枢
        text: badgeText
      });
    } else {
      wx.removeTabBarBadge({ index: 1 });
    }
  },

  /**
   * 4. 响应条目左滑置顶/取消置顶触发 (算法 2)
   */
  onSessionTogglePin(e: any) {
    const { chatRoomId, pin } = e.detail;
    const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";
    if (!wx.request) return;

    wx.request({
      url: `${API_BASE}/api/v4/chat/rooms/pin`,
      method: "POST",
      header: {
        "content-type": "application/json",
        token,
        Authorization: `Bearer ${token}`
      },
      data: {
        chatRoomId,
        pin
      },
      success: (res: any) => {
        if (res?.data?.status === 1 || res?.data?.code === 200) {
          wx.showToast({
            title: pin ? "已置顶" : "已取消置顶",
            icon: "success"
          });

          // 本地执行算法 2 毫秒级重排
          const updated = this.data.sessions.map((s: any) => {
            if (s.chatRoomId === chatRoomId) {
              return { ...s, isPinned: pin };
            }
            return s;
          });
          const reSorted = StickyPriorityWeightedSorter.sort(updated);
          this.setData({ sessions: reSorted });
        } else {
          wx.showToast({ title: res?.data?.content || "置顶操作失败", icon: "none" });
        }
      },
      fail: () => {
        wx.showToast({ title: "网络请求失败", icon: "none" });
      }
    });
  },

  /**
   * 5. 点击会话项进入聊天室
   */
  onSessionTapItem(e: any) {
    const { chatRoomId, patrolId } = e.detail;
    if (wx.navigateTo) {
      wx.navigateTo({
        url: `/packages/apps/app-chat/pages/chat-room/index?chatRoomId=${chatRoomId}&patrolId=${patrolId}`
      });
    }
  },

  onPullDownRefresh() {
    this.setData({ isRefreshing: true });
    this.fetchSessionList().then(() => {
      if (wx.stopPullDownRefresh) {
        wx.stopPullDownRefresh();
      }
    });
  }
});
