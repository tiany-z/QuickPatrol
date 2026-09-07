/**
 * WeChatMiniProgram/miniprogram/packages/apps/app-patrol/services/dispatchNoticeListener.ts
 * 高校后勤巡查e速办 v4.0 - 小程序端工单派发推送监听服务 (M23)
 * 
 * 核心特性：
 * 1. 订阅 WebSocket 'WORK_ORDER_DISPATCHED' 实时派发广播
 * 2. 区分直接派发 (DIRECT_DISPATCH) 与工单池广播 (POOL_BROADCAST)
 * 3. 毫秒级触感震动反馈：加急工单长震动 (vibrateLong)，常规工单中度短震动 (vibrateShort)
 * 4. 弹出专属模态框与快捷路由指引（直达工单详情或工单池认领）
 */

import { QpWsClient } from "../../../../utils/wsClient.js";

declare const wx: any;

export interface IDispatchNoticePayload {
  schoolId: number;
  patrolId: number;
  orderNo: string;
  title: string;
  campusId: number;
  categoryId: number;
  priorityLevel: number;
  type: "DIRECT_DISPATCH" | "POOL_BROADCAST";
  targetUserId?: number;
  targetTagId?: number;
  timestamp: number;
}

export class DispatchNoticeListener {
  private static isInitialized = false;

  /**
   * 初始化工单派发事件监听器
   */
  public static init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    QpWsClient.on("WORK_ORDER_DISPATCHED", (payload: IDispatchNoticePayload) => {
      this.handleDispatchNotice(payload);
    });
  }

  /**
   * 停止监听（用于清理或退出登录）
   */
  public static destroy(): void {
    if (!this.isInitialized) return;
    QpWsClient.off("WORK_ORDER_DISPATCHED", this.handleDispatchNotice);
    this.isInitialized = false;
  }

  /**
   * 处理派发提醒与触感交互
   */
  private static handleDispatchNotice(payload: IDispatchNoticePayload): void {
    if (!payload || !payload.patrolId) return;

    // 1. 触发触感震动反馈
    try {
      if (payload.priorityLevel === 2) {
        if (wx.vibrateLong) {
          wx.vibrateLong();
        }
      } else {
        if (wx.vibrateShort) {
          wx.vibrateShort({ type: "medium" });
        }
      }
    } catch (e) {
      console.warn("[M23] 触感震动 API 调用受限或不支持", e);
    }

    // 2. 弹窗提示与指引
    const isDirect = payload.type === "DIRECT_DISPATCH";
    const content = isDirect
      ? `您有一条新的巡查工单 [${payload.orderNo}] 已指派给您，请及时响应处理！\n标题：${payload.title}`
      : `公共工单池收到一条待认领工单 [${payload.orderNo}]，符合您的岗位标签职责，可前往认领！\n标题：${payload.title}`;

    if (wx.showModal) {
      wx.showModal({
        title: isDirect ? "🔔 新工单指派提醒" : "📢 新工单认领提醒",
        content,
        confirmText: isDirect ? "立即查看" : "前往工单池",
        cancelText: "稍后处理",
        success: (res: any) => {
          if (res && res.confirm) {
            if (isDirect) {
              if (wx.navigateTo) {
                wx.navigateTo({
                  url: `/packages/apps/app-patrol/pages/detail/index?id=${payload.patrolId}`
                });
              }
            } else {
              if (wx.navigateTo) {
                wx.navigateTo({
                  url: `/packages/apps/app-patrol/pages/pool/index?tagId=${payload.targetTagId || 0}`
                });
              }
            }
          }
        }
      });
    }
  }
}
