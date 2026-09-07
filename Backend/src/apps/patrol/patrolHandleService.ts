/**
 * 高校后勤巡查e速办 v4.0 - M27: 现场施工整改交卷与 Saga 逆序补偿核心业务中枢
 * (Patrol Handle & Saga Rollback Service)
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import { RowLockManager } from "../../shared/lock/rowLockManager.js";
import { SagaWithdrawStack } from "../../shared/sql/withdrawStack.js";
import { AuditLogger } from "../../shared/log/auditLogger.js";
import { WeChatAuthService } from "../../services/auth/wechatAuthService.js";
import { PatrolService } from "./patrolService.js";
import { ChatService } from "../chat/chatService.js";
import {
  IPatrolHandleEntity,
  ISubmitPatrolHandleRequestDto,
  ISubmitPatrolHandleResponseDto,
  IPatrolHandleHistoryResponseDto,
  IPatrolHandleItemDto
} from "./patrolHandleTypes.js";
import { verifyEvidenceImages, validateDurationHours } from "./handleUtils.js";

// 内存测试沙箱字典 (支持离线单元测试与脱机闭环)
const mockHandleRecordsMap = new Map<number, IPatrolHandleEntity>();
let mockHandleIdCounter = 5500;

// 下游外部通知钩子函数 (支持单测动态注入以模拟外部微服务超时与网络崩溃)
let downstreamNotificationHook: ((context: { schoolId: number; patrolId: number; handlerId: number; title: string }) => Promise<void>) | null = null;

export class PatrolHandleService {
  /**
   * 注册虚拟整改记录桩点 (用于单元测试)
   */
  public static mockRegisterHandleRecord(
    record: Partial<IPatrolHandleEntity> & { schoolId: number; patrolId: number; handlerId: number }
  ): IPatrolHandleEntity {
    const id = record.id || ++mockHandleIdCounter;
    const entity: IPatrolHandleEntity = {
      id,
      schoolId: record.schoolId,
      patrolId: record.patrolId,
      handlerId: record.handlerId,
      content: record.content || "现场故障已修复",
      imagesJson: Array.isArray(record.imagesJson) ? record.imagesJson : [],
      durationHours: record.durationHours || 1.0,
      createdAt: record.createdAt || new Date().toISOString()
    };
    mockHandleRecordsMap.set(id, entity);
    return entity;
  }

  /**
   * 获取测试沙箱指定整改记录
   */
  public static getMockHandleRecord(id: number): IPatrolHandleEntity | undefined {
    return mockHandleRecordsMap.get(id);
  }

  /**
   * 清空测试沙箱全部整改数据
   */
  public static clearMockData(): void {
    mockHandleRecordsMap.clear();
    mockHandleIdCounter = 5500;
    downstreamNotificationHook = null;
  }

  /**
   * 设置下游通知模拟钩子 (用于单测模拟微信服务超时与 Saga 回滚)
   */
  public static setDownstreamNotificationHook(
    hook: ((context: { schoolId: number; patrolId: number; handlerId: number; title: string }) => Promise<void>) | null
  ): void {
    downstreamNotificationHook = hook;
  }

  /**
   * 1. 师傅现场完工交卷核心正向编排与 Saga 逆序补偿事务
   */
  public static async submitPatrolHandle(
    schoolId: number,
    patrolId: number,
    handlerId: number,
    dto: ISubmitPatrolHandleRequestDto,
    clientIp: string = "127.0.0.1"
  ): Promise<ISubmitPatrolHandleResponseDto> {
    const requestId = `req_handle_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const saga = new SagaWithdrawStack();

    // 1.1 申请工单行级排他锁 (防止弱网环境下并发重复交卷)
    const lockRes = await RowLockManager.acquireRowLock(
      schoolId,
      "patrols",
      patrolId,
      "UPDATE",
      requestId,
      3000
    );

    if (lockRes.status === 0 || !lockRes.data) {
      throw new Error("CONCURRENT_LOCK_BUSY: 系统繁忙，正在处理当前工单，请稍后重试");
    }

    try {
      // 1.2 前置参数防御性校验
      if (!dto || !dto.content || dto.content.trim().length < 5) {
        throw new Error("PARAM_ERROR: 施工整改说明至少输入 5 个字符");
      }

      const validatedImages = verifyEvidenceImages(schoolId, patrolId, dto.images);
      const validatedDuration = validateDurationHours(dto.durationHours);

      // 1.3 查询工单现状并校验
      let patrol: any = PatrolService.getMockPatrol(patrolId);
      if (!patrol && getMySQLPool()) {
        const pRes = await executeQuery(
          `SELECT id, status, currentHandlerId, title FROM patrols WHERE id = ? AND schoolId = ? LIMIT 1`,
          [patrolId, schoolId]
        );
        if (pRes.status === 1 && pRes.data && pRes.data.length > 0) {
          patrol = pRes.data[0];
        }
      }

      if (!patrol) {
        throw new Error("PATROL_NOT_FOUND: 目标工单不存在或无权访问");
      }

      // 1.4 状态门禁：必须处于进行中 (status = 1)
      if (Number(patrol.status) !== 1) {
        throw new Error(`INVALID_STATUS_FOR_HANDLE: 仅进行中的工单可提交完工 (当前状态: ${patrol.status})`);
      }

      // 1.5 责任人一致性检查：只有当前接单师傅有权提交完工
      if (Number(patrol.currentHandlerId) !== handlerId) {
        throw new Error("FORBIDDEN_NOT_CURRENT_HANDLER: 您不是该工单当前绑定的责任人，无权交卷");
      }

      const now = new Date();

      // 1.6 步骤 1: 写入整改记录表 patrols_handle
      const createdRecord = this.mockRegisterHandleRecord({
        schoolId,
        patrolId,
        handlerId,
        content: dto.content.trim(),
        imagesJson: validatedImages,
        durationHours: validatedDuration,
        createdAt: now.toISOString()
      });
      const handleId = createdRecord.id;

      if (getMySQLPool()) {
        await executeQuery(
          `INSERT INTO patrols_handle (id, schoolId, patrolId, handlerId, content, imagesJson, durationHours, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            handleId,
            schoolId,
            patrolId,
            handlerId,
            dto.content.trim(),
            JSON.stringify(validatedImages),
            validatedDuration,
            now
          ]
        );
      }

      // 1.7 步骤 2: 更新工单主表 status = 2 (已整改待复核)
      PatrolService.updateMockPatrol(patrolId, {
        status: 2,
        completedAt: now.toISOString()
      });

      if (getMySQLPool()) {
        await executeQuery(
          `UPDATE patrols SET status = 2, updatedAt = NOW() WHERE id = ? AND schoolId = ?`,
          [patrolId, schoolId]
        );
      }

      // 1.8 注册 Saga 逆序补偿撤销闭包 (Compensate_Local_DB)
      saga.push(async () => {
        // 回退工单状态至 1: 进行中
        PatrolService.updateMockPatrol(patrolId, {
          status: 1,
          completedAt: null
        });

        // 物理抹除整改记录
        mockHandleRecordsMap.delete(handleId);

        if (getMySQLPool()) {
          await executeQuery(
            `UPDATE patrols SET status = 1, updatedAt = NOW() WHERE id = ? AND schoolId = ?`,
            [patrolId, schoolId]
          );
          await executeQuery(
            `DELETE FROM patrols_handle WHERE id = ? AND schoolId = ?`,
            [handleId, schoolId]
          );
        }
      });

      // 1.9 穿透 M25 聊天室：广播工单已完工系统卡片
      await this.injectHandleChatNotice(schoolId, patrolId, validatedDuration);

      // 1.10 下游长链路外部通知调用 (受 Saga 栈全生命周期保护)
      try {
        if (downstreamNotificationHook) {
          await downstreamNotificationHook({
            schoolId,
            patrolId,
            handlerId,
            title: patrol.title || "后勤巡查工单"
          });
        }
      } catch (notifyErr: any) {
        // 下游调用失败，触发 Saga 逆序补偿自动回滚！
        await saga.withdrawAll();
        throw new Error("EXTERNAL_NOTIFY_FAILED: 质检复核通知通道暂不可用，系统已自动恢复工单状态，请检查网络后重新提交");
      }

      // 1.11 审计日志记录
      await AuditLogger.log(schoolId, handlerId, "PATROL_HANDLE_SUBMIT", "patrols_handle", clientIp, {
        patrolId,
        handleId,
        durationHours: validatedDuration
      });

      return {
        handleId,
        patrolId,
        status: 2,
        statusText: "已整改待复核",
        submittedAt: now.toISOString()
      };
    } finally {
      // 释放行级排他锁
      await RowLockManager.releaseRowLock(schoolId, "patrols", patrolId, requestId, true);
    }
  }

  /**
   * 2. 查询工单施工整改历史流水与聚合指标 (支持 1:N 多轮返工追溯)
   */
  public static async getHandleHistory(
    schoolId: number,
    patrolId: number
  ): Promise<IPatrolHandleHistoryResponseDto> {
    let rawList: any[] = [];

    if (getMySQLPool()) {
      const qRes = await executeQuery(
        `SELECT id, schoolId, patrolId, handlerId, content, imagesJson, durationHours, createdAt
         FROM patrols_handle
         WHERE schoolId = ? AND patrolId = ?
         ORDER BY id DESC`,
        [schoolId, patrolId]
      );
      if (qRes.status === 1 && qRes.data && qRes.data.length > 0) {
        rawList = qRes.data;
      }
    }

    if (rawList.length === 0) {
      for (const r of mockHandleRecordsMap.values()) {
        if (r.schoolId === schoolId && r.patrolId === patrolId) {
          rawList.push(r);
        }
      }
      rawList.sort((a, b) => b.id - a.id);
    }

    let cumulativeDuration = 0;
    const records: IPatrolHandleItemDto[] = rawList.map((r: any) => {
      const hours = Number(r.durationHours) || 0;
      cumulativeDuration += hours;

      let images: string[] = [];
      try {
        images = typeof r.imagesJson === "string" ? JSON.parse(r.imagesJson) : (r.imagesJson || []);
      } catch {
        images = Array.isArray(r.imagesJson) ? r.imagesJson : [];
      }

      const user = WeChatAuthService.getMockUserById(r.handlerId);

      return {
        handleId: Number(r.id),
        handlerId: Number(r.handlerId),
        handlerName: r.handlerName || user?.realName || "维修师傅",
        handlerPhone: r.handlerPhone || user?.phone || "",
        content: r.content || "",
        images,
        durationHours: hours,
        createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(r.createdAt).toISOString()
      };
    });

    return {
      patrolId,
      totalRounds: records.length,
      cumulativeDurationHours: Math.round(cumulativeDuration * 100) / 100,
      records
    };
  }

  /**
   * 内部辅助：联动 M25 聊天室下发完工通报卡片
   */
  private static async injectHandleChatNotice(
    schoolId: number,
    patrolId: number,
    durationHours: number
  ): Promise<void> {
    try {
      for (let i = 1; i <= 10000; i++) {
        const room = ChatService.getMockRoom(i);
        if (room && room.schoolId === schoolId && room.patrolId === patrolId) {
          await ChatService.sendMessage(schoolId, 0, 9 as any, {
            chatRoomId: room.id,
            type: 2, // 2: 工单进度卡片
            content: `【师傅已完成现场抢修整改】 师傅已提交完工实证，耗时 ${durationHours} 小时，请等待质检专家到场复核。`
          });
          break;
        }
      }
    } catch {
      // 容错不阻塞主事务
    }
  }
}
