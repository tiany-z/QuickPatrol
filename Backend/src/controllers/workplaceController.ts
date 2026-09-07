/**
 * 高校后勤巡查e速办 v4.0 - M50 飞书工作台微应用矩阵与动态门禁
 * 文件路径: src/controllers/workplaceController.ts
 * 核心职责: 提供小程序工作台聚合数据接口与自定义置顶持久化接口。
 */

import { workplaceService } from "../services/workplaceService.js";
import { IWorkplaceSortPayloadDto } from "../contracts/workplaceContract.js";

export class WorkplaceController {
  /**
   * 拉取当前用户/访客的工作台聚合视图
   * 支持免密/访客态 (userId = 0) 及角色与标签复合鉴权
   */
  public async handleGetApps(
    req: any,
    res: any,
    query: any,
    userPayload?: any
  ): Promise<any> {
    const schoolId = Number(
      userPayload?.schoolId !== undefined
        ? userPayload.schoolId
        : (req?.headers as any)?.["x-school-id"] || query?.schoolId || 1
    );

    const userId = Number(userPayload?.userId || userPayload?.id || 0);
    const userRole = Number(userPayload?.role ?? (query?.role ? Number(query.role) : 0));

    let userTagIds: number[] = [];
    if (Array.isArray(userPayload?.tagIds)) {
      userTagIds = userPayload.tagIds.map(Number).filter((n: number) => !isNaN(n));
    } else if (Array.isArray(userPayload?.tags)) {
      userTagIds = userPayload.tags.map(Number).filter((n: number) => !isNaN(n));
    }

    const view = await workplaceService.getWorkplaceView({
      schoolId,
      userId,
      userRole,
      userTagIds
    });

    if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      if (typeof res.end === "function") {
        res.end(JSON.stringify({ code: 200, data: view, message: "获取工作台配置成功" }));
      }
    }

    return { code: 200, data: view, message: "获取工作台配置成功" };
  }

  /**
   * 保存当前登录用户的置顶微应用排序列表
   */
  public async handleSavePins(
    req: any,
    res: any,
    body: IWorkplaceSortPayloadDto,
    userPayload: any
  ): Promise<any> {
    const schoolId = Number(
      userPayload?.schoolId !== undefined
        ? userPayload.schoolId
        : (req?.headers as any)?.["x-school-id"] || 1
    );
    const userId = Number(userPayload?.userId || userPayload?.id || 0);

    if (!schoolId || isNaN(schoolId) || schoolId <= 0 || !userId || userId <= 0) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 401, message: "未授权：请先登录后再保存置顶应用" }));
        }
      }
      return { code: 401, message: "未授权：请先登录后再保存置顶应用" };
    }

    const pinnedKeys = body?.pinnedAppCodes || body?.pinnedAppKeys;
    if (!body || !Array.isArray(pinnedKeys)) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 400, message: "参数错误：pinnedAppCodes 必须为应用标识数组" }));
        }
      }
      return { code: 400, message: "参数错误：pinnedAppCodes 必须为应用标识数组" };
    }

    await workplaceService.saveUserPins(userId, schoolId, pinnedKeys);

    if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      if (typeof res.end === "function") {
        res.end(JSON.stringify({ code: 200, data: { success: true }, message: "自定义置顶保存成功" }));
      }
    }

    return { code: 200, data: { success: true }, message: "自定义置顶保存成功" };
  }
}

export const workplaceController = new WorkplaceController();
