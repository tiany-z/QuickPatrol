/**
 * 高校后勤巡查e速办 v4.0 - M38: 类 QQ 2分钟消息撤回与审计存根
 * (Chat Message Withdrawal & Security Audit Service)
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import { RedisWsBridge } from "../../ws/redisWsBridge.js";
import { ChatMessageService } from "./chatMessageService.js";
import { ChatRoomService } from "./chatRoomService.js";
import {
  ChatMessageType,
  WithdrawOperatorType,
  IChatMessageEntity,
  IWithdrawMessageRequestDto,
  IWithdrawMessageResponseDto,
  IAuditLogEntity,
  IMessageWithdrawnWsBroadcast,
  IRoomSummaryRollbackPayload
} from "./chatWithdrawTypes.js";
import { WithdrawalTimeWindowEvaluator } from "./withdrawalTimeWindowEvaluator.js";

export interface IDbExecutor {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
}

export interface IRedisPublisher {
  eval?(script: string, numkeys: number, ...args: any[]): Promise<any>;
  publish?(channel: string, message: string): Promise<number>;
}

export class ChatWithdrawService {
  private static mockLogsStore: IAuditLogEntity[] = [];
  private static logIdCounter = 1;

  constructor(
    private readonly customDb?: IDbExecutor,
    private readonly customRedis?: IRedisPublisher
  ) {}

  /**
   * 重置 Mock 审计日志与沙箱数据
   */
  public static resetMockData(): void {
    this.mockLogsStore = [];
    this.logIdCounter = 1;
  }

  public static getMockLogs(): IAuditLogEntity[] {
    return [...this.mockLogsStore];
  }

  /**
   * 执行消息撤回主业务流程
   * @param schoolId 学校租户 ID
   * @param operatorId 操作人 ID
   * @param operatorRole 操作人系统角色
   * @param dto 撤回请求 DTO
   * @param clientIp 客户端 IP
   * @param userAgent 客户端 UA
   */
  public async withdrawMessage(
    schoolId: number,
    operatorId: number,
    operatorRole: number,
    dto: IWithdrawMessageRequestDto,
    clientIp: string = "127.0.0.1",
    userAgent: string = "QuickPatrol-Client"
  ): Promise<IWithdrawMessageResponseDto> {
    const { messageId, chatRoomId, adminReason } = dto;

    // 1. 查询目标消息
    let message: IChatMessageEntity | null = null;

    if (this.customDb) {
      const lockSql = `
        SELECT id, schoolId, chatRoomId, senderId, senderRole, type, content, answerMessageId, isWithDraw, createdAt
        FROM chat_messages
        WHERE id = ? AND schoolId = ? AND chatRoomId = ?
        FOR UPDATE
      `;
      const rows = await this.customDb.query<IChatMessageEntity>(lockSql, [messageId, schoolId, chatRoomId]);
      if (rows && rows.length > 0) {
        message = rows[0];
      }
    } else if (getMySQLPool()) {
      const lockSql = `
        SELECT id, schoolId, chatRoomId, senderId, senderRole, type, content, answerMessageId, isWithDraw, createdAt
        FROM chat_messages
        WHERE id = ? AND schoolId = ? AND chatRoomId = ?
        FOR UPDATE
      `;
      const res = await executeQuery<IChatMessageEntity>(lockSql, [messageId, schoolId, chatRoomId]);
      if (res.status === 1 && res.data && res.data.length > 0) {
        message = res.data[0];
      }
    } else {
      // 内存沙箱检索
      const mockMsg = ChatMessageService.getMockMessage(messageId);
      if (mockMsg && mockMsg.schoolId === schoolId && mockMsg.chatRoomId === chatRoomId) {
        message = mockMsg;
      }
    }

    if (!message) {
      throw new Error("未找到指定的消息记录或无权访问");
    }

    // 2. 幂等性校验 (CAS 防重撤)
    if (message.isWithDraw === 1) {
      return {
        code: 200,
        message: "该消息已处于撤回状态",
        data: {
          messageId,
          chatRoomId,
          operatorId,
          operatorType: WithdrawOperatorType.SENDER_SELF,
          isWithDraw: true,
          reEditable: false,
          withdrawnAt: new Date().toISOString()
        }
      };
    }

    // 3. 权限与身份鉴定
    const isAdmin = (operatorRole === 4);
    const isOwner = (message.senderId === operatorId);

    if (!isOwner && !isAdmin) {
      throw new Error("操作权限不足: 仅发送人本人或学校安全管理员有权撤回该消息");
    }

    // 4. 120 秒时间窗口判定 (执行算法 1)
    const timeEval = WithdrawalTimeWindowEvaluator.evaluate(
      message.createdAt,
      new Date(),
      isAdmin // 管理员豁免时限
    );

    if (!timeEval.allowed) {
      throw new Error(timeEval.reason || "已超过撤回时限，无法执行撤回");
    }

    const operatorType = (isAdmin && !isOwner)
      ? WithdrawOperatorType.ADMIN_FORCE
      : WithdrawOperatorType.SENDER_SELF;

    // 5. 更新物理表状态: 逻辑置位 isWithDraw = 1 (绝不物理删除原内容)
    message.isWithDraw = 1;
    const nowIso = new Date().toISOString();

    if (this.customDb) {
      const updateMsgSql = `
        UPDATE chat_messages 
        SET isWithDraw = 1 
        WHERE id = ? AND schoolId = ?
      `;
      await this.customDb.execute(updateMsgSql, [messageId, schoolId]);
    } else if (getMySQLPool()) {
      const updateMsgSql = `
        UPDATE chat_messages 
        SET isWithDraw = 1 
        WHERE id = ? AND schoolId = ?
      `;
      await executeQuery(updateMsgSql, [messageId, schoolId]);
    } else {
      ChatMessageService.setMockMessage(messageId, message);
    }

    // 6. 写入审计存根 (operation_logs 表 07)
    const auditSnapshot = JSON.stringify({
      messageId: message.id,
      chatRoomId: message.chatRoomId,
      senderId: message.senderId,
      senderRole: message.senderRole,
      type: message.type,
      originalContent: message.content,
      createdAt: message.createdAt,
      withdrawnAt: nowIso,
      adminReason: adminReason || null
    });

    const auditAction = operatorType === WithdrawOperatorType.ADMIN_FORCE
      ? "ADMIN_FORCE_WITHDRAW"
      : "MESSAGE_WITHDRAW";

    if (this.customDb) {
      const insertAuditSql = `
        INSERT INTO operation_logs (
          schoolId, module, action, targetId, operatorId, operatorRole, clientIp, userAgent, snapshotPayload, createdAt
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW()
        )
      `;
      await this.customDb.execute(insertAuditSql, [
        schoolId,
        "CHAT_IM",
        auditAction,
        messageId,
        operatorId,
        operatorRole,
        clientIp,
        userAgent,
        auditSnapshot
      ]);
    } else if (getMySQLPool()) {
      const insertAuditSql = `
        INSERT INTO operation_logs (
          schoolId, module, action, targetId, operatorId, operatorRole, clientIp, userAgent, snapshotPayload, createdAt
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW()
        )
      `;
      await executeQuery(insertAuditSql, [
        schoolId,
        "CHAT_IM",
        auditAction,
        messageId,
        operatorId,
        operatorRole,
        clientIp,
        userAgent,
        auditSnapshot
      ]);
    } else {
      ChatWithdrawService.mockLogsStore.push({
        id: ++ChatWithdrawService.logIdCounter,
        schoolId,
        module: "CHAT_IM",
        action: auditAction,
        targetId: messageId,
        operatorId,
        operatorRole,
        clientIp,
        userAgent,
        snapshotPayload: auditSnapshot,
        createdAt: nowIso
      });
    }

    // 7. 执行算法 2: 会话最新摘要反向自愈探针
    const summaryRollback = await this.resolveSessionSummaryRollback(schoolId, chatRoomId, messageId);

    // 8. 执行算法 3: 接收方未读数原子递减纠偏
    await this.decrementReceiverUnreadCount(schoolId, chatRoomId, message.senderRole);

    // 9. 查询操作人昵称
    let operatorName = isAdmin ? "管理员" : "用户";
    if (this.customDb) {
      const userRows = await this.customDb.query<{ nickName: string }>(
        `SELECT nickName FROM users WHERE id = ? AND schoolId = ? LIMIT 1`,
        [operatorId, schoolId]
      );
      if (userRows && userRows.length > 0 && userRows[0].nickName) {
        operatorName = userRows[0].nickName;
      }
    } else if (getMySQLPool()) {
      const uRes = await executeQuery<{ nickName: string }>(
        `SELECT nickName FROM users WHERE id = ? AND schoolId = ? LIMIT 1`,
        [operatorId, schoolId]
      );
      if (uRes.status === 1 && uRes.data && uRes.data.length > 0 && uRes.data[0].nickName) {
        operatorName = uRes.data[0].nickName;
      }
    }

    // 10. 组装全双工 WebSocket 广播载荷
    const wsPayload: IMessageWithdrawnWsBroadcast = {
      event: "MESSAGE_WITHDRAWN",
      schoolId,
      chatRoomId,
      payload: {
        messageId,
        operatorId,
        operatorName,
        operatorRole,
        operatorType,
        isSystemRecall: (operatorType === WithdrawOperatorType.ADMIN_FORCE),
        withdrawnAt: nowIso,
        updatedSessionSummary: summaryRollback ? {
          lastMessage: summaryRollback.lastMessage,
          lastMessageAt: summaryRollback.lastMessageAt
        } : undefined
      }
    };

    if (this.customRedis?.eval) {
      try {
        await this.customRedis.eval(
          `redis.call('PUBLISH', 'ws_broadcast_bus', ARGV[1])`,
          0,
          JSON.stringify(wsPayload)
        );
      } catch {
        // 忽略广播错误
      }
    } else if (this.customRedis?.publish) {
      try {
        await this.customRedis.publish("ws_broadcast_bus", JSON.stringify(wsPayload));
      } catch {
        // 忽略广播错误
      }
    } else {
      try {
        await RedisWsBridge.broadcast("ws:cluster:broadcast", schoolId, wsPayload);
      } catch {
        // 忽略静默
      }
    }

    // 11. 组装返回给发信人的响应结果 (文本消息赋予重新编辑能力)
    const isTextMsg = (message.type === ChatMessageType.TEXT);
    return {
      code: 200,
      message: "消息撤回成功",
      data: {
        messageId,
        chatRoomId,
        operatorId,
        operatorType,
        isWithDraw: true,
        reEditable: isOwner && isTextMsg,
        originalText: (isOwner && isTextMsg) ? message.content : undefined,
        withdrawnAt: nowIso
      }
    };
  }

  /**
   * 算法 2 落地: 探针计算上一条有效消息并回滚 chat_rooms.lastMessage
   */
  public async resolveSessionSummaryRollback(
    schoolId: number,
    chatRoomId: number,
    withdrawnMessageId: number
  ): Promise<IRoomSummaryRollbackPayload> {
    let rollbackMessage = "[消息已撤回]";
    let rollbackTime = new Date().toISOString();

    if (this.customDb) {
      const probeSql = `
        SELECT id, type, content, createdAt 
        FROM chat_messages 
        WHERE schoolId = ? AND chatRoomId = ? AND id != ? AND isWithDraw = 0 
        ORDER BY id DESC 
        LIMIT 1
      `;
      const prevRows = await this.customDb.query<IChatMessageEntity>(probeSql, [schoolId, chatRoomId, withdrawnMessageId]);
      if (prevRows && prevRows.length > 0) {
        const prev = prevRows[0];
        rollbackMessage = this.extractSummary(prev.type, prev.content);
        rollbackTime = prev.createdAt;
      }

      const updateRoomSql = `
        UPDATE chat_rooms 
        SET lastMessage = ?, lastMessageAt = ? 
        WHERE id = ? AND schoolId = ?
      `;
      await this.customDb.execute(updateRoomSql, [rollbackMessage, rollbackTime, chatRoomId, schoolId]);
    } else if (getMySQLPool()) {
      const probeSql = `
        SELECT id, type, content, createdAt 
        FROM chat_messages 
        WHERE schoolId = ? AND chatRoomId = ? AND id != ? AND isWithDraw = 0 
        ORDER BY id DESC 
        LIMIT 1
      `;
      const res = await executeQuery<IChatMessageEntity>(probeSql, [schoolId, chatRoomId, withdrawnMessageId]);
      if (res.status === 1 && res.data && res.data.length > 0) {
        const prev = res.data[0];
        rollbackMessage = this.extractSummary(prev.type, prev.content);
        rollbackTime = prev.createdAt;
      }

      const updateRoomSql = `
        UPDATE chat_rooms 
        SET lastMessage = ?, lastMessageAt = ? 
        WHERE id = ? AND schoolId = ?
      `;
      await executeQuery(updateRoomSql, [rollbackMessage, rollbackTime, chatRoomId, schoolId]);
    } else {
      // 内存沙箱倒序查找上一条未撤回消息
      const validMessages = ChatMessageService.getAllMockMessages()
        .filter(m => m.schoolId === schoolId && m.chatRoomId === chatRoomId && m.id !== withdrawnMessageId && m.isWithDraw === 0)
        .sort((a, b) => b.id - a.id);

      if (validMessages.length > 0) {
        const prev = validMessages[0];
        rollbackMessage = this.extractSummary(prev.type, prev.content);
        rollbackTime = prev.createdAt;
      }

      const room = ChatRoomService.getMockRoom(chatRoomId);
      if (room) {
        room.lastMessage = rollbackMessage;
        room.lastMessageAt = rollbackTime;
      }
    }

    return {
      chatRoomId,
      schoolId,
      lastMessage: rollbackMessage,
      lastMessageAt: rollbackTime,
      affectedReceiverRole: "BOTH"
    };
  }

  /**
   * 算法 3 落地: 接收方未读数原子递减纠偏
   */
  public async decrementReceiverUnreadCount(
    schoolId: number,
    chatRoomId: number,
    senderRole: number
  ): Promise<void> {
    const isSenderHandler = (senderRole === 1);
    const unreadCol = isSenderHandler ? "creatorUnreadCount" : "handlerUnreadCount";

    if (this.customDb) {
      const decrementSql = `
        UPDATE chat_rooms 
        SET ${unreadCol} = CASE 
          WHEN ${unreadCol} > 0 THEN ${unreadCol} - 1 
          ELSE 0 
        END 
        WHERE id = ? AND schoolId = ?
      `;
      await this.customDb.execute(decrementSql, [chatRoomId, schoolId]);
    } else if (getMySQLPool()) {
      const decrementSql = `
        UPDATE chat_rooms 
        SET ${unreadCol} = CASE 
          WHEN ${unreadCol} > 0 THEN ${unreadCol} - 1 
          ELSE 0 
        END 
        WHERE id = ? AND schoolId = ?
      `;
      await executeQuery(decrementSql, [chatRoomId, schoolId]);
    } else {
      const room = ChatRoomService.getMockRoom(chatRoomId);
      if (room) {
        if (isSenderHandler) {
          room.creatorUnreadCount = Math.max(0, (room.creatorUnreadCount || 0) - 1);
        } else {
          room.handlerUnreadCount = Math.max(0, (room.handlerUnreadCount || 0) - 1);
        }
      }
    }
  }

  private extractSummary(type: ChatMessageType, content: string): string {
    switch (type) {
      case ChatMessageType.TEXT:
        return (content || "").substring(0, 30);
      case ChatMessageType.IMAGE:
        return "[图片]";
      case ChatMessageType.PATROL_CARD:
        return "[工单协同卡片]";
      case ChatMessageType.SYSTEM:
        return "[系统通知]";
      default:
        return "[新消息]";
    }
  }
}
