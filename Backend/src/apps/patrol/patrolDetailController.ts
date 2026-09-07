/**
 * 高校后勤巡查e速办 v4.0 - M30: 巡查工单综合大宽表视图与全景详情控制器
 * (Patrol Detail Panoramic View & Action Controller)
 */

import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";
import { PatrolDetailService } from "./patrolDetailService.js";
import {
  IPatrolPanoramicDetailDto,
  IAbortPatrolRequestDto,
  IAbortPatrolResponseDto
} from "./patrolDetailTypes.js";

export interface IPatrolDetailOperatorContext {
  schoolId: number;
  userId: number;
  role?: number;
  permissions?: string[];
  ip?: string;
  realName?: string;
}

export class PatrolDetailController {
  /**
   * GET /api/patrol/panoramic-detail
   * 获取工单全景大宽表详情、施工对比双图与九维权限掩码
   */
  public static async handleGetPanoramicDetail(
    ctx: IPatrolDetailOperatorContext,
    query: Record<string, any>
  ): Promise<StandardResult<IPatrolPanoramicDetailDto>> {
    try {
      const { schoolId, userId, role = 0, permissions = [] } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的用户身份或租户标识丢失");
      }

      const patrolId = Number(query.patrolId || query.id);
      if (!patrolId || isNaN(patrolId) || patrolId <= 0) {
        return returnError("PARAM_ERROR: 缺少合法有效的工单ID");
      }

      const data = await PatrolDetailService.getPanoramicDetail(schoolId, patrolId, {
        id: userId,
        role,
        permissions
      });

      return returnSuccess(data);
    } catch (err: any) {
      return returnError(err.message || "获取工单全景详情失败");
    }
  }

  /**
   * POST /api/patrol/abort
   * 异常废单工单作废终止协议入口
   */
  public static async handleAbortPatrol(
    ctx: IPatrolDetailOperatorContext,
    body: IAbortPatrolRequestDto & { patrolId?: number }
  ): Promise<StandardResult<IAbortPatrolResponseDto>> {
    try {
      const { schoolId, userId, role = 0, realName, ip = "127.0.0.1" } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的用户身份或租户标识丢失");
      }

      const patrolId = Number(body?.patrolId);
      if (!patrolId || isNaN(patrolId) || patrolId <= 0) {
        return returnError("PARAM_ERROR: 缺少合法有效的工单ID");
      }

      if (!body || !body.reason || body.reason.trim().length < 5) {
        return returnError("PARAM_ERROR: 请至少输入 5 个字符的客观作废原因说明");
      }

      const res = await PatrolDetailService.abortPatrol(
        schoolId,
        patrolId,
        { id: userId, role, realName },
        { reason: body.reason.trim() },
        ip
      );

      return returnSuccess(res);
    } catch (err: any) {
      return returnError(err.message || "申请作废工单失败");
    }
  }
}
