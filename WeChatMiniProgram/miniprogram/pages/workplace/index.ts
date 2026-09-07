/**
 * 高校后勤巡查e速办 v4.0 - M50: 飞书工作台微应用矩阵与动态门禁
 * 文件路径: miniprogram/pages/workplace/index.ts
 * 核心职责: 小程序工作台矩阵大盘、四象限门禁路由分发、个人置顶动态编排与 AI 智能卡片联动
 */

import {
  IWorkplaceViewResponseDto,
  IWorkplaceCategoryGroup,
  IWorkplaceAppItem,
  IWorkplaceSortPayloadDto
} from "./contracts/workplaceTypes";

import { API_BASE } from "../../config/env.js";
import { defaultWorkplaceGroups } from "./defaultWorkplaceData.js";

Page({
  data: {
    loading: false,
    refreshing: false,
    schoolId: 1,
    schoolName: "示范大学后勤智慧中心",
    isGuest: false,
    pinnedApps: [] as IWorkplaceAppItem[],
    groups: defaultWorkplaceGroups,
    filteredGroups: defaultWorkplaceGroups,
    aiCopilotBanner: {
      enabled: true,
      greeting: "Hi，我是校园后勤 Copilot，今天有什么可以帮您？",
      placeholder: "输入问题或工单号，按问号或直接提问...",
      quickPrompts: [
        "图书馆三楼空调漏水如何报修？",
        "查询我名下的待巡查网格任务",
        "查看宿舍楼电梯维保记录"
      ]
    },
    pinManageMode: false,
    activeCategory: "all",
    searchKeyword: "",
    statusBarHeight: 44,
    navBarHeight: 44,
    headerTotalHeight: 88,
    capsulePaddingRight: 96
  },

  onLoad() {
    this.initTopMetrics();
    this.loadWorkplaceData();
  },

  initTopMetrics() {
    try {
      const app = typeof getApp === "function" ? getApp<{ globalData: { systemMetrics: any } }>() : null;
      let statusBarHeight = 44;
      let navBarHeight = 44;
      let headerTotalHeight = 88;
      let capsulePaddingRight = 96;

      if (app?.globalData?.systemMetrics?.headerTotalHeight) {
        const m = app.globalData.systemMetrics;
        statusBarHeight = m.statusBarHeight || 44;
        navBarHeight = m.navBarHeight || 44;
        headerTotalHeight = m.headerTotalHeight || 88;
        capsulePaddingRight = m.capsule ? m.capsule.width + (m.capsuleRightMargin || 10) : 96;
      } else {
        const wxAny = wx as any;
        const windowInfo = wxAny.getWindowInfo ? wxAny.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {});
        if (windowInfo.statusBarHeight) statusBarHeight = windowInfo.statusBarHeight;
        if (wx.getMenuButtonBoundingClientRect) {
          const cap = wx.getMenuButtonBoundingClientRect();
          if (cap?.top && cap?.height) {
            navBarHeight = (cap.top - statusBarHeight) * 2 + cap.height;
            const winWidth = windowInfo.windowWidth || 375;
            capsulePaddingRight = winWidth - cap.left + 8;
          }
        }
        headerTotalHeight = statusBarHeight + navBarHeight;
      }

      this.setData({
        statusBarHeight,
        navBarHeight,
        headerTotalHeight,
        capsulePaddingRight
      });
    } catch (e) {
      console.warn("[Workplace] 度量计算异常", e);
    }
  },

  onShow() {
    this.checkPreAuthIntentResume();
    // 每次进入页面时静默刷新最新角标与门禁状态
    if (!this.data.loading) {
      this.loadWorkplaceData(true);
    }
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true });
    this.loadWorkplaceData().finally(() => {
      this.setData({ refreshing: false });
      if (typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
    });
  },

  /**
   * 算法 1 意图路由唤醒检测 (Intent Route Resume)
   * 若登录前被毛玻璃禁行拦截并暂存意图，且当前已完成登录核验，则自动恢复导航
   */
  checkPreAuthIntentResume() {
    try {
      const intentRoute = wx.getStorageSync("PRE_AUTH_INTENT_ROUTE");
      const token = wx.getStorageSync("token") || wx.getStorageSync("qp_token");

      if (intentRoute && token) {
        wx.removeStorageSync("PRE_AUTH_INTENT_ROUTE");
        wx.removeStorageSync("PRE_AUTH_INTENT_APP");

        wx.showToast({
          title: "身份核验通过，正在为您直达...",
          icon: "success",
          duration: 1500
        });

        setTimeout(() => {
          wx.navigateTo({
            url: intentRoute,
            fail: () => {
              wx.switchTab({ url: intentRoute });
            }
          });
        }, 1200);
      }
    } catch (e) {
      console.warn("[Workplace] 意图路由唤醒异常", e);
    }
  },

  /**
   * 加载工作台四象限微应用矩阵与聚合徽标
   */
  async loadWorkplaceData(silent: boolean = false): Promise<void> {
    if (!silent) {
      this.setData({ loading: true });
    }

    const token = wx.getStorageSync ? (wx.getStorageSync("token") || wx.getStorageSync("qp_token") || "") : "";
    const schoolId = wx.getStorageSync ? (wx.getStorageSync("schoolId") || 1) : 1;

    return new Promise<void>((resolve) => {
      if (!wx.request) {
        this.setData({ loading: false });
        return resolve();
      }

      wx.request({
        url: `${API_BASE}/api/v1/workplace/apps`,
        method: "GET",
        header: {
          "Content-Type": "application/json",
          "x-school-id": schoolId,
          token,
          Authorization: token ? `Bearer ${token}` : ""
        },
        success: (res: any) => {
          if (res?.data?.code === 200 && res.data.data) {
            const data = res.data.data as IWorkplaceViewResponseDto;
            this.setData({
              schoolId: data.schoolId || 1,
              schoolName: data.schoolName || "示范大学后勤智慧中心",
              isGuest: Boolean(data.isGuest),
              pinnedApps: data.pinnedApps || [],
              groups: data.groups || [],
              aiCopilotBanner: data.aiCopilotBanner || this.data.aiCopilotBanner,
              loading: false
            });
            this.applyFilterAndSearch();
          } else {
            if (!this.data.groups || this.data.groups.length === 0) {
              this.setData({ groups: defaultWorkplaceGroups, loading: false });
              this.applyFilterAndSearch();
            } else {
              this.setData({ loading: false });
            }
          }
          resolve();
        },
        fail: () => {
          if (!this.data.groups || this.data.groups.length === 0) {
            this.setData({ groups: defaultWorkplaceGroups, loading: false });
            this.applyFilterAndSearch();
          } else {
            this.setData({ loading: false });
          }
          resolve();
        }
      });
    });
  },

  /**
   * 搜索过滤与象限分类切换
   */
  handleSearchInput(e: any) {
    const searchKeyword = (e.detail?.value || "").trim();
    this.setData({ searchKeyword }, () => {
      this.applyFilterAndSearch();
    });
  },

  handleClearSearch() {
    this.setData({ searchKeyword: "" }, () => {
      this.applyFilterAndSearch();
    });
  },

  handleCategorySelect(e: any) {
    const category = e.currentTarget.dataset.category;
    if (!category) return;
    this.setData({ activeCategory: category }, () => {
      this.applyFilterAndSearch();
    });
  },

  applyFilterAndSearch() {
    const { groups, activeCategory, searchKeyword } = this.data;
    const lowerKeyword = searchKeyword.toLowerCase();

    let filtered = groups.map((g) => {
      let filteredApps = g.apps;
      if (lowerKeyword) {
        filteredApps = filteredApps.filter(
          (app) =>
            app.name.toLowerCase().includes(lowerKeyword) ||
            app.appCode.toLowerCase().includes(lowerKeyword)
        );
      }
      return {
        ...g,
        apps: filteredApps
      };
    });

    if (activeCategory !== "all") {
      filtered = filtered.filter((g) => g.categoryKey === activeCategory);
    }

    this.setData({ filteredGroups: filtered });
  },

  /**
   * 顶部 AI Copilot 战略卡片点击直达
   */
  handleCopilotBannerTap() {
    if (typeof wx.vibrateShort === "function") {
      wx.vibrateShort({ type: "light" });
    }
    wx.navigateTo({
      url: "/pages/ai-copilot/index"
    });
  },

  /**
   * 快捷提示词直接进入 AI 对话并带入 Prompt
   */
  handleQuickPromptTap(e: any) {
    const prompt = e.currentTarget.dataset.prompt;
    if (!prompt) return;

    if (typeof wx.vibrateShort === "function") {
      wx.vibrateShort({ type: "light" });
    }

    wx.navigateTo({
      url: `/pages/ai-copilot/index?prompt=${encodeURIComponent(prompt)}`
    });
  },

  /**
   * 切换个人常用置顶编辑模式
   */
  togglePinManageMode() {
    if (typeof wx.vibrateShort === "function") {
      wx.vibrateShort({ type: "light" });
    }

    if (this.data.isGuest) {
      wx.showToast({
        title: "请先登录后开启置顶编辑",
        icon: "none"
      });
      return;
    }

    this.setData({ pinManageMode: !this.data.pinManageMode });
  },

  /**
   * 处理卡片上的置顶切换 (添加/移除置顶)
   */
  handleTogglePin(e: any) {
    const app = e.detail?.app as IWorkplaceAppItem;
    if (!app || !app.appCode) return;

    if (this.data.isGuest) {
      wx.showToast({
        title: "请先登录后保存个人常用应用",
        icon: "none"
      });
      return;
    }

    const { pinnedApps, groups } = this.data;
    const exists = pinnedApps.some((item) => item.appCode === app.appCode);

    let nextPinnedApps: IWorkplaceAppItem[] = [];
    if (exists) {
      // 取消置顶
      nextPinnedApps = pinnedApps.filter((item) => item.appCode !== app.appCode);
    } else {
      // 加入置顶 (至多支持 8 个常用微应用)
      if (pinnedApps.length >= 8) {
        wx.showToast({
          title: "常用置顶最多支持 8 个应用",
          icon: "none"
        });
        return;
      }
      nextPinnedApps = [...pinnedApps, { ...app, isPinned: true }];
    }

    // 同步更新 groups 内部各微应用的 isPinned 状态
    const updatedGroups = groups.map((g) => ({
      ...g,
      apps: g.apps.map((item) => ({
        ...item,
        isPinned: nextPinnedApps.some((p) => p.appCode === item.appCode)
      }))
    }));

    this.setData({
      pinnedApps: nextPinnedApps,
      groups: updatedGroups
    });
    this.applyFilterAndSearch();

    // 持久化保存至服务端 (算法 3)
    this.savePinnedAppsToServer(nextPinnedApps.map((p) => p.appCode));
  },

  /**
   * 向服务端持久化保存用户自定义置顶序列
   */
  savePinnedAppsToServer(pinnedAppKeys: string[]) {
    const token = wx.getStorageSync ? (wx.getStorageSync("token") || wx.getStorageSync("qp_token") || "") : "";
    const schoolId = this.data.schoolId || 1;

    if (!wx.request || !token) return;

    const payload: IWorkplaceSortPayloadDto = {
      pinnedAppKeys
    };

    wx.request({
      url: `${API_BASE}/api/v1/workplace/sort`,
      method: "POST",
      header: {
        "Content-Type": "application/json",
        "x-school-id": schoolId,
        token,
        Authorization: `Bearer ${token}`
      },
      data: payload,
      success: (res: any) => {
        if (res?.data?.code === 200) {
          wx.showToast({
            title: "置顶配置已同步",
            icon: "success",
            duration: 1200
          });
        }
      }
    });
  }
});
