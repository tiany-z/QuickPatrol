/**
 * 高校后勤巡查e速办 v4.0 - M39: 聊天消息长按引用回复与源消息联动
 * (Chat Quote & Context Slicing Service)
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import { DfaWordFilter } from "../feedback/dfaWordFilter.js";
import { ChatMessageService } from "./chatMessageService.js";
import { ChatRoomService } from "./chatRoomService.js";
import { ChatMessageType, IChatMessageEntity } from "./chatWithdrawTypes.js";
import {
  IChatMessageQuoteView,
  IQuotedMessagePayload,
  IQuoteContextWindowDto,
  ISendQuotedMessageRequestDto,
  ISendQuotedMessageResponseDto
} from "./chatQuoteTypes.js";
import { QuotedMessageSummaryExtractor } from "./quotedMessageSummaryExtractor.js";

export interface IDbExecutor {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
}

export class ChatQuoteService {
  private static messageIdCounter = 3000;

  constructor(private readonly db?: IDbExecutor) {}

  /**
   * 重置 Mock 状态
   */
  public static resetMockData(): void {
    this.messageIdCounter = 3000;
  }

  /**
   * 发送带有引用的消息并自动装配被引用的源消息摘要
   * @param schoolId 学校租户 ID
   * @param senderId 发信人 ID
   * @param senderRole 发信人角色 (0 师生, 1 师傅, 4 管理员)
   * @param dto 发送引用消息请求 DTO
   */
  public async sendQuotedMessage(
    schoolId: number,
    senderId: number,
    senderRole: number,
    dto: ISendQuotedMessageRequestDto
  ): Promise<ISendQuotedMessageResponseDto> {
    const { chatRoomId, type, content, answerMessageId, clientMsgId } = dto;

    if (!answerMessageId || answerMessageId <= 0) {
      throw new Error("非法的前序引用消息 ID");
    }

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new Error("回复内容不可为空");
    }

    // 1. 防御性检查: 验证被引用的源消息是否存在且同属本校及当前 chatRoomId (防跨房越权引用)
    let sourceMsg: (IChatMessageEntity & { senderName?: string }) | null = null;

    if (this.db) {
      const sourceSql = `
        SELECT m.id, m.schoolId, m.chatRoomId, m.senderId, m.senderRole, m.type, m.content, m.isWithDraw, m.createdAt,
               u.nickName AS senderName
        FROM chat_messages m
        LEFT JOIN users u ON m.senderId = u.id AND u.schoolId = m.schoolId
        WHERE m.id = ? AND m.schoolId = ?
        LIMIT 1
      `;
      const sourceRows = await this.db.query<any>(sourceSql, [answerMessageId, schoolId]);
      if (sourceRows && sourceRows.length > 0) {
        sourceMsg = sourceRows[0];
      }
    } else if (getMySQLPool()) {
      const sourceSql = `
        SELECT m.id, m.schoolId, m.chatRoomId, m.senderId, m.senderRole, m.type, m.content, m.isWithDraw, m.createdAt,
               u.nickName AS senderName
        FROM chat_messages m
        LEFT JOIN users u ON m.senderId = u.id AND u.schoolId = m.schoolId
        WHERE m.id = ? AND m.schoolId = ?
        LIMIT 1
      `;
      const res = await executeQuery<any>(sourceSql, [answerMessageId, schoolId]);
      if (res.status === 1 && res.data && res.data.length > 0) {
        sourceMsg = res.data[0];
      }
    } else {
      const mock = ChatMessageService.getMockMessage(answerMessageId);
      if (mock && mock.schoolId === schoolId) {
        sourceMsg = {
          ...mock,
          senderName: mock.senderRole === 1 ? "张师傅" : "师生同学"
        };
      }
    }

    if (!sourceMsg) {
      throw new Error("被引用的源消息不存在或已被清理");
    }

    if (sourceMsg.chatRoomId !== chatRoomId) {
      throw new Error("越权阻断: 禁止跨会话室引用其他房间的消息");
    }

    // 2. DFA 敏感词扫描
    let finalContent = content.trim();
    if (type === ChatMessageType.TEXT) {
      const scan = DfaWordFilter.getInstance().scanAndSanitize(finalContent);
      if (scan.hasFatalWords) {
        throw new Error("回复内容包含严重违规词汇，已被系统拦截！");
      }
      finalContent = scan.sanitizedText;
    }

    // 3. 落盘写入 chat_messages
    let newMessageId: number;
    const nowIso = new Date().toISOString();

    if (this.db) {
      const insertSql = `
        INSERT INTO chat_messages (
          schoolId, chatRoomId, senderId, senderRole, type, content, answerMessageId, isWithDraw, createdAt
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, 0, NOW()
        )
      `;
      const result = await this.db.execute(insertSql, [
        schoolId,
        chatRoomId,
        senderId,
        senderRole,
        type,
        finalContent,
        answerMessageId
      ]);
      newMessageId = result.insertId;
    } else if (getMySQLPool()) {
      const insertSql = `
        INSERT INTO chat_messages (
          schoolId, chatRoomId, senderId, senderRole, type, content, answerMessageId, isWithDraw, createdAt
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, 0, NOW()
        )
      `;
      const res = await executeQuery<{ insertId: number; affectedRows: number }>(insertSql, [
        schoolId,
        chatRoomId,
        senderId,
        senderRole,
        type,
        finalContent,
        answerMessageId
      ]);
      newMessageId = (res.data as any)?.insertId || Date.now();
    } else {
      newMessageId = ++ChatQuoteService.messageIdCounter;
      const entity: IChatMessageEntity = {
        id: newMessageId,
        schoolId,
        chatRoomId,
        senderId,
        senderRole: senderRole as any,
        type,
        content: finalContent,
        answerMessageId,
        isWithDraw: 0,
        createdAt: nowIso
      };
      ChatMessageService.setMockMessage(newMessageId, entity);
    }

    // 4. 执行算法 1: 提炼被引用消息的卡片摘要
    const { summary, isWithdrawn } = QuotedMessageSummaryExtractor.extract(
      sourceMsg.type,
      sourceMsg.content,
      sourceMsg.isWithDraw
    );

    const quotedPayload: IQuotedMessagePayload = {
      id: sourceMsg.id,
      senderId: sourceMsg.senderId,
      senderName: sourceMsg.senderName || (sourceMsg.senderRole === 1 ? "维修师傅" : "师生用户"),
      senderRole: sourceMsg.senderRole,
      type: sourceMsg.type,
      summary,
      isWithdrawn
    };

    // 5. 更新会话表最新摘要与未读数
    const isSenderHandler = (senderRole === 1);
    const unreadCol = isSenderHandler ? "creatorUnreadCount" : "handlerUnreadCount";
    const roomSummary = `[回复] ${finalContent.substring(0, 25)}`;

    if (this.db) {
      const updateRoomSql = `
        UPDATE chat_rooms 
        SET lastMessage = ?, lastMessageAt = NOW(), ${unreadCol} = ${unreadCol} + 1 
        WHERE id = ? AND schoolId = ?
      `;
      await this.db.execute(updateRoomSql, [roomSummary, chatRoomId, schoolId]);
    } else if (getMySQLPool()) {
      const updateRoomSql = `
        UPDATE chat_rooms 
        SET lastMessage = ?, lastMessageAt = NOW(), ${unreadCol} = ${unreadCol} + 1 
        WHERE id = ? AND schoolId = ?
      `;
      await executeQuery(updateRoomSql, [roomSummary, chatRoomId, schoolId]);
    } else {
      const room = ChatRoomService.getMockRoom(chatRoomId);
      if (room) {
        room.lastMessage = roomSummary;
        room.lastMessageAt = nowIso;
        if (isSenderHandler) {
          room.creatorUnreadCount = (room.creatorUnreadCount || 0) + 1;
        } else {
          room.handlerUnreadCount = (room.handlerUnreadCount || 0) + 1;
        }
      }
    }

    return {
      code: 200,
      message: "引用消息发送成功",
      data: {
        messageId: newMessageId,
        chatRoomId,
        clientMsgId: clientMsgId || `Q_${Date.now()}`,
        answerMessageId,
        quotedMessage: quotedPayload,
        content: finalContent,
        createdAt: nowIso
      }
    };
  }

  /**
   * 静态辅助：为任意消息列表批量注水 quotedMessage (就地增强与属性填充)
   */
  public static async populateQuotesForMessages(
    schoolId: number,
    messages: any[],
    customDb?: any
  ): Promise<any[]> {
    if (!messages || messages.length === 0) return messages;
    const service = new ChatQuoteService(customDb);
    const views = await service.populateQuotesForMessages(schoolId, messages as any);
    const viewMap = new Map<number, any>(views.map((v) => [v.id, v.quotedMessage]));
    for (const msg of messages) {
      if (viewMap.has(msg.id)) {
        msg.quotedMessage = viewMap.get(msg.id);
      }
    }
    return messages;
  }

  /**
   * 批量为消息列表注水被引用的源消息卡片数据 (用于历史消息列表查询，单次 IN 查询杜绝 N+1)
   */
  public async populateQuotesForMessages(
    schoolId: number,
    messages: IChatMessageEntity[]
  ): Promise<IChatMessageQuoteView[]> {
    if (!messages || messages.length === 0) return [];

    // 1. 收集所有有效引用的 answerMessageId
    const quoteIds = Array.from(
      new Set(
        messages
          .map((m) => m.answerMessageId)
          .filter((id): id is number => typeof id === "number" && id > 0)
      )
    );

    const quoteMap = new Map<number, IQuotedMessagePayload>();

    if (quoteIds.length > 0) {
      if (this.db) {
        const placeholders = quoteIds.map(() => "?").join(",");
        const batchSql = `
          SELECT m.id, m.senderId, m.senderRole, m.type, m.content, m.isWithDraw,
                 u.nickName AS senderName
          FROM chat_messages m
          LEFT JOIN users u ON m.senderId = u.id AND u.schoolId = m.schoolId
          WHERE m.id IN (${placeholders}) AND m.schoolId = ?
        `;
        const quoteRows = await this.db.query<any>(batchSql, [...quoteIds, schoolId]);
        for (const row of quoteRows) {
          const { summary, isWithdrawn } = QuotedMessageSummaryExtractor.extract(
            row.type,
            row.content,
            row.isWithDraw
          );
          quoteMap.set(row.id, {
            id: row.id,
            senderId: row.senderId,
            senderName: row.senderName || (row.senderRole === 1 ? "维修师傅" : "用户"),
            senderRole: row.senderRole,
            type: row.type,
            summary,
            isWithdrawn
          });
        }
      } else if (getMySQLPool()) {
        const placeholders = quoteIds.map(() => "?").join(",");
        const batchSql = `
          SELECT m.id, m.senderId, m.senderRole, m.type, m.content, m.isWithDraw,
                 u.nickName AS senderName
          FROM chat_messages m
          LEFT JOIN users u ON m.senderId = u.id AND u.schoolId = m.schoolId
          WHERE m.id IN (${placeholders}) AND m.schoolId = ?
        `;
        const res = await executeQuery<any>(batchSql, [...quoteIds, schoolId]);
        const rows = (res.status === 1 && res.data) ? res.data : [];
        for (const row of rows) {
          const { summary, isWithdrawn } = QuotedMessageSummaryExtractor.extract(
            row.type,
            row.content,
            row.isWithDraw
          );
          quoteMap.set(row.id, {
            id: row.id,
            senderId: row.senderId,
            senderName: row.senderName || (row.senderRole === 1 ? "维修师傅" : "用户"),
            senderRole: row.senderRole,
            type: row.type,
            summary,
            isWithdrawn
          });
        }
      } else {
        // 沙箱查询
        for (const qId of quoteIds) {
          const mockMsg = ChatMessageService.getMockMessage(qId);
          if (mockMsg) {
            const { summary, isWithdrawn } = QuotedMessageSummaryExtractor.extract(
              mockMsg.type,
              mockMsg.content,
              mockMsg.isWithDraw
            );
            quoteMap.set(qId, {
              id: mockMsg.id,
              senderId: mockMsg.senderId,
              senderName: mockMsg.senderRole === 1 ? "张师傅" : "师生同学",
              senderRole: mockMsg.senderRole,
              type: mockMsg.type,
              summary,
              isWithdrawn
            });
          }
        }
      }
    }

    // 2. 组装视图数据
    return messages.map((m) => {
      let quotedMessage: IQuotedMessagePayload | undefined = undefined;
      if (m.answerMessageId && m.answerMessageId > 0) {
        quotedMessage = quoteMap.get(m.answerMessageId) || {
          id: m.answerMessageId,
          senderId: 0,
          senderName: "系统",
          senderRole: 9,
          type: ChatMessageType.TEXT,
          summary: "[原消息已被清理]",
          isWithdrawn: true
        };
      }

      return {
        id: m.id,
        schoolId: m.schoolId,
        chatRoomId: m.chatRoomId,
        senderId: m.senderId,
        senderName: m.senderRole === 1 ? "维修师傅" : (m.senderId === 0 ? "系统通知" : "师生用户"),
        senderAvatar: "/assets/avatar_default.png",
        senderRole: m.senderRole,
        type: m.type,
        content: m.isWithDraw === 1 ? "该消息已被撤回" : m.content,
        answerMessageId: m.answerMessageId || 0,
        quotedMessage,
        isWithDraw: m.isWithDraw === 1,
        isSelf: false,
        createdAt: m.createdAt
      };
    });
  }

  /**
   * 算法 3: 极远源消息对称上下文切片窗口查询
   * @param schoolId 学校租户 ID
   * @param chatRoomId 会话室 ID
   * @param anchorMessageId 锚点中心消息 ID
   * @param windowSize 窗口大小 (默认 20 条)
   */
  public async queryContextSlice(
    schoolId: number,
    chatRoomId: number,
    anchorMessageId: number,
    windowSize: number = 20
  ): Promise<IQuoteContextWindowDto> {
    const half = Math.floor(windowSize / 2);

    let upperRows: IChatMessageEntity[] = [];
    let centerMsg: IChatMessageEntity | null = null;
    let lowerRows: IChatMessageEntity[] = [];

    if (this.db) {
      const upperSql = `
        SELECT m.* FROM chat_messages m
        WHERE m.schoolId = ? AND m.chatRoomId = ? AND m.id < ?
        ORDER BY m.id DESC
        LIMIT ?
      `;
      upperRows = await this.db.query<IChatMessageEntity>(upperSql, [schoolId, chatRoomId, anchorMessageId, half]);

      const centerSql = `
        SELECT m.* FROM chat_messages m
        WHERE m.schoolId = ? AND m.chatRoomId = ? AND m.id = ?
        LIMIT 1
      `;
      const centerRows = await this.db.query<IChatMessageEntity>(centerSql, [schoolId, chatRoomId, anchorMessageId]);
      if (centerRows && centerRows.length > 0) {
        centerMsg = centerRows[0];
      }

      const lowerSql = `
        SELECT m.* FROM chat_messages m
        WHERE m.schoolId = ? AND m.chatRoomId = ? AND m.id > ?
        ORDER BY m.id ASC
        LIMIT ?
      `;
      lowerRows = await this.db.query<IChatMessageEntity>(lowerSql, [schoolId, chatRoomId, anchorMessageId, half]);
    } else if (getMySQLPool()) {
      const upperSql = `
        SELECT m.* FROM chat_messages m
        WHERE m.schoolId = ? AND m.chatRoomId = ? AND m.id < ?
        ORDER BY m.id DESC
        LIMIT ?
      `;
      const upRes = await executeQuery<IChatMessageEntity>(upperSql, [schoolId, chatRoomId, anchorMessageId, half]);
      upperRows = (upRes.status === 1 && upRes.data) ? upRes.data : [];

      const centerSql = `
        SELECT m.* FROM chat_messages m
        WHERE m.schoolId = ? AND m.chatRoomId = ? AND m.id = ?
        LIMIT 1
      `;
      const cRes = await executeQuery<IChatMessageEntity>(centerSql, [schoolId, chatRoomId, anchorMessageId]);
      if (cRes.status === 1 && cRes.data && cRes.data.length > 0) {
        centerMsg = cRes.data[0];
      }

      const lowerSql = `
        SELECT m.* FROM chat_messages m
        WHERE m.schoolId = ? AND m.chatRoomId = ? AND m.id > ?
        ORDER BY m.id ASC
        LIMIT ?
      `;
      const lowRes = await executeQuery<IChatMessageEntity>(lowerSql, [schoolId, chatRoomId, anchorMessageId, half]);
      lowerRows = (lowRes.status === 1 && lowRes.data) ? lowRes.data : [];
    } else {
      // 内存沙箱检索
      const all = ChatMessageService.getAllMockMessages()
        .filter((m) => m.schoolId === schoolId && m.chatRoomId === chatRoomId);

      centerMsg = all.find((m) => m.id === anchorMessageId) || null;

      upperRows = all
        .filter((m) => m.id < anchorMessageId)
        .sort((a, b) => b.id - a.id)
        .slice(0, half);

      lowerRows = all
        .filter((m) => m.id > anchorMessageId)
        .sort((a, b) => a.id - b.id)
        .slice(0, half);
    }

    if (!centerMsg) {
      throw new Error("指定的锚点源消息不存在");
    }

    // 组合并按 ID 正序排列
    const mergedEntities: IChatMessageEntity[] = [
      ...[...upperRows].reverse(),
      centerMsg,
      ...lowerRows
    ];

    // 批量注水引用卡片
    const hydratedMessages = await this.populateQuotesForMessages(schoolId, mergedEntities);

    return {
      chatRoomId,
      anchorMessageId,
      isHistoricalSlice: true,
      messages: hydratedMessages,
      hasEarlier: upperRows.length >= half,
      hasLater: lowerRows.length >= half,
      hasMoreOlder: upperRows.length >= half,
      hasMoreNewer: lowerRows.length >= half
    };
  }
}
