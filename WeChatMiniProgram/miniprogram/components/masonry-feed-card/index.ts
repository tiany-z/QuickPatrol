import { ISpaceFeedCardDto } from "../../packages/apps/app-space/pages/feed-stream/types";

Component({
  properties: {
    card: {
      type: Object,
      value: {}
    }
  },

  data: {
    isLiked: false,
    likeCountDisplay: 0
  },

  observers: {
    "card.likeCount": function(val: number) {
      this.setData({ likeCountDisplay: val || 0 });
    }
  },

  methods: {
    /**
     * 点赞微动效与请求
     */
    async onLikeTap() {
      if (this.data.isLiked) {
        wx.showToast({ title: "您今日已点赞啦~", icon: "none" });
        return;
      }

      const card = this.properties.card as ISpaceFeedCardDto;
      if (!card || !card.postId) return;

      // 乐观更新
      this.setData({
        isLiked: true,
        likeCountDisplay: this.data.likeCountDisplay + 1
      });

      // 模拟/生成设备指纹
      let model = "GenericPhone";
      try {
        const sys = wx.getSystemInfoSync();
        model = (sys.model || "Device").replace(/\s+/g, "_");
      } catch {
        // ignore
      }
      const fingerprint = "FP_" + model;

      try {
        const res: any = await new Promise((resolve, reject) => {
          wx.request({
            url: "https://api.xcesb.cn/api/v4/space/feeds/like",
            method: "POST",
            data: {
              postId: card.postId,
              clientFingerprint: fingerprint
            },
            success: (r) => resolve(r.data),
            fail: (err) => reject(err)
          });
        });

        if (res && res.status !== 1 && res.code !== 200) {
          // 回滚乐观更新
          this.setData({
            isLiked: false,
            likeCountDisplay: Math.max(0, this.data.likeCountDisplay - 1)
          });
          wx.showToast({ title: res.message || res.content || "点赞受限", icon: "none" });
        }
      } catch {
        this.setData({
          isLiked: false,
          likeCountDisplay: Math.max(0, this.data.likeCountDisplay - 1)
        });
      }
    },

    onCommentTap() {
      const card = this.properties.card as ISpaceFeedCardDto;
      if (card && card.postId) {
        this.triggerEvent("comment", { postId: card.postId });
      }
    }
  }
});
