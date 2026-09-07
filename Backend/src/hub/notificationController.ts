/**
 * 高校后勤巡查e速办 v4.0 - M42: 统一通知中枢端点控制器
 * (Notification Hub API Controller)
 */

import { NotificationService } from "./notificationService.js";
import { IQueryAppNotificationsDto } from "./notificationTypes.js";
import { returnError, returnSuccess, StandardResult } from "../shared/flow/result.js";

export interface INotificationHttpCtx {
  schoolId: number;
  userId: number;
  userRole?: number;
  params?: Record<string, any>;
  query?: Record<string, any>;
  body?: Record<string, any>;
}

export class NotificationController {
  constructor(private readonly notifService: NotificationService = new NotificationService()) {}

  /**
   * GET /api/v4/notification/sessions
   * 获取按微应用折叠的通知会话列表
   */
  public async getSessions(ctx: INotificationHttpCtx): Promise<any> {
    const { schoolId, userId } = ctx;

    if (!schoolId || !userId) {
      return { code: 400, message: "参数缺失: schoolId 或 userId 未提供" };
    }

    try {
      const sessions = await this.notifService.getAppSessions(schoolId, userId);
      const totalUnread = sessions.reduce((acc, cur) => acc + cur.unreadCount, 0);
      return {
        code: 200,
        message: "获取成功",
        data: {
          totalUnread,
          sessions
        }
      };
    } catch (err: unknown) {
      return { code: 500, message: (err as Error).message || "获取通知会话大盘失败" };
    }
  }

  public async handleGetSessions(ctx: INotificationHttpCtx): Promise<StandardResult<any>> {
    const res = await this.getSessions(ctx);
    if (res.code === 200) {
      return returnSuccess(res.data, res.message);
    }
    return returnError(res.message);
  }

  /**
   * GET /api/v4/notification/messages 或 /api/v4/notification/apps/:appId/messages
   * 分页获取某个微应用的明细卡片流水
   */
  public async getAppNotifications(ctx: INotificationHttpCtx): Promise<any> {
    const { schoolId, userId, params = {}, query = {}, body = {} } = ctx;
    const appId = String(params.appId || query.appId || body.appId || "").trim();

    if (!appId) {
      return { code: 400, message: "缺少参数: appId 为必填项" };
    }

    const dto: IQueryAppNotificationsDto = {
      appId,
      page: query.page ? parseInt(String(query.page), 10) : 1,
      pageSize: query.pageSize ? parseInt(String(query.pageSize), 10) : 20,
      onlyUnread: query.onlyUnread === "true" || query.onlyUnread === true || query.onlyUnread === 1
    };

    try {
      const result = await this.notifService.queryAppNotifications(schoolId, userId, dto);
      return { code: 200, message: "获取成功", data: result };
    } catch (err: unknown) {
      return { code: 500, message: (err as Error).message || "拉取通知流水失败" };
    }
  }

  public async handleGetAppNotifications(ctx: INotificationHttpCtx): Promise<StandardResult<any>> {
    const res = await this.getAppNotifications(ctx);
    if (res.code === 200) {
      return returnSuccess(res.data, res.message);
    }
    return returnError(res.message);
  }

  /**
   * POST /api/v4/notification/ack-read
   * 标记通知已读 (支持单条消除或按应用一键全清)
   */
  public async ackRead(ctx: INotificationHttpCtx): Promise<any> {
    const { schoolId, userId, body = {}, params = {}, query = {} } = ctx;
    const appId = String(body.appId || params.appId || query.appId || "").trim();
    const messageId = parseInt(String(body.messageId || query.messageId || 0), 10);

    if (!appId) {
      return { code: 400, message: "缺少参数: appId 为必填项" };
    }

    try {
      const res = await this.notifService.ackRead(schoolId, userId, messageId, appId);
      return { code: 200, message: "已读状态更新成功", data: res };
    } catch (err: unknown) {
      return { code: 500, message: (err as Error).message || "更新已读状态失败" };
    }
  }

  public async handleAckRead(ctx: INotificationHttpCtx): Promise<StandardResult<any>> {
    const res = await this.ackRead(ctx);
    if (res.code === 200) {
      return returnSuccess(res.data, res.message);
    }
    return returnError(res.message);
  }
}
