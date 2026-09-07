/**
 * 高校后勤巡查e速办 v4.0 - M50: 飞书工作台微应用矩阵与动态门禁
 * 文件路径: miniprogram/pages/workplace/components/app-card-item/index.ts
 * 核心职责: 单个微应用卡片渲染，封装动态门禁鉴权、意图路由暂存与徽标呈现
 */

import { IWorkplaceAppItem } from "../../contracts/workplaceTypes";

Component({
  properties: {
    app: {
      type: Object,
      value: {} as IWorkplaceAppItem
    },
    pinManageMode: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    /**
     * 点击微应用卡片
     */
    handleCardTap() {
      const app = this.data.app as IWorkplaceAppItem;
      if (!app || !app.appCode) return;

      // 如果处于置顶编辑管理模式，点击触发置顶切换
      if (this.data.pinManageMode) {
        this.triggerEvent("togglePin", { app });
        return;
      }

      // 1. ACTIVE 状态: 正常放行
      if (app.accessStatus === "ACTIVE") {
        if (typeof wx.vibrateShort === "function") {
          wx.vibrateShort({ type: "light" });
        }
        this.triggerEvent("openApp", { app });

        if (app.entryRoute) {
          wx.navigateTo({
            url: app.entryRoute,
            fail: () => {
              // 若 entryRoute 属于 tabBar 页面则尝试 switchTab
              wx.switchTab({
                url: app.entryRoute,
                fail: () => {
                  wx.showToast({
                    title: `应用路径不存在: ${app.entryRoute}`,
                    icon: "none"
                  });
                }
              });
            }
          });
        }
        return;
      }

      // 2. FROSTED_LOCK 状态: 访客毛玻璃拦截并暂存意图路由
      if (app.accessStatus === "FROSTED_LOCK") {
        if (typeof wx.vibrateShort === "function") {
          wx.vibrateShort({ type: "medium" });
        }

        try {
          wx.setStorageSync("PRE_AUTH_INTENT_ROUTE", app.entryRoute);
          wx.setStorageSync("PRE_AUTH_INTENT_APP", app.appCode);
        } catch (e) {
          console.warn("[Workplace] 暂存意图路由异常", e);
        }

        this.triggerEvent("frostedTap", { app });

        wx.showModal({
          title: "校园认证专享",
          content: `【${app.name}】仅面向本校认证师生开放。请先完成身份核验后即可自动进入。`,
          confirmText: "立即认证",
          cancelText: "稍后再说",
          confirmColor: "#2563EB",
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({
                url: `/pages/index/index?redirect=${encodeURIComponent(app.entryRoute)}`
              });
            }
          }
        });
        return;
      }

      // 3. RESTRICTED 状态: 角色或标签权限不足
      if (app.accessStatus === "RESTRICTED") {
        if (typeof wx.vibrateShort === "function") {
          wx.vibrateShort({ type: "heavy" });
        }
        this.triggerEvent("restrictedTap", { app });
        wx.showToast({
          title: `【${app.name}】需要特定岗位角色或管理授权`,
          icon: "none",
          duration: 2500
        });
        return;
      }
    },

    /**
     * 长按微应用卡片
     */
    handleLongPress() {
      const app = this.data.app as IWorkplaceAppItem;
      if (!app || !app.appCode) return;

      if (typeof wx.vibrateShort === "function") {
        wx.vibrateShort({ type: "medium" });
      }

      this.triggerEvent("longPressApp", { app });
    },

    /**
     * 点击置顶图标切换置顶
     */
    handlePinTap() {
      const app = this.data.app as IWorkplaceAppItem;
      if (!app || !app.appCode) return;

      this.triggerEvent("togglePin", { app });
    }
  }
});
