Component({
  properties: {
    postId: {
      type: Number,
      value: 0
    },
    initialLiked: {
      type: Boolean,
      value: false
    },
    initialCount: {
      type: Number,
      value: 0
    }
  },

  data: {
    isLiked: false,
    likeCount: 0,
    isAnimating: false,
    unlikedIcon: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238E8E93' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'/></svg>",
    likedIcon: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23FF2D55' stroke='%23FF2D55' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'/></svg>"
  },

  observers: {
    "initialLiked, initialCount": function (initLiked: boolean, initCount: number) {
      this.setData({
        isLiked: Boolean(initLiked),
        likeCount: Number(initCount) || 0
      });
    }
  },

  lifetimes: {
    attached() {
      this.setData({
        isLiked: this.data.initialLiked,
        likeCount: this.data.initialCount
      });
    }
  },

  methods: {
    async onToggleTap() {
      const { postId, isLiked, likeCount } = this.data;

      if (!postId || postId <= 0) {
        return;
      }

      // 1. 触发轻量级触感短震动
      try {
        wx.vibrateShort({ type: "light" });
      } catch {
        // ignore
      }

      // 2. 乐观翻转 UI
      const prevLiked = isLiked;
      const prevCount = likeCount;

      const targetLiked = !isLiked;
      const targetCount = targetLiked ? likeCount + 1 : Math.max(0, likeCount - 1);

      this.setData({
        isLiked: targetLiked,
        likeCount: targetCount,
        isAnimating: targetLiked // 点赞时激活粒子爆发动画
      });

      // 动画 600ms 后复位
      if (targetLiked) {
        setTimeout(() => {
          this.setData({ isAnimating: false });
        }, 600);
      }

      // 触发事件通知上层
      this.triggerEvent("likeChange", {
        postId,
        isLiked: targetLiked,
        likeCount: targetCount
      });

      // 3. 发起后端异步持久化
      try {
        const token = wx.getStorageSync("token") || "";
        const schoolCode = wx.getStorageSync("currentSchoolCode") || "lcu";

        const res: any = await new Promise((resolve, reject) => {
          wx.request({
            url: `https://api.xcesb.cn/api/v4/space/feeds/toggle-like`,
            method: "POST",
            data: { postId },
            header: {
              "Content-Type": "application/json",
              Authorization: token ? `Bearer ${token}` : "",
              "x-school-code": schoolCode
            },
            success: (r) => resolve(r.data),
            fail: (err) => reject(err)
          });
        });

        if (res && (res.code === 200 || res.status === 1)) {
          const payload = res.data || res;
          if (typeof payload.isLiked === "boolean") {
            this.setData({
              isLiked: payload.isLiked,
              likeCount: payload.currentLikeCount ?? targetCount
            });
          }
        } else {
          // 异常回滚
          this.setData({ isLiked: prevLiked, likeCount: prevCount, isAnimating: false });
          wx.showToast({
            title: (res && (res.message || res.content)) || "点赞操作失败",
            icon: "none"
          });
        }
      } catch {
        // 网络失败悲观回滚
        this.setData({ isLiked: prevLiked, likeCount: prevCount, isAnimating: false });
        wx.showToast({ title: "网络异常，点赞已回退", icon: "none" });
      }
    }
  }
});
