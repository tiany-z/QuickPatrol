/**
 * 高校后勤巡查e速办 v4.0 - M28: 质检复核到场核验与合格/驳回状态机控制器
 * (Patrol Review & Inspection State Machine Controller)
 */

import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";
import { PatrolReviewService } from "./patrolReviewService.js";
import {
  ISubmitPatrolReviewRequestDto,
  ISubmitPatrolReviewResponseDto,
  IPatrolReviewHistoryResponseDto,
  PatrolReviewPassedEnum
} from "./patrolReviewTypes.js";
import { IReviewerContext } from "./reviewUtils.js";

export interface IReviewOperatorContext {
  schoolId: number;
  userId: number;
  role?: number;
  permissions?: string[];
  ip?: string;
  realName?: string;
}

export class PatrolReviewController {
  /**
   * POST /api/patrol/review/submit
   * 质检复核人员到场核验交卷入口
   */
  public static async handleSubmitPatrolReview(
    ctx: IReviewOperatorContext,
    body: ISubmitPatrolReviewRequestDto & { patrolId?: number },
    paramPatrolId?: number
  ): Promise<StandardResult<ISubmitPatrolReviewResponseDto>> {
    try {
      const { schoolId, userId, role = 0, permissions = [], ip = "127.0.0.1" } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的质检复核身份");
      }

      const patrolId = Number(body?.patrolId || paramPatrolId);
      if (!patrolId || isNaN(patrolId) || patrolId <= 0) {
        return returnError("PARAM_ERROR: 非法的工单ID");
      }

      if (!body || (body.isPassed !== 0 && body.isPassed !== 1)) {
        return returnError("PARAM_ERROR: isPassed 必须指定为 0 (驳回) 或 1 (合格)");
      }

      const reviewerContext: IReviewerContext = {
        id: userId,
        role,
        permissions
      };

      const result = await PatrolReviewService.submitPatrolReview(
        schoolId,
        patrolId,
        reviewerContext,
        {
          isPassed: body.isPassed,
          remark: body.remark,
          images: body.images
        },
        ip
      );

      const successMsg =
        result.isPassed === PatrolReviewPassedEnum.PASSED
          ? "质检复核合格，工单已办结进入待评价"
          : "质检复核不合格驳回，工单已打回责任师傅返工";

      return returnSuccess(result, successMsg);
    } catch (err: any) {
      return returnError(err.message || "提交质检复核失败");
    }
  }

  /**
   * GET /api/patrol/review/history
   * 查询指定工单的质检复核全生命周期历史流水
   */
  public static async handleGetReviewHistory(
    ctx: IReviewOperatorContext,
    patrolId: number
  ): Promise<StandardResult<IPatrolReviewHistoryResponseDto>> {
    try {
      const { schoolId } = ctx;
      if (!schoolId) {
        return returnError("未指定高校租户");
      }

      const pId = Number(patrolId);
      if (!pId || isNaN(pId) || pId <= 0) {
        return returnError("PARAM_ERROR: 非法的工单ID");
      }

      const result = await PatrolReviewService.getReviewHistory(schoolId, pId);
      return returnSuccess(result, "获取质检复核历史成功");
    } catch (err: any) {
      return returnError(err.message || "获取质检复核历史失败");
    }
  }
}
