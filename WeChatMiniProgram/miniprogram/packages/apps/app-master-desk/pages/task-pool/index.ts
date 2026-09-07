/**
 * 高校后勤巡查e速办 v4.0 - M24: 师傅端现场抢修看板核心页面
 * (Master Desk Task Pool & Workbench Page)
 * 
 * 核心特性：
 * 1. 抢单池 / 待出发 / 施工中 / 待验收 四象限快速切换与未读红点同步
 * 2. SLA 动态加权紧急度红灯闪烁置顶 (特急/临期优先排布)
 * 3. 并发防抖秒速原子抢单，带微信硬件触感震动反馈
 * 4. 现场工种不符协同改派弹窗与现场转交
 * 5. 下拉刷新与滑动触底分页加载
 */

import { ITaskPoolPageData, MasterDeskTab, IMasterTaskCard } from "./types.js";
import { API_BASE } from "../../../../../config/env.js";

declare const wx: any;

Page<ITaskPoolPageData, any>({
  data: {
    activeTab: "pool",
    summary: {
      poolCount: 0,
      assignedCount: 0,
      inProgressCount: 0,
      reviewCount: 0
    },
    taskList: [],
    isLoading: false,
    page: 1,
    hasMore: true,
    isClaiming: false,
    isTransferModalVisible: false,
    transferPatrolId: 0,
    transferOrderNo: "",
    transferType: "CATEGORY_MISMATCH",
    newCategoryId: 1,
    transferReason: "",
    categoriesList: [
      { id: 1, name: "水电暖通" },
      { id: 2, name: "土建木工" },
      { id: 3, name: "桌椅门窗" },
      { id: 4, name: "泥瓦修缮" },
      { id: 5, name: "消防安防" },
      { id: 6, name: "公共照明" }
    ],
    categoryIndex: 0
  },

  onLoad() {
    this.refreshAllData();
  },

  onPullDownRefresh() {
    this.refreshAllData().then(() => {
      if (wx.stopPullDownRefresh) {
        wx.stopPullDownRefresh();
      }
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.isLoading) {
      this.fetchTaskList();
    }
  },

  /**
   * 刷新全部四象限数据
   */
  async refreshAllData(): Promise<void> {
    await this.fetchSummary();
    this.setData({ page: 1, hasMore: true, taskList: [] });
    await this.fetchTaskList();
  },

  /**
   * 获取四象限未读数字统计
   */
  fetchSummary(): Promise<void> {
    return new Promise((resolve) => {
      const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";
      if (!wx.request) return resolve();

      wx.request({
        url: `${API_BASE}/api/patrol/workbench-summary`,
        method: "GET",
        header: {
          "content-type": "application/json",
          token,
          Authorization: `Bearer ${token}`
        },
        success: (res: any) => {
          if (res?.data?.status === 1 && res?.data?.data) {
            this.setData({ summary: res.data.data });
          }
        },
        complete: () => resolve()
      });
    });
  },

  /**
   * 分页获取当前象限的任务列表
   */
  fetchTaskList(): Promise<void> {
    if (this.data.isLoading || !this.data.hasMore) return Promise.resolve();
    this.setData({ isLoading: true });

    return new Promise((resolve) => {
      const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";
      if (!wx.request) {
        this.setData({ isLoading: false });
        return resolve();
      }

      wx.request({
        url: `${API_BASE}/api/patrol/workbench-list?tab=${this.data.activeTab}&page=${this.data.page}&pageSize=10`,
        method: "GET",
        header: {
          "content-type": "application/json",
          token,
          Authorization: `Bearer ${token}`
        },
        success: (res: any) => {
          if (res?.data?.status === 1 && res?.data?.data) {
            const list: IMasterTaskCard[] = res.data.data.list || [];
            const newTaskList = this.data.page === 1 ? list : [...this.data.taskList, ...list];
            this.setData({
              taskList: newTaskList,
              hasMore: list.length >= 10,
              page: this.data.page + 1
            });
          }
        },
        complete: () => {
          this.setData({ isLoading: false });
          resolve();
        }
      });
    });
  },

  /**
   * 切换四象限 Tab
   */
  onTabChange(e: any) {
    const tab: MasterDeskTab = e.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    this.setData({
      activeTab: tab,
      page: 1,
      hasMore: true,
      taskList: []
    });
    this.fetchTaskList();
  },

  /**
   * 核心抢单 / 接单操作 (先到先得)
   */
  handleClaimTask(e: any) {
    const id = Number(e.currentTarget.dataset.id);
    if (!id || this.data.isClaiming) return;

    this.setData({ isClaiming: true });
    if (wx.showLoading) {
      wx.showLoading({ title: "正在原子抢单...", mask: true });
    }

    const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";

    wx.request({
      url: `${API_BASE}/api/patrol/accept`,
      method: "POST",
      header: {
        "content-type": "application/json",
        token,
        Authorization: `Bearer ${token}`
      },
      data: {
        patrolId: id,
        acceptSource: this.data.activeTab === "pool" ? "TASK_POOL" : "DIRECT_ASSIGNED"
      },
      success: (res: any) => {
        if (wx.hideLoading) wx.hideLoading();

        if (res?.data?.status === 1) {
          // 触感震动与成功提示
          if (wx.vibrateShort) wx.vibrateShort({ type: "medium" });
          if (wx.showToast) {
            wx.showToast({ title: "抢单成功！", icon: "success" });
          }

          // 自动切换至施工中象限并热刷新
          setTimeout(() => {
            this.setData({ activeTab: "inProgress" });
            this.refreshAllData();
          }, 800);
        } else {
          const msg = res?.data?.message || "手慢了，该工单已被同事抢先认领！";
          if (wx.showModal) {
            wx.showModal({
              title: "抢单未成功",
              content: msg,
              showCancel: false
            });
          }
          this.refreshAllData();
        }
      },
      fail: () => {
        if (wx.hideLoading) wx.hideLoading();
        if (wx.showToast) {
          wx.showToast({ title: "网络异常，请重试", icon: "none" });
        }
      },
      complete: () => {
        this.setData({ isClaiming: false });
      }
    });
  },

  /**
   * 打开协同改派弹窗
   */
  openTransferModal(e: any) {
    const id = Number(e.currentTarget.dataset.id);
    const orderNo = String(e.currentTarget.dataset.orderno || "");
    this.setData({
      isTransferModalVisible: true,
      transferPatrolId: id,
      transferOrderNo: orderNo,
      transferReason: "",
      newCategoryId: this.data.categoriesList[0]?.id || 1,
      categoryIndex: 0
    });
  },

  /**
   * 关闭改派弹窗
   */
  closeTransferModal() {
    this.setData({ isTransferModalVisible: false });
  },

  /**
   * 修改重选分类
   */
  onCategoryPickerChange(e: any) {
    const idx = Number(e.detail.value);
    const cat = this.data.categoriesList[idx];
    if (cat) {
      this.setData({
        categoryIndex: idx,
        newCategoryId: cat.id
      });
    }
  },

  /**
   * 输入改派原因
   */
  onReasonInput(e: any) {
    this.setData({ transferReason: e.detail.value });
  },

  /**
   * 提交工种不符改派
   */
  submitTransfer() {
    if (!this.data.transferReason || this.data.transferReason.trim().length < 5) {
      if (wx.showToast) {
        wx.showToast({ title: "请填写至少 5 字原因", icon: "none" });
      }
      return;
    }

    if (wx.showLoading) {
      wx.showLoading({ title: "提交改派中...", mask: true });
    }

    const token = wx.getStorageSync ? wx.getStorageSync("qp_token") : "";

    wx.request({
      url: `${API_BASE}/api/patrol/transfer`,
      method: "POST",
      header: {
        "content-type": "application/json",
        token,
        Authorization: `Bearer ${token}`
      },
      data: {
        patrolId: this.data.transferPatrolId,
        transferType: "CATEGORY_MISMATCH",
        newCategoryId: this.data.newCategoryId,
        reason: this.data.transferReason.trim()
      },
      success: (res: any) => {
        if (wx.hideLoading) wx.hideLoading();

        if (res?.data?.status === 1) {
          if (wx.showToast) {
            wx.showToast({ title: "改派成功！", icon: "success" });
          }
          this.closeTransferModal();
          this.refreshAllData();
        } else {
          if (wx.showModal) {
            wx.showModal({
              title: "改派拦截",
              content: res?.data?.message || "改派失败",
              showCancel: false
            });
          }
        }
      },
      fail: () => {
        if (wx.hideLoading) wx.hideLoading();
        if (wx.showToast) {
          wx.showToast({ title: "网络错误", icon: "none" });
        }
      }
    });
  },

  /**
   * 导航至工单详情
   */
  navigateToDetail(e: any) {
    const id = e.currentTarget.dataset.id;
    if (wx.navigateTo) {
      wx.navigateTo({
        url: `/packages/apps/app-patrol/pages/detail/index?id=${id}`
      });
    }
  }
});
