import { IAuthUser, IAuthState } from "../typings/router.js";
import { RoleMatcher, RoleBitmask } from "../utils/roleMatcher.js";
import { API_BASE } from "../config/env.js";

const AUTH_STORAGE_KEY = "xcesb_auth_state";
const STORAGE_KEY_TOKEN = "qp_token";
const STORAGE_KEY_USER = "qp_user_info";
const STORAGE_KEY_ACTIVE_TYPE = "qp_active_type";

/**
 * M09 & M13: 全局认证状态与多租户双身份中枢 (AuthStore)
 * 支撑渐进式认证、微信静默登录、角色位掩码计算、以及双身份（师生端 ⇄ 师傅端）无感热切换
 */
export class AuthStore {
  private static state: IAuthState & {
    activeType: 1 | 2;
    availableIdentities: Array<{ type: 1 | 2; typeName: string; desc: string }>;
  } = {
    isLoggedIn: false,
    user: null,
    currentSchoolId: 1,
    activeType: 1,
    availableIdentities: [
      { type: 1, typeName: "师生巡查端", desc: "随手拍隐患报修、诉求反映与工单评价" }
    ]
  };

  private static listeners = new Set<(state: IAuthState) => void>();

  public static init(): void {
    try {
      const cached = wx.getStorageSync ? wx.getStorageSync(AUTH_STORAGE_KEY) : null;
      const cachedActiveType = (wx.getStorageSync ? wx.getStorageSync(STORAGE_KEY_ACTIVE_TYPE) : 1) || 1;

      if (cached && cached.user && cached.user.token) {
        const role = cached.user.role || 0;
        const availableIdentities: Array<{ type: 1 | 2; typeName: string; desc: string }> = [
          { type: 1, typeName: "师生巡查端", desc: "随手拍隐患报修、诉求反映与工单评价" }
        ];
        if (role >= 2) {
          availableIdentities.push({
            type: 2,
            typeName: "后勤施工端",
            desc: "工单认领、现场整改打卡与延期申请"
          });
        }

        this.state = {
          isLoggedIn: true,
          user: cached.user,
          currentSchoolId: cached.user.schoolId || 1,
          activeType: cachedActiveType === 2 ? 2 : 1,
          availableIdentities
        };
      }
    } catch {
      // 保持 Guest 模式
    }
  }

  public static isLoggedIn(): boolean {
    return this.state.isLoggedIn;
  }

  public static getCurrentUser(): IAuthUser | null {
    return this.state.user;
  }

  public static getActiveType(): 1 | 2 {
    return this.state.activeType;
  }

  public static getAvailableIdentities(): Array<{ type: 1 | 2; typeName: string; desc: string }> {
    return this.state.availableIdentities;
  }

  public static getUserRoleMask(): number {
    if (!this.state.isLoggedIn || !this.state.user) {
      return RoleBitmask.GUEST;
    }
    return this.state.user.roleMask || RoleMatcher.rolesToMask([this.state.user.role]);
  }

  public static setAuth(user: IAuthUser, activeType: 1 | 2 = 1): void {
    const roleMask = user.roleMask || RoleMatcher.rolesToMask([user.role]);
    const availableIdentities: Array<{ type: 1 | 2; typeName: string; desc: string }> = [
      { type: 1, typeName: "师生巡查端", desc: "随手拍隐患报修、诉求反映与工单评价" }
    ];
    if (user.role >= 2) {
      availableIdentities.push({
        type: 2,
        typeName: "后勤施工端",
        desc: "工单认领、现场整改打卡与延期申请"
      });
    }

    const safeActiveType = (activeType === 2 && user.role >= 2) ? 2 : 1;

    this.state = {
      isLoggedIn: true,
      user: { ...user, roleMask },
      currentSchoolId: user.schoolId,
      activeType: safeActiveType,
      availableIdentities
    };

    try {
      if (wx.setStorageSync) {
        wx.setStorageSync(AUTH_STORAGE_KEY, this.state);
        wx.setStorageSync(STORAGE_KEY_TOKEN, user.token);
        wx.setStorageSync(STORAGE_KEY_USER, user);
        wx.setStorageSync(STORAGE_KEY_ACTIVE_TYPE, safeActiveType);
      }
    } catch (e) {
      console.error("[AuthStore] 缓存持久化异常", e);
    }
    this.notify();
  }

