import { ISpaceFeedCardDto, IStreamPageData } from "./types";

Page({
  data: {
    schoolCode: "lcu",
    schoolName: "智慧高校",
    page: 1,
    pageSize: 20,
    activeTrack: "all",
    activeSort: "latest",
    leftColumnCards: [],
    rightColumnCards: [],
    leftHeight: 0,
    rightHeight: 0,
    isLoading: false,
    hasMore: true,
    selectedPostIdForComment: 0,
    showCommentSheet: false
  } as IStreamPageData,

  onLoad(options: any) {
    if (options?.schoolCode) {
      this.setData({ schoolCode: options.schoolCode });
    }
    this.loadFeeds(true);
  },

  onPullDownRefresh() {
    this.loadFeeds(true);
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.isLoading) {
      this.loadFeeds(false);
    }
  },

  /**
   * 切换分类轨道
   */
  onSelectTrack(e: any) {
    const track = e.currentTarget.dataset.track;
    if (track && track !== this.data.activeTrack) {
      this.setData({ activeTrack: track });
      this.loadFeeds(true);
    }
  },

  /**
   * 切换排序 (最新 / 热榜)
   */
  onToggleSort() {
    const nextSort = this.data.activeSort === "latest" ? "hot" : "latest";
    this.setData({ activeSort: nextSort });
    this.loadFeeds(true);
  },

  /**
   * 核心数据拉取
   */
  async loadFeeds(isRefresh: boolean) {
    if (this.data.isLoading) return;

    const page = isRefresh ? 1 : this.data.page + 1;
    this.setData({ isLoading: true });

    if (isRefresh) {
      wx.showNavigationBarLoading();
    }

    try {
      const res: any = await new Promise((resolve, reject) => {
        wx.request({
          url: "https://api.xcesb.cn/api/v4/space/feeds",
          method: "GET",
          data: {
            schoolCode: this.data.schoolCode,
            page,
            pageSize: this.data.pageSize,
            filterTrack: this.data.activeTrack,
            sortBy: this.data.activeSort
          },
          success: (r) => resolve(r.data),
          fail: (err) => reject(err)
        });
      });

      if (res && (res.status === 1 || res.code === 200) && res.data) {
        const payload = res.data;
        const newCards: ISpaceFeedCardDto[] = payload.cards || [];
        this.distributeToMasonry(newCards, isRefresh);

        this.setData({
          schoolName: payload.schoolName || this.data.schoolName,
          page,
          hasMore: payload.hasMore !== undefined ? payload.hasMore : newCards.length >= this.data.pageSize,
          isLoading: false
        });
      } else {
        this.setData({ isLoading: false });
      }
    } catch {
      this.setData({ isLoading: false });
      wx.showToast({ title: "网络连接失败", icon: "none" });
    } finally {
      if (isRefresh) {
        wx.hideNavigationBarLoading();
        wx.stopPullDownRefresh();
      }
    }
  },

  /**
   * 算法 1: 客户端双列瀑布流等高贪心排版分配
   */
  distributeToMasonry(cards: ISpaceFeedCardDto[], isRefresh: boolean) {
    const leftList: ISpaceFeedCardDto[] = isRefresh ? [] : [...this.data.leftColumnCards];
    const rightList: ISpaceFeedCardDto[] = isRefresh ? [] : [...this.data.rightColumnCards];
    let leftH = isRefresh ? 0 : this.data.leftHeight;
    let rightH = isRefresh ? 0 : this.data.rightHeight;

    for (const card of cards) {
      // 预估卡片高度
      let h = 100 + Math.ceil((card.title || "").length / 11) * 24;
      if (card.trackType === "REPAIR") {
        h += 190;
      } else if (card.trackType === "OFFICIAL_REPLY") {
        h += 130;
      } else {
        h += 80;
      }

      if (card.albumImages && card.albumImages.length > 0) {
        h += 100;
      }

      if (leftH <= rightH) {
        leftList.push(card);
        leftH += h;
      } else {
        rightList.push(card);
        rightH += h;
      }
    }

    this.setData({
      leftColumnCards: leftList,
      rightColumnCards: rightList,
      leftHeight: leftH,
      rightHeight: rightH
    });
  },

  onOpenComment(e: any) {
    const postId = Number(e.detail?.postId || 0);
    this.setData({
      selectedPostIdForComment: postId,
      showCommentSheet: true
    });
  },

  onCloseComment() {
    this.setData({ showCommentSheet: false });
  },

  onCommentSuccess() {
    // 乐观递增对应动态的评论数
    const postId = this.data.selectedPostIdForComment;
    const updateCard = (card: ISpaceFeedCardDto) => {
      if (card.postId === postId) {
        return { ...card, commentCount: (card.commentCount || 0) + 1 };
      }
      return card;
    };

    this.setData({
      leftColumnCards: this.data.leftColumnCards.map(updateCard),
      rightColumnCards: this.data.rightColumnCards.map(updateCard)
    });
  }
});
