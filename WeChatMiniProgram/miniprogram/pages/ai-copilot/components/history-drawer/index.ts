/**
 * 高校后勤巡查e速办 v4.0 - M49: AI 会话持久化与智能工单卡片直达
 * 文件路径: miniprogram/pages/ai-copilot/components/history-drawer/index.ts
 * 核心职责: 小程序侧边栏抽屉组件，支持查看历史会话列表，点击重载会话。
 */

import { IAISessionSummaryDto } from "../../contracts/copilotTypes";

Component({
  properties: {
    isOpen: {
      type: Boolean,
      value: false
    }
  },

  data: {
    sessions: [] as IAISessionSummaryDto[],
    loading: false
  },

  observers: {
    isOpen(val: boolean) {
      if (val) {
        this.loadSessionList();
      }
    }
  },

  methods: {
    async loadSessionList() {
      this.setData({ loading: true });
      try {
        const token = wx.getStorageSync("token") || "";
        const res = await new Promise<any>((resolve, reject) => {
          wx.request({
            url: "https://patrol.university.edu.cn/api/v1/ai/sessions?page=1&limit=20",
            header: { Authorization: `Bearer ${token}` },
            success: (r) => resolve(r.data),
            fail: reject
          });
        });

        if (res && res.code === 200 && Array.isArray(res.data)) {
          this.setData({ sessions: res.data });
        }
      } catch {
        // 容错处理
      } finally {
        this.setData({ loading: false });
      }
    },

    handleSelect(e: any) {
      const uuid = e.currentTarget.dataset.uuid;
      this.triggerEvent("selectSession", { sessionUuid: uuid });
      this.triggerEvent("close");
    },

    handleClose() {
      this.triggerEvent("close");
    }
  }
});
