/**
 * 高校后勤巡查e速办 v4.0 - M32: 诉求详情与官方答复公函展示页面
 */

import { VaultManager } from "../../utils/vaultManager";
import { IAppealDetailView } from "./types";

Page({
  data: {
    appealId: 0,
    vaultToken: "",
    showThanksModal: false,
    hasSentThanksCard: false,
    cachedETag: "",
    appeal: {
      id: 0,
      schoolId: 1,
      title: "",
      content: "",
      creatorId: 0,
      status: 0,
      isTop: 0,
      likeCount: 0,
      commentCount: 0,
      createdAt: "",
      updatedAt: "",
      officialReply: null,
      thanksCards: [],
      commentsCount: 0
    } as IAppealDetailView
  },

  onLoad(options: any) {
    const appealId = parseInt(options.id || options.appealId, 10) || 0;
    this.setData({ appealId });

    // 从本地凭证管理器自动寻找匹配当前 appealId 的 VaultToken
    const allTokens = VaultManager.getAllItems();
    const matched = allTokens.find(i => i.postId === appealId);
    if (matched) {
      this.setData({ vaultToken: matched.token });
    }

    this.loadAppealDetail(appealId);
  },

  async loadAppealDetail(appealId: number) {
    if (!appealId) return;

    wx.showLoading({ title: "加载公函详情..." });

    try {
      const header: Record<string, string> = {
        "Authorization": "Bearer " + wx.getStorageSync("token"),
        "x-school-id": wx.getStorageSync("schoolId") || "1"
      };

      if (this.data.cachedETag) {
        header["if-none-match"] = this.data.cachedETag;
      }
      if (this.data.vaultToken) {
        header["x-vault-token"] = this.data.vaultToken;
      }

      const res: any = await new Promise((resolve, reject) => {
        wx.request({
          url: "https://api.xcesb.cn/api/v4/feedback/appeals/detail",
          method: "GET",
          data: { appealId },
          header,
          success: (r) => resolve(r.data),
          fail: (err) => reject(err)
        });
      });

      wx.hideLoading();

      if (res && res.status === 1 && res.data) {
        if (!res.data.isModified) {
          // 304 无修改，保留当前视图
          return;
        }

        const appealData = res.data.appeal;
        const currentUserId = Number(wx.getStorageSync("userId") || 0);

        // 检查当前用户是否已赠送过感谢卡
        const hasSent = appealData.thanksCards?.some((c: any) => {
          return this.data.vaultToken ? true : c.userId === currentUserId;
        }) || false;

        this.setData({
          appeal: appealData,
          hasSentThanksCard: hasSent,
          cachedETag: res.data.currentETag || ""
        });
      }
    } catch {
      wx.hideLoading();
      wx.showToast({ title: "网络连接异常", icon: "none" });
    }
  },

  onOpenThanksDialog() {
    this.setData({ showThanksModal: true });
  },

  onCloseThanksDialog() {
    this.setData({ showThanksModal: false });
  },

  onThanksCardSuccess(e: any) {
    this.setData({
      showThanksModal: false,
      hasSentThanksCard: true
    });

    const { pointsAwarded, badgeAwarded } = e.detail || {};

    wx.showModal({
      title: "🎉 感谢卡已送达！",
      content: `您的真挚感谢已直达科室主管！荣获【${badgeAwarded || "暖心使者"}】勋章，+${pointsAwarded || 10} 啄木鸟治理积分已入账！`,
      showCancel: false,
      success: () => {
        this.loadAppealDetail(this.data.appealId);
      }
    });
  }
});
