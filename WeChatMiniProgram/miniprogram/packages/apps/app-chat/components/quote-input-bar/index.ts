/**
 * M39: 输入框上方吸顶待发引用卡片组件 (quote-input-bar)
 */

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    senderName: {
      type: String,
      value: ""
    },
    summary: {
      type: String,
      value: ""
    }
  },

  methods: {
    /**
     * 点击关闭按钮取消当前引用状态
     */
    onTapClose() {
      this.triggerEvent("cancel");
    }
  }
});
