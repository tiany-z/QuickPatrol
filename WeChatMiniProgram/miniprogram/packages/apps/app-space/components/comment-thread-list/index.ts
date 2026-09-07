Component({
  properties: {
    threads: {
      type: Array,
      value: []
    }
  },

  methods: {
    /**
     * 点击回复某条评论
     */
    onTapReply(e: any) {
      const commentId = Number(e.currentTarget.dataset.commentId);
      const authorName = String(e.currentTarget.dataset.authorName || "");
      this.triggerEvent("reply", {
        replyCommentId: commentId,
        replyAuthorName: authorName
      });
    },

    /**
     * 展开查看更多二级楼层
     */
    onExpandMoreSubReplies(e: any) {
      const rootId = Number(e.currentTarget.dataset.rootId);
      this.triggerEvent("expand", { rootId });
    }
  }
});
