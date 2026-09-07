Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    },
    postId: {
      type: Number,
      value: 0
    }
  },

  data: {
    guestNick: "热心师生",
    guestAvatarUrl: "",
    commentContent: "",
    isSubmitting: false
  },

  methods: {
    stopProp() {
      // 阻止蒙层点击事件穿透
    },

    onChooseAvatar(e: any) {
      const avatarUrl = e.detail?.avatarUrl || "";
      this.setData({ guestAvatarUrl: avatarUrl });
    },

    onInputNick(e: any) {
      this.setData({ guestNick: e.detail?.value || "" });
    },

    onInputContent(e: any) {
      this.setData({ commentContent: e.detail?.value || "" });
    },

    async onSubmit() {
      const { guestNick, guestAvatarUrl, commentContent } = this.data;
      const postId = this.properties.postId;

      if (!commentContent || commentContent.trim().length < 2) {
        wx.showToast({ title: "留言内容至少 2 个字", icon: "none" });
        return;
      }

      this.setData({ isSubmitting: true });

      try {
        const res: any = await new Promise((resolve, reject) => {
          wx.request({
            url: "https://api.xcesb.cn/api/v4/space/feeds/guest-comment",
            method: "POST",
            data: {
              postId,
              guestNick: guestNick || "热心师生",
              guestAvatar: guestAvatarUrl,
              commentContent: commentContent.trim()
            },
            success: (r) => resolve(r.data),
            fail: (err) => reject(err)
          });
        });

        this.setData({ isSubmitting: false });
        if (res && (res.status === 1 || res.code === 200)) {
          wx.showToast({ title: "留言发表成功！", icon: "success" });
          this.setData({ commentContent: "" });
          this.triggerEvent("success", res.data);
          this.triggerEvent("close");
        } else {
          wx.showToast({ title: res.message || res.content || "留言失败", icon: "none" });
        }
      } catch {
        this.setData({ isSubmitting: false });
        wx.showToast({ title: "网络连接超时", icon: "none" });
      }
    },

    onClose() {
      this.triggerEvent("close");
    }
  }
});
