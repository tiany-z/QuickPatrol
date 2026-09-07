/**
 * M21: 隐患提报与 POI 吸附控制器
 * (Patrol & Campus POI Controller)
 */

import { PatrolService } from "./patrolService.js";
import { CampusPoiService } from "./campusPoiService.js";
import { ICreatePatrolRequest } from "./patrolTypes.js";
import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";

export class PatrolController {
  /**
   * 提报隐患工单主处理入口
   */
  public static async createPatrol(
    ctx: { schoolId: number; userId: number; role?: number; ip?: string },
    body: ICreatePatrolRequest
  ): Promise<StandardResult<any>> {
    try {
      if (!ctx.schoolId || !ctx.userId) {
        return returnError("用户未登录或未指定有效高校租户");
      }

      if (!body || typeof body !== "object") {
        return returnError("缺少提报请求体参数");
      }

      const clientIp = ctx.ip || "127.0.0.1";
      const result = await PatrolService.createPatrol(ctx.schoolId, ctx.userId, clientIp, body);
      return returnSuccess(result);
    } catch (err: any) {
      return returnError(err.message || "提报隐患工单失败");
    }
  }

  /**
   * 校内建筑 POI 地图选点吸附处理入口
   */
  public static async snapPoi(
    ctx: { schoolId: number; userId?: number },
    body: { campusId: number; latitude: number; longitude: number }
  ): Promise<StandardResult<any>> {
    try {
      if (!ctx.schoolId) {
        return returnError("缺少高校租户上下文");
      }

      if (!body || typeof body !== "object") {
        return returnError("缺少请求体参数");
      }

      if (!body.campusId || typeof body.latitude !== "number" || typeof body.longitude !== "number") {
        return returnError("缺少校区ID或图钉经纬度数据");
      }

      const snapResult = await CampusPoiService.snapNearestBuilding(
        ctx.schoolId,
        body.campusId,
        body.latitude,
        body.longitude
      );

      return returnSuccess(snapResult);
    } catch (err: any) {
      return returnError(err.message || "校内 POI 空间吸附处理异常");
    }
  }
}
