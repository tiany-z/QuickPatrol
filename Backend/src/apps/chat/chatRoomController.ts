/**
 * M36: 协同会话室门禁控制器 (Chat Room Controller)
 * 职责：
 * 1. 责任师傅主动握手激活端点 (POST /api/v4/chat/rooms/activate-handshake)
 * 2. 聊天室首屏元数据与动态权限掩码端点 (GET /api/v4/chat/rooms/meta)
 * 3. 严格四级权限拦截与 StandardResult 响应包裹
 */

import { ChatRoomService } from "./chatRoomService.js";
import {
  IActivateHandshakeRequestDto,
  IActivateHandshakeResponseDto,
  IChatRoomMetaDto
} from "./chatRoomTypes.js";
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

export class ChatRoomController {
  constructor(private readonly roomService: ChatRoomService = new ChatRoomService()) {}

  /**
   * POST /api/v4/chat/rooms/:id/activate-handshake 或 /activate-handshake
   * 责任师傅一键主动握手激活会话 (返回原生 HTTP 报文格式)
   */
  public async activateHandshake(ctx: IChatHttpCtx): Promise<any> {
    const rawId =
      ctx.body?.chatRoomId ??
      ctx.params?.id ??
      ctx.params?.chatRoomId ??
      ctx.query?.id ??
      ctx.query?.chatRoomId;

    const chatRoomId = parseInt(String(rawId), 10);
    const { schoolId, userId, body } = ctx;

    if (!chatRoomId || isNaN(chatRoomId)) {
      return { code: 400, message: "会话室 ID 非法" };
    }

    if (!userId || userId <= 0) {
      return { code: 401, message: "请先完成维修师傅身份登录" };
    }

    const dto: IActivateHandshakeRequestDto = {
      chatRoomId,
      greetingMessage: body?.greetingMessage
    };

    try {
      const result = await this.roomService.activateHandshake(schoolId, chatRoomId, userId, dto);
      return { code: 200, message: result.statusText, data: result };
    } catch (err: unknown) {
      return { code: 403, message: (err as Error).message };
    }
  }

  /**
   * 网关 Handler 标准封装: 激活握手
   */
  public async handleActivateHandshake(
    ctx: { schoolId: number; userId: number },
    body?: any,
    params?: any
  ): Promise<StandardResult<IActivateHandshakeResponseDto>> {
    const rawId = body?.chatRoomId ?? params?.id ?? params?.chatRoomId;
    const chatRoomId = parseInt(String(rawId), 10);
    const { schoolId, userId } = ctx;

    if (!chatRoomId || isNaN(chatRoomId)) {
      return returnError("会话室 ID 非法");
    }

    if (!userId || userId <= 0) {
      return returnError("请先完成维修师傅身份登录");
    }

    const dto: IActivateHandshakeRequestDto = {
      chatRoomId,
      greetingMessage: body?.greetingMessage
    };

    try {
      const result = await this.roomService.activateHandshake(schoolId, chatRoomId, userId, dto);
      return returnSuccess(result, result.statusText);
    } catch (err: any) {
      return returnError(err?.message || "激活会话失败");
    }
  }

  /**
   * GET /api/v4/chat/rooms/:id/meta 或 /meta
   * 打开会话页获取元数据与输入权限掩码 (返回原生 HTTP 报文格式)
   */
  public async getRoomMeta(ctx: IChatHttpCtx): Promise<any> {
    const rawId =
      ctx.params?.id ??
      ctx.params?.chatRoomId ??
      ctx.query?.id ??
      ctx.query?.chatRoomId ??
      ctx.body?.chatRoomId;

    const chatRoomId = parseInt(String(rawId), 10);
    const { schoolId, userId, role = 0 } = ctx;

    if (!chatRoomId || isNaN(chatRoomId)) {
      return { code: 400, message: "会话室 ID 非法" };
    }

    try {
      const meta = await this.roomService.getRoomMetadata(schoolId, chatRoomId, userId, role);
      return { code: 200, message: "查询成功", data: meta };
    } catch (err: unknown) {
      return { code: 404, message: (err as Error).message };
    }
  }

  /**
   * 网关 Handler 标准封装: 拉取元数据与权限掩码
   */
  public async handleGetRoomMeta(
    ctx: { schoolId: number; userId: number; role?: number },
    params?: any,
    query?: any
  ): Promise<StandardResult<IChatRoomMetaDto>> {
    const rawId = query?.chatRoomId ?? query?.id ?? params?.id ?? params?.chatRoomId;
    const chatRoomId = parseInt(String(rawId), 10);
    const { schoolId, userId, role = 0 } = ctx;

    if (!chatRoomId || isNaN(chatRoomId)) {
      return returnError("会话室 ID 非法");
    }

    try {
      const meta = await this.roomService.getRoomMetadata(schoolId, chatRoomId, userId, role);
      return returnSuccess(meta, "查询成功");
    } catch (err: any) {
      return returnError(err?.message || "查询会话元数据失败");
    }
  }
}
