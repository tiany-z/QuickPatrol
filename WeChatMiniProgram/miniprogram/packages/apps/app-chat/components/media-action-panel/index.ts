/**
 * M37: 底部多媒体扩展条逻辑组件 (media-action-panel)
 */



Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    },
    isHandler: {
      type: Boolean,
      value: false,
      observer(newVal: boolean) {
        this.updateCannedReplies(newVal);
      }
    }
  },

  data: {
    cannedReplies: [] as string[]
  },

  lifetimes: {
    attached() {
      this.updateCannedReplies(this.data.isHandler);
    }
  },

  methods: {
    updateCannedReplies(isHandler: boolean) {
      if (isHandler) {
        this.setData({
          cannedReplies: [
            "已到宿舍楼下，请开门",
            "现场已处理完毕，请同学确认",
            "缺少专用备件，正在领料中",
            "已联系班组师傅协同处理"
          ]
        });
      } else {
        this.setData({
          cannedReplies: [
            "在宿舍，门虚掩，直接进",
            "下午有课不在寝室",
            "师傅大概什么时候能到？",
            "损坏严重漏水，请尽快排查"
          ]
        });
      }
    },

    onTapCamera() {
      this.triggerEvent("camera");
    },

    onTapAlbum() {
      this.triggerEvent("album");
    },

    onTapLocation() {
      this.triggerEvent("location");
    },

    onTapSendCard() {
      this.triggerEvent("sendCard");
    },

    onTapCallHotline() {
      if (wx.makePhoneCall) {
        wx.makePhoneCall({
          phoneNumber: "0535-6901234"
        });
      }
    },

    onSelectCannedReply(e: any) {
      const text = e.currentTarget.dataset.text;
      if (text) {
        this.triggerEvent("canned", { text });
      }
    }
  }
});
