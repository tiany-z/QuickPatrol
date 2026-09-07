/**
 * 高校后勤巡查e速办 v4.0 - M39: 聊天消息长按引用回复与源消息联动
 * (Chat Quote Controller)
 */

import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";
import { ChatQuoteService } from "./chatQuoteService.js";
import { ISendQuotedMessageRequestDto } from "./chatQuoteTypes.js";

export interface IChatHttpCtx {
  schoolId: number;
  userId: number;
  userRole: number;
  params?: { id?: string };
  query?: any;
  body?: any;
}

export class ChatQuoteController {
  constructor(private readonly quoteService: ChatQuoteService = new ChatQuoteService()) {}

  /**
   * POST /api/v4/chat/messages/quote
   * 发送带引用的回复消息
   */
  public async sendQuote(ctx: IChatHttpCtx): Promise<any> {
    const { schoolId, userId, userRole, body } = ctx;
    const { chatRoomId, type, content, answerMessageId, clientMsgId } = body || {};

    if (!chatRoomId || typeof chatRoomId !== "number") {
      return { code: 400, message: "参数缺失: chatRoomId" };
    }
    if (!answerMessageId || typeof answerMessageId !== "number") {
      return { code: 400, message: "参数缺失: answerMessageId 必须为有效正整数" };
    }
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return { code: 400, message: "回复内容不可为空" };
    }

    const dto: ISendQuotedMessageRequestDto = {
      chatRoomId,
      type: typeof type === "number" ? type : 0,
      content: content.trim(),
      answerMessageId,
      clientMsgId: clientMsgId || `C_${Date.now()}`
    };

    try {
      const res = await this.quoteService.sendQuotedMessage(schoolId, userId, userRole, dto);
      return res;
    } catch (err: unknown) {
      const msg = (err as Error).message || "发送引用消息失败";
      return { code: 400, message: msg };
    }
  }

  public async handleSendQuote(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
    const raw = await this.sendQuote(ctx);
    if (raw.code === 200) {
      return returnSuccess(raw.data, raw.message || "引用消息发送成功");
    }
    return returnError(raw.message || "发送引用消息失败");
  }

  /**
   * GET /api/v4/chat/rooms/context-slice
   * 查询极远源消息上下文切片
   */
  public async getContextSlice(ctx: IChatHttpCtx): Promise<any> {
    const rawRoomId = ctx.params?.id || ctx.query?.chatRoomId || ctx.body?.chatRoomId;
    const chatRoomId = parseInt(String(rawRoomId || "0"), 10);
    const rawAnchorId = ctx.query?.anchorMessageId || ctx.body?.anchorMessageId;
    const anchorMessageId = parseInt(String(rawAnchorId || "0"), 10);
    const windowSize = Math.min(50, Math.max(10, parseInt(String(ctx.query?.windowSize || "20"), 10)));
    const { schoolId } = ctx;

    if (!chatRoomId || !anchorMessageId) {
      return { code: 400, message: "缺少必要参数: chatRoomId 或 anchorMessageId" };
    }

    try {
      const sliceData = await this.quoteService.queryContextSlice(
        schoolId,
        chatRoomId,
        anchorMessageId,
        windowSize
      );
      return { code: 200, message: "切片拉取成功", data: sliceData };
    } catch (err: unknown) {
      const msg = (err as Error).message || "上下文切片查询失败";
      return { code: 500, message: msg };
    }
  }

  public async handleGetContextSlice(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
    const raw = await this.getContextSlice(ctx);
    if (raw.code === 200) {
      return returnSuccess(raw.data, raw.message || "切片拉取成功");
    }
    return returnError(raw.message || "上下文切片查询失败");
  }
}
