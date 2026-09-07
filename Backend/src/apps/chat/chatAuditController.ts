/**
 * 高校后勤巡查e速办 v4.0 - M38: 类 QQ 2分钟消息撤回与审计存根
 * (Chat Audit Controller - 安全审计存根调阅端点)
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";
import { ChatMessageService } from "./chatMessageService.js";
import { ChatWithdrawService, IDbExecutor } from "./chatWithdrawService.js";
import { ChatMessageType, IWithdrawAuditDetailDto, WithdrawOperatorType } from "./chatWithdrawTypes.js";

export interface IAuditHttpCtx {
  schoolId: number;
  userId: number;
  userRole: number; // 必须为 4 (校级管理员/SEC_AUDITOR)
  query: {
    chatRoomId?: string;
    messageId?: string;
    page?: string;
    pageSize?: string;
  };
}

export class ChatAuditController {
  constructor(private readonly db?: IDbExecutor) {}

  /**
   * GET /api/v4/chat/rooms/withdrawn-stubs 或 GET /api/v4/chat/audit/withdrawn-stubs
   * 查询已撤回消息的原文字与操作存根
   */
  public async getWithdrawnAuditStubs(ctx: IAuditHttpCtx): Promise<any> {
    const { schoolId, userRole, query } = ctx;

    // 1. 严格权限校验: 仅校级管理员 (Role 4) 拥有调阅撤回存根权限
    if (userRole !== 4) {
      return { code: 403, message: "越权拒绝: 仅校级网络安全员与后勤督查纪检专员有权调阅撤回存根" };
    }

    const chatRoomId = query?.chatRoomId ? parseInt(query.chatRoomId, 10) : undefined;
    const messageId = query?.messageId ? parseInt(query.messageId, 10) : undefined;
    const page = Math.max(1, parseInt(query?.page || "1", 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(query?.pageSize || "20", 10)));
    const offset = (page - 1) * pageSize;

    if (this.db) {
      let whereClause = `m.schoolId = ? AND m.isWithDraw = 1`;
      const params: any[] = [schoolId];

      if (chatRoomId) {
        whereClause += ` AND m.chatRoomId = ?`;
        params.push(chatRoomId);
      }
      if (messageId) {
        whereClause += ` AND m.id = ?`;
        params.push(messageId);
      }

      const selectSql = `
        SELECT 
          m.id AS messageId,
          m.chatRoomId,
          m.type AS originalType,
          m.content AS originalContent,
          m.createdAt AS sentAt,
          u.id AS senderId,
          u.nickName AS senderName,
          u.userNo AS senderNo,
          m.senderRole,
          l.operatorId,
          op.nickName AS operatorName,
          l.operatorRole,
          l.action AS auditAction,
          l.createdAt AS withdrawnAt,
          l.clientIp,
          l.snapshotPayload
        FROM chat_messages m
        LEFT JOIN users u ON m.senderId = u.id AND u.schoolId = m.schoolId
        LEFT JOIN operation_logs l ON l.targetId = m.id AND l.schoolId = m.schoolId AND l.module = 'CHAT_IM'
        LEFT JOIN users op ON l.operatorId = op.id AND op.schoolId = l.schoolId
        WHERE ${whereClause}
        ORDER BY m.id DESC
        LIMIT ? OFFSET ?
      `;

      params.push(pageSize, offset);
      const rows = await this.db.query<any>(selectSql, params);
      const auditList = this.mapAuditRows(rows);

      return {
        code: 200,
        message: "调阅成功",
        data: {
          page,
          pageSize,
          records: auditList
        }
      };
    } else if (getMySQLPool()) {
      let whereClause = `m.schoolId = ? AND m.isWithDraw = 1`;
      const params: any[] = [schoolId];

      if (chatRoomId) {
        whereClause += ` AND m.chatRoomId = ?`;
        params.push(chatRoomId);
      }
      if (messageId) {
        whereClause += ` AND m.id = ?`;
        params.push(messageId);
      }

      const selectSql = `
        SELECT 
          m.id AS messageId,
          m.chatRoomId,
          m.type AS originalType,
          m.content AS originalContent,
          m.createdAt AS sentAt,
          u.id AS senderId,
          u.nickName AS senderName,
          u.userNo AS senderNo,
          m.senderRole,
          l.operatorId,
          op.nickName AS operatorName,
          l.operatorRole,
          l.action AS auditAction,
          l.createdAt AS withdrawnAt,
          l.clientIp,
          l.snapshotPayload
        FROM chat_messages m
        LEFT JOIN users u ON m.senderId = u.id AND u.schoolId = m.schoolId
        LEFT JOIN operation_logs l ON l.targetId = m.id AND l.schoolId = m.schoolId AND l.module = 'CHAT_IM'
        LEFT JOIN users op ON l.operatorId = op.id AND op.schoolId = l.schoolId
        WHERE ${whereClause}
        ORDER BY m.id DESC
        LIMIT ? OFFSET ?
      `;

      params.push(pageSize, offset);
      const res = await executeQuery<any[]>(selectSql, params);
      const rows = (res.status === 1 && res.data) ? res.data : [];
      const auditList = this.mapAuditRows(rows);

      return {
        code: 200,
        message: "调阅成功",
        data: {
          page,
          pageSize,
          records: auditList
        }
      };
    } else {
      // 内存沙箱查询
      const mockLogs = ChatWithdrawService.getMockLogs().filter(l => l.schoolId === schoolId);
      const mockMsgs = ChatMessageService.getAllMockMessages().filter(m => m.schoolId === schoolId && m.isWithDraw === 1);

      let targetMsgs = mockMsgs;
      if (chatRoomId) {
        targetMsgs = targetMsgs.filter(m => m.chatRoomId === chatRoomId);
      }
      if (messageId) {
        targetMsgs = targetMsgs.filter(m => m.id === messageId);
      }

      targetMsgs.sort((a, b) => b.id - a.id);
      const pagedMsgs = targetMsgs.slice(offset, offset + pageSize);

      const records: IWithdrawAuditDetailDto[] = pagedMsgs.map(m => {
        const log = mockLogs.find(l => l.targetId === m.id);
        const sentTime = new Date(m.createdAt).getTime();
        const withdrawTime = log ? new Date(log.createdAt).getTime() : sentTime;
        const elapsedSeconds = Math.max(0, Math.floor((withdrawTime - sentTime) / 1000));

        let parsedReason: string | undefined;
        if (log?.snapshotPayload) {
          try {
            const parsed = JSON.parse(log.snapshotPayload);
            parsedReason = parsed.adminReason;
          } catch {
            // 忽略
          }
        }

        return {
          messageId: m.id,
          chatRoomId: m.chatRoomId,
          patrolId: 0,
          patrolOrderNo: `ROOM-${m.chatRoomId}`,
          originalContent: m.content,
          originalType: m.type as ChatMessageType,
          sender: {
            id: m.senderId,
            name: m.senderRole === 1 ? "责任师傅" : "师生同学",
            roleName: m.senderRole === 1 ? "维修师傅" : "报修师生",
            studentOrWorkerNo: `USR-${m.senderId}`
          },
          operator: {
            id: log?.operatorId || m.senderId,
            name: log?.operatorRole === 4 ? "校级管理员" : (m.senderRole === 1 ? "责任师傅" : "发信人"),
            roleName: log?.operatorRole === 4 ? "安全管理员" : "发信人"
          },
          operatorType: log?.action === "ADMIN_FORCE_WITHDRAW"
            ? WithdrawOperatorType.ADMIN_FORCE
            : WithdrawOperatorType.SENDER_SELF,
          withdrawReason: parsedReason,
          sentAt: m.createdAt,
          withdrawnAt: log?.createdAt || m.createdAt,
          elapsedSeconds,
          clientIp: log?.clientIp || "127.0.0.1"
        };
      });

      return {
        code: 200,
        message: "调阅成功",
        data: {
          page,
          pageSize,
          records
        }
      };
    }
  }

  public async handleGetAuditStubs(ctx: IAuditHttpCtx): Promise<StandardResult<any>> {
    const rawRes = await this.getWithdrawnAuditStubs(ctx);
    if (rawRes.code === 200) {
      return returnSuccess(rawRes.data, "调阅成功");
    }
    return returnError(rawRes.message || "调阅失败");
  }

  private mapAuditRows(rows: any[]): IWithdrawAuditDetailDto[] {
    return rows.map((row) => {
      const sentTime = new Date(row.sentAt).getTime();
      const withdrawTime = row.withdrawnAt ? new Date(row.withdrawnAt).getTime() : sentTime;
      const elapsedSeconds = Math.max(0, Math.floor((withdrawTime - sentTime) / 1000));

      let parsedReason: string | undefined;
      if (row.snapshotPayload) {
        try {
          const parsed = JSON.parse(row.snapshotPayload);
          parsedReason = parsed.adminReason;
        } catch {
          // 忽略解析错误
        }
      }

      return {
        messageId: row.messageId,
        chatRoomId: row.chatRoomId,
        patrolId: 0,
        patrolOrderNo: `ROOM-${row.chatRoomId}`,
        originalContent: row.originalContent,
        originalType: row.originalType as ChatMessageType,
        sender: {
          id: row.senderId || 0,
          name: row.senderName || "未知用户",
          roleName: row.senderRole === 1 ? "维修师傅" : "报修师生",
          studentOrWorkerNo: row.senderNo || "N/A"
        },
        operator: {
          id: row.operatorId || 0,
          name: row.operatorName || "未知操作人",
          roleName: row.operatorRole === 4 ? "安全管理员" : "发信人"
        },
        operatorType: row.auditAction === "ADMIN_FORCE_WITHDRAW"
          ? WithdrawOperatorType.ADMIN_FORCE
          : WithdrawOperatorType.SENDER_SELF,
        withdrawReason: parsedReason,
        sentAt: row.sentAt,
        withdrawnAt: row.withdrawnAt || row.sentAt,
        elapsedSeconds,
        clientIp: row.clientIp || "127.0.0.1"
      };
    });
  }
}
