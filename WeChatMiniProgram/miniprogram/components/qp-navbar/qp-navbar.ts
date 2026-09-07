Component({
  options: {
    multipleSlots: true
  },
  properties: {
    title: {
      type: String,
      value: "高校后勤巡查e速办"
    },
    showAvatar: {
      type: Boolean,
      value: false
    },
    avatarUrl: {
      type: String,
      value: ""
    },
    bgMode: {
      type: String,
      value: "translucent" // "translucent" | "solid" | "transparent"
    },
    theme: {
      type: String,
      value: "light" // "light" | "dark"
    },
    showBack: {
      type: Boolean,
      value: false
    },
    placeholder: {
      type: Boolean,
      value: true
    }
  },
  data: {
    statusBarHeight: 44,
    navBarHeight: 44,
    headerTotalHeight: 88,
    capsulePaddingRight: 96
  },
  lifetimes: {
    attached() {
      this.initMetrics();
    }
  },
  pageLifetimes: {
    show() {
      this.initMetrics();
    }
  },
  methods: {
    initMetrics() {
      try {
        let statusBarHeight = 44;
        let navBarHeight = 44;
        let headerTotalHeight = 88;
        let capsulePaddingRight = 96;

        const app = typeof getApp === "function" ? getApp<{ globalData: { systemMetrics: any } }>() : null;
        if (app?.globalData?.systemMetrics?.headerTotalHeight) {
          const m = app.globalData.systemMetrics;
          statusBarHeight = m.statusBarHeight || 44;
          navBarHeight = m.navBarHeight || 44;
          headerTotalHeight = m.headerTotalHeight || 88;
          capsulePaddingRight = m.capsule ? m.capsule.width + (m.capsuleRightMargin || 10) : 96;
        } else {
          const wxAny = wx as any;
          const windowInfo = wxAny.getWindowInfo ? wxAny.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {});
          if (windowInfo.statusBarHeight) {
            statusBarHeight = windowInfo.statusBarHeight;
          }
          if (wx.getMenuButtonBoundingClientRect) {
            const cap = wx.getMenuButtonBoundingClientRect();
            if (cap && cap.top && cap.height) {
              navBarHeight = (cap.top - statusBarHeight) * 2 + cap.height;
              const winWidth = windowInfo.windowWidth || 375;
              capsulePaddingRight = winWidth - cap.left + 8;
            }
          }
          headerTotalHeight = statusBarHeight + navBarHeight;
        }

        this.setData({
          statusBarHeight,
          navBarHeight,
          headerTotalHeight,
          capsulePaddingRight
        });
      } catch (e) {
        console.warn("[qp-navbar] 度量计算异常", e);
      }
    },
    onAvatarTap() {
      this.triggerEvent("avatarTap");
    },
    onBackTap() {
      try {
        if (typeof wx !== "undefined" && wx.vibrateShort) {
          wx.vibrateShort({ type: "light" });
        }
      } catch {}

      const pages = getCurrentPages ? getCurrentPages() : [];
      if (pages.length > 1) {
        wx.navigateBack({ delta: 1 });
      } else {
        wx.reLaunch({ url: "/pages/workplace/index" });
      }
    }
  }
});
