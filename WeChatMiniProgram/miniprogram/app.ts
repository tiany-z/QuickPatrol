import { ISystemMetrics } from "./typings/theme.js";
import { calculateSystemMetrics, deriveHslTiers } from "./utils/themeHelper.js";

export interface IAppGlobalData {
  systemMetrics: ISystemMetrics;
  currentSchoolId: number;
}

App<{
  globalData: IAppGlobalData;
  initSystemMetrics: () => void;
  applySchoolTheme: (h: number, s: number, l: number) => void;
}>({
  globalData: {
    systemMetrics: {} as ISystemMetrics,
    currentSchoolId: 1,
  },

  onLaunch() {
    this.initSystemMetrics();
  },

  /**
   * 动态视口几何计算与归一化
   */
  initSystemMetrics() {
    try {
      const wxAny = wx as any;
      const windowInfo = wxAny.getWindowInfo ? wxAny.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {});
      const capsule = wx.getMenuButtonBoundingClientRect
        ? wx.getMenuButtonBoundingClientRect()
        : { top: 48, bottom: 80, left: 281, right: 368, width: 87, height: 32 };

      this.globalData.systemMetrics = calculateSystemMetrics(windowInfo, capsule);
      console.log("[M07] 视口安全区归一化就绪", this.globalData.systemMetrics);
    } catch (err) {
      console.error("[M07] 获取系统安全区参数异常，启用标准保底参数", err);
      // 保底回退参数 (标准 iPhone 13/14 规格)
      this.globalData.systemMetrics = {
        statusBarHeight: 47,
        navBarHeight: 44,
        headerTotalHeight: 91,
        capsule: { top: 54, bottom: 86, left: 281, right: 368, width: 87, height: 32 },
        capsuleRightMargin: 7,
        safeBottom: 34,
        screenWidth: 375,
        screenHeight: 812,
      };
    }
  },

  /**
   * 根据多租户学校校徽色动态注入主题
   */
  applySchoolTheme(h: number, s: number, l: number) {
    const tokens = deriveHslTiers({ h, s, l });
    console.log(`[M07] 动态切换学校校徽专属主题: H=${h}, S=${s}%, L=${l}%`, tokens);
  },
});