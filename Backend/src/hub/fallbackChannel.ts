/**
 * 高校后勤巡查e速办 v4.0 - M43: 外部多级穿透降级通道中枢 (Fallback Channel)
 * (Two-Tier Fallback Channel & Auto-Healing Sorter - Algorithm 4)
 */

import { ExternalPushStatus, IPenetrationResultDto } from "./presenceTypes.js";
import { AntiHarassmentQuotaLimiter } from "./antiHarassmentQuotaLimiter.js";
import { IRedisPipelineClient } from "../shared/resilience/tokenBucketLimiter.js";

export interface IDbExecutor {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
}

export class FallbackChannel {
  // 内存用户与消息模拟存储 (用于单元测试脱机环境)
  private static mockUsers: Map<string, { openId: string; phone: string }> = new Map();

  constructor(
    private readonly db?: IDbExecutor,
    private readonly redis?: IRedisPipelineClient | any
  ) {}

  /**
   * 执行到期延迟穿透裁决 (算法 4)
   * 包含：已读自愈熔断 ➔ Tier-1 微信订阅消息 ➔ Tier-2 运营商短信 (特急险情与配额限制)
   */
  public async executeFallbackPenetration(
    schoolId: number,
    receiverId: number,
    messageId: number,
    priority: "low" | "normal" | "urgent"
  ): Promise<IPenetrationResultDto> {
    const startTime = Date.now();

    // 1. 检查该消息是否已被用户在端内阅读 (算法 4 关键自愈熔断: Ghost Task Cancellation)
    const msgRecord = await this.queryMessageRecord(schoolId, messageId);
    if (!msgRecord) {
      return {
        messageId,
        receiverId,
        finalStatus: ExternalPushStatus.NONE,
        channelUsed: "NONE",
        costTimeMs: Date.now() - startTime,
        suppressReason: "消息已被清理"
      };
    }

    if (msgRecord.isRead === 1) {
      // 关键自愈: 用户已在 180s 缓冲期内打开系统阅毕，直接取消外部穿透推送
      return {
        messageId,
        receiverId,
        finalStatus: ExternalPushStatus.NONE,
        channelUsed: "NONE",
        costTimeMs: Date.now() - startTime,
        suppressReason: "用户已在缓冲期内阅读完毕，自愈熔断"
      };
    }

    // 2. 查询接收人微信 openId 与手机号码
    const user = await this.queryUserRecord(schoolId, receiverId);
    if (!user) {
      await this.updateMessageStatus(schoolId, messageId, ExternalPushStatus.FAILED, 0);
      return {
        messageId,
        receiverId,
        finalStatus: ExternalPushStatus.FAILED,
        channelUsed: "NONE",
        costTimeMs: Date.now() - startTime,
        suppressReason: "接收人不存在"
      };
    }

    // 3. 执行 Tier-1: 微信服务号/小程序订阅模板消息推送 (0 成本精准触达)
    let wxSuccess = false;
    if (user.openId && user.openId.startsWith("o")) {
      try {
        wxSuccess = await this.sendWxSubscribeMessage(schoolId, user.openId, msgRecord.title, msgRecord.content);
      } catch {
        wxSuccess = false;
      }
    }

    if (wxSuccess) {
      await this.updateMessageStatus(schoolId, messageId, ExternalPushStatus.WX_SENT, 0);
      return {
        messageId,
        receiverId,
        finalStatus: ExternalPushStatus.WX_SENT,
        channelUsed: "WX_SUBSCRIBE",
        costTimeMs: Date.now() - startTime
      };
    }

    // 4. 微信推送失败或无 OpenId，执行降级裁决
    // 铁律: 仅特急重大险情 (priority === 'urgent') 允许降级动用短信通道
    if (priority !== "urgent") {
      await this.updateMessageStatus(schoolId, messageId, ExternalPushStatus.FAILED, 0);
      return {
        messageId,
        receiverId,
        finalStatus: ExternalPushStatus.FAILED,
        channelUsed: "NONE",
        costTimeMs: Date.now() - startTime,
        suppressReason: "普通通知不允许动用短信通道骚扰师生"
      };
    }

    // 5. 执行 Tier-2: 运营商特急短信终极兜底 (受算法 3 防骚扰配额限流强约束)
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!user.phone || !phoneRegex.test(user.phone)) {
      await this.updateMessageStatus(schoolId, messageId, ExternalPushStatus.FAILED, 0);
      return {
        messageId,
        receiverId,
        finalStatus: ExternalPushStatus.FAILED,
        channelUsed: "NONE",
        costTimeMs: Date.now() - startTime,
        suppressReason: "用户未绑定有效大陆手机号"
      };
    }

