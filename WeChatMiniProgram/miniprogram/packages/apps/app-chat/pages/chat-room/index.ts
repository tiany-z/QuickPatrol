/**
 * 高校后勤巡查e速办 v4.0 - M37: 微信小程序类 QQ 即时协同聊天室核心控制器
 * (Patrol Chat Room Page Controller)
 */

import { IChatRoomPageData, IChatMessageItem } from "./types.js";
import { BubbleInPlaceMutationMachine } from "../../utils/bubbleInPlaceMutationMachine.js";
import { ViewportScrollTargetCalculator } from "../../utils/viewportScrollTargetCalculator.js";
import { DwellTimeEvaluator } from "../../utils/dwellTimeEvaluator.js";



import { API_BASE } from "../../../../../config/env.js";

Page<IChatRoomPageData, any>({
  dwellEvaluator: new DwellTimeEvaluator(),

  data: {
    chatRoomId: 0,
    patrolId: 0,
    orderNo: "",
    statusText: "维修协同中",
    locationName: "现场",
    myUserId: 0,
    isMaster: false,
    initiatedByHandler: false,
    isClosed: false,
    roomTitle: "",
    inputText: "",
    messageList: [] as IChatMessageItem[],
    cursorId: 0,
    hasMore: true,
    isSending: false,
    showMediaPanel: false,
    scrollIntoViewId: "",
    replyingToMessage: null as IChatMessageItem | null,
    canInput: true,
    lockReason: "",
    showHandshakeButton: false,
    showActionMenu: false,
    selectedActionMsg: null as any,
    highlightMessageId: 0,
    isViewingHistoricalSlice: false
  },

  onLoad(query: any) {
    const userInfoStr = wx.getStorageSync ? wx.getStorageSync("userInfo") : "";
    let userInfo: any = null;
    try {
      userInfo = typeof userInfoStr === "string" && userInfoStr ? JSON.parse(userInfoStr) : userInfoStr;
    } catch {
      userInfo = null;
    }

    const roomId = Number(query?.chatRoomId || query?.roomId || 0);
    const pId = Number(query?.patrolId || 0);
    const isMasterRole = Number(userInfo?.role || 0) >= 1;

    this.setData({
      chatRoomId: roomId,
      patrolId: pId,
      roomTitle: query?.title ? decodeURIComponent(query.title) : `工单现场协同 #${pId || roomId}`,
      myUserId: Number(userInfo?.id || userInfo?.userId || 0),
      isMaster: isMasterRole,
      initiatedByHandler: query?.initiated === "1",
      isClosed: query?.closed === "1"
    });

    if (roomId > 0) {
      this.loadRoomMeta(roomId);
      this.loadHistoryMessages(0);
      this.listenWebSocketMessages();
    }
  },

  onShow() {
    // M40: 视口停留判定 (算法 1): 停留 >= 300ms 自动消红点
    if (this.data.chatRoomId > 0) {
      this.dwellEvaluator.startDwellTimer(() => {
        this.markRoomAsRead();
      });
    }
  },

  onHide() {
    this.dwellEvaluator.handleLeave();
  },

  onUnload() {
    this.dwellEvaluator.handleLeave();
    if (this.data.chatRoomId > 0) {
      this.markRoomAsRead();
    }
  },

  /**
   * 拉取房间元数据与权限掩码 (M36 契约)
   */
  loadRoomMeta(roomId: number) {
    const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";
    if (!wx.request) return;

    wx.request({
      url: `${API_BASE}/api/v4/chat/rooms/meta?chatRoomId=${roomId}`,
      method: "GET",
      header: {
        "content-type": "application/json",
        token,
        Authorization: `Bearer ${token}`
      },
      success: (res: any) => {
        if (res?.data?.status === 1 && res.data.data) {
          const meta = res.data.data;
          this.setData({
            orderNo: meta.orderNo || "",
            statusText: meta.patrolStatusText || "维修协同中",
            locationName: meta.locationName || "现场",
            initiatedByHandler: meta.initiatedByHandler === 1,
            isClosed: meta.isClosed === 1,
            canInput: meta.permissions ? meta.permissions.canInput : true,
            lockReason: meta.permissions ? meta.permissions.lockReason : "",
            showHandshakeButton: meta.permissions ? meta.permissions.showHandshakeButton : false
          });
        }
      }
    });
  },

  /**
   * 游标增量拉取历史记录 (M37 契约)
   */
  loadHistoryMessages(cursorId: number = 0): Promise<void> {
    return new Promise((resolve) => {
      const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";
      if (!wx.request || !this.data.chatRoomId) return resolve();

      wx.request({
        url: `${API_BASE}/api/v4/chat/rooms/history?chatRoomId=${this.data.chatRoomId}&cursorMessageId=${cursorId}&pageSize=20`,
        method: "GET",
        header: {
          "content-type": "application/json",
          token,
          Authorization: `Bearer ${token}`
        },
        success: (res: any) => {
          if (res?.data?.status === 1 && res.data.data) {
            const listData = res.data.data;
            const messages = listData.messages || [];
            const myUid = this.data.myUserId;

            const mapped: IChatMessageItem[] = messages.map((m: any) => ({
              ...m,
              isSelf: m.senderId === myUid
            }));

            let updatedList: IChatMessageItem[];
            if (cursorId > 0) {
              updatedList = [...mapped, ...this.data.messageList];
            } else {
              updatedList = mapped;
            }

            this.setData({
              messageList: updatedList,
              hasMore: listData.hasMore,
              cursorId: listData.minMessageId || 0
            });

            if (cursorId === 0) {
              this.scrollToBottom();
            }
          }
          resolve();
        },
        fail: () => resolve()
      });
    });
  },

  /**
   * 加载更早历史消息
   */
  loadMoreMessages() {
    if (this.data.hasMore && this.data.cursorId > 0) {
      this.loadHistoryMessages(this.data.cursorId);
    }
  },

  /**
   * 退出聊天室时上报已读消除 (M37 契约)
   */
  markRoomAsRead() {
    const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";
    if (!wx.request || !this.data.chatRoomId) return;

    wx.request({
      url: `${API_BASE}/api/v4/chat/rooms/ack-read`,
      method: "POST",
      header: {
        "content-type": "application/json",
        token,
        Authorization: `Bearer ${token}`
      },
      data: {
        chatRoomId: this.data.chatRoomId
      }
    });
  },

  /**
   * 输入框文本变更
   */
  handleInput(e: any) {
    this.setData({ inputText: e.detail.value || "" });
  },

  /**
   * 发送文本消息 (乐观 UI 插入与落盘同步，支持 M39 引用回复)
   */
  handleSendMessage() {
    const content = this.data.inputText.trim();
    if (!content) return;

    if (!this.data.canInput) {
      wx.showToast({
        title: this.data.lockReason || "当前通道未开启",
        icon: "none"
      });
      return;
    }

    const replyMsg = this.data.replyingToMessage;
    const answerMessageId = replyMsg ? (parseInt(String(replyMsg.id).replace(/\D/g, ""), 10) || 0) : 0;
    const tempClientMsgId = "TEMP_" + Date.now();
    const tempBubble: IChatMessageItem = {
      id: tempClientMsgId,
      chatRoomId: this.data.chatRoomId,
      senderId: this.data.myUserId,
      senderRole: this.data.isMaster ? 1 : 0,
      senderName: "我",
      isSelf: true,
      type: 0,
      content,
      answerMessageId,
      quotedMessage: replyMsg ? {
        id: answerMessageId,
        senderName: replyMsg.senderName || "用户",
        summary: replyMsg.content ? replyMsg.content.substring(0, 30) : ""
      } : undefined,
      isWithDraw: 0,
      createdAt: "刚刚",
      isLoading: true
    };

    // 乐观 UI 插入并触底
    this.setData({
      messageList: [...this.data.messageList, tempBubble],
      inputText: "",
      replyingToMessage: null,
      showMediaPanel: false
    });
    this.scrollToBottom();

    const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";
    if (!wx.request) return;

    const requestUrl = answerMessageId > 0
      ? `${API_BASE}/api/v4/chat/messages/quote`
      : `${API_BASE}/api/v4/chat/rooms/messages`;

    wx.request({
      url: requestUrl,
      method: "POST",
      header: {
        "content-type": "application/json",
        token,
        Authorization: `Bearer ${token}`
      },
      data: {
        chatRoomId: this.data.chatRoomId,
        type: 0,
        content,
        answerMessageId,
        clientMsgId: tempClientMsgId
      },
      success: (res: any) => {
        if (res?.data?.status === 1 && res.data.data) {
          const resp = res.data.data;
          const updated = this.data.messageList.map((m: IChatMessageItem) => {
            if (m.id === tempClientMsgId) {
              return {
                ...m,
                id: resp.messageId,
                isLoading: false,
                content: resp.content || m.content,
                quotedMessage: resp.quotedMessage || m.quotedMessage
              };
            }
            return m;
          });
          this.setData({ messageList: updated });
        } else {
          // 标记失败
          const updated = this.data.messageList.map((m: IChatMessageItem) => {
            if (m.id === tempClientMsgId) {
              return { ...m, isLoading: false, isFailed: true };
            }
            return m;
          });
          this.setData({ messageList: updated });
          wx.showToast({ title: res?.data?.content || "发送受限", icon: "none" });
        }
      },
      fail: () => {
        const updated = this.data.messageList.map((m: IChatMessageItem) => {
          if (m.id === tempClientMsgId) {
            return { ...m, isLoading: false, isFailed: true };
          }
          return m;
        });
        this.setData({ messageList: updated });
        wx.showToast({ title: "网络异常，未能送达", icon: "none" });
      }
    });
  },

  /**
   * 拍照直发
   */
  handleCamera() {
    if (!wx.chooseMedia) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["camera"],
      camera: "back",
      success: (res: any) => {
        if (res.tempFiles && res.tempFiles[0]) {
          this.uploadAndSendImage(res.tempFiles[0].tempFilePath);
        }
      }
    });
  },

  /**
   * 手机相册选图
   */
  handleAlbum() {
    if (!wx.chooseMedia) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album"],
      success: (res: any) => {
        if (res.tempFiles && res.tempFiles[0]) {
          this.uploadAndSendImage(res.tempFiles[0].tempFilePath);
        }
      }
    });
  },

  /**
   * 上传并发送图片消息 (type = 1)
   */
  uploadAndSendImage(filePath: string) {
    wx.showLoading({ title: "上传图片中..." });
    const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";

    wx.uploadFile({
      url: `${API_BASE}/api/storage/oss/upload`,
      filePath,
      name: "file",
      header: {
        token,
        Authorization: `Bearer ${token}`
      },
      success: (uploadRes: any) => {
        wx.hideLoading();
        try {
          const parsed = JSON.parse(uploadRes.data);
          const imageUrl = parsed?.data?.url || parsed?.url;
          if (imageUrl) {
            this.sendMediaMessage(1, imageUrl);
          } else {
            wx.showToast({ title: "图片解析失败", icon: "none" });
          }
        } catch {
          wx.showToast({ title: "上传响应异常", icon: "none" });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: "图片上传失败", icon: "none" });
      }
    });
  },

  /**
   * 发送多媒体/特殊形态消息
   */
  sendMediaMessage(type: 1 | 2, content: string) {
    const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";
    if (!wx.request) return;

    const tempClientMsgId = "TEMP_" + Date.now();
    const tempBubble: IChatMessageItem = {
      id: tempClientMsgId,
      chatRoomId: this.data.chatRoomId,
      senderId: this.data.myUserId,
      senderRole: this.data.isMaster ? 1 : 0,
      senderName: "我",
      isSelf: true,
      type,
      content,
      isWithDraw: 0,
      createdAt: "刚刚",
      isLoading: true
    };

    this.setData({
      messageList: [...this.data.messageList, tempBubble],
      showMediaPanel: false
    });
    this.scrollToBottom();

    wx.request({
      url: `${API_BASE}/api/v4/chat/rooms/messages`,
      method: "POST",
      header: {
        "content-type": "application/json",
        token,
        Authorization: `Bearer ${token}`
      },
      data: {
        chatRoomId: this.data.chatRoomId,
        type,
        content,
        clientMsgId: tempClientMsgId
      },
      success: (res: any) => {
        if (res?.data?.status === 1 && res.data.data) {
          const resp = res.data.data;
          const updated = this.data.messageList.map((m: IChatMessageItem) => {
            if (m.id === tempClientMsgId) {
              return { ...m, id: resp.messageId, isLoading: false };
            }
            return m;
          });
          this.setData({ messageList: updated });
        }
      }
    });
  },

  /**
   * 发送常用语快捷消息
   */
  handleQuickReply(e: any) {
    const text = e.detail?.text;
    if (text) {
      this.setData({ inputText: text }, () => {
        this.handleSendMessage();
      });
    }
  },

  /**
   * 发送工单卡片 (type = 2)
   */
  handleSendCard() {
    const cardContent = `工单 #${this.data.orderNo || this.data.patrolId} [${this.data.statusText}] ${this.data.locationName}`;
    this.sendMediaMessage(2, cardContent);
  },

  /**
   * 发送位置
   */
  handleLocation() {
    const loc = `${this.data.locationName || "校园现场"}`;
    this.setData({ inputText: `📍 我当前在：${loc}` }, () => {
      this.handleSendMessage();
    });
  },

  /**
   * 师傅一键主动握手激活协同通道
   */
  handleInitiateChat() {
    const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";
    if (!wx.request) return;

    wx.request({
      url: `${API_BASE}/api/v4/chat/rooms/activate-handshake`,
      method: "POST",
      header: {
        "content-type": "application/json",
        token,
        Authorization: `Bearer ${token}`
      },
      data: {
        chatRoomId: this.data.chatRoomId
      },
      success: (res: any) => {
        if (res?.data?.status === 1) {
          wx.showToast({ title: "已成功开启协同通道", icon: "success" });
          this.setData({
            initiatedByHandler: true,
            canInput: true,
            showHandshakeButton: false,
            lockReason: ""
          });
        } else {
          wx.showToast({ title: res?.data?.content || "激活受限", icon: "none" });
        }
      }
    });
  },

  /**
   * 展开/收起多媒体扩展面板
   */
  handleToggleMediaPanel() {
    this.setData({
      showMediaPanel: !this.data.showMediaPanel
    });
  },

  handleToggleEmoji() {
    this.setData({
      inputText: this.data.inputText + "😊"
    });
  },

  handleMicVoice() {
    wx.showToast({ title: "长按语音暂未开放", icon: "none" });
  },

  /**
   * 气泡长按呼起操作浮层
   */
  handleActionPopover(e: any) {
    const detail = e.detail;
    this.setData({
      showActionMenu: true,
      selectedActionMsg: detail
    });
  },

  handleCloseActionMenu() {
    this.setData({ showActionMenu: false, selectedActionMsg: null });
  },

  handleMenuCopy() {
    const msg = this.data.selectedActionMsg;
    if (msg && msg.content && wx.setClipboardData) {
      wx.setClipboardData({
        data: msg.content,
        success: () => {
          wx.showToast({ title: "已复制到剪贴板", icon: "none" });
        }
      });
    }
    this.handleCloseActionMenu();
  },

  handleMenuQuote() {
    const msg = this.data.selectedActionMsg;
    if (msg) {
      this.setData({
        replyingToMessage: {
          id: msg.messageId,
          content: msg.content,
          senderName: msg.senderName,
          type: 0
        },
        showActionMenu: false
      });
    }
  },

  handleMenuWithdraw() {
    const msg = this.data.selectedActionMsg;
    this.handleCloseActionMenu();
    if (!msg || !msg.messageId) return;

    const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";
    wx.request({
      url: `${API_BASE}/api/v4/chat/messages/withdraw`,
      method: "POST",
      header: {
        "content-type": "application/json",
        token,
        Authorization: `Bearer ${token}`
      },
      data: {
        chatRoomId: this.data.chatRoomId,
        messageId: msg.messageId
      },
      success: (res: any) => {
        if (res?.data?.status === 1 || res?.data?.code === 200) {
          const resData = res?.data?.data || {};
          const originalText = resData.originalText || msg.content;
          const { updatedList } = BubbleInPlaceMutationMachine.mutate(
            this.data.messageList as any[],
            msg.messageId,
            this.data.myUserId,
            this.data.myUserId,
            originalText,
            false
          );
          this.setData({ messageList: updatedList as IChatMessageItem[] });
          wx.showToast({ title: "已撤回", icon: "success" });
        } else {
          wx.showToast({ title: res?.data?.content || res?.data?.message || "撤回失败", icon: "none" });
        }
      },
      fail: () => {
        wx.showToast({ title: "网络请求异常", icon: "none" });
      }
    });
  },

  /**
   * 点击重新编辑回填输入框 (M38)
   */
  handleReEditMessage(e: any) {
    const originalText = e.detail?.originalText;
    if (typeof originalText === "string") {
      this.setData({ inputText: originalText });
      wx.showToast({ title: "已填入编辑框", icon: "none" });
    }
  },

  handleCancelQuote() {
    this.setData({ replyingToMessage: null });
  },

  /**
   * M39: 联动定位源消息 (算法2 & 算法3)
   */
  async handleLocateQuote(e: any) {
    const targetMessageId = Number(e.detail?.targetMessageId || 0);
    if (!targetMessageId) return;

    // 使用算法2计算视图滚动目标
    const scrollTarget = ViewportScrollTargetCalculator.calculate(
      targetMessageId,
      this.data.messageList as any[]
    );

    if (scrollTarget.inViewport) {
      // 命中当前渲染列表，执行高亮与平滑滚动 (算法4)
      this.executeScrollAndHighlight(scrollTarget.elementId, targetMessageId);
    } else {
      // 属于极远历史记录，触发对称上下文切片拉取 (算法3)
      await this.fetchFarHistoryContextSlice(targetMessageId);
    }
  },

  /**
   * 执行滚动定位与高亮发光衰减 (算法4: 1500ms)
   */
  executeScrollAndHighlight(elementId: string, messageId: number) {
    this.setData({
      scrollIntoViewId: elementId,
      highlightMessageId: messageId
    });

    // 1500ms 发光衰减结束后清除高亮状态
    setTimeout(() => {
      if (this.data.highlightMessageId === messageId) {
        this.setData({ highlightMessageId: 0 });
      }
    }, 1500);
  },

  /**
   * 拉取极远源消息对称上下文切片 (算法3)
   */
  fetchFarHistoryContextSlice(targetMessageId: number): Promise<void> {
    return new Promise((resolve) => {
      wx.showLoading({ title: "正在定位源消息..." });
      const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";

      wx.request({
        url: `${API_BASE}/api/v4/chat/rooms/context-slice?chatRoomId=${this.data.chatRoomId}&anchorMessageId=${targetMessageId}&windowSize=20`,
        method: "GET",
        header: {
          "content-type": "application/json",
          token,
          Authorization: `Bearer ${token}`
        },
        success: (res: any) => {
          wx.hideLoading();
          if (res?.data?.status === 1 && res.data.data) {
            const sliceData = res.data.data;
            const messages = sliceData.messages || [];
            const myUid = this.data.myUserId;

            const mapped: IChatMessageItem[] = messages.map((m: any) => ({
              ...m,
              isSelf: m.senderId === myUid
            }));

            this.setData({
              messageList: mapped,
              isViewingHistoricalSlice: true
            }, () => {
              // 渲染完成后定位至锚点
              const elementId = ViewportScrollTargetCalculator.getTargetElementId(targetMessageId);
              this.executeScrollAndHighlight(elementId, targetMessageId);
            });
          } else {
            wx.showToast({
              title: res?.data?.content || "源消息定位失败或已被清理",
              icon: "none"
            });
          }
          resolve();
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: "网络请求失败", icon: "none" });
          resolve();
        }
      });
    });
  },

  /**
   * 退出历史切片，返回最新瀑布流
   */
  handleReturnToLatest() {
    this.setData({
      isViewingHistoricalSlice: false,
      messageList: [],
      cursorId: 0
    }, () => {
      this.loadHistoryMessages(0);
    });
  },

  handleViewPatrolDetail() {
    const pId = this.data.patrolId;
    if (pId && wx.navigateTo) {
      wx.navigateTo({
        url: `/packages/apps/app-patrol/pages/detail/index?id=${pId}`
      });
    }
  },

  /**
   * 平滑滚动触底
   */
  scrollToBottom() {
    setTimeout(() => {
      this.setData({ scrollIntoViewId: "scroll-bottom-anchor" });
    }, 150);
  },

  /**
   * 监听 WebSocket 跨节点实时推送
   */
  listenWebSocketMessages() {
    const app = getApp ? getApp() : null;
    if (!app || !app.globalData?.socketTask) return;

    try {
      app.globalData.socketTask.onMessage((res: any) => {
        try {
          const payload = JSON.parse(res.data);
          if (payload.event === "CHAT_MESSAGE_ARRIVED" && payload.chatRoomId === this.data.chatRoomId) {
            const incoming = payload.message;
            if (incoming.senderId !== this.data.myUserId) {
              const newBubble: IChatMessageItem = {
                ...incoming,
                isSelf: false
              };
              this.setData({
                messageList: [...this.data.messageList, newBubble]
              });
              this.scrollToBottom();

              // M40: 当前激活会话零红点直接自愈，就地已读消退
              this.markRoomAsRead();
            }
          } else if (payload.event === "CHAT_HANDSHAKE_ACTIVATED" && payload.chatRoomId === this.data.chatRoomId) {
            this.setData({
              initiatedByHandler: true,
              canInput: true,
              showHandshakeButton: false,
              lockReason: ""
            });
            wx.showToast({ title: "责任师傅已开启协同通道", icon: "none" });
          } else if (payload.event === "MESSAGE_WITHDRAWN" && payload.chatRoomId === this.data.chatRoomId) {
            const p = payload.payload || {};
            const { messageId, operatorId, isSystemRecall } = p;
            const { updatedList, hitIndex } = BubbleInPlaceMutationMachine.mutate(
              this.data.messageList as any[],
              messageId,
              operatorId,
              this.data.myUserId,
              undefined,
              Boolean(isSystemRecall)
            );
            if (hitIndex !== -1) {
              this.setData({ messageList: updatedList as IChatMessageItem[] });
            }
          }
        } catch {
          // 忽略非 JSON
        }
      });
    } catch {
      // 降级忽略
    }
  }
});
