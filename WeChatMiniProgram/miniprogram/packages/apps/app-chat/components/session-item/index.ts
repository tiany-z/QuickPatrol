/**
 * 高校后勤巡查e速办 v4.0 - M40: 会话大盘条目组件 (Session Item Component)
 * 支持左滑置顶/取消置顶抽屉、未读红点展示与点击进入
 */

Component({
  properties: {
    session: {
      type: Object,
      value: {}
    }
  },

  data: {
    offsetX: 0,
    isOpened: false
  },

  methods: {
    /**
     * 点击整行条目进入聊天室
     */
    onTapItem() {
      if (this.data.isOpened) {
        this.closeDrawer();
        return;
      }
      const s = this.data.session;
      this.triggerEvent("tapitem", {
        chatRoomId: s.chatRoomId,
        patrolId: s.patrolId,
        orderNo: s.patrolOrderNo
      });
    },

    /**
     * 点击左滑抽屉中的置顶/取消置顶按钮
     */
    onTapPinAction() {
      const s = this.data.session;
      this.triggerEvent("togglepin", {
        chatRoomId: s.chatRoomId,
        pin: !s.isPinned
      });
      this.closeDrawer();
    },

    /**
     * 关闭侧滑抽屉
     */
    closeDrawer() {
      this.setData({ offsetX: 0, isOpened: false });
    },

    /**
     * 监听滑动结束或位移改变
     */
    onChange(e: any) {
      if (e.detail.source === "touch") {
        const x = e.detail.x;
        // 滑动超过 -40px (约 -80rpx) 自动吸附展开
        if (x < -40) {
          this.setData({ isOpened: true });
        } else {
          this.setData({ isOpened: false });
        }
      }
    }
  }
});