    // 算法 3: 每日 3 条配额硬顶 + 300 秒防刷冷却锁校验
    const quotaCheck = await AntiHarassmentQuotaLimiter.checkAndConsumeSmsQuota(
      this.redis,
      schoolId,
      receiverId
    );
    if (!quotaCheck.allowed) {
      await this.updateMessageStatus(schoolId, messageId, ExternalPushStatus.FAILED, 0);
      return {
        messageId,
        receiverId,
        finalStatus: ExternalPushStatus.FAILED,
        channelUsed: "SMS_CARRIER",
        costTimeMs: Date.now() - startTime,
        suppressReason: quotaCheck.reason
      };
    }

    // 发送运营商短信
    let smsSent = false;
    try {
      smsSent = await this.sendCarrierSms(schoolId, user.phone, msgRecord.title);
    } catch {
      smsSent = false;
    }

    if (smsSent) {
      await this.updateMessageStatus(schoolId, messageId, ExternalPushStatus.SMS_SENT, 1);
      return {
        messageId,
        receiverId,
        finalStatus: ExternalPushStatus.SMS_SENT,
        channelUsed: "SMS_CARRIER",
        costTimeMs: Date.now() - startTime
      };
    } else {
      await this.updateMessageStatus(schoolId, messageId, ExternalPushStatus.FAILED, 0);
      return {
        messageId,
        receiverId,
        finalStatus: ExternalPushStatus.FAILED,
        channelUsed: "SMS_CARRIER",
        costTimeMs: Date.now() - startTime,
        suppressReason: "运营商短信网关返回发送失败"
      };
    }
  }

  /**
   * 模拟调用微信服务通知接口 (提供单元测试 spy 重写桩点)
   */
  public async sendWxSubscribeMessage(
    _schoolId: number,
    _openId: string,
    _title: string,
    _content: string
  ): Promise<boolean> {
    return true;
  }

  /**
   * 模拟调用腾讯云/阿里云短信开放平台网关 (提供单元测试 spy 重写桩点)
   */
  public async sendCarrierSms(
    _schoolId: number,
    _phone: string,
    _title: string
  ): Promise<boolean> {
    return true;
  }

  // =========================================================================
  // 内部辅助数据访问方法
  // =========================================================================

  private async queryMessageRecord(
    schoolId: number,
    messageId: number
  ): Promise<{ isRead: number; title: string; content: string } | null> {
    if (this.db) {
      try {
        const sql = `SELECT isRead, title, content FROM messages WHERE id = ? AND schoolId = ? LIMIT 1`;
        const rows = await this.db.query<{ isRead: number; title: string; content: string }>(sql, [
          messageId,
          schoolId
        ]);
        if (rows && rows.length > 0) {
          return rows[0];
        }
      } catch {
        // 降级使用空
      }
    }
    return null;
  }

  private async queryUserRecord(
    schoolId: number,
    userId: number
  ): Promise<{ openId: string; phone: string } | null> {
    if (this.db) {
      try {
        const sql = `SELECT openId, phone FROM users WHERE id = ? AND (schoolId = ? OR schoolId = 0) LIMIT 1`;
        const rows = await this.db.query<{ openId: string; phone: string }>(sql, [userId, schoolId]);
        if (rows && rows.length > 0) {
          return rows[0];
        }
      } catch {
        // 降级查内存
      }
    }

    const mockKey = `${schoolId}:${userId}`;
    if (FallbackChannel.mockUsers.has(mockKey)) {
      return FallbackChannel.mockUsers.get(mockKey)!;
    }
    const globalKey = `0:${userId}`;
    if (FallbackChannel.mockUsers.has(globalKey)) {
      return FallbackChannel.mockUsers.get(globalKey)!;
    }

    return null;
  }

  private async updateMessageStatus(
    schoolId: number,
    messageId: number,
    status: ExternalPushStatus,
    smsSent: number
  ): Promise<void> {
    if (this.db) {
      try {
        const sql = `UPDATE messages SET externalPushStatus = ?, smsSent = ? WHERE id = ? AND schoolId = ?`;
        await this.db.execute(sql, [status, smsSent, messageId, schoolId]);
      } catch {
        // 忽略异常
      }
    }
  }

  public static registerMockUser(
    schoolId: number,
    userId: number,
    openId: string,
    phone: string
  ): void {
    this.mockUsers.set(`${schoolId}:${userId}`, { openId, phone });
  }

  public static resetMockData(): void {
    this.mockUsers.clear();
  }
}
