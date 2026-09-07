/**
 * 高校后勤巡查e速办 v4.0 - M27: 现场施工整改交卷与 Saga 逆序补偿控制器
 * (Patrol Handle & Saga Rollback Controller)
 */

import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";
import { PatrolHandleService } from "./patrolHandleService.js";
import {
  ISubmitPatrolHandleRequestDto,
  ISubmitPatrolHandleResponseDto,
  IPatrolHandleHistoryResponseDto
} from "./patrolHandleTypes.js";

export interface IHandleOperatorContext {
  schoolId: number;
  userId: number;
  role?: number;
  ip?: string;
  realName?: string;
}

export class PatrolHandleController {
  /**
   * POST /api/patrol/handle/submit
   * 师傅现场完工交卷处理入口
   */
  public static async handleSubmitPatrolHandle(
    ctx: IHandleOperatorContext,
    body: ISubmitPatrolHandleRequestDto,
    paramPatrolId?: number
  ): Promise<StandardResult<ISubmitPatrolHandleResponseDto>> {
    try {
      const { schoolId, userId, ip = "127.0.0.1" } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的后勤师傅身份");
      }

      const patrolId = Number(body?.patrolId || paramPatrolId);
      if (!patrolId || isNaN(patrolId) || patrolId <= 0) {
        return returnError("PARAM_ERROR: 非法的工单ID");
      }

      if (!body || !body.content || typeof body.content !== "string" || body.content.trim().length < 5) {
        return returnError("PARAM_ERROR: 施工整改说明至少输入 5 个字符");
      }

      if (!body.images || !Array.isArray(body.images) || body.images.length === 0) {
        return returnError("PARAM_ERROR: 必须上传至少 1 张现场完工照片");
      }

      const parsedHours = Number(body.durationHours);
      if (isNaN(parsedHours) || parsedHours < 0.1 || parsedHours > 120.0) {
        return returnError("PARAM_ERROR: 施工耗时必须在 0.1 至 120.0 小时之间");
      }

      const result = await PatrolHandleService.submitPatrolHandle(
        schoolId,
        patrolId,
        userId,
        {
          patrolId,
          content: body.content.trim(),
          images: body.images,
          durationHours: parsedHours
        },
        ip
      );

      return returnSuccess(result, "现场施工整改交卷成功");
    } catch (err: any) {
      return returnError(err.message || "提交施工整改交卷失败");
    }
  }

  /**
   * GET /api/patrol/handle/history
   * 查询施工整改历史流水
   */
  public static async handleGetHandleHistory(
    ctx: IHandleOperatorContext,
    patrolId: number
  ): Promise<StandardResult<IPatrolHandleHistoryResponseDto>> {
    try {
      const { schoolId } = ctx;
      if (!schoolId) {
        return returnError("未指定高校租户");
      }

      const pId = Number(patrolId);
      if (!pId || isNaN(pId) || pId <= 0) {
        return returnError("PARAM_ERROR: 非法的工单ID");
      }

      const result = await PatrolHandleService.getHandleHistory(schoolId, pId);
      return returnSuccess(result, "获取施工整改历史成功");
    } catch (err: any) {
      return returnError(err.message || "获取施工整改历史失败");
    }
  }
}
