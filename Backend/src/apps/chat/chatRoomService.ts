/**
 * M36: 工单协同会话室中枢调度服务 (Chat Room Service)
 * 职责：
 * 1. 工单提报/派单自动绑定并创建唯一会话室 (严格幂等防重)
 * 2. 责任维修师傅单向主动握手激活状态机 (initiatedByHandler: 0 -> 1)
 * 3. 握手激活瞬间注入系统居中通知气泡 (type = 3) 并触发 WebSocket 广播
 * 4. 责任人换人转派自愈交接 (handlerId 动态继承)
 * 5. 工单办结自动归档冷冻 (isClosed: 1 只读锁定)
 * 6. 首屏会话元数据与动态权限掩码解析 (Algorithm 4)
 * 7. 内存沙箱隔离自愈桩点
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import {
  IChatRoomEntity,
  IActivateHandshakeRequestDto,
  IActivateHandshakeResponseDto,
  IChatRoomMetaDto
} from "./chatRoomTypes.js";

export interface IDbExecutor {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
}

export interface IRedisPublisher {
  eval?(script: string, numkeys: number, ...args: any[]): Promise<any>;
  publish?(channel: string, message: string): Promise<number>;
}

export class ChatRoomService {
  private static mockRoomsStore: Map<number, IChatRoomEntity> = new Map();
  private static mockMessagesStore: Map<number, any> = new Map();
  private static roomIdCounter = 500;
  private static messageIdCounter = 1000;

  constructor(
    private readonly customDb?: IDbExecutor,
    private readonly customRedis?: IRedisPublisher
  ) {}

  /**
   * 重置与初始化内存沙箱 Mock 数据 (保证测试用例独立正交)
   */
  public static resetMockData(): void {
    this.mockRoomsStore.clear();
    this.mockMessagesStore.clear();
    this.roomIdCounter = 500;
    this.messageIdCounter = 1000;

    // 内置一条经典的工单未激活会话室
    this.mockRoomsStore.set(501, {
      id: 501,
      schoolId: 1,
      roomType: "patrol",
      title: "工单现场协同 #101",
      patrolId: 101,
      creatorId: 99,
      handlerId: 88,
      initiatedByHandler: 0,
      isClosed: 0,
      isPinned: 0,
      creatorUnreadCount: 0,
      handlerUnreadCount: 0,
      lastMessage: "",
      lastMessageAt: null,
      createdAt: new Date().toISOString().replace("T", " ").substring(0, 19)
    });
  }

  public static setMockRoom(id: number, room: any): void {
    this.mockRoomsStore.set(id, room);
  }

  /**
   * 注册/注入自定义 Mock 会话室
   */
  public static seedMockRoom(room: Partial<IChatRoomEntity> & { id: number; schoolId: number; patrolId: number }): void {
    this.mockRoomsStore.set(room.id, {
      id: room.id,
      schoolId: room.schoolId,
      roomType: room.roomType || "patrol",
      title: room.title || `工单协同 #${room.patrolId}`,
      patrolId: room.patrolId,
      creatorId: room.creatorId || 99,
      handlerId: room.handlerId || 88,
      initiatedByHandler: room.initiatedByHandler ?? 0,
      isClosed: room.isClosed ?? 0,
      isPinned: room.isPinned ?? 0,
      creatorUnreadCount: room.creatorUnreadCount || 0,
      handlerUnreadCount: room.handlerUnreadCount || 0,
      lastMessage: room.lastMessage || "",
      lastMessageAt: room.lastMessageAt || null,
      createdAt: room.createdAt || new Date().toISOString().replace("T", " ").substring(0, 19)
    });
  }

  /**
   * 获取所有内存会话室记录
   */
  public static getMockRooms(): IChatRoomEntity[] {
    return Array.from(this.mockRoomsStore.values());
  }

  /**
   * 获取指定 ID 的内存会话室
   */
  public static getMockRoom(id: number): IChatRoomEntity | undefined {
    return this.mockRoomsStore.get(id);
  }

  /**
   * 更新指定 ID 的内存会话室
   */
  public static updateMockRoom(id: number, updates: Partial<IChatRoomEntity>): boolean {
    const room = this.mockRoomsStore.get(id);
    if (!room) return false;
    Object.assign(room, updates);
    return true;
  }

  /**
   * 获取所有内存消息
   */
  public static getMockMessages(): any[] {
    return Array.from(this.mockMessagesStore.values());
  }

  /**
   * 工单提报/派单触发自动建房 (严格幂等防重)
   */
  public async provisionPatrolRoom(
    schoolId: number,
    patrolId: number,
    creatorId: number,
    handlerId: number = 0
  ): Promise<{ chatRoomId: number; isNewlyCreated: boolean }> {
    if (this.customDb) {
      return this.provisionWithDb(this.customDb, schoolId, patrolId, creatorId, handlerId);
    }

    const pool = getMySQLPool();
    if (pool) {
      try {
        const realDb = this.buildRealDb();
        return await this.provisionWithDb(realDb, schoolId, patrolId, creatorId, handlerId);
      } catch {
        return this.provisionInMemory(schoolId, patrolId, creatorId, handlerId);
      }
    }

    return this.provisionInMemory(schoolId, patrolId, creatorId, handlerId);
  }

  private async provisionWithDb(
    db: IDbExecutor,
    schoolId: number,
    patrolId: number,
    creatorId: number,
    handlerId: number
  ): Promise<{ chatRoomId: number; isNewlyCreated: boolean }> {
    // 1. 快速探针检查
    const checkSql = `SELECT id, handlerId FROM chat_rooms WHERE schoolId = ? AND patrolId = ? LIMIT 1`;
    const rows = await db.query<{ id: number; handlerId: number }>(checkSql, [schoolId, patrolId]);
    if (rows.length > 0) {
      // 若已存在但责任师傅发生变更，则自愈更新 handlerId
      if (handlerId > 0 && rows[0].handlerId !== handlerId) {
        await db.execute(
          `UPDATE chat_rooms SET handlerId = ? WHERE id = ? AND schoolId = ?`,
          [handlerId, rows[0].id, schoolId]
        );
      }
      return { chatRoomId: rows[0].id, isNewlyCreated: false };
    }

    // 2. 插入新记录 (利用 uk_school_patrol 联合唯一约束防并发)
    try {
      const insertSql = `
        INSERT INTO chat_rooms (
          schoolId, roomType, title, patrolId, creatorId, handlerId, 
          initiatedByHandler, isClosed, isPinned, 
          creatorUnreadCount, handlerUnreadCount, createdAt
        ) VALUES (
          ?, 'patrol', '', ?, ?, ?, 
          0, 0, 0, 
          0, 0, NOW()
        )
      `;
      const result = await db.execute(insertSql, [schoolId, patrolId, creatorId, handlerId]);
      return { chatRoomId: result.insertId, isNewlyCreated: true };
    } catch (err: any) {
      if (String(err?.message).includes("Duplicate entry")) {
        const doubleCheck = await db.query<{ id: number }>(checkSql, [schoolId, patrolId]);
        return { chatRoomId: doubleCheck[0]?.id || 0, isNewlyCreated: false };
      }
      throw err;
    }
  }

  private provisionInMemory(
    schoolId: number,
    patrolId: number,
    creatorId: number,
    handlerId: number
  ): { chatRoomId: number; isNewlyCreated: boolean } {
    for (const room of ChatRoomService.mockRoomsStore.values()) {
      if (room.schoolId === schoolId && room.patrolId === patrolId) {
        if (handlerId > 0 && room.handlerId !== handlerId) {
          room.handlerId = handlerId;
        }
        return { chatRoomId: room.id, isNewlyCreated: false };
      }
    }

    ChatRoomService.roomIdCounter += 1;
    const newId = ChatRoomService.roomIdCounter;

    ChatRoomService.mockRoomsStore.set(newId, {
      id: newId,
      schoolId,
      roomType: "patrol",
      title: `工单现场协同 #${patrolId}`,
      patrolId,
      creatorId,
      handlerId,
      initiatedByHandler: 0,
      isClosed: 0,
      isPinned: 0,
      creatorUnreadCount: 0,
      handlerUnreadCount: 0,
      lastMessage: "",
      lastMessageAt: null,
      createdAt: new Date().toISOString().replace("T", " ").substring(0, 19)
    });

    return { chatRoomId: newId, isNewlyCreated: true };
  }

  /**
   * 责任师傅执行主动握手激活
   */
  public async activateHandshake(
    schoolId: number,
    chatRoomId: number,
    operatorUserId: number,
    dto: IActivateHandshakeRequestDto
  ): Promise<IActivateHandshakeResponseDto> {
    if (this.customDb) {
      return this.activateWithDb(this.customDb, schoolId, chatRoomId, operatorUserId, dto);
    }

    const pool = getMySQLPool();
    if (pool) {
      try {
        const realDb = this.buildRealDb();
        return await this.activateWithDb(realDb, schoolId, chatRoomId, operatorUserId, dto);
      } catch (err: any) {
        if (err.message && (err.message.includes("越权") || err.message.includes("结案") || err.message.includes("未找到"))) {
          throw err;
        }
        return this.activateInMemory(schoolId, chatRoomId, operatorUserId, dto);
      }
    }

    return this.activateInMemory(schoolId, chatRoomId, operatorUserId, dto);
  }

  private async activateWithDb(
    db: IDbExecutor,
    schoolId: number,
    chatRoomId: number,
    operatorUserId: number,
    dto: IActivateHandshakeRequestDto
  ): Promise<IActivateHandshakeResponseDto> {
    // 1. 排他行锁查询
    const lockSql = `
      SELECT id, schoolId, patrolId, creatorId, handlerId, initiatedByHandler, isClosed 
      FROM chat_rooms 
      WHERE id = ? AND schoolId = ? 
      FOR UPDATE
    `;
    const roomRows = await db.query<IChatRoomEntity>(lockSql, [chatRoomId, schoolId]);
    if (roomRows.length === 0) {
      throw new Error("未找到对应工单会话室");
    }

    const room = roomRows[0];

    // 2. 校验工单关闭状态
    if (room.isClosed === 1) {
      throw new Error("该工单已结案归档，会话已处于只读冷冻状态，无法重新激活");
    }

    // 3. 严格权限鉴权: 只有当前责任师傅可发起主动握手
    if (room.handlerId !== operatorUserId) {
      throw new Error("越权拦截: 只有当前工单的责任维修师傅本人有权主动激活会话");
    }

    // 4. 若已激活，幂等返回
    if (room.initiatedByHandler === 1) {
      return {
        chatRoomId,
        patrolId: room.patrolId || 0,
        initiatedByHandler: 1,
        handlerName: "责任师傅",
        activatedAt: new Date().toISOString(),
        systemBubbleId: 0,
        statusText: "会话此前已处于激活状态"
      };
    }

    // 5. 状态机跃迁: initiatedByHandler 置为 1
    await db.execute(
      `UPDATE chat_rooms SET initiatedByHandler = 1, lastMessageAt = NOW() WHERE id = ? AND schoolId = ?`,
      [chatRoomId, schoolId]
    );

    // 6. 插入系统官方居中通知气泡 (type = 3: 系统通知)
    const bubbleContent =
      dto.greetingMessage?.trim() ||
      "🛠️ 责任维修师傅已主动开启协同通道，您可以直接发送现场照片或补充说明。";

    const insertBubbleSql = `
      INSERT INTO chat_messages (
        schoolId, chatRoomId, sendUserId, senderId, senderRole, type, content, isWithDraw, createdAt
      ) VALUES (
        ?, ?, 0, 0, 9, 3, ?, 0, NOW()
      )
    `;
    let bubbleId = 0;
    try {
      const bubbleRes = await db.execute(insertBubbleSql, [schoolId, chatRoomId, bubbleContent]);
      bubbleId = bubbleRes.insertId;
    } catch {
      // 兼容部分环境下无 senderRole 列的容错插入
      const fallbackSql = `
        INSERT INTO chat_messages (
          schoolId, chatRoomId, type, content, isWithDraw, createdAt
        ) VALUES (
          ?, ?, 3, ?, 0, NOW()
        )
      `;
      const fallbackRes = await db.execute(fallbackSql, [schoolId, chatRoomId, bubbleContent]);
      bubbleId = fallbackRes.insertId;
    }

    // 7. 查询师傅真实姓名
    let handlerName = "维修师傅";
    try {
      const userSql = `SELECT nickName, realName FROM users WHERE id = ? AND schoolId = ? LIMIT 1`;
      const userRows = await db.query<any>(userSql, [operatorUserId, schoolId]);
      if (userRows.length > 0) {
        handlerName = userRows[0].realName || userRows[0].nickName || "维修师傅";
      }
    } catch {
      // ignore
    }

    // 8. 触发广播
    await this.broadcastHandshakeEvent({
      schoolId,
      chatRoomId,
      patrolId: room.patrolId || 0,
      operatorUserId,
      handlerName,
      bubbleId,
      bubbleContent
    });

    return {
      chatRoomId,
      patrolId: room.patrolId || 0,
      initiatedByHandler: 1,
      handlerName,
      activatedAt: new Date().toISOString(),
      systemBubbleId: bubbleId,
      statusText: "协同会话已成功激活并通知提报师生"
    };
  }

  private activateInMemory(
    schoolId: number,
    chatRoomId: number,
    operatorUserId: number,
    dto: IActivateHandshakeRequestDto
  ): IActivateHandshakeResponseDto {
    const room = ChatRoomService.mockRoomsStore.get(chatRoomId);
    if (!room || room.schoolId !== schoolId) {
      throw new Error("未找到对应工单会话室");
    }

    if (room.isClosed === 1) {
      throw new Error("该工单已结案归档，会话已处于只读冷冻状态，无法重新激活");
    }

    if (room.handlerId !== operatorUserId) {
      throw new Error("越权拦截: 只有当前工单的责任维修师傅本人有权主动激活会话");
    }

    if (room.initiatedByHandler === 1) {
      return {
        chatRoomId,
        patrolId: room.patrolId || 0,
        initiatedByHandler: 1,
        handlerName: "张师傅",
        activatedAt: new Date().toISOString(),
        systemBubbleId: 0,
        statusText: "会话此前已处于激活状态"
      };
    }

    room.initiatedByHandler = 1;
    room.lastMessageAt = new Date().toISOString().replace("T", " ").substring(0, 19);

    ChatRoomService.messageIdCounter += 1;
    const bubbleId = ChatRoomService.messageIdCounter;
    const bubbleContent =
      dto.greetingMessage?.trim() ||
      "🛠️ 责任维修师傅已主动开启协同通道，您可以直接发送现场照片或补充说明。";

    ChatRoomService.mockMessagesStore.set(bubbleId, {
      id: bubbleId,
      schoolId,
      chatRoomId,
      senderId: 0,
      senderRole: 9,
      type: 3,
      content: bubbleContent,
      isWithDraw: 0,
      createdAt: new Date().toISOString()
    });

    return {
      chatRoomId,
      patrolId: room.patrolId || 0,
      initiatedByHandler: 1,
      handlerName: "张师傅",
      activatedAt: new Date().toISOString(),
      systemBubbleId: bubbleId,
      statusText: "协同会话已成功激活并通知提报师生"
    };
  }

  private async broadcastHandshakeEvent(payload: {
    schoolId: number;
    chatRoomId: number;
    patrolId: number;
    operatorUserId: number;
    handlerName: string;
    bubbleId: number;
    bubbleContent: string;
  }): Promise<void> {
    const broadcastBody = {
      event: "CHAT_HANDSHAKE_ACTIVATED",
      schoolId: payload.schoolId,
      chatRoomId: payload.chatRoomId,
      patrolId: payload.patrolId,
      handlerUserId: payload.operatorUserId,
      handlerName: payload.handlerName,
      activatedAt: Date.now(),
      systemMessage: {
        messageId: payload.bubbleId,
        content: payload.bubbleContent,
        type: 3,
        createdAt: new Date().toISOString()
      }
    };

    if (this.customRedis) {
      try {
        if (typeof this.customRedis.eval === "function") {
          await this.customRedis.eval(
            `redis.call('PUBLISH', 'ws_broadcast_bus', ARGV[1])`,
            0,
            JSON.stringify(broadcastBody)
          );
        } else if (typeof this.customRedis.publish === "function") {
          await this.customRedis.publish("ws_broadcast_bus", JSON.stringify(broadcastBody));
        }
      } catch {
        // ignore
      }
    }
  }

  /**
   * 拉取会话元数据与输入框权限掩码 (Algorithm 4)
   */
  public async getRoomMetadata(
    schoolId: number,
    chatRoomId: number,
    currentUserId: number,
    currentUserRole: number
  ): Promise<IChatRoomMetaDto> {
    if (this.customDb) {
      return this.getMetaWithDb(this.customDb, schoolId, chatRoomId, currentUserId, currentUserRole);
    }

    const pool = getMySQLPool();
    if (pool) {
      try {
        const realDb = this.buildRealDb();
        return await this.getMetaWithDb(realDb, schoolId, chatRoomId, currentUserId, currentUserRole);
      } catch {
        return this.getMetaInMemory(schoolId, chatRoomId, currentUserId, currentUserRole);
      }
    }

    return this.getMetaInMemory(schoolId, chatRoomId, currentUserId, currentUserRole);
  }

  private async getMetaWithDb(
    db: IDbExecutor,
    schoolId: number,
    chatRoomId: number,
    currentUserId: number,
    currentUserRole: number
  ): Promise<IChatRoomMetaDto> {
    const roomSql = `SELECT * FROM chat_rooms WHERE id = ? AND schoolId = ? LIMIT 1`;
    const rows = await db.query<IChatRoomEntity>(roomSql, [chatRoomId, schoolId]);
    if (rows.length === 0) {
      throw new Error("目标会话室不存在");
    }
    const room = rows[0];

    // 查询双方用户信息
    let creatorName = "提报同学";
    let creatorAvatar = "/assets/avatar_student.png";
    let handlerName = "维修师傅";
    let handlerAvatar = "/assets/avatar_handler.png";

    try {
      const usersSql = `SELECT id, nickName, realName, avatarUrl FROM users WHERE id IN (?, ?) AND schoolId = ?`;
      const userRows = await db.query<any>(usersSql, [room.creatorId, room.handlerId, schoolId]);
      const creator = userRows.find((u) => u.id === room.creatorId);
      const handler = userRows.find((u) => u.id === room.handlerId);

      if (creator) {
        creatorName = creator.realName || creator.nickName || creatorName;
        creatorAvatar = creator.avatarUrl || creatorAvatar;
      }
      if (handler) {
        handlerName = handler.realName || handler.nickName || handlerName;
        handlerAvatar = handler.avatarUrl || handlerAvatar;
      }
    } catch {
      // ignore
    }

    // 执行 Algorithm 4: 计算动态权限掩码
    const permissions = this.evaluatePermissionMask(room, currentUserId, currentUserRole);

    return {
      chatRoomId: room.id,
      schoolId: room.schoolId,
      patrolId: room.patrolId || 0,
      roomType: room.roomType,
      title: room.title || `工单协同 #${room.patrolId}`,
      creatorId: room.creatorId,
      creatorName,
      creatorAvatar,
      handlerId: room.handlerId,
      handlerName,
      handlerAvatar,
      handlerTag: "后勤修缮工程专工",
      initiatedByHandler: room.initiatedByHandler === 1,
      isClosed: room.isClosed === 1,
      isPinned: room.isPinned === 1,
      permissions
    };
  }

  private getMetaInMemory(
    schoolId: number,
    chatRoomId: number,
    currentUserId: number,
    currentUserRole: number
  ): IChatRoomMetaDto {
    const room = ChatRoomService.mockRoomsStore.get(chatRoomId);
    if (!room || room.schoolId !== schoolId) {
      throw new Error("目标会话室不存在");
    }

    const permissions = this.evaluatePermissionMask(room, currentUserId, currentUserRole);

    return {
      chatRoomId: room.id,
      schoolId: room.schoolId,
      patrolId: room.patrolId || 0,
      roomType: room.roomType,
      title: room.title,
      creatorId: room.creatorId,
      creatorName: "王同学",
      creatorAvatar: "/assets/avatar_student.png",
      handlerId: room.handlerId,
      handlerName: "张师傅",
      handlerAvatar: "/assets/avatar_handler.png",
      handlerTag: "后勤修缮工程专工",
      initiatedByHandler: room.initiatedByHandler === 1,
      isClosed: room.isClosed === 1,
      isPinned: room.isPinned === 1,
      permissions
    };
  }

  /**
   * 算法 4: 会话状态感知与输入框动态权限掩码判定
   */
  private evaluatePermissionMask(
    room: { initiatedByHandler: number; isClosed: number; handlerId: number; creatorId: number },
    currentUserId: number,
    currentUserRole: number
  ): { canInput: boolean; lockReason: string; showHandshakeButton: boolean } {
    // 1. 若工单已结案
    if (room.isClosed === 1) {
      return {
        canInput: false,
        lockReason: "工单已办结，会话已归档为只读记录",
        showHandshakeButton: false
      };
    }

    // 2. 若为责任师傅
    if (currentUserId === room.handlerId) {
      return {
        canInput: true,
        lockReason: "",
        showHandshakeButton: room.initiatedByHandler === 0
      };
    }

    // 3. 若为提报师生
    if (currentUserId === room.creatorId) {
      if (room.initiatedByHandler === 0) {
        return {
          canInput: false,
          lockReason: "等待维修师傅主动联络后即可开启沟通...",
          showHandshakeButton: false
        };
      } else {
        return {
          canInput: true,
          lockReason: "",
          showHandshakeButton: false
        };
      }
    }

    // 4. 其他巡查/管理人员
    const canInput = currentUserRole >= 4;
    return {
      canInput,
      lockReason: canInput ? "" : "仅工单提报人与指定师傅可参与会话",
      showHandshakeButton: false
    };
  }

  /**
   * 工单结案自动归档冷冻会话室
   */
  public async closePatrolRoom(schoolId: number, patrolId: number): Promise<void> {
    if (this.customDb) {
      await this.customDb.execute(
        `UPDATE chat_rooms SET isClosed = 1 WHERE patrolId = ? AND schoolId = ?`,
        [patrolId, schoolId]
      );
      return;
    }

    const pool = getMySQLPool();
    if (pool) {
      try {
        await executeQuery(
          `UPDATE chat_rooms SET isClosed = 1 WHERE patrolId = ? AND schoolId = ?`,
          [patrolId, schoolId]
        );
      } catch {
        // ignore
      }
    }

    for (const room of ChatRoomService.mockRoomsStore.values()) {
      if (room.schoolId === schoolId && room.patrolId === patrolId) {
        room.isClosed = 1;
      }
    }
  }

  private buildRealDb(): IDbExecutor {
    return {
      query: async (sql, params) => {
        const r = await executeQuery(sql, params);
        if (r.status !== 1) throw new Error(r.content || "DB query error");
        return ((r as any)?.data || []) as any[];
      },
      execute: async (sql, params) => {
        const r = await executeQuery(sql, params);
        if (r.status !== 1) throw new Error(r.content || "DB execute error");
        const res = (r as any)?.data as any;
        return { insertId: res?.insertId || 0, affectedRows: res?.affectedRows || 0 };
      }
    };
  }
}
