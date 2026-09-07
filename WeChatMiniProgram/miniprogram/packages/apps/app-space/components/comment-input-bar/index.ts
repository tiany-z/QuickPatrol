Component({
  properties: {
    postId: {
      type: Number,
      value: 0
    },
    replyCommentId: {
      type: Number,
      value: 0
    },
    replyAuthorName: {
      type: String,
      value: ""
    }
  },

  data: {
    content: "",
    guestNick: "热心师生",
    guestAvatarUrl: "",
    showAuthModal: false,
    isSending: false
  },

  methods: {
    stopProp() {
      // 阻止蒙层事件穿透
    },

    onInput(e: any) {
      this.setData({ content: e.detail?.value || "" });
    },

    onOpenAuthModal() {
      this.setData({ showAuthModal: true });
    },

    onCloseAuthModal() {
      this.setData({ showAuthModal: false });
    },

    onChooseAvatar(e: any) {
      this.setData({ guestAvatarUrl: e.detail?.avatarUrl || "" });
    },

    onNickChange(e: any) {
      this.setData({ guestNick: e.detail?.value || "" });
    },

    onCancelReply() {
      this.triggerEvent("cancelReply");
    },

    async onSubmit() {
      const { content, guestNick, guestAvatarUrl } = this.data;
      const { postId, replyCommentId } = this.properties;

      if (!content || !content.trim()) {
        wx.showToast({ title: "请输入评论文字", icon: "none" });
        return;
      }

      this.setData({ isSending: true });

      try {
        const res: any = await new Promise((resolve, reject) => {
          wx.request({
            url: "https://api.xcesb.cn/api/v4/space/comments",
            method: "POST",
            data: {
              postId,
              replyCommentId,
              guestNick: guestNick || "热心师生",
              guestAvatar: guestAvatarUrl,
              content: content.trim()
            },
            success: (r) => resolve(r.data),
            fail: (err) => reject(err)
          });
        });

        this.setData({ isSending: false });

        if (res && (res.status === 1 || res.code === 200)) {
          wx.showToast({ title: "发表成功", icon: "success" });
          this.setData({ content: "" });
          this.triggerEvent("success", res.data);
        } else if (res && (res.status === 0 && res.content?.includes("频繁"))) {
          wx.showToast({ title: "您发言太快啦，请稍候再试", icon: "none" });
        } else {
          wx.showToast({ title: res?.message || res?.content || "提交失败", icon: "none" });
        }
      } catch {
        this.setData({ isSending: false });
        wx.showToast({ title: "网络连接失败", icon: "none" });
      }
    }
  }
});
