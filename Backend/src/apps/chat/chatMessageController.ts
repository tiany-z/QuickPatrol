/**
 * 高校后勤巡查e速办 v4.0 - M37: 类 QQ 聊天气泡与消息协同控制器
 * (Chat Message Controller)
 *
 * 职责：
 * 1. 投递聊天消息端点 (POST /api/v4/chat/rooms/messages)
 * 2. 游标倒序拉取历史消息端点 (GET /api/v4/chat/rooms/history)
 * 3. 进房已读清零端点 (POST /api/v4/chat/rooms/ack-read)
 * 4. M36 门禁前置强校验与 StandardResult 标准报文响应包裹
 */

import { ChatMessageService } from "./chatMessageService.js";
import { ChatGatekeeper } from "./chatGatekeeper.js";
import {
  ISendMessageRequestDto,
  ISendMessageResponseDto,
  IChatMessageListDto,
  ChatMessageType
} from "./chatMessageTypes.js";
import { StandardResult, returnSuccess, returnError } from "../../shared/flow/result.js";

export interface IChatHttpCtx {
  schoolId: number;
  userId: number;
  role?: number;
  body?: any;
  params?: Record<string, string>;
  query?: Record<string, string>;
  ip?: string;
}

export class ChatMessageController {
  constructor(
    private readonly messageService: ChatMessageService = new ChatMessageService(),
    private readonly gatekeeper: ChatGatekeeper = new ChatGatekeeper()
  ) {}

  /**
   * POST /api/v4/chat/rooms/:id/messages 或 /messages
   * 投递聊天消息 (返回原生 HTTP 报文格式)
   */
  public async sendMessage(ctx: IChatHttpCtx): Promise<any> {
    const rawId =
      ctx.body?.chatRoomId ??
      ctx.params?.id ??
      ctx.params?.chatRoomId ??
      ctx.query?.id ??
      ctx.query?.chatRoomId;

    const chatRoomId = parseInt(String(rawId), 10);
    const { schoolId, userId, role = 0, body } = ctx;

    if (!chatRoomId || isNaN(chatRoomId)) {
      return { code: 400, message: "会话室 ID 非法" };
    }

    if (!userId || userId <= 0) {
      return { code: 401, message: "请先登录后发送消息" };
    }

    // 1. M36 门禁前置强校验: 未握手激活时严防师生发言
    try {
      await this.gatekeeper.assertCanSendMessage(schoolId, chatRoomId, userId, role);
    } catch (err: unknown) {
      return { code: 403, message: (err as Error).message };
    }

    // 2. 参数结构校验
    const { type = 0, content, answerMessageId = 0, clientMsgId } = body || {};

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return { code: 400, message: "消息内容不可为空" };
    }

    if (![0, 1, 2, 3].includes(type)) {
      return { code: 400, message: "消息类型非法" };
    }

    const dto: ISendMessageRequestDto = {
      chatRoomId,
      type: type as ChatMessageType,
      content: content.trim(),
      answerMessageId: parseInt(answerMessageId, 10) || 0,
      clientMsgId: String(clientMsgId || Date.now())
    };

