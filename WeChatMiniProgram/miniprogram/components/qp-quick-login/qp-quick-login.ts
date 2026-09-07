import { RouterGuard } from "../../utils/routerGuard.js";
import { AuthStore } from "../../store/authStore.js";
import { DeviceAccountStore } from "../../utils/deviceAccountStore.js";

Component({
  data: {
    visible: false,
    promptText: "登录后即可体验完整后勤巡查协同功能"
  },
  lifetimes: {
    attached() {
      // 向路由守卫绑定自己的呼起钩子
      RouterGuard.bindLoginModalTrigger((promptText: string) => {
        this.setData({
          visible: true,
          promptText: promptText || this.data.promptText
        });
      });
    }
  },
  methods: {
    closeModal() {
      this.setData({ visible: false });
      RouterGuard.clearPendingIntent();
    },

    /**
     * 微信手机号快捷一键授权回调
     */
    async onGetPhoneNumber(e: any) {
      if (!e || !e.detail || !e.detail.code) {
        // 用户取消或拒绝授权
        if (typeof wx !== "undefined" && wx.showToast) {
          wx.showToast({ title: "已取消授权", icon: "none" });
        }
        this.closeModal();
        return;
      }

      if (typeof wx !== "undefined" && wx.showLoading) {
        wx.showLoading({ title: "正在登录...", mask: true });
      }

      try {
        const mockUser = {
          userId: 1001,
          openId: "wx_mock_openid_123",
          boundPhone: "13800000000",
          realName: "张三 (认证)",
          role: 0,
          roleName: "在校学生",
          roleMask: 2,
          schoolId: 1,
          schoolName: "聊城大学",
          token: "jwt_mock_token_abcdef"
        };

        AuthStore.setAuth(mockUser);
        DeviceAccountStore.saveAccount({
          schoolId: mockUser.schoolId,
          schoolName: mockUser.schoolName,
          schoolCode: "lcu",
          logoUrl: "",
          campusName: "西校区",
          boundPhone: mockUser.boundPhone,
          userId: mockUser.userId,
          realName: mockUser.realName,
          role: mockUser.role,
          roleName: mockUser.roleName,
          token: mockUser.token,
          tokenExpireAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          isExpired: false,
          sessionStatus: "active",
          lastLoginAt: new Date().toISOString()
        });

        if (typeof wx !== "undefined" && wx.hideLoading) {
          wx.hideLoading();
        }
        this.setData({ visible: false });

        // 核心放行：自动唤醒并冲刷被挂起的微应用意图直达
        RouterGuard.flushPendingIntent();
      } catch (err) {
        if (typeof wx !== "undefined" && wx.hideLoading) {
          wx.hideLoading();
        }
        if (typeof wx !== "undefined" && wx.showToast) {
          wx.showToast({ title: "登录失败，请重试", icon: "none" });
        }
      }
    }
  }
});