  public static clearAuth(): void {
    this.state = {
      isLoggedIn: false,
      user: null,
      currentSchoolId: this.state.currentSchoolId,
      activeType: 1,
      availableIdentities: [
        { type: 1, typeName: "师生巡查端", desc: "随手拍隐患报修、诉求反映与工单评价" }
      ]
    };

    try {
      if (wx.removeStorageSync) {
        wx.removeStorageSync(AUTH_STORAGE_KEY);
        wx.removeStorageSync(STORAGE_KEY_TOKEN);
        wx.removeStorageSync(STORAGE_KEY_USER);
        wx.removeStorageSync(STORAGE_KEY_ACTIVE_TYPE);
      }
    } catch {
      // ignore
    }
    this.notify();
  }

  public static subscribe(fn: (state: IAuthState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private static notify(): void {
    this.listeners.forEach((fn) => {
      try {
        fn(this.state);
      } catch (e) {
        console.error("[AuthStore] 监听器通知异常", e);
      }
    });
  }

  public static clearAll(): void {
    this.listeners.clear();
    this.state = {
      isLoggedIn: false,
      user: null,
      currentSchoolId: 1,
      activeType: 1,
      availableIdentities: [
        { type: 1, typeName: "师生巡查端", desc: "随手拍隐患报修与工单评价" }
      ]
    };
  }

  /**
   * M13 微信静默登录
   */
  public static async silentLogin(schoolId: number): Promise<boolean> {
    if (!wx.login) return false;

    return new Promise((resolve) => {
      wx.login({
        success: async (res) => {
          if (!res.code) {
            resolve(false);
            return;
          }

          try {
            if (!wx.request) {
              resolve(false);
              return;
            }

            wx.request({
              url: `${API_BASE}/api/auth/login`,
              method: "POST",
              data: { schoolId, code: res.code },
              success: (apiRes: any) => {
                if (apiRes?.data?.success && apiRes.data.data) {
                  const data = apiRes.data.data;
                  this.setAuth(
                    {
                      userId: data.userInfo.userId,
                      openId: data.userInfo.openId || "",
                      boundPhone: data.userInfo.phone || "",
                      realName: data.userInfo.realName || data.userInfo.nickName,
                      role: data.userInfo.role,
                      roleName: data.userInfo.roleText,
                      roleMask: RoleMatcher.rolesToMask([data.userInfo.role]),
                      schoolId: data.userInfo.schoolId,
                      schoolName: "",
                      token: data.token
                    },
                    data.activeType
                  );
                  resolve(true);
                } else {
                  resolve(false);
                }
              },
              fail: () => resolve(false)
            });
          } catch {
            resolve(false);
          }
        },
        fail: () => resolve(false)
      });
    });
  }

  /**
   * M13 双身份无缝切换 (师生端 ⇄ 师傅端)
   */
  public static async switchActiveType(targetType: 1 | 2): Promise<boolean> {
    if (!this.state.isLoggedIn || !this.state.user) {
      return false;
    }

    if (this.state.activeType === targetType) {
      return true;
    }

    // 客户端基础防护：role < 2 严禁切换到施工端
    if (targetType === 2 && this.state.user.role < 2) {
      return false;
    }

    try {
      if (!wx.request) {
        this.state.activeType = targetType;
        this.notify();
        return true;
      }

      return new Promise((resolve) => {
        wx.request({
          url: "https://api.quickpatrol.edu.cn/api/auth/switch-identity",
          method: "POST",
          header: { Authorization: `Bearer ${this.state.user!.token}` },
          data: { targetActiveType: targetType },
          success: (res: any) => {
            if (res?.data?.success && res.data.data) {
              const { token, activeType } = res.data.data;
              if (this.state.user) {
                this.state.user.token = token;
              }
              this.state.activeType = activeType;

              try {
                if (wx.setStorageSync) {
                  wx.setStorageSync(AUTH_STORAGE_KEY, this.state);
                  wx.setStorageSync(STORAGE_KEY_TOKEN, token);
                  wx.setStorageSync(STORAGE_KEY_ACTIVE_TYPE, activeType);
                }
              } catch {}

              this.notify();
              resolve(true);
            } else {
              resolve(false);
            }
          },
          fail: () => resolve(false)
        });
      });
    } catch {
      return false;
    }
  }
}

/** 实例型快捷门面对象 (完全遵循 M13 设计规范) */
export const authStore = {
  getState: () => ({
    token: AuthStore.getCurrentUser()?.token || "",
    userInfo: AuthStore.getCurrentUser(),
    activeType: AuthStore.getActiveType(),
    availableIdentities: AuthStore.getAvailableIdentities(),
    isLoggedIn: AuthStore.isLoggedIn()
  }),
  subscribe: (listener: (state: any) => void) => AuthStore.subscribe(listener as any),
  silentLogin: (schoolId: number) => AuthStore.silentLogin(schoolId),
  switchActiveType: (targetType: 1 | 2) => AuthStore.switchActiveType(targetType)
};
