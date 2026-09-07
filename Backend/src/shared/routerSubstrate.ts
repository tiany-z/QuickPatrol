/**
 * M09: 飞书式 4-Tab 导航中枢与微前端路由守卫 (TabBar & Router Guard)
 * 后端共享契约与算法映射实现 (与小程序端 100% 同构对齐)
 */

export enum RoleBitmask {
  GUEST = 1 << 0, // 1 - 未登录访客
  STUDENT = 1 << 1, // 2 - 学生
  STAFF = 1 << 2, // 4 - 教职工
  WORKER = 1 << 3, // 8 - 维保师傅
  INSPECTOR = 1 << 4, // 16 - 质检复核员
  SUPERVISOR = 1 << 5, // 32 - 科室主管
  ADMIN = 1 << 6, // 64 - 校管理员
  ROOT = 1 << 7, // 128 - 平台超管
}

export interface IMicroAppRoute {
  appId: string;
  name: string;
  icon: string;
  entryPath: string;
  requiredRoleMask: number;
  isPublic: boolean;
  loginPromptText?: string;
  badgeCount?: number;
}

export interface IPendingIntent {
  appId: string;
  url: string;
  query?: Record<string, any>;
  timestamp: number;
}

export interface ITabBarItem {
  pagePath: string;
  text: string;
  iconPath: string;
  selectedIconPath: string;
  badgeCount: number;
}

export interface IAuthUser {
  userId: number;
  openId: string;
  boundPhone: string;
  realName: string;
  role: number;
  roleName: string;
  roleMask: number;
  schoolId: number;
  schoolName: string;
  token: string;
}

export interface IAuthState {
  isLoggedIn: boolean;
  user: IAuthUser | null;
  currentSchoolId: number;
}

/**
 * 算法 1: 基于位掩码的高性能多角色权限判定算法 (Role Bitmask Matcher)
 */
export class RoleMatcher {
  public static rolesToMask(roles: number[]): number {
    if (!roles || roles.length === 0) {
      return RoleBitmask.GUEST;
    }
    return roles.reduce((acc, role) => {
      switch (role) {
        case 0:
          return acc | RoleBitmask.STUDENT;
        case 1:
          return acc | RoleBitmask.STAFF;
        case 2:
          return acc | RoleBitmask.WORKER;
        case 3:
          return acc | RoleBitmask.INSPECTOR;
        case 4:
          return acc | RoleBitmask.SUPERVISOR;
        case 5:
          return acc | RoleBitmask.ADMIN;
        case 9:
          return acc | RoleBitmask.ROOT;
        default:
          return acc;
      }
    }, 0);
  }

  public static hasAccess(userRoleMask: number, appRequiredMask: number): boolean {
    if ((userRoleMask & RoleBitmask.ROOT) !== 0) {
      return true;
    }
    return (userRoleMask & appRequiredMask) !== 0;
  }
}

/**
 * 全局认证状态模拟器 (MemoryAuthStore)
 */
export class MemoryAuthStore {
  private static state: IAuthState = {
    isLoggedIn: false,
    user: null,
    currentSchoolId: 1,
  };

  private static listeners = new Set<(state: IAuthState) => void>();

  public static isLoggedIn(): boolean {
    return this.state.isLoggedIn;
  }

  public static getCurrentUser(): IAuthUser | null {
    return this.state.user;
  }

  public static getUserRoleMask(): number {
    if (!this.state.isLoggedIn || !this.state.user) {
      return RoleBitmask.GUEST;
    }
    return this.state.user.roleMask || RoleMatcher.rolesToMask([this.state.user.role]);
  }

  public static setAuth(user: IAuthUser): void {
    const roleMask = user.roleMask || RoleMatcher.rolesToMask([user.role]);
    this.state = {
      isLoggedIn: true,
      user: { ...user, roleMask },
      currentSchoolId: user.schoolId,
    };
    this.listeners.forEach((fn) => fn(this.state));
  }

