/**
 * 高校后勤巡查e速办 v4.0 - M41: 科室工作群与突发险情应急抢险群聊中枢服务
 * (Chat Group Domain Service)
 * 
 * 核心职责：
 * 1. 科室常态群与突发险情抢险群创建 (泛型 chat_rooms 表, roomType = 'group')
 * 2. 群主身份原子确权与多部门成员批量装填
 * 3. 三级立体权限阶梯断言 (Owner=2, Admin=1, Member=0)
 * 4. 吸顶置顶公告发布、存储与实时扩散 (GROUP_NOTICE_PUBLISHED)
 * 5. 基于已读游标的 O(1) 滑动更新与零写放大未读计算
 * 6. 群主退群“防孤儿”熔断保护与只读归档状态机
 * 7. 离线单元测试沙箱正交隔离支持
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import { RedisWsBridge } from "../../ws/redisWsBridge.js";
import { WeChatAuthService } from "../../services/auth/wechatAuthService.js";
import {
  GroupMemberRole,
  IChatGroupRoomEntity,
  IChatGroupMemberEntity,
  ICreateGroupRequestDto,
  ICreateGroupResponseDto,
  IGroupMemberManageDto,
  IPublishGroupNoticeDto,
  IGroupNoticeDetailDto,
  IGroupReadCursorResponseDto,
  IGroupDetailDto,
  IGroupMemberItemDto,
  IGroupWsNoticePayload,
  IGroupWsForceEvictPayload
} from "./chatGroupTypes.js";
import { GroupReadCursorCalculator } from "./groupReadCursorCalculator.js";
import { NineGridAvatarCompositor } from "./nineGridAvatarCompositor.js";

export interface IDbExecutor {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
}

export interface IRedisPipelineClient {
  eval?(script: string, numkeys: number, ...args: any[]): Promise<any>;
  publish?(channel: string, message: string): Promise<number>;
}

export class ChatGroupService {
  // 内存沙箱隔离字典 (支持脱机纯内存单元测试)
  private static mockGroupRooms: Map<number, IChatGroupRoomEntity> = new Map();
  private static mockGroupMembers: Map<string, IChatGroupMemberEntity> = new Map();
  private static mockGroupNotices: Map<number, IGroupNoticeDetailDto> = new Map();
  private static roomIdSeq = 800;
  private static memberIdSeq = 2000;

  constructor(
    private readonly customDb?: IDbExecutor,
    private readonly customRedis?: IRedisPipelineClient
  ) {}

  /**
   * 重置内存沙箱桩点数据
   */
  public static resetMockData(): void {
    this.mockGroupRooms.clear();
    this.mockGroupMembers.clear();
    this.mockGroupNotices.clear();
    this.roomIdSeq = 800;
    this.memberIdSeq = 2000;
  }

  /**
   * 获取全部内存群聊房间
   */
  public static getMockGroupRooms(): IChatGroupRoomEntity[] {
    return Array.from(this.mockGroupRooms.values());
  }

  /**
   * 注册/注入自定义群聊房间
   */
  public static seedMockGroup(room: Partial<IChatGroupRoomEntity> & { id: number; schoolId: number }): void {
    this.mockGroupRooms.set(room.id, {
      id: room.id,
      schoolId: room.schoolId,
      roomType: "group",
      title: room.title || `科室工作群 #${room.id}`,
      patrolId: room.patrolId !== undefined ? room.patrolId : null,
      creatorId: room.creatorId || 101,
      handlerId: room.handlerId || 0,
      initiatedByHandler: 1,
      isClosed: (room.isClosed !== undefined ? room.isClosed : 0) as any,
      isPinned: (room.isPinned !== undefined ? room.isPinned : 0) as any,
      creatorUnreadCount: 0,
      handlerUnreadCount: 0,
      lastMessage: room.lastMessage || "[群聊已建立]",
      lastMessageAt: room.lastMessageAt || new Date().toISOString(),
      createdAt: room.createdAt || new Date().toISOString()
    });
  }

  /**
   * 注册/注入自定义群成员
   */
  public static seedMockMember(member: Partial<IChatGroupMemberEntity> & { schoolId: number; chatRoomId: number; userId: number }): void {
    const id = member.id || ++this.memberIdSeq;
    const key = `${member.schoolId}_${member.chatRoomId}_${member.userId}`;
    this.mockGroupMembers.set(key, {
      id,
      schoolId: member.schoolId,
      chatRoomId: member.chatRoomId,
      userId: member.userId,
      role: member.role !== undefined ? member.role : GroupMemberRole.MEMBER,
      nickInGroup: member.nickInGroup || "",
      joinedAt: member.joinedAt || new Date().toISOString(),
      lastReadMessageId: member.lastReadMessageId || 0,
      isMuted: member.isMuted || 0
    });
  }

  // =========================================================================
  // 业务核心接口
  // =========================================================================

  /**
   * 1. 创建科室工作群或突发险情应急抢险群
   */
  public async createGroup(
    schoolId: number,
    creatorId: number,
    dto: ICreateGroupRequestDto
  ): Promise<ICreateGroupResponseDto> {
    const { title, patrolId = null, memberUserIds = [], initialNotice } = dto;

    if (!title || title.trim().length === 0) {
      throw new Error("群聊名称不可为空");
    }

    const cleanTitle = title.trim();
    const nowIso = new Date().toISOString();
    const lastMsgSummary = initialNotice ? `[群公告] ${initialNotice.substring(0, 30)}` : "[群聊已建立]";

    // 过滤同租户成员，防止跨校越权拉人
    let validMemberIds: number[] = [];
    if (this.customDb) {
      const uniqueIds = Array.from(new Set(memberUserIds)).filter((id) => id !== creatorId);
      if (uniqueIds.length > 0) {
        const placeholders = uniqueIds.map(() => "?").join(",");
        const rows = await this.customDb.query<{ id: number }>(
          `SELECT id FROM users WHERE schoolId = ? AND id IN (${placeholders}) AND isDeleted = 0`,
          [schoolId, ...uniqueIds]
        );
        validMemberIds = rows.map((r) => r.id);
      }
    } else if (getMySQLPool()) {
      const uniqueIds = Array.from(new Set(memberUserIds)).filter((id) => id !== creatorId);
      if (uniqueIds.length > 0) {
        const placeholders = uniqueIds.map(() => "?").join(",");
        const res: any = await executeQuery<any[]>(
          `SELECT id FROM users WHERE schoolId = ? AND id IN (${placeholders}) AND isDeleted = 0`,
          [schoolId, ...uniqueIds]
        );
        const rows = res.status === 1 && res.data ? res.data : [];
        validMemberIds = rows.map((r: any) => r.id);
      }
    } else {
      // 内存沙箱环境
      const uniqueIds = Array.from(new Set(memberUserIds)).filter((id) => id !== creatorId);
      validMemberIds = uniqueIds.filter((uid) => {
        const u = WeChatAuthService.getMockUser(uid);
        return u ? u.schoolId === schoolId : true; // 沙箱默认通过
      });
    }

    let chatRoomId = 0;

    // 1. 落盘会话室 (chat_rooms, roomType = 'group')
    if (this.customDb) {
      const insertRoomSql = `
        INSERT INTO chat_rooms (
          schoolId, roomType, title, patrolId, creatorId, handlerId,
          initiatedByHandler, isClosed, lastMessage, lastMessageAt, createdAt
        ) VALUES (
          ?, 'group', ?, ?, ?, 0,
          1, 0, ?, NOW(), NOW()
        )
      `;
      const roomRes = await this.customDb.execute(insertRoomSql, [
        schoolId,
        cleanTitle,
        patrolId,
        creatorId,
        lastMsgSummary
      ]);
      chatRoomId = roomRes.insertId;

      // 2. 插入群主 (role = 2)
      const insertOwnerSql = `
        INSERT INTO chat_group_members (
          schoolId, chatRoomId, userId, role, nickInGroup, joinedAt, lastReadMessageId, isMuted
        ) VALUES (?, ?, ?, 2, '', NOW(), 0, 0)
      `;
      await this.customDb.execute(insertOwnerSql, [schoolId, chatRoomId, creatorId]);

      // 3. 批量装填其他成员 (role = 0)
      if (validMemberIds.length > 0) {
        const valueTuples = validMemberIds.map(() => "(?, ?, ?, 0, '', NOW(), 0, 0)").join(", ");
        const memberParams: any[] = [];
        for (const uid of validMemberIds) {
          memberParams.push(schoolId, chatRoomId, uid);
        }
        await this.customDb.execute(
          `INSERT INTO chat_group_members (schoolId, chatRoomId, userId, role, nickInGroup, joinedAt, lastReadMessageId, isMuted) VALUES ${valueTuples}`,
          memberParams
        );
      }

      // 4. 初始公告
      if (initialNotice && initialNotice.trim().length > 0) {
        const noticeContent = `[置顶群公告] ${initialNotice.trim()}`;
        await this.customDb.execute(
          `INSERT INTO chat_messages (schoolId, chatRoomId, senderId, senderRole, type, content, answerMessageId, isWithDraw, createdAt) VALUES (?, ?, 0, 9, 3, ?, 0, 0, NOW())`,
          [schoolId, chatRoomId, noticeContent]
        );
      }
    } else if (getMySQLPool()) {
      const insertRoomSql = `
        INSERT INTO chat_rooms (
          schoolId, roomType, title, patrolId, creatorId, handlerId,
          initiatedByHandler, isClosed, lastMessage, lastMessageAt, createdAt
        ) VALUES (
          ?, 'group', ?, ?, ?, 0,
          1, 0, ?, NOW(), NOW()
        )
      `;
      const rRes: any = await executeQuery(insertRoomSql, [
        schoolId,
        cleanTitle,
        patrolId,
        creatorId,
        lastMsgSummary
      ]);
      chatRoomId = rRes.data?.insertId || rRes.insertId || 0;

      // 插入群主
      await executeQuery(
        `INSERT INTO chat_group_members (schoolId, chatRoomId, userId, role, nickInGroup, joinedAt, lastReadMessageId, isMuted) VALUES (?, ?, ?, 2, '', NOW(), 0, 0)`,
        [schoolId, chatRoomId, creatorId]
      );

      // 批量装填成员
      if (validMemberIds.length > 0) {
        const valueTuples = validMemberIds.map(() => "(?, ?, ?, 0, '', NOW(), 0, 0)").join(", ");
        const memberParams: any[] = [];
        for (const uid of validMemberIds) {
          memberParams.push(schoolId, chatRoomId, uid);
        }
        await executeQuery(
          `INSERT INTO chat_group_members (schoolId, chatRoomId, userId, role, nickInGroup, joinedAt, lastReadMessageId, isMuted) VALUES ${valueTuples}`,
          memberParams
        );
      }

      if (initialNotice && initialNotice.trim().length > 0) {
        await executeQuery(
          `INSERT INTO chat_messages (schoolId, chatRoomId, senderId, senderRole, type, content, answerMessageId, isWithDraw, createdAt) VALUES (?, ?, 0, 9, 3, ?, 0, 0, NOW())`,
          [schoolId, chatRoomId, `[置顶群公告] ${initialNotice.trim()}`]
        );
      }
    } else {
      // 内存沙箱
      chatRoomId = ++ChatGroupService.roomIdSeq;
      const groupRoom: IChatGroupRoomEntity = {
        id: chatRoomId,
        schoolId,
        roomType: "group",
        title: cleanTitle,
        patrolId,
        creatorId,
        handlerId: 0,
        initiatedByHandler: 1,
        isClosed: 0,
        isPinned: 0,
        creatorUnreadCount: 0,
        handlerUnreadCount: 0,
        lastMessage: lastMsgSummary,
        lastMessageAt: nowIso,
        createdAt: nowIso
      };
      ChatGroupService.mockGroupRooms.set(chatRoomId, groupRoom);

      // 注入群主
      ChatGroupService.seedMockMember({
        schoolId,
        chatRoomId,
        userId: creatorId,
        role: GroupMemberRole.OWNER,
        nickInGroup: "",
        lastReadMessageId: 0
      });

      // 注入初始普通成员
      for (const uid of validMemberIds) {
        ChatGroupService.seedMockMember({
          schoolId,
          chatRoomId,
          userId: uid,
          role: GroupMemberRole.MEMBER,
          nickInGroup: "",
          lastReadMessageId: 0
        });
      }

      // 初始公告
      if (initialNotice && initialNotice.trim().length > 0) {
        ChatGroupService.mockGroupNotices.set(chatRoomId, {
          chatRoomId,
          content: initialNotice.trim(),
          publisherName: "群主",
          publishedAt: nowIso,
          isPinned: true
        });
      }
    }

    const totalMemberCount = 1 + validMemberIds.length;

    // 广播 GROUP_CREATED
    const broadcastPayload = {
      event: "GROUP_CREATED",
      schoolId,
      chatRoomId,
      title: cleanTitle,
      patrolId,
      memberUserIds: [creatorId, ...validMemberIds],
      createdAt: nowIso
    };

    if (this.customRedis?.eval) {
      try {
        await this.customRedis.eval(
          `redis.call('PUBLISH', 'ws_broadcast_bus', ARGV[1])`,
          0,
          JSON.stringify(broadcastPayload)
        );
      } catch {}
    } else {
      try {
        await RedisWsBridge.broadcast("ws:cluster:broadcast", schoolId, broadcastPayload);
      } catch {}
    }

    return {
      chatRoomId,
      title: cleanTitle,
      memberCount: totalMemberCount,
      createdAt: nowIso
    };
  }

  /**
   * 2. 发布/更新群公告 (严格鉴权: 仅限群主与管理员)
   */
  public async publishNotice(
    schoolId: number,
    operatorId: number,
    dto: IPublishGroupNoticeDto
  ): Promise<IGroupNoticeDetailDto> {
    const { chatRoomId, content, isPinned = true } = dto;

    if (!chatRoomId || !content || content.trim().length === 0) {
      throw new Error("群公告内容不可为空");
    }

    const cleanContent = content.trim();
    const nowIso = new Date().toISOString();

    // 1. 权限判定: 检查操作人在该群的角色 (必须 >= ADMIN)
    const operatorRole = await this.getUserGroupRole(schoolId, chatRoomId, operatorId);
    if (operatorRole < GroupMemberRole.ADMIN) {
      throw new Error("权限不足: 仅群主或管理员有权发布群公告");
    }

    let publisherName = "管理员";

    // 2. 落盘公告
    const noticeContent = `[置顶群公告] ${cleanContent}`;
    if (this.customDb) {
      await this.customDb.execute(
        `INSERT INTO chat_messages (schoolId, chatRoomId, senderId, senderRole, type, content, answerMessageId, isWithDraw, createdAt) VALUES (?, ?, ?, 9, 3, ?, 0, 0, NOW())`,
        [schoolId, chatRoomId, operatorId, noticeContent]
      );
      await this.customDb.execute(
        `UPDATE chat_rooms SET lastMessage = ?, lastMessageAt = NOW() WHERE id = ? AND schoolId = ?`,
        [noticeContent.substring(0, 30), chatRoomId, schoolId]
      );
      const userRows = await this.customDb.query<{ realName?: string; nickName?: string }>(
        `SELECT realName, nickName FROM users WHERE id = ? AND schoolId = ? LIMIT 1`,
        [operatorId, schoolId]
      );
      publisherName = userRows[0]?.realName || userRows[0]?.nickName || (operatorRole === GroupMemberRole.OWNER ? "群主" : "管理员");
    } else if (getMySQLPool()) {
      await executeQuery(
        `INSERT INTO chat_messages (schoolId, chatRoomId, senderId, senderRole, type, content, answerMessageId, isWithDraw, createdAt) VALUES (?, ?, ?, 9, 3, ?, 0, 0, NOW())`,
        [schoolId, chatRoomId, operatorId, noticeContent]
      );
      await executeQuery(
        `UPDATE chat_rooms SET lastMessage = ?, lastMessageAt = NOW() WHERE id = ? AND schoolId = ?`,
        [noticeContent.substring(0, 30), chatRoomId, schoolId]
      );
      const uRes: any = await executeQuery<any[]>(
        `SELECT realName, nickName FROM users WHERE id = ? AND schoolId = ? LIMIT 1`,
        [operatorId, schoolId]
      );
      const userRows = uRes.status === 1 && uRes.data ? uRes.data : [];
      publisherName = userRows[0]?.realName || userRows[0]?.nickName || (operatorRole === GroupMemberRole.OWNER ? "群主" : "管理员");
    } else {
      // 内存沙箱
      const room = ChatGroupService.mockGroupRooms.get(chatRoomId);
      if (room) {
        room.lastMessage = noticeContent.substring(0, 30);
        room.lastMessageAt = nowIso;
      }
      const u = WeChatAuthService.getMockUser(operatorId);
      publisherName = u?.realName || u?.nickName || (operatorRole === GroupMemberRole.OWNER ? "群主" : "管理员");
    }

    const noticeDetail: IGroupNoticeDetailDto = {
      chatRoomId,
      content: cleanContent,
      publisherName,
      publishedAt: nowIso,
      isPinned: Boolean(isPinned)
    };

    // 缓存最新公告
    ChatGroupService.mockGroupNotices.set(chatRoomId, noticeDetail);

    // 3. 广播 WebSocket 强穿透事件
    const noticePayload: IGroupWsNoticePayload = {
      event: "GROUP_NOTICE_PUBLISHED",
      schoolId,
      chatRoomId,
      notice: {
        content: cleanContent,
        publisherName,
        isPinned: Boolean(isPinned),
        publishedAt: nowIso
      }
    };

    if (this.customRedis?.eval) {
      try {
        await this.customRedis.eval(
          `redis.call('PUBLISH', 'ws_broadcast_bus', ARGV[1])`,
          0,
          JSON.stringify(noticePayload)
        );
      } catch {}
    } else {
      try {
        await RedisWsBridge.broadcast("ws:cluster:broadcast", schoolId, noticePayload);
      } catch {}
    }

    return noticeDetail;
  }

  /**
   * 3. 算法 1 落地: 滑动更新已读游标 (O(1) 极速写操作，零写放大)
   */
  public async updateReadCursor(
    schoolId: number,
    chatRoomId: number,
    userId: number,
    lastReadMessageId: number
  ): Promise<IGroupReadCursorResponseDto> {
    const targetCursor = Math.max(0, Math.floor(lastReadMessageId || 0));
    const nowIso = new Date().toISOString();

    if (this.customDb) {
      const updateSql = `
        UPDATE chat_group_members 
        SET lastReadMessageId = GREATEST(lastReadMessageId, ?) 
        WHERE chatRoomId = ? AND userId = ? AND schoolId = ?
      `;
      const res = await this.customDb.execute(updateSql, [targetCursor, chatRoomId, userId, schoolId]);
      if (res.affectedRows === 0) {
        throw new Error("您并非该群聊成员，无法同步已读游标");
      }
    } else if (getMySQLPool()) {
      const updateSql = `
        UPDATE chat_group_members 
        SET lastReadMessageId = GREATEST(lastReadMessageId, ?) 
        WHERE chatRoomId = ? AND userId = ? AND schoolId = ?
      `;
      const res: any = await executeQuery(updateSql, [targetCursor, chatRoomId, userId, schoolId]);
      if ((res.data?.affectedRows || res.affectedRows || 0) === 0) {
        throw new Error("您并非该群聊成员，无法同步已读游标");
      }
    } else {
      // 内存沙箱
      const key = `${schoolId}_${chatRoomId}_${userId}`;
      const member = ChatGroupService.mockGroupMembers.get(key);
      if (!member) {
        throw new Error("您并非该群聊成员，无法同步已读游标");
      }
      member.lastReadMessageId = GroupReadCursorCalculator.advanceCursor(
        member.lastReadMessageId,
        targetCursor
      );
    }

    return {
      chatRoomId,
      lastReadMessageId: targetCursor,
      effectiveUnreadCount: 0,
      syncedAt: nowIso
    };
  }

  /**
   * 4. 获取群聊全景详情与成员列表 (权限阶梯断言)
   */
  public async getGroupDetail(
    schoolId: number,
    chatRoomId: number,
    userId: number
  ): Promise<IGroupDetailDto> {
    // 1. 查询会话房间
    let room: IChatGroupRoomEntity | undefined;
    if (this.customDb) {
      const rows = await this.customDb.query<any>(
        `SELECT * FROM chat_rooms WHERE id = ? AND schoolId = ? AND roomType = 'group' LIMIT 1`,
        [chatRoomId, schoolId]
      );
      room = rows[0];
    } else if (getMySQLPool()) {
      const res: any = await executeQuery<any[]>(
        `SELECT * FROM chat_rooms WHERE id = ? AND schoolId = ? AND roomType = 'group' LIMIT 1`,
        [chatRoomId, schoolId]
      );
      room = res.status === 1 && res.data ? res.data[0] : undefined;
    } else {
      room = ChatGroupService.mockGroupRooms.get(chatRoomId);
    }

    if (!room || room.schoolId !== schoolId) {
      throw new Error("群聊不存在或已被解散");
    }

    // 2. 查询当前用户在群内的角色 (非群成员 403 拦截)
    const currentUserRole = await this.getUserGroupRole(schoolId, chatRoomId, userId);

    // 3. 查询全部群成员
    let rawMembers: any[] = [];
    if (this.customDb) {
      const sql = `
        SELECT m.userId, m.role, m.nickInGroup, m.joinedAt, m.isMuted,
               u.realName, u.nickName, u.avatarUrl
        FROM chat_group_members m
        LEFT JOIN users u ON u.id = m.userId AND u.schoolId = m.schoolId
        WHERE m.chatRoomId = ? AND m.schoolId = ?
        ORDER BY m.role DESC, m.joinedAt ASC
      `;
      rawMembers = await this.customDb.query(sql, [chatRoomId, schoolId]);
    } else if (getMySQLPool()) {
      const sql = `
        SELECT m.userId, m.role, m.nickInGroup, m.joinedAt, m.isMuted,
               u.realName, u.nickName, u.avatarUrl
        FROM chat_group_members m
        LEFT JOIN users u ON u.id = m.userId AND u.schoolId = m.schoolId
        WHERE m.chatRoomId = ? AND m.schoolId = ?
        ORDER BY m.role DESC, m.joinedAt ASC
      `;
      const res: any = await executeQuery<any[]>(sql, [chatRoomId, schoolId]);
      rawMembers = res.status === 1 && res.data ? res.data : [];
    } else {
      for (const m of ChatGroupService.mockGroupMembers.values()) {
        if (m.schoolId === schoolId && m.chatRoomId === chatRoomId) {
          const u = WeChatAuthService.getMockUser(m.userId);
          rawMembers.push({
            userId: m.userId,
            role: m.role,
            nickInGroup: m.nickInGroup,
            joinedAt: m.joinedAt,
            isMuted: m.isMuted,
            realName: u?.realName || `用户_${m.userId}`,
            nickName: u?.nickName || `师生_${m.userId}`,
            avatarUrl: u?.avatarUrl || "https://res.quickpatrol.edu.cn/static/avatar/default_student.png"
          });
        }
      }
      rawMembers.sort((a, b) => b.role - a.role);
    }

    const members: IGroupMemberItemDto[] = rawMembers.map((m) => {
      const r = m.role as GroupMemberRole;
      const roleName = r === GroupMemberRole.OWNER ? "群主" : r === GroupMemberRole.ADMIN ? "管理员" : "成员";
      return {
        userId: m.userId,
        realName: m.realName || `用户_${m.userId}`,
        nickName: m.nickName || m.realName || `用户_${m.userId}`,
        nickInGroup: m.nickInGroup || "",
        avatarUrl: m.avatarUrl || "https://res.quickpatrol.edu.cn/static/avatar/default_student.png",
        role: r,
        roleName,
        joinedAt: m.joinedAt || new Date().toISOString(),
        isMuted: Boolean(m.isMuted)
      };
    });

    const currentMember = members.find((m) => m.userId === userId);
    const isMuted = currentMember ? currentMember.isMuted : false;
    const isOwnerOrAdmin = currentUserRole >= GroupMemberRole.ADMIN;

    // 4. 获取群公告
    const notice = ChatGroupService.mockGroupNotices.get(chatRoomId) || null;

    // 5. 创建人名称
    const creatorUser = WeChatAuthService.getMockUser(room.creatorId);
    const creatorName = creatorUser?.realName || creatorUser?.nickName || `用户_${room.creatorId}`;

    return {
      chatRoomId,
      schoolId,
      title: room.title,
      patrolId: room.patrolId || null,
      creatorId: room.creatorId,
      creatorName,
      isClosed: room.isClosed === 1,
      memberCount: members.length,
      members,
      notice,
      currentUserRole,
      isOwnerOrAdmin,
      isMuted,
      createdAt: room.createdAt
    };
  }

  /**
   * 5. 邀请/添加成员入群 (防跨校穿透)
   */
  public async addMembers(
    schoolId: number,
    operatorId: number,
    dto: IGroupMemberManageDto
  ): Promise<{ addedCount: number }> {
    const { chatRoomId, targetUserIds = [] } = dto;
    if (!chatRoomId || targetUserIds.length === 0) {
      return { addedCount: 0 };
    }

    // 验证操作人是否在群内
    await this.getUserGroupRole(schoolId, chatRoomId, operatorId);

    // 过滤属于同校的目标成员
    let validIds: number[] = [];
    if (this.customDb) {
      const uniqueIds = Array.from(new Set(targetUserIds));
      const placeholders = uniqueIds.map(() => "?").join(",");
      const rows = await this.customDb.query<{ id: number }>(
        `SELECT id FROM users WHERE schoolId = ? AND id IN (${placeholders}) AND isDeleted = 0`,
        [schoolId, ...uniqueIds]
      );
      validIds = rows.map((r) => r.id);
    } else if (getMySQLPool()) {
      const uniqueIds = Array.from(new Set(targetUserIds));
      const placeholders = uniqueIds.map(() => "?").join(",");
      const res: any = await executeQuery<any[]>(
        `SELECT id FROM users WHERE schoolId = ? AND id IN (${placeholders}) AND isDeleted = 0`,
        [schoolId, ...uniqueIds]
      );
      const rows = res.status === 1 && res.data ? res.data : [];
      validIds = rows.map((r: any) => r.id);
    } else {
      validIds = Array.from(new Set(targetUserIds)).filter((uid) => {
        const u = WeChatAuthService.getMockUser(uid);
        return u ? u.schoolId === schoolId : true;
      });
    }

    let addedCount = 0;
    for (const uid of validIds) {
      if (this.customDb) {
        const sql = `
          INSERT INTO chat_group_members (
            schoolId, chatRoomId, userId, role, nickInGroup, joinedAt, lastReadMessageId, isMuted
          ) VALUES (?, ?, ?, 0, '', NOW(), 0, 0)
          ON DUPLICATE KEY UPDATE joinedAt = joinedAt
        `;
        const res = await this.customDb.execute(sql, [schoolId, chatRoomId, uid]);
        if (res.affectedRows > 0) addedCount++;
      } else if (getMySQLPool()) {
        const sql = `
          INSERT INTO chat_group_members (
            schoolId, chatRoomId, userId, role, nickInGroup, joinedAt, lastReadMessageId, isMuted
          ) VALUES (?, ?, ?, 0, '', NOW(), 0, 0)
          ON DUPLICATE KEY UPDATE joinedAt = joinedAt
        `;
        const res: any = await executeQuery(sql, [schoolId, chatRoomId, uid]);
        if ((res.data?.affectedRows || res.affectedRows || 0) > 0) addedCount++;
      } else {
        const key = `${schoolId}_${chatRoomId}_${uid}`;
        if (!ChatGroupService.mockGroupMembers.has(key)) {
          ChatGroupService.seedMockMember({
            schoolId,
            chatRoomId,
            userId: uid,
            role: GroupMemberRole.MEMBER,
            nickInGroup: "",
            lastReadMessageId: 0
          });
          addedCount++;
        }
      }
    }

    return { addedCount };
  }

  /**
   * 6. 移除群成员或主动退群 (防群聊孤儿熔断保护)
   */
  public async removeMember(
    schoolId: number,
    operatorId: number,
    chatRoomId: number,
    targetUserId: number
  ): Promise<{ success: boolean; isDisbanded: boolean }> {
    const operatorRole = await this.getUserGroupRole(schoolId, chatRoomId, operatorId);
    const targetRole = await this.getUserGroupRole(schoolId, chatRoomId, targetUserId);

    const isSelfLeave = (operatorId === targetUserId);

    // 场景 A: 主动退群
    if (isSelfLeave) {
      if (operatorRole === GroupMemberRole.OWNER) {
        // 群主退群，检测群内是否只剩群主一人
        let memberCount = 0;
        if (this.customDb) {
          const rows = await this.customDb.query<{ c: number }>(
            `SELECT COUNT(1) AS c FROM chat_group_members WHERE chatRoomId = ? AND schoolId = ?`,
            [chatRoomId, schoolId]
          );
          memberCount = rows[0]?.c || 0;
        } else if (getMySQLPool()) {
          const res: any = await executeQuery<any[]>(
            `SELECT COUNT(1) AS c FROM chat_group_members WHERE chatRoomId = ? AND schoolId = ?`,
            [chatRoomId, schoolId]
          );
          const rows = res.status === 1 && res.data ? res.data : [];
          memberCount = rows[0]?.c || 0;
        } else {
          for (const m of ChatGroupService.mockGroupMembers.values()) {
            if (m.schoolId === schoolId && m.chatRoomId === chatRoomId) memberCount++;
          }
        }

        if (memberCount > 1) {
          throw new Error("您是群主，请先转让群主身份后再退出群聊");
        }

        // 群内只剩群主一人，直接级联解散群聊
        await this.disbandGroup(schoolId, chatRoomId);
        return { success: true, isDisbanded: true };
      }
    } else {
      // 场景 B: 踢人
      if (operatorRole < GroupMemberRole.ADMIN) {
        throw new Error("权限不足: 仅群主或管理员有权移出成员");
      }
      if (targetRole === GroupMemberRole.OWNER) {
        throw new Error("权限不足: 无法将群主移出群聊");
      }
      if (operatorRole === GroupMemberRole.ADMIN && targetRole === GroupMemberRole.ADMIN) {
        throw new Error("权限不足: 管理员之间不可相互移出");
      }
    }

    // 执行物理移除
    if (this.customDb) {
      await this.customDb.execute(
        `DELETE FROM chat_group_members WHERE chatRoomId = ? AND userId = ? AND schoolId = ?`,
        [chatRoomId, targetUserId, schoolId]
      );
    } else if (getMySQLPool()) {
      await executeQuery(
        `DELETE FROM chat_group_members WHERE chatRoomId = ? AND userId = ? AND schoolId = ?`,
        [chatRoomId, targetUserId, schoolId]
      );
    } else {
      const key = `${schoolId}_${chatRoomId}_${targetUserId}`;
      ChatGroupService.mockGroupMembers.delete(key);
    }

    // 若是被踢，广播长连接熔断信令
    if (!isSelfLeave) {
      const evictPayload: IGroupWsForceEvictPayload = {
        event: "FORCE_EVICT_MEMBER",
        schoolId,
        chatRoomId,
        evictedUserId: targetUserId,
        operatorId,
        reason: "已被管理员移出该群聊"
      };
      if (this.customRedis?.eval) {
        try {
          await this.customRedis.eval(
            `redis.call('PUBLISH', 'ws_broadcast_bus', ARGV[1])`,
            0,
            JSON.stringify(evictPayload)
          );
        } catch {}
      } else {
        try {
          await RedisWsBridge.broadcast("ws:cluster:broadcast", schoolId, evictPayload);
        } catch {}
      }
    }

    return { success: true, isDisbanded: false };
  }

  /**
   * 7. 切换消息免打扰 (isMuted)
   */
  public async toggleMute(
    schoolId: number,
    userId: number,
    chatRoomId: number,
    isMuted: boolean
  ): Promise<{ chatRoomId: number; isMuted: boolean }> {
    const muteVal = isMuted ? 1 : 0;
    if (this.customDb) {
      await this.customDb.execute(
        `UPDATE chat_group_members SET isMuted = ? WHERE chatRoomId = ? AND userId = ? AND schoolId = ?`,
        [muteVal, chatRoomId, userId, schoolId]
      );
    } else if (getMySQLPool()) {
      await executeQuery(
        `UPDATE chat_group_members SET isMuted = ? WHERE chatRoomId = ? AND userId = ? AND schoolId = ?`,
        [muteVal, chatRoomId, userId, schoolId]
      );
    } else {
      const key = `${schoolId}_${chatRoomId}_${userId}`;
      const member = ChatGroupService.mockGroupMembers.get(key);
      if (!member) {
        throw new Error("您并非该群聊成员");
      }
      member.isMuted = muteVal;
    }

    return { chatRoomId, isMuted };
  }

  /**
   * 8. 获取指定用户在群内的角色 (非成员抛出异常)
   */
  public async getUserGroupRole(
    schoolId: number,
    chatRoomId: number,
    userId: number
  ): Promise<GroupMemberRole> {
    if (this.customDb) {
      const sql = `
        SELECT role FROM chat_group_members 
        WHERE chatRoomId = ? AND userId = ? AND schoolId = ? 
        LIMIT 1
      `;
      const rows = await this.customDb.query<{ role: number }>(sql, [chatRoomId, userId, schoolId]);
      if (!rows || rows.length === 0) {
        throw new Error("您不是该群聊的成员，无权操作");
      }
      return rows[0].role as GroupMemberRole;
    }

    if (getMySQLPool()) {
      const sql = `
        SELECT role FROM chat_group_members 
        WHERE chatRoomId = ? AND userId = ? AND schoolId = ? 
        LIMIT 1
      `;
      const res: any = await executeQuery<any[]>(sql, [chatRoomId, userId, schoolId]);
      const rows = res.status === 1 && res.data ? res.data : [];
      if (!rows || rows.length === 0) {
        throw new Error("您不是该群聊的成员，无权操作");
      }
      return rows[0].role as GroupMemberRole;
    }

    // 内存沙箱
    const key = `${schoolId}_${chatRoomId}_${userId}`;
    const member = ChatGroupService.mockGroupMembers.get(key);
    if (!member) {
      throw new Error("您不是该群聊的成员，无权操作");
    }
    return member.role;
  }

  /**
   * 9. 计算指定成员在该群内的离散未读数 (算法 1 联动)
   */
  public async calculateUserGroupUnread(
    schoolId: number,
    chatRoomId: number,
    userId: number
  ): Promise<number> {
    if (this.customDb) {
      const sql = `
        SELECT 
          m.lastReadMessageId,
          (SELECT MAX(id) FROM chat_messages WHERE chatRoomId = ? AND schoolId = ?) AS maxMsgId,
          (SELECT COUNT(1) FROM chat_messages WHERE chatRoomId = ? AND schoolId = ? AND isWithDraw = 1 AND id > m.lastReadMessageId) AS withdrawnCount
        FROM chat_group_members m
        WHERE m.chatRoomId = ? AND m.userId = ? AND m.schoolId = ?
        LIMIT 1
      `;
      const rows = await this.customDb.query<any>(sql, [
        chatRoomId,
        schoolId,
        chatRoomId,
        schoolId,
        chatRoomId,
        userId,
        schoolId
      ]);
      if (!rows || rows.length === 0) return 0;
      const lastRead = Number(rows[0].lastReadMessageId || 0);
      const maxId = Number(rows[0].maxMsgId || 0);
      const withdrawn = Number(rows[0].withdrawnCount || 0);
      return Math.max(0, maxId - lastRead - withdrawn);
    }

    if (getMySQLPool()) {
      const sql = `
        SELECT 
          m.lastReadMessageId,
          (SELECT MAX(id) FROM chat_messages WHERE chatRoomId = ? AND schoolId = ?) AS maxMsgId,
          (SELECT COUNT(1) FROM chat_messages WHERE chatRoomId = ? AND schoolId = ? AND isWithDraw = 1 AND id > m.lastReadMessageId) AS withdrawnCount
        FROM chat_group_members m
        WHERE m.chatRoomId = ? AND m.userId = ? AND m.schoolId = ?
        LIMIT 1
      `;
      const res: any = await executeQuery<any[]>(sql, [
        chatRoomId,
        schoolId,
        chatRoomId,
        schoolId,
        chatRoomId,
        userId,
        schoolId
      ]);
      const rows = res.status === 1 && res.data ? res.data : [];
      if (!rows || rows.length === 0) return 0;
      const lastRead = Number(rows[0].lastReadMessageId || 0);
      const maxId = Number(rows[0].maxMsgId || 0);
      const withdrawn = Number(rows[0].withdrawnCount || 0);
      return Math.max(0, maxId - lastRead - withdrawn);
    }

    // 内存沙箱
    const key = `${schoolId}_${chatRoomId}_${userId}`;
    const member = ChatGroupService.mockGroupMembers.get(key);
    if (!member) return 0;
    return GroupReadCursorCalculator.calculateUnread(member.lastReadMessageId, 0);
  }

  /**
   * 解散群聊（级联置为归档只读）
   */
  private async disbandGroup(schoolId: number, chatRoomId: number): Promise<void> {
    if (this.customDb) {
      await this.customDb.execute(
        `UPDATE chat_rooms SET isClosed = 1, lastMessage = '[群聊已解散]' WHERE id = ? AND schoolId = ?`,
        [chatRoomId, schoolId]
      );
      await this.customDb.execute(
        `DELETE FROM chat_group_members WHERE chatRoomId = ? AND schoolId = ?`,
        [chatRoomId, schoolId]
      );
    } else if (getMySQLPool()) {
      await executeQuery(
        `UPDATE chat_rooms SET isClosed = 1, lastMessage = '[群聊已解散]' WHERE id = ? AND schoolId = ?`,
        [chatRoomId, schoolId]
      );
      await executeQuery(
        `DELETE FROM chat_group_members WHERE chatRoomId = ? AND schoolId = ?`,
        [chatRoomId, schoolId]
      );
    } else {
      const room = ChatGroupService.mockGroupRooms.get(chatRoomId);
      if (room) {
        room.isClosed = 1;
        room.lastMessage = "[群聊已解散]";
      }
      for (const [key, m] of ChatGroupService.mockGroupMembers.entries()) {
        if (m.schoolId === schoolId && m.chatRoomId === chatRoomId) {
          ChatGroupService.mockGroupMembers.delete(key);
        }
      }
    }
  }
}
