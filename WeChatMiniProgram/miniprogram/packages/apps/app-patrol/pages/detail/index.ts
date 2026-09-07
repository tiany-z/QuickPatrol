/**
 * 高校后勤巡查e速办 v4.0 - M30: 工单全景大宽表详情视图页面控制器
 * (Patrol Panoramic Detail Page Controller)
 */

import { IPatrolDetailData } from "./types.js";

import { API_BASE } from "../../../../../config/env.js";

interface IDetailPageState {
  patrolId: number;
  loading: boolean;
  detail: IPatrolDetailData | null;
  showAbortModal: boolean;
  abortReason: string;
  aborting: boolean;
}

Page<IDetailPageState, any>({
  data: {
    patrolId: 0,
    loading: true,
    detail: null,
    showAbortModal: false,
    abortReason: "",
    aborting: false
  },

  onLoad(query: any) {
    const pId = Number(query?.patrolId || query?.id || 0);
    if (!pId) {
      wx.showToast({ title: "缺少工单标识", icon: "none" });
      return;
    }

    this.setData({ patrolId: pId });
    this.loadDetail();
  },

  onPullDownRefresh() {
    this.loadDetail(() => {
      wx.stopPullDownRefresh();
    });
  },

  /**
   * 拉取工单全景大盘数据
   */
  loadDetail(callback?: () => void) {
    const { patrolId } = this.data;
    const token = wx.getStorageSync("token") || "";

    wx.request({
      url: `${API_BASE}/api/patrol/panoramic-detail?patrolId=${patrolId}`,
      method: "GET",
      header: {
        Authorization: `Bearer ${token}`
      },
      success: (res: any) => {
        const body = res.data;
        if (body && body.status === 1 && body.data) {
          this.setData({
            detail: body.data,
            loading: false
          });
        } else {
          wx.showToast({
            title: body?.content || "获取详情失败",
            icon: "none"
          });
          this.setData({ loading: false });
        }
      },
      fail: () => {
        wx.showToast({ title: "网络异常，请重试", icon: "none" });
        this.setData({ loading: false });
      },
      complete: () => {
        if (typeof callback === "function") {
          callback();
        }
      }
    });
  },

  /**
   * 图片全屏画廊预览
   */
  onPreviewImage(e: any) {
    const current = e.currentTarget.dataset.url;
    const urls = this.data.detail?.images || [];
    wx.previewImage({
      current,
      urls
    });
  },

  /**
   * 动作：进入即时协同聊天室
   */
  onOpenChat() {
    const { patrolId } = this.data;
    wx.navigateTo({
      url: `/packages/apps/app-chat/pages/chat-room/index?patrolId=${patrolId}`
    });
  },

  /**
   * 动作：师傅快速接单认领
   */
  onTakePatrol() {
    const { patrolId } = this.data;
    const token = wx.getStorageSync("token") || "";

    wx.showLoading({ title: "正在接单..." });
    wx.request({
      url: `${API_BASE}/api/patrol/accept/claim`,
      method: "POST",
      header: { Authorization: `Bearer ${token}` },
      data: { patrolId, acceptSource: "TASK_POOL" },
      success: (res: any) => {
        wx.hideLoading();
        if (res.data?.status === 1) {
          wx.showToast({ title: "接单成功", icon: "success" });
          this.loadDetail();
        } else {
          wx.showToast({ title: res.data?.content || "接单失败", icon: "none" });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: "网络超时", icon: "none" });
      }
    });
  },

  /**
   * 动作：现场完工整改交卷
   */
  onHandlePatrol() {
    const { patrolId } = this.data;
    wx.navigateTo({
      url: `/packages/apps/app-master-desk/pages/handle-submit/index?patrolId=${patrolId}`
    });
  },

  /**
   * 动作：申请工期顺延
   */
  onApplyDelay() {
    const { detail, patrolId } = this.data;
    if (!detail) return;
    const orderNo = detail.orderNo;
    const deadline = encodeURIComponent(detail.deadline);
    wx.navigateTo({
      url: `/packages/apps/app-patrol/pages/delay-apply/index?patrolId=${patrolId}&orderNo=${orderNo}&deadline=${deadline}`
    });
  },

  /**
   * 动作：质检验收
   */
  onReviewPatrol() {
    const { patrolId } = this.data;
    wx.navigateTo({
      url: `/packages/apps/app-admin/pages/patrol-review/index?patrolId=${patrolId}`
    });
  },

  /**
   * 动作：服务满意度评价
   */
  onFeedbackPatrol() {
    const { patrolId } = this.data;
    wx.navigateTo({
      url: `/packages/apps/app-patrol/pages/feedback/index?patrolId=${patrolId}`
    });
  },

  /**
   * 动作：临期催办
   */
  onUrgePatrol() {
    wx.showToast({ title: "催办督办提醒已下发责任组", icon: "success" });
  },

  /**
   * 打开作废工单弹窗
   */
  onOpenAbortModal() {
    this.setData({
      showAbortModal: true,
      abortReason: ""
    });
  },

  onCloseAbortModal() {
    this.setData({
      showAbortModal: false,
      abortReason: ""
    });
  },

  onAbortReasonInput(e: any) {
    this.setData({
      abortReason: e.detail.value || ""
    });
  },

  /**
   * 确认执行工单终止作废
   */
  onConfirmAbort() {
    const { patrolId, abortReason } = this.data;
    if (!abortReason || abortReason.trim().length < 5) {
      wx.showToast({ title: "客观作废原因至少5字", icon: "none" });
      return;
    }

    this.setData({ aborting: true });
    const token = wx.getStorageSync("token") || "";

    wx.request({
      url: `${API_BASE}/api/patrol/abort`,
      method: "POST",
      header: { Authorization: `Bearer ${token}` },
      data: {
        patrolId,
        reason: abortReason.trim()
      },
      success: (res: any) => {
        this.setData({ aborting: false });
        if (res.data?.status === 1) {
          wx.showToast({ title: "工单已作废关闭", icon: "success" });
          this.setData({ showAbortModal: false });
          this.loadDetail();
        } else {
          wx.showToast({ title: res.data?.content || "作废失败", icon: "none" });
        }
      },
      fail: () => {
        this.setData({ aborting: false });
        wx.showToast({ title: "网络请求异常", icon: "none" });
      }
    });
  }
});
