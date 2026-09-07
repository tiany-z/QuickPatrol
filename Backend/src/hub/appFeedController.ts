/**
 * 高校后勤巡查e速办 v4.0 - M44: 微应用专属卡片流端点控制器
 * (App Feed Controller)
 */

import { AppFeedService } from "./appFeedService.js";
import { IAppFeedHttpCtx } from "./appFeedTypes.js";
import { returnError, returnSuccess, StandardResult } from "../shared/flow/result.js";

export class AppFeedController {
  constructor(private readonly feedService: AppFeedService = new AppFeedService()) {}

  /**
   * GET /api/v4/notification/app-feed
   * 基于游标分页拉取指定微应用的卡片流
   */
  public async getFeed(ctx: IAppFeedHttpCtx): Promise<any> {
    const { schoolId, userId, query = {}, params = {}, body = {} } = ctx;
    const appId = String(params.appId || query.appId || body.appId || "").trim();

    if (!schoolId || !userId) {
      return { code: 400, message: "参数缺失: schoolId 或 userId 未提供" };
    }

    if (!appId) {
      return { code: 400, message: "缺少必要参数: appId" };
    }

    const cursor = parseInt(String(query.cursorMessageId || query.cursor || 0), 10);
    const pageSize = parseInt(String(query.pageSize || 20), 10);

    try {
      const result = await this.feedService.getAppCardStream(schoolId, userId, appId, cursor, pageSize);
      return result;
    } catch (err: unknown) {
      return { code: 500, message: (err as Error).message || "拉取卡片流失败" };
    }
  }

  public async handleGetFeed(ctx: IAppFeedHttpCtx): Promise<StandardResult<any>> {
    const res = await this.getFeed(ctx);
    if (res.code === 200) {
      return returnSuccess(res.data, res.message);
    }
    return returnError(res.message);
  }

  /**
   * POST /api/v4/notification/app-feed/ack-read
   * 批量将卡片流标为已读
   */
  public async batchAckRead(ctx: IAppFeedHttpCtx): Promise<any> {
    const { schoolId, userId, body = {}, query = {}, params = {} } = ctx;
    const appId = String(body.appId || query.appId || params.appId || "").trim();

    if (!schoolId || !userId) {
      return { code: 400, message: "参数缺失: schoolId 或 userId 未提供" };
    }

    if (!appId) {
      return { code: 400, message: "缺少参数: appId" };
    }

    const rawMessageIds = body.messageIds ?? query.messageIds;
    const messageIds = Array.isArray(rawMessageIds)
      ? rawMessageIds.map((id: any) => Number(id)).filter((id: number) => !isNaN(id))
      : undefined;

    try {
      const res = await this.feedService.batchAckRead(schoolId, userId, appId, messageIds);
      return {
        code: 200,
        message: "已读状态更新成功",
        data: {
          appId,
          ...res
        }
      };
    } catch (err: unknown) {
      return { code: 500, message: (err as Error).message || "更新已读状态失败" };
    }
  }

  public async handleBatchAckRead(ctx: IAppFeedHttpCtx): Promise<StandardResult<any>> {
    const res = await this.batchAckRead(ctx);
    if (res.code === 200) {
      return returnSuccess(res.data, res.message);
    }
    return returnError(res.message);
  }
}
