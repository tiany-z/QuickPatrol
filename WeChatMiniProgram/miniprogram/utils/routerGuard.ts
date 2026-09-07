import { IMicroAppRoute, IPendingIntent } from "../typings/router.js";
import { AuthStore } from "../store/authStore.js";
import { RoleMatcher } from "./roleMatcher.js";

/**
 * M09: 微前端路由守卫与意图调度器 (RouterGuard)
 * 职责：
 * 1. 毫秒级 O(1) 角色位掩码准入判定
 * 2. 未登录访客拦截与原地意图挂起 (Pending Intent Pipeline)
 * 3. 登录成功后 0 割裂直达放行
 * 4. 路由栈深度自适应防爆栈保护 (Stack Throttler)
 */
export class RouterGuard {
  private static appRegistry = new Map<string, IMicroAppRoute>();
  private static pendingIntent: IPendingIntent | null = null;
  private static loginModalTrigger?: (promptText: string) => void;
  private static readonly INTENT_TTL_MS = 300 * 1000; // 5分钟有效期

  /**
   * 注册受保护的微应用路由元数据
   */
  public static registerApp(route: IMicroAppRoute): void {
    this.appRegistry.set(route.appId, route);
  }

  /**
   * 绑定半屏登录组件的唤起钩子
   */
  public static bindLoginModalTrigger(trigger: (promptText: string) => void): void {
    this.loginModalTrigger = trigger;
  }

  /**
   * 统一跳转门禁分发器
   */
  public static navigateToApp(
    appId: string,
    customPath?: string,
    query?: Record<string, any>
  ): boolean {
    const app = this.appRegistry.get(appId);
    if (!app) {
      console.error(`[M09 RouterGuard] 未知微应用: ${appId}`);
      return false;
    }

    const targetUrl = customPath || app.entryPath;
    const userRoleMask = AuthStore.getUserRoleMask();

    // 1. 公开应用直接放行
    if (app.isPublic) {
      this.executeNavigate(targetUrl, query);
      return true;
    }

    // 2. 校验准入权限 (位掩码 O(1) 判定)
    if (RoleMatcher.hasAccess(userRoleMask, app.requiredRoleMask)) {
      this.executeNavigate(targetUrl, query);
      return true;
    }

    // 3. 拦截：未登录访客挂起意图并原地呼起半屏授权
    if (!AuthStore.isLoggedIn()) {
      console.warn(`[M09 RouterGuard] 访客尝试访问受限应用 [${app.name}]，触发门禁挂起`);
      this.pendingIntent = {
        appId,
        url: this.buildUrl(targetUrl, query),
        query,
        timestamp: Date.now()
      };

      if (this.loginModalTrigger) {
        this.loginModalTrigger(
          app.loginPromptText || `登录后即可使用「${app.name}」功能`
        );
      }
      return false;
    }

    // 4. 已登录但角色越权 (例如学生点击师傅工作台)
    if (typeof wx !== "undefined" && wx.showToast) {
      wx.showToast({
        title: "当前身份无权访问该微应用",
        icon: "none",
        duration: 2500
      });
    }
    return false;
  }

  /**
   * 登录成功后冲刷挂起意图直达目标应用
   */
  public static flushPendingIntent(): boolean {
    if (!this.pendingIntent) return false;

    // 校验 5 分钟有效期
    if (Date.now() - this.pendingIntent.timestamp > this.INTENT_TTL_MS) {
      this.pendingIntent = null;
      return false;
    }

    const url = this.pendingIntent.url;
    this.pendingIntent = null;

    console.log(`[M09 RouterGuard] ⚡ 意图唤醒放行直达: ${url}`);
    this.executeNavigate(url);
    return true;
  }

  public static getPendingIntent(): IPendingIntent | null {
    return this.pendingIntent;
  }

  public static clearPendingIntent(): void {
    this.pendingIntent = null;
  }

  /**
   * 深链外链直达安全校验 (扫码直接进入分包页面防越权)
   */
  public static validateDirectAccess(appId: string): boolean {
    const app = this.appRegistry.get(appId);
    if (!app || app.isPublic) return true;

    const userRoleMask = AuthStore.getUserRoleMask();
    return RoleMatcher.hasAccess(userRoleMask, app.requiredRoleMask);
  }

  /**
   * 智能路由执行与防爆栈自适应管道
   */
  public static executeNavigate(url: string, query?: Record<string, any>): void {
    const fullUrl = this.buildUrl(url, query);

    if (typeof getCurrentPages === "function" && typeof wx !== "undefined") {
      const pages = getCurrentPages() || [];
      // 路由栈接近 10 层上限时降级为 redirectTo
      if (pages.length >= 9 && wx.redirectTo) {
        wx.redirectTo({ url: fullUrl });
        return;
      }

      if (wx.navigateTo) {
        wx.navigateTo({
          url: fullUrl,
          fail: () => {
            if (wx.switchTab) {
              wx.switchTab({ url: fullUrl });
            }
          }
        });
        return;
      }
    }
  }

  public static buildUrl(url: string, query?: Record<string, any>): string {
    if (!query || Object.keys(query).length === 0) return url;
    const queryString = Object.entries(query)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    return url.includes("?") ? `${url}&${queryString}` : `${url}?${queryString}`;
  }

  public static clearRegistry(): void {
    this.appRegistry.clear();
    this.pendingIntent = null;
    this.loginModalTrigger = undefined;
  }
}
