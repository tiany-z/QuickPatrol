/**
 * packages/apps/app-patrol/pages/feedback/index.ts
 * 师生服务满意度五星评价页面逻辑
 */

import { IFeedbackFormData } from "./types";

Page({
  data: {
    patrolId: 0,
    orderNo: "",
    title: "",
    location: "",
    handlerName: "责任师傅",
    score: 5,
    speedScore: 5,
    qualityScore: 5,
    attitudeScore: 5,
    presetTags: [
      { text: "上门神速", selected: true },
      { text: "技术精湛", selected: true },
      { text: "礼貌热心", selected: false },
      { text: "现场整洁", selected: false },
      { text: "规范专业", selected: false }
    ],
    comment: "",
    submitting: false
  } as IFeedbackFormData,

  onLoad(options: {
    patrolId?: string;
    orderNo?: string;
    title?: string;
    location?: string;
    handlerName?: string;
  }) {
    const pId = options.patrolId ? parseInt(options.patrolId, 10) : 0;
    this.setData({
      patrolId: pId,
      orderNo: options.orderNo || `LCU-ORDER-${pId}`,
      title: decodeURIComponent(options.title || "后勤抢修工单"),
      location: decodeURIComponent(options.location || "修缮现场"),
      handlerName: decodeURIComponent(options.handlerName || "维修师傅")
    });
  },

  /**
   * 更改综合星级评分
   */
  onScoreChange(e: WechatMiniprogram.CustomEvent) {
    const val = Number(e.currentTarget.dataset.val);
    this.setData({
      score: val,
      speedScore: val,
      qualityScore: val,
      attitudeScore: val
    });
  },

  /**
   * 更改子维度星级评分
   */
  onSubScoreChange(e: WechatMiniprogram.CustomEvent) {
    const field = e.currentTarget.dataset.field;
    const val = Number(e.currentTarget.dataset.val);
    this.setData({
      [field]: val
    });
  },

  /**
   * 切换快捷标签勾选
   */
  onToggleTag(e: WechatMiniprogram.CustomEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const tags = [...this.data.presetTags];
    tags[idx].selected = !tags[idx].selected;
    this.setData({ presetTags: tags });
  },

  /**
   * 输入心得体会评语
   */
  onCommentInput(e: WechatMiniprogram.Input) {
    this.setData({ comment: e.detail.value });
  },

  /**
   * 提交评价并封存工单
   */
  async onSubmitFeedback() {
    const { submitting } = this.data;
    if (submitting) return;

    this.setData({ submitting: true });
    wx.showLoading({ title: "正在提交评价...", mask: true });

    try {
      // 模拟调用 /api/patrol/feedback/submit
      wx.hideLoading();
      this.setData({ submitting: false });

      wx.showToast({
        title: "感谢您的真诚评价！",
        icon: "success",
        duration: 2000
      });

      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 1500);
    } catch (err: any) {
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showModal({
        title: "评价提交失败",
        content: err?.message || "网络繁忙，请稍后重试",
        showCancel: false
      });
    }
  }
});
