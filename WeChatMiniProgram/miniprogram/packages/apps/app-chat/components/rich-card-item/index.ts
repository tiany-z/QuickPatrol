/**
 * 高校后勤巡查e速办 v4.0 - M44: 100% 结构化富卡片渲染组件
 * (Rich Card Item Component)
 */

Component({
  properties: {
    card: {
      type: Object,
      value: {}
    }
  },

  methods: {
    /**
     * 点击卡片内的缩略图触发全屏画廊预览 (算法 4)
     */
    onTapThumbnail() {
      const card = this.data.card;
      const payload = card?.cardPayload;
      if (!payload) return;

      const currentUrl = payload.rawImageUrl || payload.thumbnailUrl;
      if (!currentUrl) return;

      this.triggerEvent("previewimage", {
        currentUrl,
        allUrls: [currentUrl]
      });
    },

    /**
     * 点击卡片底部动作按钮，抛送事件交付父页面/M45 原地变迁
     */
    onTapActionButton(e: any) {
      const action = e.currentTarget.dataset.action;
      if (!action || action.disabled) return;

      const card = this.data.card;
      this.triggerEvent("cardaction", {
        actionId: action.actionId,
        messageId: card?.messageId,
        patrolId: card?.patrolId,
        payload: action.payload
      });
    }
  }
});
