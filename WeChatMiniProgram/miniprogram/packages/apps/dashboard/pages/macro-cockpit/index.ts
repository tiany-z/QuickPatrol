/**
 * 高校后勤巡查e速办 v4.0 - M53 全校后勤宏观运维决策大盘
 * 文件路径: packages/apps/dashboard/pages/macro-cockpit/index.ts
 * 核心职责: 大屏全屏水合、2.5D高斯空间核密度热力渲染、一键直呼总值班长、防窥脱敏与Excel导出
 */

import {
  IMacroDashboardResponseDto,
  RiskLevel
} from "../../contracts/dashboardTypes";

import { API_BASE } from "../../../../../config/env.js";

Page({
  data: {
    dashboard: {
      schoolId: 1,
      schoolName: "数字示范高校",
      updateTimestamp: "2026-09-06 18:00:00",
      cfhiScore: 92,
      cfhiLevel: RiskLevel.SAFE,
      patrolOverview: {
        totalCount: 24,
        pendingCount: 3,
        processingCount: 4,
        reviewingCount: 2,
        completedCount: 15,
        completionRate: 94.5,
        overdueCount: 1,
        avgHandleHours: 3.6,
        categoryDistribution: [
          { categoryId: 1, categoryName: "水电暖通", count: 12, percentage: 50.0 },
          { categoryId: 2, categoryName: "房屋土建", count: 6, percentage: 25.0 },
          { categoryId: 3, categoryName: "绿化保洁", count: 4, percentage: 16.7 },
          { categoryId: 4, categoryName: "消防安防", count: 2, percentage: 8.3 }
        ],
        slaRiskTrend: [
          { hourSlot: "12:00", safeCount: 12, warningCount: 2, criticalCount: 0 },
          { hourSlot: "14:00", safeCount: 15, warningCount: 3, criticalCount: 1 },
          { hourSlot: "16:00", safeCount: 10, warningCount: 4, criticalCount: 1 },
          { hourSlot: "18:00", safeCount: 8, warningCount: 2, criticalCount: 1 }
        ]
      },
      attendanceOverview: {
        scheduledTotal: 20,
        actualPresent: 18,
        attendanceRate: 90.0,
        lateCount: 1,
        absentCount: 2,
        onDutyWorkers: [
          {
            userId: 8801,
            name: "张建国 (高级电工)",
            phone: "13812345678",
            departmentName: "供电运维保障班",
            lastPunchTime: "08:25",
            currentBuilding: "笃学楼高压配电房",
            latitude: 31.2308,
            longitude: 121.4740
          },
          {
            userId: 8802,
            name: "李师傅 (管道工)",
            phone: "13987654321",
            departmentName: "水暖抢修突击队",
            lastPunchTime: "08:31",
            currentBuilding: "第三教学楼泵房",
            latitude: 31.2315,
            longitude: 121.4755
          }
        ]
      },
      shiftOverview: {
        chiefCommander: {
          userId: 1,
          name: "王处长",
          phone: "13900001234",
          title: "后勤保障处总值班长"
        },
        activeMaintenances: [
          {
            scheduleId: 101,
            title: "全校高压变电站预防性试验与除尘维保",
            timeRange: "08:00 - 18:00",
            impactArea: "笃学楼与图书信息中心",
            status: "RUNNING" as const
          }
        ]
      },
      feedbackOverview: {
        overallSatisfactionScore: 4.92,
        totalFeedbacks: 89,
        hotKeywords: [
          { text: "空调制冷", weight: 92 },
          { text: "热水供应", weight: 78 },
          { text: "水管滴水", weight: 65 },
          { text: "路灯修复", weight: 44 }
        ]
      },
      heatMapPoints: [
        { latitude: 31.2312, longitude: 121.4745, weight: 0.85, buildingName: "笃学楼", activeFaultCount: 1 },
        { latitude: 31.2325, longitude: 121.4760, weight: 0.65, buildingName: "信息中心", activeFaultCount: 1 }
      ],
      tenantQuota: {
        planLevelText: "旗舰尊享版",
        quotaUsagePercent: 68.5,
        remainingDays: 285
      }
    } as IMacroDashboardResponseDto,
    isLoading: false,
    stealthMode: false,
    isEmergencyAlert: false,
    emergencyLocation: "笃学楼地下变电站"
  },

  _autoSyncTimer: null as any,

  onLoad() {
    this.initDashboard();
    // 启动 10 秒温和轮询同步，确保大屏数字持续鲜活动态
    this._autoSyncTimer = setInterval(() => {
      this.fetchDashboardData(true);
    }, 10000);
  },

  onUnload() {
    if (this._autoSyncTimer) {
      clearInterval(this._autoSyncTimer);
      this._autoSyncTimer = null;
    }
  },

  onPullDownRefresh() {
    this.fetchDashboardData(false).finally(() => {
      if (typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
    });
  },

  initDashboard() {
    this.fetchDashboardData(false);
  },

  fetchDashboardData(silent: boolean = false) {
    return new Promise<void>((resolve) => {
      const token = (wx.getStorageSync && wx.getStorageSync("token")) || "";
      const schoolId = (wx.getStorageSync && wx.getStorageSync("schoolId")) || 1;

      if (!silent) this.setData({ isLoading: true });

      wx.request({
        url: `${API_BASE}/api/v1/dashboard/overview`,
        method: "GET",
        header: {
          "content-type": "application/json",
          token,
          "x-school-id": String(schoolId)
        },
        success: (res: any) => {
          const body = res.data;
          if (body && (body.code === 200 || body.status === 1)) {
            const data: IMacroDashboardResponseDto = body.data || body.result;
            if (data) {
              this.setData({ dashboard: data });
              this.drawKdeHeatCanvas();
            }
          }
        },
        complete: () => {
          if (!silent) this.setData({ isLoading: false });
          resolve();
        }
      });
    });
  },

  /**
   * 绘制 2.5D 高斯核密度空间热力网格 (KDE)
   */
  drawKdeHeatCanvas() {
    if (typeof wx.createSelectorQuery !== "function") return;

    const query = wx.createSelectorQuery();
    query.select("#kdeHeatCanvas")
      .fields({ node: true, size: true })
      .exec((res: any) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext("2d");
        const width = res[0].width || 300;
        const height = res[0].height || 240;

        ctx.clearRect(0, 0, width, height);

        const points = this.data.dashboard.heatMapPoints || [];
        for (const pt of points) {
          // 投影归一化坐标至画布视口
          const x = width * 0.5 + (pt.longitude - 121.4740) * 8000;
          const y = height * 0.5 + (31.2315 - pt.latitude) * 8000;
          const radius = 35 * Math.max(0.3, pt.weight);

          const grad = ctx.createRadialGradient(x, y, 2, x, y, radius);
          grad.addColorStop(0, `rgba(239, 68, 68, ${pt.weight * 0.85})`);
          grad.addColorStop(0.5, `rgba(245, 158, 11, ${pt.weight * 0.45})`);
          grad.addColorStop(1, "rgba(59, 130, 246, 0)");

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, 2 * Math.PI);
          ctx.fill();
        }
      });
  },

  toggleStealthMode() {
    this.setData({ stealthMode: !this.data.stealthMode });
    wx.showToast({
      title: this.data.stealthMode ? "已开启防窥脱敏" : "已恢复明细展示",
      icon: "none"
    });
  },

  maskName(name: string): string {
    if (!name) return "***";
    if (name.length <= 2) return name[0] + "*";
    return name[0] + "*".repeat(name.length - 2) + name[name.length - 1];
  },

  handleCallCommander() {
    const phone = this.data.dashboard.shiftOverview?.chiefCommander?.phone;
    if (phone && typeof wx.makePhoneCall === "function") {
      wx.makePhoneCall({ phoneNumber: phone });
    } else {
      wx.showToast({ title: "总值班电话: " + (phone || "暂未录入"), icon: "none" });
    }
  },

  handleManualSync() {
    const token = (wx.getStorageSync && wx.getStorageSync("token")) || "";
    const schoolId = (wx.getStorageSync && wx.getStorageSync("schoolId")) || 1;

    wx.showLoading({ title: "正在同步全盘..." });

    wx.request({
      url: `${API_BASE}/api/v1/dashboard/trigger-sync`,
      method: "POST",
      header: {
        "content-type": "application/json",
        token,
        "x-school-id": String(schoolId)
      },
      complete: () => {
        wx.hideLoading();
        this.fetchDashboardData(true);
        wx.showToast({ title: "全盘指标已更新", icon: "success" });
      }
    });
  },

  handleExportPatrolExcel() {
    const token = (wx.getStorageSync && wx.getStorageSync("token")) || "";
    const schoolId = (wx.getStorageSync && wx.getStorageSync("schoolId")) || 1;

    wx.showLoading({ title: "正在合成Excel台账..." });

    wx.request({
      url: `${API_BASE}/api/v1/dashboard/export-excel`,
      method: "POST",
      header: {
        "content-type": "application/json",
        token,
        "x-school-id": String(schoolId)
      },
      data: {
        includeMapQr: true
      },
      success: (res: any) => {
        wx.hideLoading();
        const body = res.data;
        if (body && (body.code === 200 || body.status === 1)) {
          const info = body.data || body.result;
          wx.showModal({
            title: "台账导出成功",
            content: `文件: ${info?.fileName || "台账.xlsx"}\n大小: ${Math.round((info?.fileSizeBytes || 2048) / 1024)} KB\n包含全校隐患定位与高德实景导航`,
            showCancel: false
          });
        } else {
          wx.showToast({ title: "导出生成失败", icon: "none" });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: "网络请求异常", icon: "none" });
      }
    });
  },

  dismissEmergencyAlert() {
    this.setData({ isEmergencyAlert: false });
  }
});
