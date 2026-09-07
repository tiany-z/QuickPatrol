/**
 * 高校后勤巡查e速办 v4.0 - M29: 满意度五星评价与超时自动好评结案控制器
 * (Feedback Controller)
 */

import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";
import { FeedbackService } from "./feedbackService.js";
import {
  ISubmitFeedbackRequestDto,
  ISubmitFeedbackResponseDto,
  IFeedbackDetailDto,
  IMasterReputationProfileDto
} from "./feedbackTypes.js";

export interface IFeedbackOperatorContext {
  schoolId: number;
  userId: number;
  role?: number;
  permissions?: string[];
  ip?: string;
  realName?: string;
}

export class FeedbackController {
  /**
   * POST /api/patrol/feedback/submit
   * 师生端提交服务评价
   */
  public static async handleSubmitFeedback(
    ctx: IFeedbackOperatorContext,
    body: ISubmitFeedbackRequestDto & { patrolId?: number },
    paramPatrolId?: number
  ): Promise<StandardResult<ISubmitFeedbackResponseDto>> {
    try {
      const { schoolId, userId, ip = "127.0.0.1" } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的提报师生身份或用户未登录");
      }

      const patrolId = Number(body?.patrolId || paramPatrolId);
      if (!patrolId || isNaN(patrolId) || patrolId <= 0) {
        return returnError("PARAM_ERROR: 非法的工单ID");
      }

      const parsedScore = Number(body?.score);
      if (isNaN(parsedScore) || parsedScore < 1 || parsedScore > 5) {
        return returnError("PARAM_ERROR: 综合评分必须在 1 至 5 星之间");
      }

      const result = await FeedbackService.submitFeedback(
        schoolId,
        patrolId,
        userId,
        {
          score: Math.floor(parsedScore),
          speedScore: body.speedScore !== undefined ? Number(body.speedScore) : undefined,
          qualityScore: body.qualityScore !== undefined ? Number(body.qualityScore) : undefined,
          attitudeScore: body.attitudeScore !== undefined ? Number(body.attitudeScore) : undefined,
          comment: body.comment,
          tags: body.tags
        },
        ip
      );

      return returnSuccess(result, "感谢您的真诚评价，您的反馈是我们进步的动力");
    } catch (err: any) {
      return returnError(err.message || "提交满意度评价失败");
    }
  }

  /**
   * GET /api/patrol/feedback/detail
   * 查询工单评价详情
   */
  public static async handleGetFeedbackDetail(
    ctx: IFeedbackOperatorContext,
    patrolId: number
  ): Promise<StandardResult<IFeedbackDetailDto | null>> {
    try {
      const { schoolId } = ctx;
      if (!schoolId) {
        return returnError("未指定高校租户");
      }

      const pId = Number(patrolId);
      if (!pId || isNaN(pId) || pId <= 0) {
        return returnError("PARAM_ERROR: 非法的工单ID");
      }

      const result = await FeedbackService.getFeedbackDetail(schoolId, pId);
      return returnSuccess(result, "获取工单评价成功");
    } catch (err: any) {
      return returnError(err.message || "获取工单评价失败");
    }
  }

  /**
   * GET /api/patrol/feedback/master-reputation
   * 查询师傅个人口碑与画像
   */
  public static async handleGetMasterReputation(
    ctx: IFeedbackOperatorContext,
    masterId: number
  ): Promise<StandardResult<IMasterReputationProfileDto>> {
    try {
      const { schoolId } = ctx;
      if (!schoolId) {
        return returnError("未指定高校租户");
      }

      const mId = Number(masterId);
      if (!mId || isNaN(mId) || mId <= 0) {
        return returnError("PARAM_ERROR: 非法的师傅用户ID");
      }

      const result = await FeedbackService.getMasterReputationProfile(schoolId, mId);
      return returnSuccess(result, "获取师傅口碑画像成功");
    } catch (err: any) {
      return returnError(err.message || "获取师傅口碑画像失败");
    }
  }
}
