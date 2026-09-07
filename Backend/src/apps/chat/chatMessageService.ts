/**
 * 高校后勤巡查e速办 v4.0 - M37: 类 QQ 聊天气泡渲染与多媒体扩展条中枢服务
 * (Chat Message Service)
 *
 * 核心设计与算法：
 * 1. 算法 1：聊天图片尺寸动态自适应缩放与边界约束 (Chat Image Box Normalizer)
 * 2. 算法 2：消息时间戳智能会话分组与相对时间消解 (Message Timestamp Cluster Resolver)
 * 3. 算法 3：会话最新摘要提取与未读消息原子累加 (Room Last Message & Unread Accumulator)
 * 4. 算法 4：消息列表视口滚动定位与新消息触底锚定 (Chat Scroll Anchor Evaluator)
 * 5. DFA 内容安全扫描过滤暴恐违规词汇，XSS HTML 实体转义
 * 6. 历史消息游标倒序分页拉取与撤回掩码遮蔽 (isWithDraw = 1 -> "该消息已被撤回")
 * 7. 进房即刻已读清零 (Ack Read)
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import { RedisWsBridge } from "../../ws/redisWsBridge.js";
import { DfaWordFilter } from "../feedback/dfaWordFilter.js";
import { ChatRoomService } from "./chatRoomService.js";
import { ChatQuoteService } from "./chatQuoteService.js";
import {
  ChatMessageType,
  IChatMessageEntity,
  ISendMessageRequestDto,
  ISendMessageResponseDto,
  IChatMessageListDto,
  IChatMessageListItem,
  IChatMessageWsBroadcast
} from "./chatMessageTypes.js";

export interface IDbExecutor {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
}

export interface IRedisPublisher {
  eval?(script: string, numkeys: number, ...args: any[]): Promise<any>;
  publish?(channel: string, message: string): Promise<number>;
}

/**
 * 算法 1: 聊天图片尺寸动态自适应缩放与边界约束算法
 */
export function computeImageBox(wRaw: number, hRaw: number): { boxWidth: number; boxHeight: number } {
  const MAX_WIDTH = 400;
  const MAX_HEIGHT = 400;
  const MIN_WIDTH = 140;
  const MIN_HEIGHT = 140;

  if (!wRaw || !hRaw || wRaw <= 0 || hRaw <= 0) {
    return { boxWidth: 360, boxHeight: 360 };
  }

  const R = wRaw / hRaw;
  let wBox: number;
  let hBox: number;

  if (R >= 0.8 && R <= 1.25) {
    // Case A: 正方形或微方图 (0.8 <= R <= 1.25)
    const scale = Math.min(MAX_WIDTH / wRaw, MAX_HEIGHT / hRaw);
    wBox = Math.max(MIN_WIDTH, Math.round(wRaw * scale));
    hBox = Math.max(MIN_HEIGHT, Math.round(hRaw * scale));
  } else if (R < 0.8) {
    // Case B: 极度修长的竖图 (R < 0.8)
    hBox = MAX_HEIGHT;
    wBox = Math.max(MIN_WIDTH, Math.round(hBox * R));
    if (wBox > MAX_WIDTH) wBox = MAX_WIDTH;
  } else {
    // Case C: 宽屏全景横图 (R > 1.25)
    wBox = MAX_WIDTH;
    hBox = Math.max(MIN_HEIGHT, Math.round(wBox / R));
    if (hBox > MAX_HEIGHT) hBox = MAX_HEIGHT;
  }

  return { boxWidth: wBox, boxHeight: hBox };
}

/**
 * 算法 2: 相对时间人性化消解
 */
