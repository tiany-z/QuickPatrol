/**
 * 高校后勤巡查e速办 v4.0 - M42: 微应用官方服务号条目卡片组件控制器
 * (App Session Item Component Controller)
 */

Component({
  properties: {
    session: {
      type: Object,
      value: {
        appCode: "",
        appName: "微应用助手",
        appIcon: "/assets/icons/default.png",
        category: "daily",
        unreadCount: 0,
        lastNoticeTitle: "",
        lastNoticeSnippet: "",
        lastNoticeAt: "",
        formattedTimeText: ""
      }
    }
  },

  methods: {
    onTapItem() {
      const session = this.data.session;
      this.triggerEvent("tapSession", { session });
    }
  }
});
