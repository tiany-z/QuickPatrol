/**
 * 高校后勤巡查e速办 v4.0 - M40: 视口停留已读瞬间消除与工单置顶排序大盘控制器
 * (Chat Session Controller)
 */

import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";
import { ChatSessionService } from "./chatSessionService.js";

export interface IChatHttpCtx {
  schoolId: number;
  userId: number;
  userRole: number;
  params?: { id?: string };
  query?: any;
  body?: any;
}

export class ChatSessionController {
  constructor(private readonly sessionService: ChatSessionService = new ChatSessionService()) {}

  /**
   * GET /api/v4/chat/sessions
   * 获取当前用户会话大盘列表
   */
  public async getSessions(ctx: IChatHttpCtx): Promise<any> {
    const { schoolId, userId, userRole } = ctx;

    if (!schoolId || !userId) {
      return { code: 400, message: "参数缺失: schoolId 或 userId 未提供" };
    }

    try {
      const sessions = await this.sessionService.getUserSessions(schoolId, userId, userRole);
      const totalUnread = await this.sessionService.calculateUserTotalUnread(schoolId, userId);
      return {
        code: 200,
        message: "获取成功",
        data: {
          totalUnread,
          sessions
        }
      };
    } catch (err: unknown) {
      return { code: 500, message: (err as Error).message || "获取会话列表失败" };
    }
  }

  public async handleGetSessions(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
    const raw = await this.getSessions(ctx);
    if (raw.code === 200) {
      return returnSuccess(raw.data, raw.message);
    }
    return returnError(raw.message);
  }

  /**
   * POST /api/v4/chat/rooms/ack-read 或 /api/v4/chat/rooms/:id/ack-read
   * 视口停留满 300ms 消除未读数
   */
  public async ackRead(ctx: IChatHttpCtx): Promise<any> {
    const rawId = ctx.params?.id || ctx.body?.chatRoomId || ctx.query?.chatRoomId;
    const chatRoomId = parseInt(String(rawId || "0"), 10);
    const { schoolId, userId } = ctx;

    if (!chatRoomId || isNaN(chatRoomId)) {
      return { code: 400, message: "无效的会话 ID" };
    }

    if (!schoolId || !userId) {
      return { code: 400, message: "参数缺失: schoolId 或 userId 未提供" };
    }

    try {
      const res = await this.sessionService.ackRoomRead(schoolId, chatRoomId, userId);
      return res;
    } catch (err: unknown) {
      return { code: 400, message: (err as Error).message || "未读消除失败" };
    }
  }

  public async handleAckRead(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
    const raw = await this.ackRead(ctx);
    if (raw.code === 200) {
      return returnSuccess(raw.data, raw.message);
    }
    return returnError(raw.message);
  }

  /**
   * POST /api/v4/chat/rooms/pin 或 /api/v4/chat/rooms/:id/pin
   * 切换个人置顶状态
   */
  public async togglePin(ctx: IChatHttpCtx): Promise<any> {
    const rawId = ctx.params?.id || ctx.body?.chatRoomId || ctx.query?.chatRoomId;
    const chatRoomId = parseInt(String(rawId || "0"), 10);
    const { schoolId, userId } = ctx;
    const pin = typeof ctx.body?.pin === "boolean" ? ctx.body.pin : (ctx.body?.pin === 1 || ctx.body?.pin === "true");

    if (!chatRoomId || isNaN(chatRoomId)) {
      return { code: 400, message: "参数缺失: chatRoomId 必须为有效整数" };
    }

    if (typeof ctx.body?.pin === "undefined" && typeof ctx.query?.pin === "undefined") {
      return { code: 400, message: "参数缺失: pin 必须为布尔值" };
    }

    try {
      const res = await this.sessionService.toggleSessionPin(schoolId, userId, chatRoomId, pin);
      return res;
    } catch (err: unknown) {
      return { code: 500, message: (err as Error).message || "置顶状态切换失败" };
    }
  }

  public async handleTogglePin(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
    const raw = await this.togglePin(ctx);
    if (raw.code === 200) {
      return returnSuccess(raw.data, raw.message);
    }
    return returnError(raw.message);
  }
}
