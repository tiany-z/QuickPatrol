/**
 * 高校后勤巡查e速办 v4.0 - M26: 师傅端工期顺延申请页面控制器
 * (Patrol Delay Apply Page Controller)
 */

import { IDelayApplyPageData } from "./types.js";

import { API_BASE } from "../../../../../config/env.js";

Page<IDelayApplyPageData, any>({
  data: {
    patrolId: 0,
    orderNo: "",
    currentDeadline: "",
    delayHours: 24,
    hoursOptions: [
      { label: "12 小时 (半天)", value: 12 },
      { label: "24 小时 (1天)", value: 24 },
      { label: "48 小时 (2天)", value: 48 },
      { label: "72 小时 (3天)", value: 72 },
      { label: "自定义", value: -1 }
    ],
    customHours: "",
    reason: "",
    evidenceImages: [],
    predictedDeadline: "",
    submitting: false
  },

  onLoad(query: any) {
    const pId = Number(query?.patrolId || 0);
    const orderNo = query?.orderNo || "";
    const deadline = query?.deadline ? decodeURIComponent(query.deadline) : "";

    this.setData({
      patrolId: pId,
      orderNo,
      currentDeadline: deadline
    });

    this.recalculatePredicted();
  },

  /**
   * 选择预设顺延时长
   */
  onSelectHour(e: any) {
    const val = Number(e.currentTarget.dataset.value);
    this.setData({
      delayHours: val,
      customHours: val > 0 ? "" : this.data.customHours
    });
    this.recalculatePredicted();
  },

  /**
   * 自定义时长输入
   */
  onCustomInput(e: any) {
    const val = parseInt(e.detail.value, 10) || 0;
    this.setData({
      customHours: e.detail.value,
      delayHours: val > 0 ? val : -1
    });
    this.recalculatePredicted();
  },

  /**
   * 客观原因输入
   */
  onReasonInput(e: any) {
    this.setData({ reason: e.detail.value || "" });
  },

  /**
   * 动力学测算最新截止时间
   */
  recalculatePredicted() {
    const { currentDeadline, delayHours } = this.data;
    if (delayHours <= 0) {
      this.setData({ predictedDeadline: "请输入有效顺延时长" });
      return;
    }

    const baseMs = currentDeadline ? new Date(currentDeadline).getTime() : Date.now();
    const effectiveBase = Math.max(isNaN(baseMs) ? Date.now() : baseMs, Date.now());
    const target = new Date(effectiveBase + delayHours * 3600 * 1000);

    const formatted = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")} ${String(target.getHours()).padStart(2, "0")}:${String(target.getMinutes()).padStart(2, "0")}`;
    this.setData({ predictedDeadline: formatted });
  },

  /**
   * 选择现场客观凭证图片
   */
  onChooseImage() {
    const { evidenceImages } = this.data;
    if (evidenceImages.length >= 6) {
      if (wx.showToast) {
        wx.showToast({ title: "最多上传 6 张客观证据图片", icon: "none" });
      }
      return;
    }

    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 6 - evidenceImages.length,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success: (res: any) => {
          const files = res.tempFiles || [];
          const newUrls = files.map((f: any) => f.tempFilePath || "");
          this.setData({
            evidenceImages: [...evidenceImages, ...newUrls]
          });
        }
      });
    }
  },

  /**
   * 删除已选照片
   */
  onDeleteImage(e: any) {
    const idx = Number(e.currentTarget.dataset.index);
    const list = [...this.data.evidenceImages];
    list.splice(idx, 1);
    this.setData({ evidenceImages: list });
  },

  /**
   * 提交延期申请
   */
  onSubmit() {
    const { patrolId, delayHours, reason, evidenceImages, submitting } = this.data;
    if (submitting) return;

    if (delayHours <= 0 || delayHours > 168) {
      if (wx.showToast) {
        wx.showToast({ title: "申请顺延时长须在 1~168 小时之间", icon: "none" });
      }
      return;
    }

    if (!reason || reason.trim().length < 5) {
      if (wx.showToast) {
        wx.showToast({ title: "请至少输入 5 个字符的原因说明", icon: "none" });
      }
      return;
    }

    this.setData({ submitting: true });
    if (wx.showLoading) {
      wx.showLoading({ title: "提交延期申请..." });
    }

    const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";

    wx.request({
      url: `${API_BASE}/api/patrol/delay/apply`,
      method: "POST",
      header: {
        "content-type": "application/json",
        token,
        Authorization: `Bearer ${token}`
      },
      data: {
        patrolId,
        delayHours,
        reason: reason.trim(),
        evidenceImages
      },
      success: (res: any) => {
        if (wx.hideLoading) wx.hideLoading();
        this.setData({ submitting: false });

        if (res?.data?.status === 1) {
          if (wx.showToast) {
            wx.showToast({ title: "延期申请已提交", icon: "success" });
          }
          setTimeout(() => {
            if (wx.navigateBack) {
              wx.navigateBack();
            }
          }, 1200);
        } else {
          if (wx.showModal) {
            wx.showModal({
              title: "申请受阻",
              content: res?.data?.content || "提交失败，请重试",
              showCancel: false
            });
          }
        }
      },
      fail: () => {
        if (wx.hideLoading) wx.hideLoading();
        this.setData({ submitting: false });
        if (wx.showToast) {
          wx.showToast({ title: "网络连接异常", icon: "none" });
        }
      }
    });
  }
});
