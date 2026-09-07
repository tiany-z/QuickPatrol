/**
 * 高校后勤巡查e速办 v4.0 - M25: 责任人主动发起聊天与师生多媒体会话中枢服务
 * (Patrol Chat & Media Session Domain Service)
 * 
 * 核心设计与算法：
 * 1. 责任人单向激活与反骚扰静默门禁 (Anti-Harassment Gate: initiatedByHandler = 0 物理阻断)
 * 2. 4级多媒体消息形态支持 (0文本, 1图片, 2进度卡片, 3系统药丸) 与 XSS 清洗清洗
 * 3. 2分钟 (120秒) 严格消息撤回时限与软屏蔽审计留痕机制
 * 4. 类 QQ 引用回复链与优雅降级容错模型
 * 5. 游标分页高效增量拉取算法 (Cursor-based Pagination)
 * 6. 未读消息计数原子自增与进房即刻已读清零
 * 7. 工单办结生命周期自动联动与归档终态只读锁定
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import { executeASTInsert, executeASTSelect } from "../../shared/sql/index.js";
import { RedisWsBridge } from "../../ws/redisWsBridge.js";
import { AuditLogger } from "../../shared/log/auditLogger.js";
import { WeChatAuthService } from "../../services/auth/wechatAuthService.js";
import { PatrolService } from "../patrol/patrolService.js";
import {
  IChatRoomEntity,
  IChatMessageEntity,
  ISendMessageRequest,
  ISendMessageResponseDto,
  IQuotedMessageDto
} from "./chatTypes.js";

// 内存沙箱会话室与聊天流水字典 (支持单测离线运行与零外部依赖)
const mockRoomsMap = new Map<number, IChatRoomEntity>();
const mockMessagesMap = new Map<number, IChatMessageEntity>();
let mockRoomIdCounter = 1000;
let mockMessageIdCounter = 5000;

export class ChatService {
  /**
   * 注册虚拟会话室 (用于离线单元测试桩点)
   */
  public static mockRegisterRoom(room: Partial<IChatRoomEntity> & { schoolId: number }): IChatRoomEntity {
    const id = room.id || mockRoomIdCounter++;
    const entity: IChatRoomEntity = {
      id,
      schoolId: room.schoolId,
      roomType: room.roomType || "patrol",
      title: room.title || `工单协同会话 #${room.patrolId || id}`,
      patrolId: room.patrolId !== undefined ? room.patrolId : null,
      creatorId: room.creatorId || 101,
      handlerId: room.handlerId || 801,
      initiatedByHandler: (room.initiatedByHandler !== undefined ? room.initiatedByHandler : 0) as any,
      isClosed: (room.isClosed !== undefined ? room.isClosed : 0) as any,
      isPinned: (room.isPinned !== undefined ? room.isPinned : 0) as any,
      creatorUnreadCount: room.creatorUnreadCount || 0,
      handlerUnreadCount: room.handlerUnreadCount || 0,
      lastMessage: room.lastMessage || "",
      lastMessageAt: room.lastMessageAt || null,
      createdAt: room.createdAt || new Date().toISOString()
    };
    mockRoomsMap.set(id, entity);
    return entity;
  }

  /**
   * 获取测试沙箱指定会话室
   */
  public static getMockRoom(id: number): IChatRoomEntity | undefined {
    return mockRoomsMap.get(id);
  }

  /**
   * 获取测试沙箱全部会话室
   */
  public static getAllMockRooms(): IChatRoomEntity[] {
    return Array.from(mockRoomsMap.values());
  }

  /**
   * 更新测试沙箱指定会话室
   */
  public static updateMockRoom(id: number, updates: Partial<IChatRoomEntity>): boolean {
    const existing = mockRoomsMap.get(id);
    if (!existing) return false;
    Object.assign(existing, updates);
    return true;
  }

  /**
   * 注册虚拟消息记录 (用于离线单元测试桩点)
   */
  public static mockRegisterMessage(msg: Partial<IChatMessageEntity> & { schoolId: number; chatRoomId: number }): IChatMessageEntity {
    const id = msg.id || mockMessageIdCounter++;
    const entity: IChatMessageEntity = {
      id,
      schoolId: msg.schoolId,
      chatRoomId: msg.chatRoomId,
      senderId: msg.senderId !== undefined ? msg.senderId : 0,
      senderRole: (msg.senderRole !== undefined ? msg.senderRole : 0) as any,
      type: (msg.type !== undefined ? msg.type : 0) as any,
      content: msg.content || "",
      answerMessageId: msg.answerMessageId || 0,
      isWithDraw: (msg.isWithDraw !== undefined ? msg.isWithDraw : 0) as any,
      createdAt: msg.createdAt || new Date().toISOString()
    };
    mockMessagesMap.set(id, entity);
    return entity;
  }

  /**
   * 获取测试沙箱指定消息
   */
  public static getMockMessage(id: number): IChatMessageEntity | undefined {
    return mockMessagesMap.get(id);
  }

  /**
   * 清空测试沙箱全部数据
   */
  public static clearMockData(): void {
    mockRoomsMap.clear();
    mockMessagesMap.clear();
    mockRoomIdCounter = 1000;
    mockMessageIdCounter = 5000;
  }

  /**
   * 1. 责任维修师傅主动发起激活会话室
   */
  public static async initiateRoomByHandler(
    schoolId: number,
    handlerId: number,
    patrolId: number,
    userIp: string = "127.0.0.1"
  ): Promise<{ success: boolean; chatRoomId: number }> {
    // 1.1 检查工单责任人归属
    let patrol: any = PatrolService.getMockPatrol(patrolId);
    if (!patrol && getMySQLPool()) {
      const pRes = await executeQuery(
        `SELECT id, orderNo, currentHandlerId, status FROM patrols WHERE id = ? AND schoolId = ? LIMIT 1`,
        [patrolId, schoolId]
      );
      if (pRes.status === 1 && pRes.data && pRes.data.length > 0) {
        patrol = pRes.data[0];
      }
    }

    if (!patrol) {
      throw new Error("关联工单不存在");
    }

    if (Number(patrol.currentHandlerId) !== handlerId) {
      throw new Error("只有当前工单的责任维修师傅有权主动发起会话！");
    }

    // 1.2 查询会话室
    let room: IChatRoomEntity | undefined = Array.from(mockRoomsMap.values()).find(
      (r) => r.schoolId === schoolId && r.patrolId === patrolId
    );

    if (!room && getMySQLPool()) {
      const rRes = await executeQuery(
        `SELECT id, initiatedByHandler, isClosed, creatorId, handlerId FROM chat_rooms WHERE schoolId = ? AND patrolId = ? LIMIT 1`,
        [schoolId, patrolId]
      );
      if (rRes.status === 1 && rRes.data && rRes.data.length > 0) {
        room = rRes.data[0];
      }
    }

    if (!room) {
      throw new Error("工单关联的会话室不存在");
    }

    if (room.isClosed === 1) {
      throw new Error("工单已结案归档，无法重新激活会话");
    }

    if (room.initiatedByHandler === 1) {
      return { success: true, chatRoomId: room.id }; // 已经激活无感放行
    }

    // 1.3 更新激活标记
    room.initiatedByHandler = 1;
    if (getMySQLPool()) {
      await executeQuery(
        `UPDATE chat_rooms SET initiatedByHandler = 1 WHERE id = ? AND schoolId = ?`,
        [room.id, schoolId]
      );
    }

    // 1.4 插入一条系统欢迎帧 (type = 3, senderRole = 9)
    const welcomeContent = "责任维修师傅已主动开启现场协同通道，双方可实时沟通。";
    const welcomeMsg = this.mockRegisterMessage({
      schoolId,
      chatRoomId: room.id,
      senderId: 0,
      senderRole: 9,
      type: 3,
      content: welcomeContent,
      isWithDraw: 0,
      createdAt: new Date().toISOString()
    });

    if (getMySQLPool()) {
      await executeQuery(
        `INSERT INTO chat_messages (schoolId, chatRoomId, senderId, senderRole, type, content, isWithDraw, createdAt)
         VALUES (?, ?, 0, 9, 3, ?, 0, NOW())`,
        [schoolId, room.id, welcomeContent]
      );
    }

    // 1.5 记录不可篡改审计日志
    await AuditLogger.log(schoolId, handlerId, "CHAT_ROOM_INITIATED", "chat_rooms", userIp, {
      patrolId,
      chatRoomId: room.id
    });

    // 1.6 跨节点实时推送房间激活帧
    await RedisWsBridge.broadcastToUsers(schoolId, [room.creatorId, handlerId], {
      event: "ROOM_ACTIVATED",
      schoolId,
      chatRoomId: room.id,
      message: {
        id: welcomeMsg.id,
        senderId: 0,
        senderName: "系统提示",
        senderRole: 9,
        type: 3,
        content: welcomeContent,
        createdAt: welcomeMsg.createdAt,
        answerMessageId: 0
      }
    });

    return { success: true, chatRoomId: room.id };
  }

  /**
   * 2. 发送聊天消息
   */
  public static async sendMessage(
    schoolId: number,
    senderId: number,
    senderRole: 0 | 1 | 2 | 4,
    req: ISendMessageRequest
  ): Promise<ISendMessageResponseDto> {
    if (!req.content || req.content.trim().length === 0) {
      throw new Error("消息内容不可为空");
    }

    // 2.1 查询会话室属性
    let room: IChatRoomEntity | undefined = mockRoomsMap.get(req.chatRoomId);
    if (!room && getMySQLPool()) {
      const rRes = await executeQuery(
        `SELECT id, patrolId, creatorId, handlerId, initiatedByHandler, isClosed FROM chat_rooms WHERE id = ? AND schoolId = ? LIMIT 1`,
        [req.chatRoomId, schoolId]
      );
      if (rRes.status === 1 && rRes.data && rRes.data.length > 0) {
        room = rRes.data[0];
      }
    }

    if (!room) {
      throw new Error("会话室不存在");
    }

    // 2.2 防骚扰静默门禁校验: 若尚未由师傅激活，师生发言被 100% 物理拦截
    if (room.initiatedByHandler === 0 && senderRole === 0) {
      throw new Error("安全拦截：当前工单处于备料静默期，请等待责任师傅主动发起沟通！");
    }

    // 2.3 归档锁死校验: 若工单已结案归档，输入通道物理闭锁
    if (room.isClosed === 1) {
      throw new Error("安全拦截：本工单已完成整改结案归档，会话已锁定为只读状态");
    }

    // 2.4 XSS 安全清洗
    const cleanContent = this.sanitizeContent(req.content.trim());

    // 2.5 插入新消息
    const newMsg = this.mockRegisterMessage({
      schoolId,
      chatRoomId: req.chatRoomId,
      senderId,
      senderRole,
      type: req.type,
      content: cleanContent,
      answerMessageId: req.answerMessageId || 0,
      isWithDraw: 0,
      createdAt: new Date().toISOString()
    });

    if (getMySQLPool()) {
      const insertSql = `
        INSERT INTO chat_messages (
          schoolId, chatRoomId, senderId, senderRole, type, content, answerMessageId, isWithDraw, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW())
      `;
      await executeQuery(insertSql, [
        schoolId,
        req.chatRoomId,
        senderId,
        senderRole,
        req.type,
        cleanContent,
        req.answerMessageId || 0
      ]);
    }

    // 2.6 更新最新消息摘要并累加对端未读数
    const isSenderCreator = senderId === room.creatorId;
    const snippet = req.type === 1 ? "[图片]" : req.type === 2 ? "[工单进度卡片]" : cleanContent.substring(0, 80);

    if (isSenderCreator) {
      room.handlerUnreadCount = (room.handlerUnreadCount || 0) + 1;
    } else {
      room.creatorUnreadCount = (room.creatorUnreadCount || 0) + 1;
    }
    room.lastMessage = snippet;
    room.lastMessageAt = new Date().toISOString();

    if (getMySQLPool()) {
      const updateRoomSql = isSenderCreator
        ? `UPDATE chat_rooms SET lastMessage = ?, lastMessageAt = NOW(), handlerUnreadCount = handlerUnreadCount + 1 WHERE id = ? AND schoolId = ?`
        : `UPDATE chat_rooms SET lastMessage = ?, lastMessageAt = NOW(), creatorUnreadCount = creatorUnreadCount + 1 WHERE id = ? AND schoolId = ?`;
      await executeQuery(updateRoomSql, [snippet, req.chatRoomId, schoolId]);
    }

    // 2.7 处理类 QQ 引用回复解析
    let quotedDto: IQuotedMessageDto | undefined = undefined;
    if (req.answerMessageId && req.answerMessageId > 0) {
      quotedDto = await this.resolveQuotedMessage(schoolId, req.answerMessageId);
    }

    // 2.8 跨节点实时双向推送
    const receiverId = isSenderCreator ? room.handlerId : room.creatorId;
    const senderUser = WeChatAuthService.getMockUserById(senderId);
    const senderName = senderUser?.realName || (senderRole === 1 ? "维修师傅" : "提报师生");

    await RedisWsBridge.sendToUser(schoolId, receiverId, {
      event: "CHAT_MESSAGE_PUSH",
      schoolId,
      chatRoomId: req.chatRoomId,
      message: {
        id: newMsg.id,
        senderId,
        senderName,
        senderRole,
        type: req.type,
        content: cleanContent,
        createdAt: newMsg.createdAt,
        answerMessageId: req.answerMessageId || 0
      }
    });

    return {
      messageId: newMsg.id,
      chatRoomId: req.chatRoomId,
      senderId,
      type: req.type,
      content: cleanContent,
      isWithDraw: 0,
      createdAt: newMsg.createdAt,
      quotedMessage: quotedDto
    };
  }

  /**
   * 3. 撤回消息 (严格限定 120 秒安全时间窗口)
   */
  public static async withdrawMessage(
    schoolId: number,
    operatorId: number,
    messageId: number,
    userIp: string = "127.0.0.1"
  ): Promise<{ success: boolean; chatRoomId: number }> {
    let msg: IChatMessageEntity | undefined = mockMessagesMap.get(messageId);
    if (!msg && getMySQLPool()) {
      const mRes = await executeQuery(
        `SELECT id, chatRoomId, senderId, createdAt, isWithDraw FROM chat_messages WHERE id = ? AND schoolId = ? LIMIT 1`,
        [messageId, schoolId]
      );
      if (mRes.status === 1 && mRes.data && mRes.data.length > 0) {
        msg = mRes.data[0];
      }
    }

    if (!msg) {
      throw new Error("目标消息不存在");
    }

    if (msg.senderId !== operatorId) {
      throw new Error("您只能撤回自己发送的消息！");
    }

    if (msg.isWithDraw === 1) {
      throw new Error("该消息早已被撤回");
    }

    // 时间窗口判定算法 (120 秒时限)
    const createdTime = new Date(msg.createdAt).getTime();
    const now = Date.now();
    if (now - createdTime > 120 * 1000) {
      throw new Error("超过 2 分钟的消息无法撤回");
    }

    // 软屏蔽标记
    msg.isWithDraw = 1;
    if (getMySQLPool()) {
      await executeQuery(
        `UPDATE chat_messages SET isWithDraw = 1 WHERE id = ? AND schoolId = ?`,
        [messageId, schoolId]
      );
    }

    // 记录不可篡改审计
    await AuditLogger.log(schoolId, operatorId, "CHAT_MESSAGE_WITHDRAW", "chat_messages", userIp, {
      messageId,
      chatRoomId: msg.chatRoomId
    });

    // 广播撤回帧通知
    await RedisWsBridge.broadcast("ws:cluster:direct", schoolId, {
      event: "MESSAGE_WITHDRAWN",
      schoolId,
      chatRoomId: msg.chatRoomId,
      withdrawnMessageId: messageId
    });

    return { success: true, chatRoomId: msg.chatRoomId };
  }

  /**
   * 4. 游标增量拉取历史记录 (单次 20 条，零全表扫描开销)
   */
  public static async getMessageList(
    schoolId: number,
    chatRoomId: number,
    cursorId: number = 0,
    limit: number = 20
  ): Promise<any[]> {
    if (getMySQLPool()) {
      let sql: string;
      let params: any[];

      if (cursorId === 0) {
        sql = `
          SELECT id, chatRoomId, senderId, senderRole, type, 
                 CASE WHEN isWithDraw = 1 THEN '消息已撤回' ELSE content END AS content,
                 answerMessageId, isWithDraw, createdAt
          FROM chat_messages
          WHERE schoolId = ? AND chatRoomId = ?
          ORDER BY id DESC
          LIMIT ?
        `;
        params = [schoolId, chatRoomId, limit];
      } else {
        sql = `
          SELECT id, chatRoomId, senderId, senderRole, type, 
                 CASE WHEN isWithDraw = 1 THEN '消息已撤回' ELSE content END AS content,
                 answerMessageId, isWithDraw, createdAt
          FROM chat_messages
          WHERE schoolId = ? AND chatRoomId = ? AND id < ?
          ORDER BY id DESC
          LIMIT ?
        `;
        params = [schoolId, chatRoomId, cursorId, limit];
      }

      const qRes = await executeQuery(sql, params);
      if (qRes.status === 1 && qRes.data) {
        return [...qRes.data].reverse();
      }
    }

    // 内存沙箱计算
    let list = Array.from(mockMessagesMap.values()).filter(
      (m) => m.schoolId === schoolId && m.chatRoomId === chatRoomId
    );

    if (cursorId > 0) {
      list = list.filter((m) => m.id < cursorId);
    }

    list.sort((a, b) => b.id - a.id);
    const sliced = list.slice(0, limit);

    const formatted = sliced.map((m) => ({
      id: m.id,
      chatRoomId: m.chatRoomId,
      senderId: m.senderId,
      senderRole: m.senderRole,
      type: m.type,
      content: m.isWithDraw === 1 ? "消息已撤回" : m.content,
      answerMessageId: m.answerMessageId,
      isWithDraw: m.isWithDraw,
      createdAt: m.createdAt
    }));

    return formatted.reverse();
  }

  /**
   * 5. 进房未读计数清零
   */
  public static async markRoomAsRead(
    schoolId: number,
    userId: number,
    chatRoomId: number
  ): Promise<void> {
    let room: IChatRoomEntity | undefined = mockRoomsMap.get(chatRoomId);
    if (!room && getMySQLPool()) {
      const rRes = await executeQuery(
        `SELECT creatorId, handlerId FROM chat_rooms WHERE id = ? AND schoolId = ? LIMIT 1`,
        [chatRoomId, schoolId]
      );
      if (rRes.status === 1 && rRes.data && rRes.data.length > 0) {
        room = rRes.data[0];
      }
    }

    if (!room) return;

    if (userId === room.creatorId) {
      room.creatorUnreadCount = 0;
      if (getMySQLPool()) {
        await executeQuery(
          `UPDATE chat_rooms SET creatorUnreadCount = 0 WHERE id = ? AND schoolId = ?`,
          [chatRoomId, schoolId]
        );
      }
    } else if (userId === room.handlerId) {
      room.handlerUnreadCount = 0;
      if (getMySQLPool()) {
        await executeQuery(
          `UPDATE chat_rooms SET handlerUnreadCount = 0 WHERE id = ? AND schoolId = ?`,
          [chatRoomId, schoolId]
        );
      }
    }
  }

  // ---------------- 私有辅助工具 ----------------

  private static sanitizeContent(content: string): string {
    return content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;")
      .replace(/\//g, "&#x2F;");
  }

  private static async resolveQuotedMessage(
    schoolId: number,
    quoteId: number
  ): Promise<IQuotedMessageDto> {
    let msg = mockMessagesMap.get(quoteId);
    if (!msg && getMySQLPool()) {
      const qRes = await executeQuery(
        `SELECT id, type, content, isWithDraw, senderId FROM chat_messages WHERE id = ? AND schoolId = ? LIMIT 1`,
        [quoteId, schoolId]
      );
      if (qRes.status === 1 && qRes.data && qRes.data.length > 0) {
        msg = qRes.data[0];
      }
    }

    if (!msg) {
      return { id: quoteId, senderName: "未知", summary: "原内容已不存在" };
    }

    const senderUser = WeChatAuthService.getMockUserById(msg.senderId);
    const senderName = senderUser?.realName || (msg.senderRole === 1 ? "维修师傅" : "提报人");

    if (msg.isWithDraw === 1) {
      return { id: quoteId, senderName, summary: "该引用消息已被撤回" };
    }

    const snippet = msg.type === 1 ? "[图片]" : msg.type === 2 ? "[工单进度卡片]" : msg.content.substring(0, 50);
    return { id: quoteId, senderName, summary: snippet };
  }
}
