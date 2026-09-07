import { GroupReadCursorCalculator } from "../../utils/groupReadCursorCalculator";

Page({
  data: {
    roomId: 0,
    title: "群聊协同",
    patrolId: null as number | null,
    messageList: [] as any[],
    currentNotice: {
      visible: false,
      content: "",
      publisherName: "管理员",
      isPinned: true
    },
    currentUserId: 0,
    currentUserRole: 0,
    lastReadMessageId: 0,
    inputText: "",
    scrollIntoViewId: "",
    isMuted: false,
    memberCount: 0
  },

  onLoad(options: any) {
    const roomId = parseInt(options.roomId || options.chatRoomId || "0", 10);
    const currentUserId = wx.getStorageSync("userId") || 101;
    this.setData({ roomId, currentUserId });

    this.fetchGroupDetail(roomId);
    this.fetchMessageList(roomId);
    this.registerWebSocketGroupListeners();
  },

  onShow() {
    this.syncMaxReadCursor();
  },

  onPullDownRefresh() {
    this.fetchMessageList(this.data.roomId).then(() => {
      wx.stopPullDownRefresh();
    });
  },

  fetchGroupDetail(roomId: number) {
    if (!roomId) return;
    wx.request({
      url: `https://api.xcesb.cn/api/v4/chat/groups/detail?chatRoomId=${roomId}`,
      method: "GET",
      header: {
        Authorization: "Bearer " + (wx.getStorageSync("token") || ""),
        "x-school-code": "lcu"
      },
      success: (res: any) => {
        if (res.data?.status === 1 && res.data?.data) {
          const detail = res.data.data;
          const notice = detail.notice;
          this.setData({
            title: detail.title || "群聊协同",
            patrolId: detail.patrolId,
            memberCount: detail.memberCount || 0,
            currentUserRole: detail.currentUserRole || 0,
            isMuted: Boolean(detail.isMuted),
            currentNotice: notice ? {
              visible: true,
              content: notice.content,
              publisherName: notice.publisherName,
              isPinned: notice.isPinned
            } : { visible: false, content: "", publisherName: "", isPinned: false }
          });
          wx.setNavigationBarTitle({
            title: `${detail.title || "群聊"} (${detail.memberCount || 0})`
          });
        }
      }
    });
  },

  fetchMessageList(roomId: number) {
    return new Promise<void>((resolve) => {
      wx.request({
        url: `https://api.xcesb.cn/api/chat/message/list?chatRoomId=${roomId}&limit=30`,
        method: "GET",
        header: {
          Authorization: "Bearer " + (wx.getStorageSync("token") || ""),
          "x-school-code": "lcu"
        },
        success: (res: any) => {
          if (res.data?.status === 1 && Array.isArray(res.data?.data)) {
            const list = res.data.data;
            this.setData({ messageList: list });
            if (list.length > 0) {
              const lastMsg = list[list.length - 1];
              this.setData({ scrollIntoViewId: `msg_${lastMsg.id}` });
            }
            this.syncMaxReadCursor();
          }
          resolve();
        },
        fail: () => resolve()
      });
    });
  },

  registerWebSocketGroupListeners() {
    const app = getApp<any>();
    const ws = app?.globalData?.wsClient;
    if (!ws) return;

    // 监听置顶公告强广播
    ws.on("GROUP_NOTICE_PUBLISHED", (data: any) => {
      if (Number(data.chatRoomId) !== this.data.roomId) return;
      this.setData({
        "currentNotice.visible": true,
        "currentNotice.content": data.notice.content,
        "currentNotice.publisherName": data.notice.publisherName || "管理员",
        "currentNotice.isPinned": data.notice.isPinned
      });
      wx.vibrateShort({ type: "heavy" });
    });

    // 监听被踢长连接熔断
    ws.on("FORCE_EVICT_MEMBER", (data: any) => {
      if (Number(data.chatRoomId) === this.data.roomId && Number(data.evictedUserId) === this.data.currentUserId) {
        wx.showModal({
          title: "提示",
          content: data.reason || "您已被管理员移出该群聊",
          showCancel: false,
          success: () => {
            wx.navigateBack();
          }
        });
      }
    });

    // 监听新群消息
    ws.on("GROUP_MESSAGE_ARRIVED", (data: any) => {
      if (Number(data.chatRoomId) !== this.data.roomId) return;
      const msg = data.message;
      const newList = [...this.data.messageList, msg];
      this.setData({
        messageList: newList,
        scrollIntoViewId: `msg_${msg.id}`
      });
      this.syncMaxReadCursor();
    });
  },

  syncMaxReadCursor() {
    const list = this.data.messageList;
    if (!list || list.length === 0 || !this.data.roomId) return;
    const maxMsgId = Number(list[list.length - 1].id || 0);
    const currentCursor = Number(this.data.lastReadMessageId || 0);

    const newCursor = GroupReadCursorCalculator.advanceCursor(currentCursor, maxMsgId);
    if (newCursor <= currentCursor) {
      return;
    }
    this.setData({ lastReadMessageId: newCursor });

    wx.request({
      url: "https://api.xcesb.cn/api/v4/chat/groups/read-cursor",
      method: "POST",
      header: {
        Authorization: "Bearer " + (wx.getStorageSync("token") || ""),
        "x-school-code": "lcu"
      },
      data: {
        chatRoomId: this.data.roomId,
        lastReadMessageId: newCursor
      }
    });
  },

  onInput(e: any) {
    this.setData({ inputText: e.detail.value });
  },

  onSendMessage() {
    const content = this.data.inputText.trim();
    if (!content || !this.data.roomId) return;

    this.setData({ inputText: "" });

    wx.request({
      url: "https://api.xcesb.cn/api/chat/message/send",
      method: "POST",
      header: {
        Authorization: "Bearer " + (wx.getStorageSync("token") || ""),
        "x-school-code": "lcu"
      },
      data: {
        chatRoomId: this.data.roomId,
        type: 0,
        content
      },
      success: (res: any) => {
        if (res.data?.status === 1) {
          this.fetchMessageList(this.data.roomId);
        } else {
          wx.showToast({ title: res.data?.message || "发送失败", icon: "none" });
        }
      }
    });
  },

  onTapSetting() {
    wx.navigateTo({
      url: `../group-detail/index?roomId=${this.data.roomId}`
    });
  }
});
