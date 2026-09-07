/**
 * M36: 协同聊天消息发送门禁检查器 (Chat Gatekeeper)
 * 职责：
 * 1. 消息发送前置门禁拦截探针，在网关与业务层双重设卡
 * 2. 核心单向门禁: 当 initiatedByHandler === 0 时，绝对卡死非责任师傅发信
 * 3. 办结会话只读锁定: isClosed === 1 时拦截所有新消息投递
 * 4. 非相关人员越权介入拦截
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import { IDbExecutor, ChatRoomService } from "./chatRoomService.js";
import { IChatRoomEntity } from "./chatRoomTypes.js";

export class ChatGatekeeper {
  constructor(private readonly customDb?: IDbExecutor) {}

  /**
   * 拦截校验: 判断当前发送人是否允许向目标会话室投递消息
   * @throws Error 403 / 权限拒绝
   */
  public async assertCanSendMessage(
    schoolId: number,
    chatRoomId: number,
    sendUserId: number,
    userRole: number = 0
  ): Promise<void> {
    if (this.customDb) {
      return this.assertWithDb(this.customDb, schoolId, chatRoomId, sendUserId, userRole);
    }

    const pool = getMySQLPool();
    if (pool) {
      try {
        const realDb: IDbExecutor = {
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
        return await this.assertWithDb(realDb, schoolId, chatRoomId, sendUserId, userRole);
      } catch (err: any) {
        if (err.message && (err.message.includes("尚未主动激活") || err.message.includes("结案") || err.message.includes("越权"))) {
          throw err;
        }
        return this.assertInMemory(schoolId, chatRoomId, sendUserId, userRole);
      }
    }

    return this.assertInMemory(schoolId, chatRoomId, sendUserId, userRole);
  }

  private async assertWithDb(
    db: IDbExecutor,
    schoolId: number,
    chatRoomId: number,
    sendUserId: number,
    userRole: number
  ): Promise<void> {
    const checkSql = `
      SELECT handlerId, creatorId, initiatedByHandler, isClosed 
      FROM chat_rooms 
      WHERE id = ? AND schoolId = ? 
      LIMIT 1
    `;
    const rows = await db.query<any>(checkSql, [chatRoomId, schoolId]);
    if (rows.length === 0) {
      throw new Error("会话室不存在或已失效");
    }

    const room = rows[0];
    this.checkRoomRules(room, sendUserId, userRole);
  }

  private assertInMemory(
    schoolId: number,
    chatRoomId: number,
    sendUserId: number,
    userRole: number
  ): void {
    const mockRooms = ChatRoomService.getMockRooms();
    const room = mockRooms.find((r) => r.id === chatRoomId && r.schoolId === schoolId);
    if (!room) {
      throw new Error("会话室不存在或已失效");
    }

    this.checkRoomRules(room, sendUserId, userRole);
  }

  private checkRoomRules(
    room: { handlerId: number; creatorId: number; initiatedByHandler: number; isClosed: number },
    sendUserId: number,
    userRole: number
  ): void {
    // 1. 已结案锁定
    if (room.isClosed === 1) {
      throw new Error("本次工单已圆满结案归档，禁止再发送新消息");
    }

    // 2. 身份合法性核验: 发送人必须是责任师傅、提报师生或校级管理员
    const isParticipant = sendUserId === room.handlerId || sendUserId === room.creatorId;
    if (!isParticipant && userRole < 4) {
      throw new Error("越权拦截: 您不是该工单的关联人，无权在此发言");
    }

    // 3. 核心单向门禁卡死: 未激活时仅允许责任师傅发言
    if (room.initiatedByHandler === 0) {
      if (sendUserId !== room.handlerId) {
        throw new Error("责任维修师傅正在赶往现场备料中，尚未主动激活协同通道，暂不可发消息");
      }
    }
  }
}
