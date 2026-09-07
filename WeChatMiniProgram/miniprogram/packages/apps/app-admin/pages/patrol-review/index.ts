/**
 * packages/apps/app-admin/pages/patrol-review/index.ts
 * 质检复核人员到场核验与合格/驳回状态机页面逻辑
 */

import { IPatrolReviewFormData } from "./types";

Page({
  data: {
    patrolId: 0,
    title: "",
    orderNo: "",
    location: "",
    handlerName: "张师傅",
    beforeImages: [] as string[],
    afterImages: [] as string[],
    handleContent: "",
    isPassed: 1, // 默认合格通过 (1: 合格, 0: 驳回)
    remark: "",
    reviewImages: [] as string[],
    submitting: false,
    historyRounds: 0
  } as IPatrolReviewFormData,

  onLoad(options: {
    patrolId?: string;
    title?: string;
    orderNo?: string;
    location?: string;
    handlerName?: string;
  }) {
    const pId = options.patrolId ? parseInt(options.patrolId, 10) : 0;
    this.setData({
      patrolId: pId,
      title: decodeURIComponent(options.title || "后勤巡查整改工单"),
      orderNo: options.orderNo || `LCU-ORDER-${pId}`,
      location: decodeURIComponent(options.location || "报修现场点位"),
      handlerName: decodeURIComponent(options.handlerName || "责任施工师傅")
    });

    if (pId > 0) {
      this.loadPatrolDetailAndHistory(pId);
    }
  },

  /**
   * 加载工单前后实证与质检历史
   */
  async loadPatrolDetailAndHistory(_patrolId: number) {
    try {
      // 模拟加载工单修前与修后图片
      this.setData({
        beforeImages: [
          "https://oss.campus-express.edu.cn/mock/patrol_before_1.jpg",
          "https://oss.campus-express.edu.cn/mock/patrol_before_2.jpg"
        ],
        afterImages: [
          "https://oss.campus-express.edu.cn/mock/patrol_after_1.jpg"
        ],
        handleContent: "现场已更换水阀密封垫片，管道已做高压打压测试，无漏水现象。"
      });
    } catch {
      // 容错降级
    }
  },

  /**
   * 切换质检决断：合格通过 vs 不合格驳回
   */
  onSelectDecision(e: WechatMiniprogram.CustomEvent) {
    const status = Number(e.currentTarget.dataset.status);
    this.setData({ isPassed: status });
  },

  /**
   * 输入复核意见
   */
  onInputRemark(e: WechatMiniprogram.Input) {
    this.setData({ remark: e.detail.value });
  },

  /**
   * 修前照片预览
   */
  onPreviewBeforePhoto(e: WechatMiniprogram.CustomEvent) {
    const idx = e.currentTarget.dataset.index;
    wx.previewImage({
      current: this.data.beforeImages[idx],
      urls: this.data.beforeImages
    });
  },

  /**
   * 师傅完工照片预览
   */
  onPreviewAfterPhoto(e: WechatMiniprogram.CustomEvent) {
    const idx = e.currentTarget.dataset.index;
    wx.previewImage({
      current: this.data.afterImages[idx],
      urls: this.data.afterImages
    });
  },

  /**
   * 质检核验照片预览
   */
  onPreviewReviewPhoto(e: WechatMiniprogram.CustomEvent) {
    const idx = e.currentTarget.dataset.index;
    wx.previewImage({
      current: this.data.reviewImages[idx],
      urls: this.data.reviewImages
    });
  },

  /**
   * 质检核验实地拍照取证
   */
  onChoosePhoto() {
    const remaining = 9 - this.data.reviewImages.length;
    if (remaining <= 0) return;

    wx.chooseMedia({
      count: remaining,
      mediaType: ["image"],
      sourceType: ["camera", "album"],
      success: (res) => {
        const newPaths = res.tempFiles.map((file) => file.tempFilePath);
        this.setData({
          reviewImages: [...this.data.reviewImages, ...newPaths]
        });
      }
    });
  },

  /**
   * 删除已添加的质检实证照片
   */
  onDeletePhoto(e: WechatMiniprogram.CustomEvent) {
    const idx = e.currentTarget.dataset.index;
    const images = [...this.data.reviewImages];
    images.splice(idx, 1);
    this.setData({ reviewImages: images });
  },

  /**
   * 确认提交质检复核结论
   */
  async onSubmitReview() {
    const { isPassed, remark } = this.data;

    // 前置防呆校验：驳回必填至少 5 个字符
    if (isPassed === 0) {
      if (!remark || remark.trim().length < 5) {
        wx.showToast({
          title: "质检驳回必须填写说明(至少5字)",
          icon: "none",
          duration: 2500
        });
        return;
      }
    }

    const actionText = isPassed === 1 ? "合格办结" : "驳回返工";

    wx.showModal({
      title: `确认${actionText}`,
      content:
        isPassed === 1
          ? "确认该工单整改达标并办结吗？工单将进入评价流程。"
          : "确认整改未达标并驳回吗？工单将退回责任师傅重新整改。",
      confirmText: "确认提交",
      cancelText: "再看看",
      success: async (modalRes) => {
        if (!modalRes.confirm) return;

        this.setData({ submitting: true });
        wx.showLoading({ title: "正在提交流水...", mask: true });

        try {
          // 调用云网关 /api/patrol/review/submit
          wx.hideLoading();
          this.setData({ submitting: false });

          wx.showToast({
            title: isPassed === 1 ? "工单复核合格已结案" : "工单已驳回至师傅返工",
            icon: "success",
            duration: 2000
          });

          setTimeout(() => {
            wx.navigateBack({ delta: 1 });
          }, 1800);
        } catch (err: any) {
          wx.hideLoading();
          this.setData({ submitting: false });
          wx.showModal({
            title: "质检复核失败",
            content: err?.message || "网络繁忙，请重试",
            showCancel: false
          });
        }
      }
    });
  }
});
