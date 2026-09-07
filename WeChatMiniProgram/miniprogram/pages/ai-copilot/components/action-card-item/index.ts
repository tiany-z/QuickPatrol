/**
 * 高校后勤巡查e速办 v4.0 - M49: AI 会话持久化与智能工单卡片直达
 * 文件路径: miniprogram/pages/ai-copilot/components/action-card-item/index.ts
 * 核心职责: 小程序端智能工单卡片组件，点击动作按钮平滑跳转至 M30 工单详情轴。
 */

import { IAIActionCardPayload } from "../../contracts/copilotTypes";

Component({
  properties: {
    cardData: {
      type: Object,
      value: {} as IAIActionCardPayload
    }
  },

  methods: {
    /**
     * 点击卡片内操作按钮
     */
    handleActionTap(e: any) {
      const action = e.currentTarget.dataset.action;
      if (!action) return;

      if (typeof wx.vibrateShort === "function") {
        wx.vibrateShort({ type: "light" });
      }

      if (action.actionType === "NAVIGATE_PATROL_DETAIL") {
        wx.navigateTo({
          url: action.targetParam,
          fail: () => {
            wx.showToast({ title: "打开工单详情失败", icon: "none" });
          }
        });
      } else if (action.actionType === "DIAL_PHONE") {
        wx.makePhoneCall({
          phoneNumber: action.targetParam
        });
      }
    }
  }
});