  public static clearAuth(): void {
    this.state = {
      isLoggedIn: false,
      user: null,
      currentSchoolId: this.state.currentSchoolId,
    };
    this.listeners.forEach((fn) => fn(this.state));
  }

  public static subscribe(fn: (state: IAuthState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  public static clearAll(): void {
    this.listeners.clear();
    this.state = {
      isLoggedIn: false,
      user: null,
      currentSchoolId: 1,
    };
  }
}

/**
 * 微前端路由守卫模拟器 (MemoryRouterGuard)
 */
export class MemoryRouterGuard {
  private static appRegistry = new Map<string, IMicroAppRoute>();
  private static pendingIntent: IPendingIntent | null = null;
  private static loginModalTrigger?: (promptText: string) => void;
  public static lastNavigatedUrl: string | null = null;
  public static lastToastMessage: string | null = null;
  private static readonly INTENT_TTL_MS = 300 * 1000;

  public static registerApp(route: IMicroAppRoute): void {
    this.appRegistry.set(route.appId, route);
  }

  public static bindLoginModalTrigger(trigger: (promptText: string) => void): void {
    this.loginModalTrigger = trigger;
  }

  public static navigateToApp(
    appId: string,
    customPath?: string,
    query?: Record<string, any>
  ): boolean {
    const app = this.appRegistry.get(appId);
    if (!app) {
      return false;
    }

    const targetUrl = customPath || app.entryPath;
    const userRoleMask = MemoryAuthStore.getUserRoleMask();

    // 1. 公开应用直接放行
    if (app.isPublic) {
      this.lastNavigatedUrl = this.buildUrl(targetUrl, query);
      return true;
    }

    // 2. 权限校验
    if (RoleMatcher.hasAccess(userRoleMask, app.requiredRoleMask)) {
      this.lastNavigatedUrl = this.buildUrl(targetUrl, query);
      return true;
    }

    // 3. 访客拦截并挂起意图
    if (!MemoryAuthStore.isLoggedIn()) {
      this.pendingIntent = {
        appId,
        url: this.buildUrl(targetUrl, query),
        query,
        timestamp: Date.now(),
      };
      if (this.loginModalTrigger) {
        this.loginModalTrigger(
          app.loginPromptText || `登录后即可使用「${app.name}」功能`
        );
      }
      return false;
    }

    // 4. 越权拦截
    this.lastToastMessage = "当前身份无权访问该微应用";
    return false;
  }

  public static flushPendingIntent(): boolean {
    if (!this.pendingIntent) return false;

    if (Date.now() - this.pendingIntent.timestamp > this.INTENT_TTL_MS) {
      this.pendingIntent = null;
      return false;
    }

    const url = this.pendingIntent.url;
    this.pendingIntent = null;
    this.lastNavigatedUrl = url;
    return true;
  }

  public static getPendingIntent(): IPendingIntent | null {
    return this.pendingIntent;
  }

  public static setPendingIntentForTest(intent: IPendingIntent | null): void {
    this.pendingIntent = intent;
  }

  public static clearPendingIntent(): void {
    this.pendingIntent = null;
  }

  public static validateDirectAccess(appId: string): boolean {
    const app = this.appRegistry.get(appId);
    if (!app || app.isPublic) return true;

    const userRoleMask = MemoryAuthStore.getUserRoleMask();
    return RoleMatcher.hasAccess(userRoleMask, app.requiredRoleMask);
  }

  public static buildUrl(url: string, query?: Record<string, any>): string {
    if (!query || Object.keys(query).length === 0) return url;
    const queryString = Object.entries(query)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    return url.includes("?") ? `${url}&${queryString}` : `${url}?${queryString}`;
  }

  public static clearAll(): void {
    this.appRegistry.clear();
    this.pendingIntent = null;
    this.loginModalTrigger = undefined;
    this.lastNavigatedUrl = null;
    this.lastToastMessage = null;
  }
}
