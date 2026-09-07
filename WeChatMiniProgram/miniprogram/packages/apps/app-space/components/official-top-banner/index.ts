Component({
  properties: {
    banners: {
      type: Array,
      value: []
    }
  },

  data: {
    currentIndex: 0
  },

  methods: {
    onSwiperChange(e: any) {
      const current = e.detail?.current || 0;
      this.setData({ currentIndex: current });
    },

    onBannerClick(e: any) {
      const noticeId = Number(e.currentTarget?.dataset?.id || 0);
      if (!noticeId) return;

      this.triggerEvent("bannerTap", { noticeId });

      try {
        wx.navigateTo({
          url: `/packages/apps/app-space/pages/notice-detail/index?id=${noticeId}`,
          fail: () => {
            // 若独立通告页尚未开辟，降级回退提示
            wx.showModal({
              title: "官方公告详情",
              content: "您正在查阅官方置顶通告 #" + noticeId,
              showCancel: false
            });
          }
        });
      } catch {
        // ignore
      }
    }
  }
});
