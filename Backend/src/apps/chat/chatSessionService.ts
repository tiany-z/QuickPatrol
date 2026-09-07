/**
 * 高校后勤巡查e速办 v4.0 - M40: 视口停留已读瞬间消除与工单置顶排序大盘核心服务
 * (Chat Session Service)
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import { RedisWsBridge } from "../../ws/redisWsBridge.js";
import { ChatRoomService } from "./chatRoomService.js";
import { ChatService } from "./chatService.js";
import { ChatGroupService } from "./chatGroupService.js";
import { NineGridAvatarCompositor } from "./nineGridAvatarCompositor.js";
import {
  IChatSessionItemDto,
  IAckReadResponseDto,
  IToggleSessionPinResponseDto,
  IReadAckWsBroadcast
} from "./chatSessionTypes.js";
import { StickyPriorityWeightedSorter } from "./stickyPriorityWeightedSorter.js";

export interface IDbExecutor {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
}

export interface IRedisPublisher {
  eval?(script: string, numkeys: number, ...args: any[]): Promise<any>;
  publish?(channel: string, message: string): Promise<number>;
}

export class ChatSessionService {
  /**
   * 内存沙箱置顶映射：key = `${schoolId}_${userId}_${chatRoomId}`
   */
  private static mockPinsStore: Map<string, { schoolId: number; userId: number; chatRoomId: number; createdAt: string }> = new Map();

  constructor(
    private readonly customDb?: IDbExecutor,
    private readonly customRedis?: IRedisPublisher
  ) {}

  /**
   * 清理沙箱置顶数据与状态
   */
  public static resetMockData(): void {
    this.mockPinsStore.clear();
  }

  /**
   * 静态快捷入口: 查询会话列表
   */
  public static async getUserSessions(
    schoolId: number,
    userId: number,
    userRole: number = 0
  ): Promise<IChatSessionItemDto[]> {
    const service = new ChatSessionService();
    return service.getUserSessions(schoolId, userId, userRole);
  }

  /**
   * 查询当前用户专属的会话大盘列表 (驱动 Tab 1 消息中枢)
   */
  public async getUserSessions(
    schoolId: number,
    userId: number,
    userRole: number
  ): Promise<IChatSessionItemDto[]> {
    if (this.customDb) {
      const sql = `
        SELECT 
          v.*,
          IF(pin.id IS NOT NULL, 1, 0) AS isPinned
        FROM v_chat_sessions v
        LEFT JOIN chat_room_pins pin 
          ON pin.chatRoomId = v.chatRoomId 
          AND pin.userId = ? 
          AND pin.schoolId = v.schoolId
        WHERE v.schoolId = ? 
          AND (v.creatorId = ? OR v.handlerId = ?)
      `;
      const rawRows = await this.customDb.query<any>(sql, [userId, schoolId, userId, userId]);
      const dtoList = this.mapDbRowsToDto(rawRows, userId);
      return StickyPriorityWeightedSorter.sort(dtoList);
    }

    if (getMySQLPool()) {
      const sql = `
        SELECT 
          v.*,
          IF(pin.id IS NOT NULL, 1, 0) AS isPinned
        FROM v_chat_sessions v
        LEFT JOIN chat_room_pins pin 
          ON pin.chatRoomId = v.chatRoomId 
          AND pin.userId = ? 
          AND pin.schoolId = v.schoolId
        WHERE v.schoolId = ? 
          AND (v.creatorId = ? OR v.handlerId = ?)
      `;
      const res: any = await executeQuery<any[]>(sql, [userId, schoolId, userId, userId]);
      const rawRows = (res.status === 1 && res.data) ? res.data : [];
      const dtoList = this.mapDbRowsToDto(rawRows, userId);
      return StickyPriorityWeightedSorter.sort(dtoList);
    }

    // 内存沙箱检索逻辑
    const roomMap = new Map<number, any>();
    for (const r of ChatRoomService.getMockRooms()) {
      roomMap.set(r.id, { ...r });
    }
    for (const r of ChatService.getAllMockRooms()) {
      if (!roomMap.has(r.id)) {
        roomMap.set(r.id, { ...r });
      } else {
        const existing = roomMap.get(r.id);
        if (r.lastMessage) existing.lastMessage = r.lastMessage;
        if (r.lastMessageAt) existing.lastMessageAt = r.lastMessageAt;
        if (r.creatorUnreadCount !== undefined) existing.creatorUnreadCount = r.creatorUnreadCount;
        if (r.handlerUnreadCount !== undefined) existing.handlerUnreadCount = r.handlerUnreadCount;
        if (r.isPinned !== undefined) existing.isPinned = r.isPinned;
        if (r.isClosed !== undefined) existing.isClosed = r.isClosed;
        if (r.initiatedByHandler !== undefined) existing.initiatedByHandler = r.initiatedByHandler;
      }
    }
    for (const gr of ChatGroupService.getMockGroupRooms()) {
      roomMap.set(gr.id, { ...gr });
    }

    const allRooms = Array.from(roomMap.values()).filter(
      (r) => r.schoolId === schoolId && (r.creatorId === userId || r.handlerId === userId || r.roomType === "group")
    );

    const dtoList: IChatSessionItemDto[] = allRooms.map((room) => {
      const isGroup = room.roomType === "group";
      const isUserCreator = (room.creatorId === userId);
      const unreadCount = isUserCreator ? (room.creatorUnreadCount || 0) : (room.handlerUnreadCount || 0);

      const targetPeerName = isGroup
        ? (room.title || "科室工作群")
        : (isUserCreator ? (room.handlerId > 0 ? "维修师傅" : "待认领师傅") : "报修师生");

      const targetPeerAvatar = isGroup
        ? NineGridAvatarCompositor.generateNineGridSvg()
        : (isUserCreator ? "/assets/avatar_handler.png" : "/assets/avatar_student.png");

      const targetPeerRoleTag = isGroup
        ? (room.patrolId ? "抢险群" : "工作群")
        : (isUserCreator ? "主责师傅" : "报修师生");

      const pinKey = `${schoolId}_${userId}_${room.id}`;
      const isPinned = ChatSessionService.mockPinsStore.has(pinKey) || (room.isPinned === 1);

      const lastAt = room.lastMessageAt || room.createdAt;

      return {
        chatRoomId: room.id,
        patrolId: room.patrolId || 0,
        patrolOrderNo: isGroup ? (room.patrolId ? `QX${room.patrolId}` : `GRP${room.id}`) : `XC${room.patrolId || room.id}`,
        patrolStatus: room.isClosed === 1 ? 4 : 1,
        patrolStatusName: room.isClosed === 1 ? "已办结" : (isGroup ? "协同中" : "维修中"),
        targetPeerName,
        targetPeerAvatar,
        targetPeerRoleTag,
        locationName: isGroup ? "多部门群聊" : "校园现场",
        lastMessage: room.lastMessage || "[暂无沟通记录]",
        lastMessageAt: lastAt,
        formattedTimeText: this.formatHumanFriendlyTime(lastAt),
        unreadCount: Math.max(0, unreadCount),
        isPinned
      };
    });

    return StickyPriorityWeightedSorter.sort(dtoList);
  }

  /**
   * 算法 1 驱动: 视口停留满 300ms 原子消除未读红点
   */
  public async ackRoomRead(
    schoolId: number,
    chatRoomId: number,
    userId: number
  ): Promise<IAckReadResponseDto> {
    let isCreator = false;
    let isHandler = false;
    let oldUnread = 0;

    if (this.customDb) {
      const roomSql = `
        SELECT creatorId, handlerId, creatorUnreadCount, handlerUnreadCount 
        FROM chat_rooms 
        WHERE id = ? AND schoolId = ? 
        LIMIT 1
      `;
      const roomRows = await this.customDb.query<any>(roomSql, [chatRoomId, schoolId]);
      if (!roomRows || roomRows.length === 0) {
        throw new Error("指定会话不存在或已被归档");
      }

      const room = roomRows[0];
      isCreator = (room.creatorId === userId);
      isHandler = (room.handlerId === userId);

      if (!isCreator && !isHandler) {
        throw new Error("越权阻断: 您并非该工单会话的参与人");
      }

      const unreadCol = isCreator ? "creatorUnreadCount" : "handlerUnreadCount";
      oldUnread = isCreator ? room.creatorUnreadCount : room.handlerUnreadCount;

      const updateSql = `
        UPDATE chat_rooms 
        SET ${unreadCol} = 0 
        WHERE id = ? AND schoolId = ?
      `;
      await this.customDb.execute(updateSql, [chatRoomId, schoolId]);
    } else if (getMySQLPool()) {
      const roomSql = `
        SELECT creatorId, handlerId, creatorUnreadCount, handlerUnreadCount 
        FROM chat_rooms 
        WHERE id = ? AND schoolId = ? 
        LIMIT 1
      `;
      const res: any = await executeQuery<any[]>(roomSql, [chatRoomId, schoolId]);
      const roomRows = (res.status === 1 && res.data) ? res.data : [];
      if (!roomRows || roomRows.length === 0) {
        throw new Error("指定会话不存在或已被归档");
      }

      const room = roomRows[0];
      isCreator = (room.creatorId === userId);
      isHandler = (room.handlerId === userId);

      if (!isCreator && !isHandler) {
        throw new Error("越权阻断: 您并非该工单会话的参与人");
      }

      const unreadCol = isCreator ? "creatorUnreadCount" : "handlerUnreadCount";
      oldUnread = isCreator ? room.creatorUnreadCount : room.handlerUnreadCount;

      const updateSql = `
        UPDATE chat_rooms 
        SET ${unreadCol} = 0 
        WHERE id = ? AND schoolId = ?
      `;
      await executeQuery(updateSql, [chatRoomId, schoolId]);
    } else {
      // 内存沙箱
      const room = ChatRoomService.getMockRoom(chatRoomId) || (ChatService.getMockRoom(chatRoomId) as any);
      if (!room || room.schoolId !== schoolId) {
        throw new Error("指定会话不存在或已被归档");
      }

      isCreator = (room.creatorId === userId);
      isHandler = (room.handlerId === userId);

      if (!isCreator && !isHandler) {
        throw new Error("越权阻断: 您并非该工单会话的参与人");
      }

      if (isCreator) {
        oldUnread = room.creatorUnreadCount || 0;
        room.creatorUnreadCount = 0;
      } else {
        oldUnread = room.handlerUnreadCount || 0;
        room.handlerUnreadCount = 0;
      }

      const csRoom = ChatService.getMockRoom(chatRoomId);
      if (csRoom) {
        if (isCreator) csRoom.creatorUnreadCount = 0;
        else csRoom.handlerUnreadCount = 0;
      }
    }

    // 统计该用户剩余的总未读数 (算法 3)
    const remainingTotal = await this.calculateUserTotalUnread(schoolId, userId);

    // 广播 CHAT_ROOM_READ_CLEARED 信令
    const broadcastPayload: IReadAckWsBroadcast = {
      event: "CHAT_ROOM_READ_CLEARED",
      schoolId,
      chatRoomId,
      userId,
      clearedUnreadCount: oldUnread,
      remainingTotalUnread: remainingTotal
    };

    if (this.customRedis?.eval) {
      try {
        await this.customRedis.eval(
          `redis.call('PUBLISH', 'ws_broadcast_bus', ARGV[1])`,
          0,
          JSON.stringify(broadcastPayload)
        );
      } catch {
        // 忽略广播错误
      }
    } else {
      try {
        await RedisWsBridge.broadcast("ws:cluster:broadcast", schoolId, broadcastPayload);
      } catch {
        // 忽略静默
      }
    }

    return {
      code: 200,
      message: "未读数已成功清零",
      data: {
        chatRoomId,
        clearedCount: oldUnread,
        remainingTotalUnread: remainingTotal,
        clearedAt: new Date().toISOString()
      }
    };
  }

  /**
   * 切换个人置顶状态 (Pin / Unpin)
   */
  public async toggleSessionPin(
    schoolId: number,
    userId: number,
    chatRoomId: number,
    pin: boolean
  ): Promise<IToggleSessionPinResponseDto> {
    if (this.customDb) {
      if (pin) {
        const pinSql = `
          INSERT INTO chat_room_pins (schoolId, userId, chatRoomId, createdAt)
          VALUES (?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE createdAt = NOW()
        `;
        await this.customDb.execute(pinSql, [schoolId, userId, chatRoomId]);
      } else {
        const unpinSql = `
          DELETE FROM chat_room_pins 
          WHERE schoolId = ? AND userId = ? AND chatRoomId = ?
        `;
        await this.customDb.execute(unpinSql, [schoolId, userId, chatRoomId]);
      }
    } else if (getMySQLPool()) {
      if (pin) {
        const pinSql = `
          INSERT INTO chat_room_pins (schoolId, userId, chatRoomId, createdAt)
          VALUES (?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE createdAt = NOW()
        `;
        await executeQuery(pinSql, [schoolId, userId, chatRoomId]);
      } else {
        const unpinSql = `
          DELETE FROM chat_room_pins 
          WHERE schoolId = ? AND userId = ? AND chatRoomId = ?
        `;
        await executeQuery(unpinSql, [schoolId, userId, chatRoomId]);
      }
    } else {
      // 内存沙箱
      const pinKey = `${schoolId}_${userId}_${chatRoomId}`;
      if (pin) {
        ChatSessionService.mockPinsStore.set(pinKey, {
          schoolId,
          userId,
          chatRoomId,
          createdAt: new Date().toISOString()
        });
      } else {
        ChatSessionService.mockPinsStore.delete(pinKey);
      }

      // 如果有 mock room 也同步其 isPinned
      const room = ChatRoomService.getMockRoom(chatRoomId) || (ChatService.getMockRoom(chatRoomId) as any);
      if (room) {
        room.isPinned = pin ? 1 : 0;
      }
      const csRoom = ChatService.getMockRoom(chatRoomId);
      if (csRoom) {
        csRoom.isPinned = pin ? 1 : 0;
      }
    }

    return {
      code: 200,
      message: pin ? "已成功置顶会话" : "已取消置顶会话",
      data: {
        chatRoomId,
        isPinned: pin,
        updatedAt: new Date().toISOString()
      }
    };
  }

  /**
   * 计算指定用户的全局未读总数 (算法 3)
   */
  public async calculateUserTotalUnread(schoolId: number, userId: number): Promise<number> {
    if (this.customDb) {
      const sumSql = `
        SELECT 
          SUM(IF(creatorId = ?, creatorUnreadCount, 0)) +
          SUM(IF(handlerId = ?, handlerUnreadCount, 0)) AS totalUnread
        FROM chat_rooms
        WHERE schoolId = ? AND (creatorId = ? OR handlerId = ?)
      `;
      const rows = await this.customDb.query<{ totalUnread: number | string }>(sumSql, [
        userId,
        userId,
        schoolId,
        userId,
        userId
      ]);
      const total = parseInt(String(rows[0]?.totalUnread || "0"), 10);
      return Math.max(0, isNaN(total) ? 0 : total);
    }

    if (getMySQLPool()) {
      const sumSql = `
        SELECT 
          SUM(IF(creatorId = ?, creatorUnreadCount, 0)) +
          SUM(IF(handlerId = ?, handlerUnreadCount, 0)) AS totalUnread
        FROM chat_rooms
        WHERE schoolId = ? AND (creatorId = ? OR handlerId = ?)
      `;
      const res: any = await executeQuery<any[]>(sumSql, [
        userId,
        userId,
        schoolId,
        userId,
        userId
      ]);
      const rows = (res.status === 1 && res.data) ? res.data : [];
      const total = parseInt(String(rows[0]?.totalUnread || "0"), 10);
      return Math.max(0, isNaN(total) ? 0 : total);
    }

    // 内存沙箱
    let total = 0;
    const roomMap = new Map<number, any>();
    for (const r of ChatRoomService.getMockRooms()) {
      roomMap.set(r.id, r);
    }
    for (const r of ChatService.getAllMockRooms()) {
      if (!roomMap.has(r.id)) {
        roomMap.set(r.id, r);
      } else {
        const existing = roomMap.get(r.id);
        if (r.creatorUnreadCount !== undefined) existing.creatorUnreadCount = r.creatorUnreadCount;
        if (r.handlerUnreadCount !== undefined) existing.handlerUnreadCount = r.handlerUnreadCount;
      }
    }
    const rooms = Array.from(roomMap.values()).filter(
      (r) => r.schoolId === schoolId && (r.creatorId === userId || r.handlerId === userId)
    );
    for (const r of rooms) {
      if (r.creatorId === userId) total += (r.creatorUnreadCount || 0);
      if (r.handlerId === userId) total += (r.handlerUnreadCount || 0);
    }
    return total;
  }

  private mapDbRowsToDto(rawRows: any[], userId: number): IChatSessionItemDto[] {
    return rawRows.map((row) => {
      const isUserCreator = (row.creatorId === userId || row.creatorUserId === userId);
      const unreadCount = isUserCreator ? row.creatorUnreadCount : row.handlerUnreadCount;
      const targetPeerName = isUserCreator
        ? (row.handlerName || row.handlerRealName || "待认领师傅")
        : (row.creatorName || row.creatorNickName || row.creatorRealName || "报修师生");
      const targetPeerAvatar = isUserCreator
        ? (row.handlerAvatar || "/assets/avatar_handler.png")
        : (row.creatorAvatar || row.creatorAvatarUrl || "/assets/avatar_student.png");
      const targetPeerRoleTag = isUserCreator ? "主责师傅" : "报修师生";

      const lastAt = row.lastMessageAt || row.roomCreatedAt || row.createdAt || new Date().toISOString();

      return {
        chatRoomId: row.chatRoomId || row.id,
        patrolId: row.patrolId,
        patrolOrderNo: row.patrolOrderNo || row.orderNo || `XC${row.patrolId}`,
        patrolStatus: typeof row.patrolStatus === "number" ? row.patrolStatus : (row.isClosed === 1 ? 4 : 1),
        patrolStatusName: this.resolvePatrolStatusName(row.patrolStatus ?? (row.isClosed === 1 ? 4 : 1)),
        targetPeerName,
        targetPeerAvatar,
        targetPeerRoleTag,
        locationName: row.patrolLocation || "校园现场",
        lastMessage: row.lastMessage || "[暂无沟通记录]",
        lastMessageAt: lastAt,
        formattedTimeText: this.formatHumanFriendlyTime(lastAt),
        unreadCount: Math.max(0, unreadCount || 0),
        isPinned: Boolean(row.isPinned)
      };
    });
  }

  private resolvePatrolStatusName(status: number): string {
    switch (status) {
      case 0: return "待接单";
      case 1: return "维修中";
      case 2: return "已延期";
      case 3: return "待复核";
      case 4: return "已办结";
      case 5: return "已评价";
      default: return "流转中";
    }
  }

  private formatHumanFriendlyTime(isoDateStr: string): string {
    if (!isoDateStr) return "";
    const date = new Date(isoDateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin}分钟前`;

    const isSameDay = (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    );
    if (isSameDay) {
      const h = String(date.getHours()).padStart(2, "0");
      const m = String(date.getMinutes()).padStart(2, "0");
      return `${h}:${m}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = (
      date.getFullYear() === yesterday.getFullYear() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getDate() === yesterday.getDate()
    );
    if (isYesterday) return "昨天";

    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${mm}-${dd}`;
  }
}