    // 3. 执行业务发送
    try {
      const senderRole = (role === 2 || role === 3) ? 1 : (role >= 4 ? 4 : 0);
      const result = await this.messageService.sendMessage(schoolId, userId, senderRole, dto);
      return { code: 200, message: "发送成功", data: result };
    } catch (err: unknown) {
      return { code: 400, message: (err as Error).message };
    }
  }

  /**
   * 网关 Handler 标准封装: 发送消息
   */
  public async handleSendMessage(
    ctx: { schoolId: number; userId: number; role?: number },
    body: any,
    params?: any
  ): Promise<StandardResult<ISendMessageResponseDto>> {
    const rawId = body?.chatRoomId ?? params?.id ?? params?.chatRoomId;
    const chatRoomId = parseInt(String(rawId), 10);
    const { schoolId, userId, role = 0 } = ctx;

    if (!chatRoomId || isNaN(chatRoomId)) {
      return returnError("会话室 ID 非法");
    }

    if (!userId || userId <= 0) {
      return returnError("请先登录后发送消息");
    }

    // 门禁预检
    try {
      await this.gatekeeper.assertCanSendMessage(schoolId, chatRoomId, userId, role);
    } catch (err: any) {
      return returnError(err?.message || "无权在该会话室发送消息");
    }

    const { type = 0, content, answerMessageId = 0, clientMsgId } = body || {};
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return returnError("消息内容不可为空");
    }

    if (![0, 1, 2, 3].includes(type)) {
      return returnError("消息类型非法");
    }

    const dto: ISendMessageRequestDto = {
      chatRoomId,
      type: type as ChatMessageType,
      content: content.trim(),
      answerMessageId: parseInt(answerMessageId, 10) || 0,
      clientMsgId: String(clientMsgId || Date.now())
    };

    try {
      const senderRole = (role === 2 || role === 3) ? 1 : (role >= 4 ? 4 : 0);
      const result = await this.messageService.sendMessage(schoolId, userId, senderRole, dto);
      return returnSuccess(result, "发送成功");
    } catch (err: any) {
      return returnError(err?.message || "消息发送失败");
    }
  }

  /**
   * GET /api/v4/chat/rooms/:id/history 或 /history
   * 倒序分页拉取历史消息 (返回原生 HTTP 报文格式)
   */
  public async getHistory(ctx: IChatHttpCtx): Promise<any> {
    const rawId =
      ctx.params?.id ??
      ctx.params?.chatRoomId ??
      ctx.query?.id ??
      ctx.query?.chatRoomId;

    const chatRoomId = parseInt(String(rawId), 10);
    const { schoolId, userId, query } = ctx;

    if (!chatRoomId || isNaN(chatRoomId)) {
      return { code: 400, message: "会话室 ID 非法" };
    }

    const cursorId = parseInt(query?.cursorMessageId || query?.cursorId || "0", 10) || 0;
    const pageSize = parseInt(query?.pageSize || query?.limit || "20", 10) || 20;

    try {
      const list = await this.messageService.queryHistoryMessages(schoolId, userId, chatRoomId, cursorId, pageSize);
      return { code: 200, message: "查询成功", data: list };
    } catch (err: unknown) {
      return { code: 500, message: (err as Error).message };
    }
  }

  /**
   * 网关 Handler 标准封装: 分页拉取历史
   */
  public async handleGetHistory(
    ctx: { schoolId: number; userId: number },
    query: any,
    params?: any
  ): Promise<StandardResult<IChatMessageListDto>> {
    const rawId = query?.chatRoomId ?? query?.id ?? params?.id ?? params?.chatRoomId;
    const chatRoomId = parseInt(String(rawId), 10);
    const { schoolId, userId } = ctx;

    if (!chatRoomId || isNaN(chatRoomId)) {
      return returnError("会话室 ID 非法");
    }

    const cursorId = parseInt(query?.cursorMessageId || query?.cursorId || "0", 10) || 0;
    const pageSize = parseInt(query?.pageSize || query?.limit || "20", 10) || 20;

    try {
      const list = await this.messageService.queryHistoryMessages(schoolId, userId, chatRoomId, cursorId, pageSize);
      return returnSuccess(list, "查询成功");
    } catch (err: any) {
      return returnError(err?.message || "拉取历史消息失败");
    }
  }

  /**
   * POST /api/v4/chat/rooms/:id/ack-read 或 /ack-read
   * 标记当前会话已读消除未读数 (返回原生 HTTP 报文格式)
   */
  public async ackRead(ctx: IChatHttpCtx): Promise<any> {
    const rawId =
      ctx.body?.chatRoomId ??
      ctx.params?.id ??
      ctx.params?.chatRoomId ??
      ctx.query?.id ??
      ctx.query?.chatRoomId;

    const chatRoomId = parseInt(String(rawId), 10);
    const { schoolId, userId } = ctx;

    if (!chatRoomId || isNaN(chatRoomId)) {
      return { code: 400, message: "会话室 ID 非法" };
    }

    try {
      await this.messageService.ackRoomRead(schoolId, chatRoomId, userId);
      return { code: 200, message: "未读数已消除" };
    } catch (err: unknown) {
      return { code: 500, message: (err as Error).message };
    }
  }

  /**
   * 网关 Handler 标准封装: 会话已读清零
   */
  public async handleAckRead(
    ctx: { schoolId: number; userId: number },
    body: any,
    params?: any
  ): Promise<StandardResult<void>> {
    const rawId = body?.chatRoomId ?? params?.id ?? params?.chatRoomId;
    const chatRoomId = parseInt(String(rawId), 10);
    const { schoolId, userId } = ctx;

    if (!chatRoomId || isNaN(chatRoomId)) {
      return returnError("会话室 ID 非法");
    }

    try {
      await this.messageService.ackRoomRead(schoolId, chatRoomId, userId);
      return returnSuccess(undefined, "未读数已消除");
    } catch (err: any) {
      return returnError(err?.message || "已读消除失败");
    }
  }
}
