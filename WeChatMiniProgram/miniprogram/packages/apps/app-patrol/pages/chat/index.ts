import { IChatRoomMetaDto } from "./types.js";

Page({
  data: {
    chatRoomId: 0,
    meta: null as IChatRoomMetaDto | null,
    canInput: false,
    lockReason: "加载会话中...",
    showHandshakeBtn: false,
    inputText: "",
    isActivating: false,
    lastMsgId: "msg-bottom"
  },

  onLoad(options: any) {
    const chatRoomId = parseInt(options?.chatRoomId || options?.id || options?.roomId || 0, 10);
    this.setData({ chatRoomId });
    if (chatRoomId > 0) {
      this.loadRoomMeta(chatRoomId);
      this.subscribeWebSocketChannel(chatRoomId);
    }
  },

  onUnload() {
    this.unsubscribeWebSocketChannel();
  },

  async loadRoomMeta(roomId: number) {
    try {
      const token = wx.getStorageSync("token") || "";
      const schoolCode = wx.getStorageSync("currentSchoolCode") || "lcu";

      const res: any = await new Promise((resolve, reject) => {
        wx.request({
          url: `https://api.xcesb.cn/api/v4/chat/rooms/meta?chatRoomId=${roomId}`,
          method: "GET",
          header: {
            Authorization: token ? `Bearer ${token}` : "",
            "x-school-code": schoolCode
          },
          success: (r) => resolve(r.data),
          fail: (err) => reject(err)
        });
      });

      if (res && (res.code === 200 || res.status === 1)) {
        const meta: IChatRoomMetaDto = res.data || res;
        this.setData({
          meta,
          canInput: meta.permissions?.canInput ?? false,
          lockReason: meta.permissions?.lockReason ?? "",
          showHandshakeBtn: meta.permissions?.showHandshakeButton ?? false
        });
      }
    } catch {
      // 弱网平滑提示
    }
  },

  /**
   * 师傅端点击【主动发起联络】
   */
  async onTriggerHandshake() {
    const { chatRoomId } = this.data;
    if (!chatRoomId || this.data.isActivating) return;

    this.setData({ isActivating: true });

    try {
      const token = wx.getStorageSync("token") || "";
      const schoolCode = wx.getStorageSync("currentSchoolCode") || "lcu";

      const res: any = await new Promise((resolve, reject) => {
        wx.request({
          url: `https://api.xcesb.cn/api/v4/chat/rooms/activate-handshake`,
          method: "POST",
          header: {
            Authorization: token ? `Bearer ${token}` : "",
            "x-school-code": schoolCode
          },
          data: { chatRoomId },
          success: (r) => resolve(r.data),
          fail: (err) => reject(err)
        });
      });

      this.setData({ isActivating: false });

      if (res && (res.code === 200 || res.status === 1)) {
        wx.showToast({ title: "已成功开启协同通道", icon: "success" });
        this.setData({
          showHandshakeBtn: false,
          canInput: true,
          lockReason: ""
        });
        if (this.data.meta) {
          this.setData({
            "meta.initiatedByHandler": true
          });
        }
      } else {
        const msg = res?.message || res?.content || "激活失败";
        wx.showToast({ title: msg, icon: "none" });
      }
    } catch {
      this.setData({ isActivating: false });
      wx.showToast({ title: "网络异常，激活失败", icon: "none" });
    }
  },

  onTextInput(e: any) {
    this.setData({ inputText: e.detail?.value || "" });
  },

  onSendMessage() {
    const { inputText, canInput } = this.data;
    if (!canInput) return;
    if (!inputText || !inputText.trim()) {
      wx.showToast({ title: "请输入内容", icon: "none" });
      return;
    }

    wx.showToast({ title: "发送消息中...", icon: "none" });
    this.setData({ inputText: "" });
  },

  /**
   * 监听 WebSocket 激活广播
   */
  subscribeWebSocketChannel(roomId: number) {
    const app = getApp ? getApp() : null;
    if (!app || !app.globalData || !app.globalData.socketTask) return;

    app.globalData.socketTask.onMessage((res: any) => {
      try {
        const payload = JSON.parse(res.data);
        if (payload.event === "CHAT_HANDSHAKE_ACTIVATED" && Number(payload.chatRoomId) === roomId) {
          try {
            wx.vibrateShort({ type: "medium" });
          } catch {
            // ignore
          }
          wx.showToast({ title: "师傅已开启联络，可以沟通啦", icon: "none" });

          this.setData({
            canInput: true,
            lockReason: "",
            showHandshakeBtn: false
          });
          if (this.data.meta) {
            this.setData({
              "meta.initiatedByHandler": true
            });
          }
        }
      } catch {
        // ignore
      }
    });
  },

  unsubscribeWebSocketChannel() {
    // 页面销毁处理
  }
});
