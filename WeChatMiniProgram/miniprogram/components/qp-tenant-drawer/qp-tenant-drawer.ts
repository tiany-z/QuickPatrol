import { DeviceAccountRecord } from "../../typings/tenant.js";
import { DeviceAccountStore } from "../../utils/deviceAccountStore.js";
import { TenantStore } from "../../store/tenantStore.js";

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    }
  },
  data: {
    maskedPhone: "138****0000",
    activeAccount: null as DeviceAccountRecord | null,
    historyList: [] as DeviceAccountRecord[],
    renewModalVisible: false,
    targetRenewAccount: null as DeviceAccountRecord | null
  },
  observers: {
    visible(val: boolean) {
      if (val) {
        this.loadAccounts();
      }
    }
  },
  methods: {
    loadAccounts() {
      const active = TenantStore.getCurrentAccount();
      const currentPhone = active ? active.boundPhone : "";
      const rawAccounts = DeviceAccountStore.getAccountsByPhone(currentPhone);

      const sorted = rawAccounts
        .filter((item) => !active || item.schoolId !== active.schoolId)
        .sort((a, b) => {
          const timeA = new Date(a.lastLoginAt).getTime() || 0;
          const timeB = new Date(b.lastLoginAt).getTime() || 0;
          return timeB - timeA;
        });

      this.setData({
        activeAccount: active,
        historyList: sorted,
        maskedPhone: currentPhone
          ? currentPhone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")
          : "未绑定手机"
      });
    },

    closeDrawer() {
      this.triggerEvent("close");
    },

    /**
     * 点击有效高校卡片 -> 触发 0 白屏秒级热切
     */
    async onSelectValidTenant(e: any) {
      const account: DeviceAccountRecord = e.currentTarget.dataset.account;
      if (!account) return;

      if (account.isExpired) {
        // 过期卡片 -> 原地呼起续期弹层
        this.setData({
          renewModalVisible: true,
          targetRenewAccount: account
        });
        return;
      }

      if (wx.showLoading) {
        wx.showLoading({ title: "正在切换...", mask: true });
      }
      await TenantStore.switchTenant(account);
      if (wx.hideLoading) {
        wx.hideLoading();
      }

      this.closeDrawer();
    },

    /**
     * 关闭半屏续期弹窗
     */
    closeRenewModal() {
      this.setData({ renewModalVisible: false, targetRenewAccount: null });
    },

    /**
     * 原地一键续期确认
     */
    onQuickRenewSuccess() {
      if (!this.data.targetRenewAccount) return;
      const renewed: DeviceAccountRecord = {
        ...this.data.targetRenewAccount,
        isExpired: false,
        sessionStatus: "valid",
        lastLoginAt: new Date().toISOString()
      };

      DeviceAccountStore.saveAccount(renewed);
      this.closeRenewModal();
      this.loadAccounts();
      TenantStore.switchTenant(renewed);
      this.closeDrawer();
    }
  }
});
