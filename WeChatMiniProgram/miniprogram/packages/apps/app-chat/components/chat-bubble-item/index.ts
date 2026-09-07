/**
 * M37: 类 QQ 聊天气泡组件 (chat-bubble-item)
 */



Component({
  properties: {
    message: {
      type: Object,
      value: {}
    },
    isHighlight: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    /**
     * 点击图片全屏放大预览
     */
    onPreviewImage() {
      const { message } = this.data;
      if (message && message.type === 1 && message.content) {
        if (wx.previewImage) {
          wx.previewImage({
            current: message.content,
            urls: [message.content]
          });
        }
      }
    },

    /**
     * 长按呼起操作浮层 (微触感短震动)
     */
    onLongPressBubble() {
      if (wx.vibrateShort) {
        try {
          wx.vibrateShort({ type: "medium" });
        } catch {
          // 降级忽略
        }
      }

      const { message } = this.data;
      if (!message) return;

      this.triggerEvent("actionPopover", {
        messageId: message.id,
        content: message.content,
        isSelf: message.isSelf,
        type: message.type,
        createdAt: message.createdAt
      });
    },

    /**
     * 点击内联工单卡片跳转
     */
    onTapPatrolCard() {
      const { message } = this.data;
      const patrolId = message?.patrolId || message?.answerMessageId;
      if (patrolId && wx.navigateTo) {
        wx.navigateTo({
          url: `/packages/apps/app-patrol/pages/detail/index?id=${patrolId}`
        });
      }
    },

    /**
     * 点击“重新编辑”回填输入框 (M38)
     */
    onTapReEdit() {
      const { message } = this.data;
      const text = message?.originalText;
      if (text) {
        this.triggerEvent("reedit", { originalText: text });
      }
    },

    /**
     * 点击气泡内嵌的引用卡片跳转定位源消息 (M39)
     */
    onTapQuotedCard() {
      const { message } = this.data;
      if (!message || !message.answerMessageId || !message.quotedMessage) return;

      this.triggerEvent("locatequote", {
        answerMessageId: message.answerMessageId,
        isWithdrawn: Boolean(message.quotedMessage.isWithdrawn)
      }, { bubbles: true, composed: true });
    }
  }
});
