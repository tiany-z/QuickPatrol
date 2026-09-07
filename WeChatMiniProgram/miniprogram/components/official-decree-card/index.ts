/**
 * 高校后勤巡查e速办 v4.0 - M32: 官方红头正式答复公函组件
 */

Component({
  properties: {
    decreeData: {
      type: Object,
      value: {}
    }
  },

  data: {
    isStamped: false,
    remainingDaysText: "",
    countdownClass: "countdown-green",
    countdownIcon: "🟢"
  },

  observers: {
    "decreeData": function(val: any) {
      if (val && val.deadlineAt) {
        this.calculateCountdown(val.deadlineAt);
        // 延迟 300ms 触发印章盖下动效
        setTimeout(() => {
          this.setData({ isStamped: true });
        }, 300);
      }
    }
  },

  methods: {
    calculateCountdown(deadlineStr: string) {
      const deadline = new Date(deadlineStr).getTime();
      const now = Date.now();
      const diffHours = Math.floor((deadline - now) / (3600 * 1000));

      if (diffHours <= 0) {
        this.setData({
          remainingDaysText: "承诺整改已到期核验中",
          countdownClass: "countdown-red",
          countdownIcon: "🔴"
        });
      } else if (diffHours <= 24) {
        this.setData({
          remainingDaysText: `整改临期预警: 仅剩 ${diffHours} 小时`,
          countdownClass: "countdown-yellow",
          countdownIcon: "🟡"
        });
      } else {
        const days = Math.floor(diffHours / 24);
        const hours = diffHours % 24;
        this.setData({
          remainingDaysText: `承诺整改倒计时: 剩余 ${days} 天 ${hours} 小时`,
          countdownClass: "countdown-green",
          countdownIcon: "🟢"
        });
      }
    },

    onPreviewImage(e: any) {
      const current = e.currentTarget.dataset.url;
      const urls = this.data.decreeData?.images || [];
      wx.previewImage({ current, urls });
    }
  }
});
