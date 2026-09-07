Page({
  data: {
    roomId: 0,
    title: "",
    patrolId: null as number | null,
    memberCount: 0,
    members: [] as any[],
    isOwnerOrAdmin: false,
    isOwner: false,
    currentUserRole: 0,
    isMuted: false,
    currentNotice: null as any,
    showNoticeModal: false,
    newNoticeContent: ""
  },

  onLoad(options: any) {
    const roomId = parseInt(options.roomId || "0", 10);
    this.setData({ roomId });
    this.loadGroupDetail(roomId);
  },

  loadGroupDetail(roomId: number) {
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
          this.setData({
            title: detail.title,
            patrolId: detail.patrolId,
            memberCount: detail.memberCount,
            members: detail.members || [],
            isOwnerOrAdmin: detail.isOwnerOrAdmin,
            isOwner: detail.currentUserRole === 2,
            currentUserRole: detail.currentUserRole,
            isMuted: Boolean(detail.isMuted),
            currentNotice: detail.notice
          });
        }
      }
    });
  },

  onToggleMute(e: any) {
    const isMuted = e.detail.value;
    this.setData({ isMuted });

    wx.request({
      url: "https://api.xcesb.cn/api/v4/chat/groups/mute",
      method: "POST",
      header: {
        Authorization: "Bearer " + (wx.getStorageSync("token") || ""),
        "x-school-code": "lcu"
      },
      data: {
        chatRoomId: this.data.roomId,
        isMuted
      },
      success: (res: any) => {
        if (res.data?.status === 1) {
          wx.showToast({
            title: isMuted ? "已开启免打扰" : "已关闭免打扰",
            icon: "success"
          });
        }
      }
    });
  },

  onTapOpenNoticeModal() {
    this.setData({
      showNoticeModal: true,
      newNoticeContent: this.data.currentNotice?.content || ""
    });
  },

  onNoticeInput(e: any) {
    this.setData({ newNoticeContent: e.detail.value });
  },

  onCancelNotice() {
    this.setData({ showNoticeModal: false });
  },

  onSubmitNotice() {
    const content = this.data.newNoticeContent.trim();
    if (!content) {
      wx.showToast({ title: "公告内容不可为空", icon: "none" });
      return;
    }

    wx.request({
      url: "https://api.xcesb.cn/api/v4/chat/groups/notice",
      method: "POST",
      header: {
        Authorization: "Bearer " + (wx.getStorageSync("token") || ""),
        "x-school-code": "lcu"
      },
      data: {
        chatRoomId: this.data.roomId,
        content,
        isPinned: true
      },
      success: (res: any) => {
        if (res.data?.status === 1) {
          wx.showToast({ title: "公告已发布", icon: "success" });
          this.setData({ showNoticeModal: false });
          this.loadGroupDetail(this.data.roomId);
        } else {
          wx.showToast({ title: res.data?.message || "发布失败", icon: "none" });
        }
      }
    });
  },

  onTapLeaveGroup() {
    const isOwner = this.data.isOwner;
    const count = this.data.memberCount;

    if (isOwner && count > 1) {
      wx.showModal({
        title: "无法退出",
        content: "您是群主，请先转让群主身份后再退出群聊。",
        showCancel: false
      });
      return;
    }

    const confirmText = (isOwner && count === 1) ? "解散并退出" : "确定退出";
    wx.showModal({
      title: "退出群聊",
      content: `确定要退出该群聊吗？`,
      confirmColor: "#FF4D4F",
      confirmText,
      success: (modalRes) => {
        if (modalRes.confirm) {
          const myUserId = wx.getStorageSync("userId") || 101;
          wx.request({
            url: "https://api.xcesb.cn/api/v4/chat/groups/members/kick",
            method: "POST",
            header: {
              Authorization: "Bearer " + (wx.getStorageSync("token") || ""),
              "x-school-code": "lcu"
            },
            data: {
              chatRoomId: this.data.roomId,
              targetUserId: myUserId
            },
            success: (res: any) => {
              if (res.data?.status === 1) {
                wx.showToast({ title: "已退出群聊", icon: "success" });
                setTimeout(() => {
                  wx.navigateBack({ delta: 2 });
                }, 1000);
              } else {
                wx.showToast({ title: res.data?.message || "退出失败", icon: "none" });
              }
            }
          });
        }
      }
    });
  }
});
