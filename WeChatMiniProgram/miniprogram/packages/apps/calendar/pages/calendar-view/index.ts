/**
 * 高校后勤巡查e速办 v4.0 - M51 全景日历日程联动与值班排班表
 * 文件路径: miniprogram/packages/apps/calendar/pages/calendar-view/index.ts
 * 核心职责: 小程序端全景日历页面控制器，月/日视图流转、时间槽贪心重叠排版展示、红线推移与直拨
 */

import {
  ICalendarMonthViewResponseDto,
  ICalendarDayViewResponseDto,
  IScheduleTimelineItemDto
} from "../../contracts/calendarTypes";

import { API_BASE } from "../../../../../config/env.js";

Page({
  data: {
    loading: true,
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth() + 1,
    selectedDateStr: "",
    monthData: null as ICalendarMonthViewResponseDto | null,
    dayData: null as ICalendarDayViewResponseDto | null,
    currentTimeRedLineTop: 0,
    isTodaySelected: true
  },

  _redLineTimer: null as any,

  onLoad() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const todayStr = `${year}-${month}-${day}`;

    this.setData({
      currentYear: now.getFullYear(),
      currentMonth: now.getMonth() + 1,
      selectedDateStr: todayStr,
      isTodaySelected: true
    });

    this.loadMonthData(this.data.currentYear, this.data.currentMonth);
    this.loadDayData(todayStr);
    this.startCurrentTimeTicker();
  },

  onUnload() {
    if (this._redLineTimer) {
      clearInterval(this._redLineTimer);
      this._redLineTimer = null;
    }
  },

  onPullDownRefresh() {
    Promise.all([
      this.loadMonthData(this.data.currentYear, this.data.currentMonth),
      this.loadDayData(this.data.selectedDateStr)
    ]).finally(() => {
      if (typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
    });
  },

  /**
   * 拉取月度 42 单元格日历及微圆点大盘
   */
  async loadMonthData(year: number, month: number): Promise<void> {
    const token = wx.getStorageSync ? (wx.getStorageSync("token") || wx.getStorageSync("qp_token") || "") : "";
    const schoolId = wx.getStorageSync ? (wx.getStorageSync("schoolId") || 1) : 1;

    return new Promise((resolve) => {
      if (!wx.request) return resolve();

      wx.request({
        url: `${API_BASE}/api/v1/schedules/month?year=${year}&month=${month}`,
        method: "GET",
        header: {
          "Content-Type": "application/json",
          "x-school-id": schoolId,
          token,
          Authorization: token ? `Bearer ${token}` : ""
        },
        success: (res: any) => {
          if (res?.data?.code === 200 && res.data.data) {
            this.setData({
              monthData: res.data.data as ICalendarMonthViewResponseDto,
              loading: false
            });
          } else {
            this.setData({ loading: false });
          }
          resolve();
        },
        fail: () => {
          this.setData({ loading: false });
          resolve();
        }
      });
    });
  },

  /**
   * 拉取某日 24h 垂直时刻时间轴与值班排班名牌
   */
  async loadDayData(dateStr: string): Promise<void> {
    const token = wx.getStorageSync ? (wx.getStorageSync("token") || wx.getStorageSync("qp_token") || "") : "";
    const schoolId = wx.getStorageSync ? (wx.getStorageSync("schoolId") || 1) : 1;

    return new Promise((resolve) => {
      if (!wx.request) return resolve();

      wx.request({
        url: `${API_BASE}/api/v1/schedules/day?date=${dateStr}`,
        method: "GET",
        header: {
          "Content-Type": "application/json",
          "x-school-id": schoolId,
          token,
          Authorization: token ? `Bearer ${token}` : ""
        },
        success: (res: any) => {
          if (res?.data?.code === 200 && res.data.data) {
            this.setData({
              dayData: res.data.data as ICalendarDayViewResponseDto
            });
          }
          resolve();
        },
        fail: () => resolve()
      });
    });
  },

  /**
   * 点击日历月网格单元格
   */
  handleDateTap(e: any) {
    const dateStr = e.currentTarget.dataset.date;
    if (!dateStr) return;

    if (typeof wx.vibrateShort === "function") {
      wx.vibrateShort({ type: "light" });
    }

    const todayStr = this.getTodayDateStr();
    this.setData({
      selectedDateStr: dateStr,
      isTodaySelected: dateStr === todayStr
    });

    this.loadDayData(dateStr);
  },

  /**
   * 切换上一个月
   */
  handlePrevMonth() {
    let m = this.data.currentMonth - 1;
    let y = this.data.currentYear;
    if (m < 1) {
      m = 12;
      y--;
    }
    this.setData({ currentYear: y, currentMonth: m });
    this.loadMonthData(y, m);
  },

  /**
   * 切换下一个月
   */
  handleNextMonth() {
    let m = this.data.currentMonth + 1;
    let y = this.data.currentYear;
    if (m > 12) {
      m = 1;
      y++;
    }
    this.setData({ currentYear: y, currentMonth: m });
    this.loadMonthData(y, m);
  },

  /**
   * 点击时间轴上事件卡片 (支持工单详情跳转)
   */
  handleTimelineItemTap(e: any) {
    const item = e.currentTarget.dataset.item as IScheduleTimelineItemDto;
    if (!item) return;

    if (typeof wx.vibrateShort === "function") {
      wx.vibrateShort({ type: "light" });
    }

    if (item.detailUrl) {
      wx.navigateTo({
        url: item.detailUrl,
        fail: () => {
          wx.showToast({ title: `查看事件: ${item.title}`, icon: "none" });
        }
      });
    } else {
      wx.showModal({
        title: item.title,
        content: `时间: ${item.startTimeText} - ${item.endTimeText}\n地点: ${item.location || "现场"}${
          item.dutyPersonName ? `\n责任人: ${item.dutyPersonName}` : ""
        }`,
        showCancel: false,
        confirmText: "我知道了"
      });
    }
  },

  /**
   * 开启当前时间红线推移定时器
   */
  startCurrentTimeTicker() {
    this.updateRedLine();
    this._redLineTimer = setInterval(() => {
      this.updateRedLine();
    }, 60000); // 每一分钟刷新一次红线位置
  },

  updateRedLine() {
    const now = new Date();
    const totalMin = now.getHours() * 60 + now.getMinutes();
    const top = Number(((totalMin / 1440) * 100).toFixed(2));
    this.setData({ currentTimeRedLineTop: top });
  },

  getTodayDateStr(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
});