export function formatHumanFriendlyTime(dateStrOrMs: string | number): string {
  const ms = typeof dateStrOrMs === 'string' ? new Date(dateStrOrMs).getTime() : dateStrOrMs;
  const now = Date.now();
  const dateMsg = new Date(ms);
  const dateNow = new Date(now);

  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  const hhmm = `${pad(dateMsg.getHours())}:${pad(dateMsg.getMinutes())}`;

  const isSameDay = dateMsg.toDateString() === dateNow.toDateString();
  if (isSameDay) {
    return `今天 ${hhmm}`;
  }

  const yesterday = new Date(now - 86400000);
  const isYesterday = dateMsg.toDateString() === yesterday.toDateString();
  if (isYesterday) {
    return `昨天 ${hhmm}`;
  }

  const diffDays = Math.floor((now - ms) / 86400000);
  if (diffDays < 7 && diffDays > 0) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${days[dateMsg.getDay()]} ${hhmm}`;
  }

  return `${dateMsg.getFullYear()}-${pad(dateMsg.getMonth() + 1)}-${pad(dateMsg.getDate())} ${hhmm}`;
}

/**
 * XSS 脚本与 HTML 标签过滤防跨站注入 (算法与安全防护 7.5)
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export class ChatMessageService {
  private static mockMessagesStore: Map<number, IChatMessageEntity> = new Map();
  private static messageIdCounter = 1000;

  constructor(
    private readonly customDb?: IDbExecutor,
    private readonly customRedis?: IRedisPublisher
  ) {}

  /**
   * 重置内存沙箱 Mock 数据 (保证测试独立正交)
   */
  public static resetMockData(): void {
    this.mockMessagesStore.clear();
    this.messageIdCounter = 1000;
  }

  public static getMockMessage(id: number): IChatMessageEntity | undefined {
    return this.mockMessagesStore.get(id);
  }

  public static setMockMessage(id: number, msg: IChatMessageEntity): void {
    this.mockMessagesStore.set(id, msg);
  }

  public static getAllMockMessages(): IChatMessageEntity[] {
    return Array.from(this.mockMessagesStore.values());
  }

  /**
   * 发送消息并落盘、更新会话摘要与触发全双工广播
   */
  public async sendMessage(
    schoolId: number,
    senderId: number,
    senderRole: number,
    dto: ISendMessageRequestDto
  ): Promise<ISendMessageResponseDto> {
    const { chatRoomId, type, content, answerMessageId = 0, clientMsgId } = dto;

    // 1. 消息内容基础合规性校验
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('消息内容不可为空');
    }

    if (content.length > 500) {
      throw new Error('文字内容过长，请精简沟通（上限 500 字）');
    }

    // 2. 内容合规清洗: 若为文本消息，执行 DFA 敏感词扫描与 XSS 转义
    let finalContent = content;
    if (type === ChatMessageType.TEXT) {
      const dfa = DfaWordFilter.getInstance();
      const scan = dfa.scanAndSanitize(content);
      if (scan.hasFatalWords) {
        throw new Error('消息包含严重违规言论，已被系统拦截！');
      }
      finalContent = escapeHtml(scan.sanitizedText);
    } else if (type === ChatMessageType.IMAGE) {
      // 图片格式或协议探针校验 (防非法外部脚本)
      if (!/^https?:\/\//i.test(content) && !content.startsWith('/')) {
        throw new Error('图片链接格式不合法');
      }
    }

    // 3. 提取用于会话列表的摘要文本 (执行算法 3)
    let summary = '[新消息]';
    switch (type) {
      case ChatMessageType.TEXT:
        summary = finalContent.substring(0, 30);
        break;
      case ChatMessageType.IMAGE:
        summary = '[图片]';
        break;
      case ChatMessageType.PATROL_CARD:
        summary = '[工单协同卡片]';
        break;
      case ChatMessageType.SYSTEM:
        summary = '[系统通知]';
        break;
    }

    let messageId: number;
    const nowIso = new Date().toISOString();

    // 4. 插入消息流水
    if (this.customDb) {
      const insertSql = `
        INSERT INTO chat_messages (
          schoolId, chatRoomId, senderId, senderRole, 
          type, content, answerMessageId, isWithDraw, createdAt
        ) VALUES (
          ?, ?, ?, ?, 
          ?, ?, ?, 0, NOW()
        )
      `;
      const res = await this.customDb.execute(insertSql, [
        schoolId,
        chatRoomId,
        senderId,
        senderRole,
        type,
        finalContent,
        answerMessageId
      ]);
      messageId = res.insertId || ++ChatMessageService.messageIdCounter;

      // 更新 chat_rooms 摘要与未读数
      const isSenderHandler = (senderRole === 1);
      const unreadCol = isSenderHandler ? 'creatorUnreadCount' : 'handlerUnreadCount';
      const updateRoomSql = `
        UPDATE chat_rooms 
        SET lastMessage = ?, lastMessageAt = NOW(), ${unreadCol} = ${unreadCol} + 1 
        WHERE id = ? AND schoolId = ?
      `;
      await this.customDb.execute(updateRoomSql, [summary, chatRoomId, schoolId]);
    } else if (getMySQLPool()) {
      const insertSql = `
        INSERT INTO chat_messages (
          schoolId, chatRoomId, senderId, senderRole, 
          type, content, answerMessageId, isWithDraw, createdAt
        ) VALUES (
          ?, ?, ?, ?, 
          ?, ?, ?, 0, NOW()
        )
      `;
      const res: any = await executeQuery<{ insertId: number; affectedRows: number }>(insertSql, [
        schoolId,
        chatRoomId,
        senderId,
        senderRole,
        type,
        finalContent,
        answerMessageId
      ]);
      messageId = res?.data?.insertId || ++ChatMessageService.messageIdCounter;

      const isSenderHandler = (senderRole === 1);
      const unreadCol = isSenderHandler ? 'creatorUnreadCount' : 'handlerUnreadCount';
      const updateRoomSql = `
        UPDATE chat_rooms 
        SET lastMessage = ?, lastMessageAt = NOW(), ${unreadCol} = ${unreadCol} + 1 
        WHERE id = ? AND schoolId = ?
      `;
      await executeQuery(updateRoomSql, [summary, chatRoomId, schoolId]);
    } else {
      // 内存沙箱落盘
      messageId = ++ChatMessageService.messageIdCounter;
      const entity: IChatMessageEntity = {
        id: messageId,
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
      ChatMessageService.mockMessagesStore.set(messageId, entity);

      // 更新 Mock 房间摘要与未读
      const room = ChatRoomService.getMockRoom(chatRoomId);
      if (room) {
        room.lastMessage = summary;
        room.lastMessageAt = nowIso;
        if (senderRole === 1) {
          room.creatorUnreadCount = (room.creatorUnreadCount || 0) + 1;
        } else {
          room.handlerUnreadCount = (room.handlerUnreadCount || 0) + 1;
        }
      }
    }

    // 5. 查询发送人昵称与头像
    let senderName = '用户';
    let senderAvatar = '/assets/avatar_default.png';

    if (senderId === 0) {
      senderName = '系统通知';
    } else if (this.customDb) {
      try {
        const userSql = `SELECT nickName, avatarUrl FROM users WHERE id = ? AND schoolId = ? LIMIT 1`;
        const userRows = await this.customDb.query<{ nickName?: string; avatarUrl?: string }>(userSql, [senderId, schoolId]);
        if (userRows && userRows[0]) {
          senderName = userRows[0].nickName || (senderRole === 1 ? '维修师傅' : '师生');
          senderAvatar = userRows[0].avatarUrl || senderAvatar;
        }
      } catch {
        senderName = senderRole === 1 ? '维修师傅' : '师生';
      }
    } else if (getMySQLPool()) {
      try {
        const userSql = `SELECT nickName, avatarUrl FROM users WHERE id = ? AND schoolId = ? LIMIT 1`;
        const userRes: any = await executeQuery<{ nickName?: string; avatarUrl?: string }[]>(userSql, [senderId, schoolId]);
        const userRows = (userRes?.data || []) as any[];
        if (userRows && userRows[0]) {
          senderName = userRows[0].nickName || (senderRole === 1 ? '维修师傅' : '师生');
          senderAvatar = userRows[0].avatarUrl || senderAvatar;
        }
      } catch {
        senderName = senderRole === 1 ? '维修师傅' : '师生';
      }
    } else {
      senderName = senderRole === 1 ? '张师傅' : '师生同学';
    }

    // 6. 构造 WebSocket 广播信令 (CHAT_MESSAGE_ARRIVED)
    const wsBroadcastPayload: IChatMessageWsBroadcast = {
      event: 'CHAT_MESSAGE_ARRIVED',
      schoolId,
      chatRoomId,
      message: {
        id: messageId,
        type,
        content: finalContent,
        senderId,
        senderName,
        senderAvatar,
        senderRole,
        answerMessageId,
        isWithDraw: false,
        createdAt: nowIso
      }
    };

    if (this.customRedis?.eval) {
      try {
        await this.customRedis.eval(
          `redis.call('PUBLISH', 'ws_broadcast_bus', ARGV[1])`,
          0,
          JSON.stringify(wsBroadcastPayload)
        );
      } catch {
        // 忽略广播错误
      }
    } else {
      try {
        await RedisWsBridge.broadcast("ws:cluster:broadcast", schoolId, wsBroadcastPayload);
      } catch {
        // 忽略静默
      }
    }

    return {
      messageId,
      chatRoomId,
      clientMsgId: clientMsgId || `c_${Date.now()}`,
      type,
      content: finalContent,
      senderId,
      senderName,
      senderAvatar,
      isSelf: true,
      createdAt: nowIso,
      statusText: '发送成功'
    };
  }

  /**
   * 倒序分页查询历史消息 (支持向上翻页与撤回遮蔽)
   */
  public async queryHistoryMessages(
    schoolId: number,
    currentUserId: number,
    chatRoomId: number,
    cursorId: number = 0,
    pageSize: number = 20
  ): Promise<IChatMessageListDto> {
    const size = Math.min(50, Math.max(1, pageSize));

    if (this.customDb) {
      let sql = `
        SELECT m.*, u.nickName AS senderName, u.avatarUrl AS senderAvatar
        FROM chat_messages m
        LEFT JOIN users u ON m.senderId = u.id
        WHERE m.schoolId = ? AND m.chatRoomId = ?
      `;
      const params: any[] = [schoolId, chatRoomId];

      if (cursorId > 0) {
        sql += ` AND m.id < ?`;
        params.push(cursorId);
      }

      sql += ` ORDER BY m.id DESC LIMIT ?`;
      params.push(size + 1);

      const rows = await this.customDb.query<any>(sql, params);
      const hasMore = rows.length > size;
      const pagedRows = hasMore ? rows.slice(0, size) : rows;

      // 翻转为时序正序 (从旧到新)
      pagedRows.reverse();

      const minId = pagedRows.length > 0 ? pagedRows[0].id : 0;

      const messages: IChatMessageListItem[] = pagedRows.map((r) => {
        const isWithdrawn = r.isWithDraw === 1;
        const safeContent = isWithdrawn ? '该消息已被撤回' : r.content;

        return {
          id: r.id,
          type: r.type,
          content: safeContent,
          senderId: r.senderId,
          senderRole: r.senderRole,
          senderName: r.senderId === 0 ? '系统消息' : (r.senderName || '用户'),
          senderAvatar: r.senderAvatar || '/assets/avatar_default.png',
          isSelf: (r.senderId === currentUserId),
          isWithDraw: isWithdrawn,
          answerMessageId: r.answerMessageId || 0,
          createdAt: r.createdAt,
          imageMeta: r.type === ChatMessageType.IMAGE ? computeImageBox(360, 360) : undefined
        };
      });

      await ChatQuoteService.populateQuotesForMessages(schoolId, messages, this.customDb);

      return {
        chatRoomId,
        hasMore,
        minMessageId: minId,
        messages
      };
    }

    if (getMySQLPool()) {
      let sql = `
        SELECT m.*, u.nickName AS senderName, u.avatarUrl AS senderAvatar
        FROM chat_messages m
        LEFT JOIN users u ON m.senderId = u.id
        WHERE m.schoolId = ? AND m.chatRoomId = ?
      `;
      const params: any[] = [schoolId, chatRoomId];

      if (cursorId > 0) {
        sql += ` AND m.id < ?`;
        params.push(cursorId);
      }

      sql += ` ORDER BY m.id DESC LIMIT ?`;
      params.push(size + 1);

      const queryRes: any = await executeQuery<any[]>(sql, params);
      const rows = (queryRes?.data || []) as any[];
      const hasMore = rows.length > size;
      const pagedRows = hasMore ? rows.slice(0, size) : rows;
      pagedRows.reverse();

      const minId = pagedRows.length > 0 ? pagedRows[0].id : 0;

      const messages: IChatMessageListItem[] = pagedRows.map((r: any) => {
        const isWithdrawn = r.isWithDraw === 1;
        const safeContent = isWithdrawn ? '该消息已被撤回' : r.content;

        return {
          id: r.id,
          type: r.type,
          content: safeContent,
          senderId: r.senderId,
          senderRole: r.senderRole,
          senderName: r.senderId === 0 ? '系统消息' : (r.senderName || '用户'),
          senderAvatar: r.senderAvatar || '/assets/avatar_default.png',
          isSelf: (r.senderId === currentUserId),
          isWithDraw: isWithdrawn,
          answerMessageId: r.answerMessageId || 0,
          createdAt: r.createdAt,
          imageMeta: r.type === ChatMessageType.IMAGE ? computeImageBox(360, 360) : undefined
        };
      });

      await ChatQuoteService.populateQuotesForMessages(schoolId, messages);

      return {
        chatRoomId,
        hasMore,
        minMessageId: minId,
        messages
      };
    }

    // 内存沙箱查询
    const all = Array.from(ChatMessageService.mockMessagesStore.values())
      .filter(m => m.schoolId === schoolId && m.chatRoomId === chatRoomId);

    let filtered = all;
    if (cursorId > 0) {
      filtered = filtered.filter(m => m.id < cursorId);
    }

    // 倒序排列
    filtered.sort((a, b) => b.id - a.id);

    const hasMore = filtered.length > size;
    const paged = hasMore ? filtered.slice(0, size) : filtered;
    paged.reverse();

    const minId = paged.length > 0 ? paged[0].id : 0;

    const messages: IChatMessageListItem[] = paged.map(m => {
      const isWithdrawn = m.isWithDraw === 1;
      const safeContent = isWithdrawn ? '该消息已被撤回' : m.content;

      return {
        id: m.id,
        type: m.type,
        content: safeContent,
        senderId: m.senderId,
        senderRole: m.senderRole,
        senderName: m.senderId === 0 ? '系统消息' : (m.senderRole === 1 ? '张师傅' : '师生同学'),
        senderAvatar: '/assets/avatar_default.png',
        isSelf: (m.senderId === currentUserId),
        isWithDraw: isWithdrawn,
        answerMessageId: m.answerMessageId || 0,
        createdAt: m.createdAt,
        imageMeta: m.type === ChatMessageType.IMAGE ? computeImageBox(360, 360) : undefined
      };
    });

    await ChatQuoteService.populateQuotesForMessages(schoolId, messages);

    return {
      chatRoomId,
      hasMore,
      minMessageId: minId,
      messages
    };
  }

  /**
   * 用户进入聊天室，将对应的未读数清零 (Ack Read)
   */
  public async ackRoomRead(schoolId: number, chatRoomId: number, userId: number): Promise<void> {
    if (this.customDb) {
      const roomSql = `SELECT creatorId, handlerId FROM chat_rooms WHERE id = ? AND schoolId = ? LIMIT 1`;
      const rows = await this.customDb.query<{ creatorId: number; handlerId: number }>(roomSql, [chatRoomId, schoolId]);
      if (rows && rows.length > 0) {
        const room = rows[0];
        if (userId === room.creatorId) {
          await this.customDb.execute(`UPDATE chat_rooms SET creatorUnreadCount = 0 WHERE id = ? AND schoolId = ?`, [chatRoomId, schoolId]);
        } else if (userId === room.handlerId) {
          await this.customDb.execute(`UPDATE chat_rooms SET handlerUnreadCount = 0 WHERE id = ? AND schoolId = ?`, [chatRoomId, schoolId]);
        }
      }
      return;
    }

    if (getMySQLPool()) {
      const roomSql = `SELECT creatorId, handlerId FROM chat_rooms WHERE id = ? AND schoolId = ? LIMIT 1`;
      const roomRes: any = await executeQuery<{ creatorId: number; handlerId: number }[]>(roomSql, [chatRoomId, schoolId]);
      const rows = (roomRes?.data || []) as any[];
      if (rows && rows.length > 0) {
        const room = rows[0];
        if (userId === room.creatorId) {
          await executeQuery(`UPDATE chat_rooms SET creatorUnreadCount = 0 WHERE id = ? AND schoolId = ?`, [chatRoomId, schoolId]);
        } else if (userId === room.handlerId) {
          await executeQuery(`UPDATE chat_rooms SET handlerUnreadCount = 0 WHERE id = ? AND schoolId = ?`, [chatRoomId, schoolId]);
        }
      }
      return;
    }

    // 内存沙箱已读消除
    const room = ChatRoomService.getMockRoom(chatRoomId);
    if (room) {
      if (userId === room.creatorId) {
        room.creatorUnreadCount = 0;
      } else if (userId === room.handlerId) {
        room.handlerUnreadCount = 0;
      }
    }
  }

  /**
   * 静态快捷方法: 发送消息
   */
  public static async sendMessage(
    schoolId: number,
    senderId: number,
    senderRole: number,
    dto: ISendMessageRequestDto
  ): Promise<ISendMessageResponseDto> {
    const service = new ChatMessageService();
    return service.sendMessage(schoolId, senderId, senderRole, dto);
  }

  /**
   * 静态快捷方法: 拉取历史消息
   */
  public static async queryHistoryMessages(
    schoolId: number,
    currentUserId: number,
    chatRoomId: number,
    cursorId?: number,
    pageSize?: number
  ): Promise<IChatMessageListDto> {
    const service = new ChatMessageService();
    return service.queryHistoryMessages(schoolId, currentUserId, chatRoomId, cursorId, pageSize);
  }

  /**
   * 静态快捷方法: 会话已读清零
   */
  public static async ackRoomRead(schoolId: number, chatRoomId: number, userId: number): Promise<void> {
    const service = new ChatMessageService();
    return service.ackRoomRead(schoolId, chatRoomId, userId);
  }
}
