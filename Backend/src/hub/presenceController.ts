/**
 * 高校后勤巡查e速办 v4.0 - M43: 用户在线感知与心跳端点控制器
 * (Presence API Controller)
 */

import { PresenceEngine } from "./presenceEngine.js";
import { IPresenceHttpCtx } from "./presenceTypes.js";
import { returnError, returnSuccess, StandardResult } from "../shared/flow/result.js";

export class PresenceController {
  constructor(private readonly presenceEngine: PresenceEngine = new PresenceEngine()) {}

  /**
   * POST /api/v4/presence/heartbeat
   * 客户端心跳保活上报 (HTTP 兜底通道)
   */
  public async heartbeat(ctx: IPresenceHttpCtx): Promise<any> {
    const { schoolId, userId, body } = ctx;

    if (!schoolId || !userId) {
      return { code: 400, message: "参数缺失: schoolId 或 userId 未提供" };
    }

    const isForeground = body?.isForeground !== false && body?.isForeground !== "false";

    try {
      await this.presenceEngine.refreshHeartbeat(schoolId, userId, isForeground);
      return {
        code: 200,
        message: "心跳已刷新",
        data: {
          schoolId,
          userId,
          status: isForeground ? "active" : "idle",
          timestamp: new Date().toISOString()
        }
      };
    } catch (err: unknown) {
      return { code: 500, message: (err as Error).message || "刷新在线心跳失败" };
    }
  }

  public async handleHeartbeat(ctx: IPresenceHttpCtx): Promise<StandardResult<any>> {
    const res = await this.heartbeat(ctx);
    if (res.code === 200) {
      return returnSuccess(res.data, res.message);
    }
    return returnError(res.message);
  }

  /**
   * GET /api/v4/presence/status
   * 查询指定用户的在线感知状态
   */
  public async getStatus(ctx: IPresenceHttpCtx): Promise<any> {
    const { schoolId, query, params, body } = ctx;
    const targetUserId = Number(query?.userId || params?.userId || body?.userId || ctx.userId);

    if (!schoolId || !targetUserId) {
      return { code: 400, message: "参数缺失: schoolId 或 targetUserId 未提供" };
    }

    try {
      const state = await this.presenceEngine.getUserPresenceState(schoolId, targetUserId);
      return {
        code: 200,
        message: "查询成功",
        data: state
      };
    } catch (err: unknown) {
      return { code: 500, message: (err as Error).message || "查询用户在线状态失败" };
    }
  }

  public async handleGetStatus(ctx: IPresenceHttpCtx): Promise<StandardResult<any>> {
    const res = await this.getStatus(ctx);
    if (res.code === 200) {
      return returnSuccess(res.data, res.message);
    }
    return returnError(res.message);
  }
}
