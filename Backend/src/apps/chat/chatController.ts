/**
 * 高校后勤巡查e速办 v4.0 - M25: 协同即时聊天控制器
 * (Patrol Chat & Media Session Controller)
 */

import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";
import { ChatService } from "./chatService.js";
import { ChatSessionService } from "./chatSessionService.js";
import {
  ISendMessageRequest,
  ISendMessageResponseDto,
  IWithdrawMessageRequest,
  IWithdrawMessageResponseDto,
  IInitiateRoomRequest,
  IInitiateRoomResponseDto,
  IMarkReadRequest,
  IChatSessionSummaryDto
} from "./chatTypes.js";

export interface IChatOperatorContext {
  schoolId: number;
  userId: number;
  role?: number;
  ip?: string;
  realName?: string;
}

export class ChatController {
  /**
   * POST /api/chat/room/initiate
   * 责任师傅主动激活会话室
   */
  public static async handleInitiateRoom(
    ctx: IChatOperatorContext,
    body: IInitiateRoomRequest
  ): Promise<StandardResult<IInitiateRoomResponseDto>> {
    try {
      const { schoolId, userId, ip = "127.0.0.1" } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的后勤人员身份");
      }
      if (!body || !body.patrolId) {
        return returnError("缺少必要参数 patrolId");
      }

      const result = await ChatService.initiateRoomByHandler(
        schoolId,
        userId,
        Number(body.patrolId),
        ip
      );

      return returnSuccess(result, "会话已成功激活开启");
    } catch (err: any) {
      return returnError(err.message || "激活会话失败");
    }
  }

  /**
   * POST /api/chat/message/send
   * 发送多媒体即时消息
   */
  public static async handleSendMessage(
    ctx: IChatOperatorContext,
    body: ISendMessageRequest
  ): Promise<StandardResult<ISendMessageResponseDto>> {
    try {
      const { schoolId, userId, role = 0 } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的用户身份");
      }
      if (!body || !body.chatRoomId || typeof body.type !== "number" || !body.content) {
        return returnError("消息参数不完整");
      }

      const result = await ChatService.sendMessage(
        schoolId,
        userId,
        role as any,
        {
          chatRoomId: Number(body.chatRoomId),
          type: body.type,
          content: String(body.content),
          answerMessageId: body.answerMessageId ? Number(body.answerMessageId) : undefined
        }
      );

      return returnSuccess(result, "消息发送成功");
    } catch (err: any) {
      return returnError(err.message || "消息发送受阻");
    }
  }

  /**
   * POST /api/chat/message/withdraw
   * 撤回消息 (120 秒内)
   */
  public static async handleWithdrawMessage(
    ctx: IChatOperatorContext,
    body: IWithdrawMessageRequest
  ): Promise<StandardResult<IWithdrawMessageResponseDto>> {
    try {
      const { schoolId, userId, ip = "127.0.0.1" } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的用户身份");
      }
      if (!body || !body.messageId) {
        return returnError("缺少消息ID");
      }

      const result = await ChatService.withdrawMessage(
        schoolId,
        userId,
        Number(body.messageId),
        ip
      );

      return returnSuccess(
        { success: result.success, chatRoomId: result.chatRoomId, messageId: Number(body.messageId) },
        "消息已成功撤回"
      );
    } catch (err: any) {
      return returnError(err.message || "撤回失败");
    }
  }

  /**
   * GET /api/chat/message/list
   * 游标增量拉取历史记录
   */
  public static async handleGetMessages(
    ctx: IChatOperatorContext,
    query: { chatRoomId?: number | string; cursorId?: number | string; limit?: number | string }
  ): Promise<StandardResult<any[]>> {
    try {
      const { schoolId } = ctx;
      if (!schoolId) {
        return returnError("未指定学校租户");
      }

      const chatRoomId = Number(query.chatRoomId);
      if (!chatRoomId) {
        return returnError("缺少会话室ID chatRoomId");
      }

      const cursorId = Number(query.cursorId) || 0;
      const limit = Number(query.limit) || 20;

      const list = await ChatService.getMessageList(schoolId, chatRoomId, cursorId, limit);
      return returnSuccess(list, "获取历史消息成功");
    } catch (err: any) {
      return returnError(err.message || "拉取记录异常");
    }
  }

  /**
   * POST /api/chat/room/mark-read
   * 进入会话室未读清零
   */
  public static async handleMarkRead(
    ctx: IChatOperatorContext,
    body: IMarkReadRequest
  ): Promise<StandardResult<{ success: boolean }>> {
    try {
      const { schoolId, userId } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的用户身份");
      }
      if (!body || !body.chatRoomId) {
        return returnError("缺少会话室ID chatRoomId");
      }

      await ChatService.markRoomAsRead(schoolId, userId, Number(body.chatRoomId));
      return returnSuccess({ success: true }, "已标记已读");
    } catch (err: any) {
      return returnError(err.message || "清除未读异常");
    }
  }

  /**
   * GET /api/chat/sessions
   * 获取当前用户的会话大盘列表
   */
  public static async handleGetSessions(
    ctx: IChatOperatorContext
  ): Promise<StandardResult<IChatSessionSummaryDto[]>> {
    try {
      const { schoolId, userId, role = 0 } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的用户身份");
      }

      const list = await ChatSessionService.getUserSessions(schoolId, userId, role);
      const mappedList: IChatSessionSummaryDto[] = list.map((item) => ({
        chatRoomId: item.chatRoomId,
        patrolId: item.patrolId,
        orderNo: item.patrolOrderNo,
        peerUserId: 0,
        peerUserName: item.targetPeerName,
        peerAvatarUrl: item.targetPeerAvatar,
        roomTitle: `工单协同 #${item.patrolId}`,
        lastMessageText: item.lastMessage,
        lastMessageTime: item.lastMessageAt,
        unreadCount: item.unreadCount,
        isPinned: item.isPinned,
        isClosed: item.patrolStatus === 4,
        initiatedByHandler: true
      }));
      return returnSuccess(mappedList, "获取会话列表成功");
    } catch (err: any) {
      return returnError(err.message || "获取会话列表失败");
    }
  }
}
