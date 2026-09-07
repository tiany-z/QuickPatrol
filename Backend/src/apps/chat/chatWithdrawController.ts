/**
 * 高校后勤巡查e速办 v4.0 - M38: 类 QQ 2分钟消息撤回与审计存根
 * (Chat Withdraw Controller)
 */

import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";
import { ChatWithdrawService } from "./chatWithdrawService.js";
import { IWithdrawMessageRequestDto, IWithdrawMessageResponseDto } from "./chatWithdrawTypes.js";

export interface IChatHttpCtx {
  schoolId: number;
  userId: number;
  userRole: number;
  ip: string;
  userAgent?: string;
  params?: { id?: string };
  body: any;
}

export class ChatWithdrawController {
  constructor(private readonly withdrawService: ChatWithdrawService = new ChatWithdrawService()) {}

  /**
   * POST /api/v4/chat/messages/:id/withdraw
   * 发起普通撤回流程 (120 秒内)
   */
  public async withdraw(ctx: IChatHttpCtx): Promise<any> {
    const rawId = ctx.params?.id || ctx.body?.messageId;
    const messageId = parseInt(String(rawId || "0"), 10);
    const { schoolId, userId, userRole, ip = "127.0.0.1", userAgent = "QuickPatrol-Client" } = ctx;
    const { chatRoomId, adminReason } = ctx.body || {};

    if (!messageId || messageId <= 0) {
      return { code: 400, message: "无效的目标消息 ID (messageId)" };
    }
    if (!chatRoomId || typeof chatRoomId !== "number") {
      return { code: 400, message: "缺少所属会话室 ID (chatRoomId)" };
    }

    const dto: IWithdrawMessageRequestDto = {
      messageId,
      chatRoomId,
      adminReason: typeof adminReason === "string" ? adminReason.trim() : undefined
    };

    try {
      const result = await this.withdrawService.withdrawMessage(
        schoolId,
        userId,
        userRole,
        dto,
        ip,
        userAgent
      );
      return result;
    } catch (err: unknown) {
      const errorMsg = (err as Error).message || "消息撤回失败";
      if (errorMsg.includes("超过撤回时限") || errorMsg.includes("无法撤回")) {
        return { code: 400, message: errorMsg };
      }
      if (errorMsg.includes("权限不足")) {
        return { code: 403, message: errorMsg };
      }
      return { code: 500, message: errorMsg };
    }
  }

  /**
   * StandardResult 包装的撤回处理器
   */
  public async handleWithdraw(
    ctx: IChatHttpCtx
  ): Promise<StandardResult<IWithdrawMessageResponseDto["data"]>> {
    const rawRes = await this.withdraw(ctx);
    if (rawRes.code === 200) {
      return returnSuccess(rawRes.data, rawRes.message || "消息撤回成功");
    }
    return returnError(rawRes.message || "消息撤回失败");
  }

  /**
   * POST /api/v4/chat/messages/admin-force-withdraw
   * 校级安全管理员强制熔断撤回违规消息
   */
  public async adminForceWithdraw(ctx: IChatHttpCtx): Promise<any> {
    if (ctx.userRole !== 4) {
      return { code: 403, message: "操作权限不足: 仅校级安全管理员有权执行强制熔断撤回" };
    }

    const rawId = ctx.params?.id || ctx.body?.messageId;
    const messageId = parseInt(String(rawId || "0"), 10);
    const { schoolId, userId, userRole, ip = "127.0.0.1", userAgent = "QuickPatrol-Admin" } = ctx;
    const { chatRoomId, adminReason } = ctx.body || {};

    if (!messageId || messageId <= 0) {
      return { code: 400, message: "无效的目标消息 ID (messageId)" };
    }
    if (!chatRoomId || typeof chatRoomId !== "number") {
      return { code: 400, message: "缺少所属会话室 ID (chatRoomId)" };
    }

    const dto: IWithdrawMessageRequestDto = {
      messageId,
      chatRoomId,
      adminReason: typeof adminReason === "string" ? adminReason.trim() : "管理员违规言论熔断处置"
    };

    try {
      const result = await this.withdrawService.withdrawMessage(
        schoolId,
        userId,
        userRole,
        dto,
        ip,
        userAgent
      );
      return result;
    } catch (err: unknown) {
      const errorMsg = (err as Error).message || "管理员强制撤回失败";
      return { code: 500, message: errorMsg };
    }
  }
}
