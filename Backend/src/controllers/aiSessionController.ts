/**
 * 高校后勤巡查e速办 v4.0 - M49: AI 会话持久化与智能工单卡片直达
 * 文件路径: src/controllers/aiSessionController.ts
 * 核心职责: 承接小程序端历史会话抽屉、会话详情回溯请求，强制校验 JWT 租户身份与用户归属。
 */

import { aiSessionService } from "../services/aiSessionService.js";

export class AISessionController {
  /**
   * 获取当前登录人的历史会话列表 (分页) 或特定会话详情
   */
  public async handleSessionsRoute(
    req: any,
    res: any,
    query: any,
    userPayload: any
  ): Promise<any> {
    const schoolId = Number(
      userPayload?.schoolId !== undefined
        ? userPayload.schoolId
        : (req?.headers as any)?.["x-school-id"] || 1
    );
    const userId = Number(userPayload?.userId || userPayload?.id || 0);

    if (!schoolId || isNaN(schoolId) || schoolId <= 0 || !userId || userId <= 0) {
      if (res && !res.headersSent && !res.writableEnded) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ code: 401, message: "未授权：缺少租户或用户登录身份" }));
      }
      return { code: 401, message: "未授权：缺少租户或用户登录身份" };
    }

    const targetUuid = (query?.uuid || query?.sessionUuid || "").trim();

    // A. 若传递了 uuid，调取该会话的全量消息流水
    if (targetUuid) {
      const detail = await aiSessionService.getSessionDetail(schoolId, userId, targetUuid);
      if (!detail) {
        if (res && !res.headersSent && !res.writableEnded) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ code: 404, message: "未找到指定会话或已被归档" }));
        }
        return { code: 404, message: "未找到指定会话或已被归档" };
      }

      if (res && !res.headersSent && !res.writableEnded) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ code: 200, data: detail, message: "会话详情调取成功" }));
      }
      return { code: 200, data: detail, message: "会话详情调取成功" };
    }

    // B. 分页拉取历史会话列表
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Number(query?.limit) || 15, 50);

    const list = await aiSessionService.getUserSessionList(schoolId, userId, page, limit);

    if (res && !res.headersSent && !res.writableEnded) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ code: 200, data: list, message: "历史会话拉取成功" }));
    }
    return { code: 200, data: list, message: "历史会话拉取成功" };
  }
}

export const aiSessionController = new AISessionController();
