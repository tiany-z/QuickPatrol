/**
 * 高校后勤巡查e速办 v4.0 - M26: 延期申请与多级审批控制器
 * (Patrol Delay Approval & Lifecycle Extension Controller)
 */

import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";
import { DelayService } from "./delayService.js";
import {
  ICreateDelayApplyRequestDto,
  ICreateDelayApplyResponseDto,
  IReviewDelayApplyRequestDto,
  IReviewDelayApplyResponseDto,
  IPatrolDelayHistoryResponseDto,
  IPatrolDelayItemDto,
  PatrolDelayStatusEnum
} from "./delayTypes.js";

export interface IDelayOperatorContext {
  schoolId: number;
  userId: number;
  role?: number;
  ip?: string;
  realName?: string;
}

export class DelayController {
  /**
   * POST /api/patrol/delay/apply
   * 师傅端提交延期申请
   */
  public static async handleCreateDelayApply(
    ctx: IDelayOperatorContext,
    body: ICreateDelayApplyRequestDto
  ): Promise<StandardResult<ICreateDelayApplyResponseDto>> {
    try {
      const { schoolId, userId, ip = "127.0.0.1" } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的后勤师傅身份");
      }

      if (!body || !body.patrolId) {
        return returnError("缺少必要参数 patrolId");
      }

      const parsedHours = Number(body.delayHours);
      if (isNaN(parsedHours) || parsedHours <= 0 || parsedHours > 168) {
        return returnError("延期时长必须在 1~168 小时之间");
      }

      if (!body.reason || typeof body.reason !== "string" || body.reason.trim().length < 5) {
        return returnError("延期客观理由至少输入 5 个字符");
      }

      const result = await DelayService.createDelayApply(
        schoolId,
        Number(body.patrolId),
        userId,
        {
          patrolId: Number(body.patrolId),
          delayHours: parsedHours,
          reason: body.reason.trim(),
          evidenceImages: Array.isArray(body.evidenceImages) ? body.evidenceImages.slice(0, 6) : []
        },
        ip
      );

      return returnSuccess(result, "延期申请提交成功");
    } catch (err: any) {
      return returnError(err.message || "提交延期申请失败");
    }
  }

  /**
   * POST /api/patrol/delay/review
   * 管理员端线上审批
   */
  public static async handleReviewDelayApply(
    ctx: IDelayOperatorContext,
    body: IReviewDelayApplyRequestDto
  ): Promise<StandardResult<IReviewDelayApplyResponseDto>> {
    try {
      const { schoolId, userId, role = 0, ip = "127.0.0.1" } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的管理员身份");
      }

      if (!body || !body.applyId) {
        return returnError("缺少必要参数 applyId");
      }

      if (body.action !== PatrolDelayStatusEnum.APPROVED && body.action !== PatrolDelayStatusEnum.REJECTED) {
        return returnError("审批动作仅支持 1:同意 或 2:驳回");
      }

      if (body.action === PatrolDelayStatusEnum.REJECTED && (!body.reviewRemark || body.reviewRemark.trim().length === 0)) {
        return returnError("驳回延期申请时必须填写审核批注");
      }

      const result = await DelayService.reviewDelayApply(
        schoolId,
        Number(body.applyId),
        userId,
        role,
        {
          applyId: Number(body.applyId),
          action: body.action,
          reviewRemark: body.reviewRemark ? body.reviewRemark.trim() : ""
        },
        ip
      );

      return returnSuccess(result, "审批操作成功");
    } catch (err: any) {
      return returnError(err.message || "审批处理失败");
    }
  }

  /**
   * GET /api/patrol/delay/history
   * 查询工单全部延期历史流水与聚合指标
   */
  public static async handleGetDelayHistory(
    ctx: IDelayOperatorContext,
    query: { patrolId?: number | string }
  ): Promise<StandardResult<IPatrolDelayHistoryResponseDto>> {
    try {
      const { schoolId } = ctx;
      if (!schoolId) {
        return returnError("未指定学校租户");
      }

      const patrolId = Number(query.patrolId);
      if (!patrolId || isNaN(patrolId) || patrolId <= 0) {
        return returnError("非法的工单ID patrolId");
      }

      const result = await DelayService.getDelayHistory(schoolId, patrolId);
      return returnSuccess(result, "获取延期历史成功");
    } catch (err: any) {
      return returnError(err.message || "获取延期历史失败");
    }
  }

  /**
   * GET /api/patrol/delay/pending
   * 查询全校待审核延期申请列表 (管理端大盘)
   */
  public static async handleGetPendingApplies(
    ctx: IDelayOperatorContext
  ): Promise<StandardResult<IPatrolDelayItemDto[]>> {
    try {
      const { schoolId } = ctx;
      if (!schoolId) {
        return returnError("未指定学校租户");
      }

      const list = await DelayService.getPendingApplies(schoolId);
      return returnSuccess(list, "获取待审延期列表成功");
    } catch (err: any) {
      return returnError(err.message || "获取待审延期列表失败");
    }
  }
}
