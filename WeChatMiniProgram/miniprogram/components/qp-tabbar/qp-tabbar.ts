import { ITabBarItem } from "../../typings/router.js";

Component({
  properties: {
    activeIndex: {
      type: Number,
      value: 0
    }
  },
  data: {
    tabList: [
      {
        pagePath: "/pages/messages/index",
        text: "消息",
        iconPath: "/assets/tabbar/tab_msg.png",
        selectedIconPath: "/assets/tabbar/tab_msg_active.png",
        badgeCount: 0
      },
      {
        pagePath: "/pages/workplace/index",
        text: "工作台",
        iconPath: "/assets/tabbar/tab_work.png",
        selectedIconPath: "/assets/tabbar/tab_work_active.png",
        badgeCount: 0
      },
      {
        pagePath: "/pages/calendar/index",
        text: "日历",
        iconPath: "/assets/tabbar/tab_cal.png",
        selectedIconPath: "/assets/tabbar/tab_cal_active.png",
        badgeCount: 0
      },
      {
        pagePath: "/pages/ai-copilot/index",
        text: "AI助手",
        iconPath: "/assets/tabbar/tab_ai.png",
        selectedIconPath: "/assets/tabbar/tab_ai_active.png",
        badgeCount: 0
      }
    ] as ITabBarItem[],
    lastTapTime: 0
  },
  methods: {
    onTabTap(e: any) {
      const now = Date.now();
      // 300ms 防抖节流
      if (now - this.data.lastTapTime < 300) {
        return;
      }
      this.setData({ lastTapTime: now });

      const index = Number(e.currentTarget.dataset.index);
      if (index === this.data.activeIndex) {
        return;
      }

      // 触觉反馈马达震动
      try {
        if (typeof wx !== "undefined" && wx.vibrateShort) {
          wx.vibrateShort({ type: "light" });
        }
      } catch {}

      const targetPath = this.data.tabList[index].pagePath;
      if (typeof wx !== "undefined" && wx.switchTab) {
        wx.switchTab({ url: targetPath });
      }
      this.triggerEvent("tabChange", { index, targetPath });
    }
  }
});
