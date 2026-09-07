/**
 * 高校后勤巡查e速办 v4.0 - M51 全景日历日程联动与值班排班表
 * 文件路径: miniprogram/packages/apps/calendar/components/shift-card/index.ts
 * 核心职责: 今日值班人员专属实名名牌组件，展示岗位职责与支持一键拨号
 */

Component({
  properties: {
    staffData: {
      type: Object,
      value: {} as any
    }
  },

  methods: {
    handleCall() {
      const phone = this.data.staffData?.dutyPhone;
      if (!phone) {
        wx.showToast({ title: "暂无联络电话", icon: "none" });
        return;
      }

      if (typeof wx.vibrateShort === "function") {
        wx.vibrateShort({ type: "medium" });
      }

      wx.makePhoneCall({
        phoneNumber: phone,
        fail: () => {
          // 用户取消或平台限制
        }
      });
    }
  }
});
