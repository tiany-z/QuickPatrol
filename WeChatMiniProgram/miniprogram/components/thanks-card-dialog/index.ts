/**
 * 高校后勤巡查e速办 v4.0 - M32: 师生文创感谢卡赠送弹窗组件
 */

Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    },
    appealId: {
      type: Number,
      value: 0
    },
    vaultToken: {
      type: String,
      value: ""
    }
  },

  data: {
    selectedType: "WARMTH",
    studentComment: "",
    isSubmitting: false,
    cards: [
      { type: "SPEED", icon: "⚡", name: "神速解决卡", desc: "雷厉风行，当日排查解决", points: 10 },
      { type: "WARMTH", icon: "🌸", name: "暖心关怀卡", desc: "态度温和，细致沟通入微", points: 10 },
      { type: "ACTION", icon: "🛠️", name: "雷厉风行卡", desc: "敢碰顽疾，彻底消灭痛点", points: 15 },
      { type: "PRAISE", icon: "🌟", name: "全五星赞赏卡", desc: "无可挑剔，满分后勤典范", points: 20 }
    ]
  },

  methods: {
    preventTouchMove() {
      // 阻止蒙层穿透
    },

    preventBubble() {
      // 阻止事件冒泡
    },

    onSelectCard(e: any) {
      const selectedType = e.currentTarget.dataset.type;
      this.setData({ selectedType });
    },

    onInputComment(e: any) {
      this.setData({ studentComment: e.detail.value });
    },

    async onSubmitCard() {
      const { appealId, selectedType, studentComment, vaultToken } = this.data;
      if (!studentComment || studentComment.trim().length < 3) {
        wx.showToast({ title: "请输入至少3字真诚感谢寄语", icon: "none" });
        return;
      }

      this.setData({ isSubmitting: true });
      wx.showLoading({ title: "传递温暖感谢中..." });

      try {
        const res: any = await new Promise((resolve, reject) => {
          wx.request({
            url: "https://api.xcesb.cn/api/v4/feedback/appeals/send-thanks-card",
            method: "POST",
            header: {
              "content-type": "application/json",
              "Authorization": "Bearer " + wx.getStorageSync("token"),
              "x-school-id": wx.getStorageSync("schoolId") || "1"
            },
            data: {
              appealId,
              cardType: selectedType,
              studentComment: studentComment.trim(),
              vaultToken
            },
            success: (r) => resolve(r.data),
            fail: (err) => reject(err)
          });
        });

        wx.hideLoading();
        this.setData({ isSubmitting: false });

        if (res && res.status === 1) {
          this.triggerEvent("success", res.data);
        } else {
          wx.showToast({ title: res?.content || res?.message || "赠送失败", icon: "none" });
        }
      } catch {
        wx.hideLoading();
        this.setData({ isSubmitting: false });
        wx.showToast({ title: "网络异常，请重试", icon: "none" });
      }
    },

    onClose() {
      this.triggerEvent("close");
    }
  }
});
