// 高校后勤巡查e速办 v4.0 - 门户转发中枢
Component({
  data: {},
  pageLifetimes: {
    show() {
      wx.reLaunch({
        url: "/pages/workplace/index"
      });
    }
  },
  methods: {
    onLoad() {
      wx.reLaunch({
        url: "/pages/workplace/index"
      });
    }
  }
});
