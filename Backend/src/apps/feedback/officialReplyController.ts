/**
 * 高校后勤巡查e速办 v4.0 - M32: 诉求责任科室流转与官方正式答复控制器
 * (Official Reply Controller)
 */

import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";
import { OfficialReplyService } from "./officialReplyService.js";
import {
  IClaimAppealDto,
  IRejectDeptDto,
  IAssignDeptDto,
  ISubmitReplyRequestDto,
  ISubmitReplyResponseDto,
  ISendThanksCardRequestDto,
  ISendThanksCardResponseDto,
  IPromoteToPublicSpaceDto
} from "./officialReplyTypes.js";

export interface IOfficialReplyContext {
  schoolId: number;
  userId: number;
  role?: number;
  departmentId?: number;
  ip?: string;
}

export class OfficialReplyController {
  /**
   * POST /api/v4/feedback/appeals/claim
   * 科室主管认领诉求
   */
  public static async handleClaimAppeal(
    ctx: IOfficialReplyContext,
    body: IClaimAppealDto
  ): Promise<StandardResult<{ message: string }>> {
    try {
      const { schoolId, userId, role = 0, departmentId: ctxDeptId } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的用户身份或租户标识丢失");
      }

      // 仅科室主管 (role=2)、质检复核人 (role=3)、校管 (role=4) 可认领
      if (![2, 3, 4].includes(role)) {
        return returnError("越权拦截: 仅后勤责任科室经办人或管理员有权认领诉求");
      }

      const appealId = Number(body?.appealId);
      const departmentId = Number(body?.departmentId || ctxDeptId || 0);

      if (!appealId || isNaN(appealId) || appealId <= 0) {
        return returnError("PARAM_ERROR: 缺少合法有效的诉求 ID");
      }

      if (!departmentId || isNaN(departmentId) || departmentId <= 0) {
        return returnError("PARAM_ERROR: 操作人未绑定有效职能科室");
      }

      await OfficialReplyService.claimAppeal(schoolId, appealId, userId, departmentId);
      return returnSuccess({ message: "认领成功，诉求已纳入本科室承办流" });
    } catch (err: any) {
      return returnError(err.message || "认领承办诉求失败");
    }
  }

  /**
   * POST /api/v4/feedback/appeals/reject-to-office
   * 部门职责不符申请退单至综合办仲裁
   */
  public static async handleRejectToOffice(
    ctx: IOfficialReplyContext,
    body: IRejectDeptDto
  ): Promise<StandardResult<{ message: string }>> {
    try {
      const { schoolId, userId, role = 0 } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的用户身份或租户标识丢失");
      }

      if (![2, 3, 4].includes(role)) {
        return returnError("越权拦截: 仅科室经办人或管理员有权申请退单仲裁");
      }

      const appealId = Number(body?.appealId);
      const rejectReason = body?.rejectReason;

      if (!appealId || isNaN(appealId) || appealId <= 0) {
        return returnError("PARAM_ERROR: 缺少合法有效的诉求 ID");
      }

      if (!rejectReason || typeof rejectReason !== "string" || rejectReason.trim().length < 5) {
        return returnError("PARAM_ERROR: 申请退回理由不能少于 5 个字");
      }

      await OfficialReplyService.rejectToOffice(schoolId, appealId, userId, rejectReason.trim());
      return returnSuccess({ message: "退单申请已递交后勤综合办仲裁处理" });
    } catch (err: any) {
      return returnError(err.message || "申请退回仲裁失败");
    }
  }

  /**
   * POST /api/v4/feedback/appeals/assign-department
   * 综合办公室人工/强制指派科室
   */
  public static async handleForceAssignDept(
    ctx: IOfficialReplyContext,
    body: IAssignDeptDto
  ): Promise<StandardResult<{ message: string }>> {
    try {
      const { schoolId, userId, role = 0 } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的用户身份或租户标识丢失");
      }

      // 仅综合办/质检复核主管 (role=3) 或校管 (role=4) 拥有行政强制仲裁派发权
      if (![3, 4].includes(role)) {
        return returnError("越权拦截: 仅后勤综合管理办或校管有权进行行政仲裁派发");
      }

      const appealId = Number(body?.appealId);
      const targetDepartmentId = Number(body?.targetDepartmentId);

      if (!appealId || isNaN(appealId) || appealId <= 0) {
        return returnError("PARAM_ERROR: 缺少合法有效的诉求 ID");
      }

      if (!targetDepartmentId || isNaN(targetDepartmentId) || targetDepartmentId <= 0) {
        return returnError("PARAM_ERROR: 缺少目标责任科室 ID");
      }

      await OfficialReplyService.forceAssignDepartment(
        schoolId,
        appealId,
        userId,
        targetDepartmentId,
        body.assignNote || "综合办统一调度指派",
        Boolean(body.isLocked)
      );

      return returnSuccess({ message: "诉求已强制指派至指定科室主办，已锁定防推单" });
    } catch (err: any) {
      return returnError(err.message || "强制指派责任科室失败");
    }
  }

  /**
   * POST /api/v4/feedback/appeals/official-reply
   * 科室出具官方正式红头答复公函
   */
  public static async handleSubmitReply(
    ctx: IOfficialReplyContext,
    body: ISubmitReplyRequestDto
  ): Promise<StandardResult<ISubmitReplyResponseDto>> {
    try {
      const { schoolId, userId, role = 0, departmentId = 1 } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的用户身份或租户标识丢失");
      }

      if (![2, 3, 4].includes(role)) {
        return returnError("越权拦截: 仅科室负责人可发布官方正式答复公函");
      }

      const { appealId, decreeTitle, responderTitle, content, imageUrls, promiseDays } = body || {};

      if (!appealId || isNaN(Number(appealId)) || Number(appealId) <= 0) {
        return returnError("PARAM_ERROR: 缺少合法有效的诉求 ID");
      }

      if (!decreeTitle || typeof decreeTitle !== "string" || decreeTitle.trim().length < 5 || decreeTitle.trim().length > 50) {
        return returnError("PARAM_ERROR: 公函标题必须在 5 ~ 50 字之间");
      }

      if (!content || typeof content !== "string" || content.trim().length < 20) {
        return returnError("PARAM_ERROR: 官方正式答复正文不能少于 20 个字，请详实说明调查情况与整改举措");
      }

      const dto: ISubmitReplyRequestDto = {
        appealId: Number(appealId),
        decreeTitle: decreeTitle.trim(),
        responderTitle: responderTitle?.trim() || "后勤责任科室主管",
        content: content.trim(),
        imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
        promiseDays: parseInt(String(promiseDays), 10) || 3
      };

      const result = await OfficialReplyService.submitOfficialReply(
        schoolId,
        Number(appealId),
        userId,
        departmentId,
        dto
      );

      return returnSuccess(result);
    } catch (err: any) {
      return returnError(err.message || "发布官方答复公函失败");
    }
  }

  /**
   * POST /api/v4/feedback/appeals/send-thanks-card
   * 师生向科室赠送文创感谢卡
   */
  public static async handleSendThanksCard(
    ctx: IOfficialReplyContext,
    body: ISendThanksCardRequestDto
  ): Promise<StandardResult<ISendThanksCardResponseDto>> {
    try {
      const { schoolId, userId } = ctx;
      if (!schoolId) {
        return returnError("缺少高校租户标识");
      }

      const { appealId, cardType, studentComment, vaultToken } = body || {};

      if (!appealId || isNaN(Number(appealId)) || Number(appealId) <= 0) {
        return returnError("PARAM_ERROR: 缺少合法有效的诉求 ID");
      }

      if (!["SPEED", "WARMTH", "ACTION", "PRAISE"].includes(cardType)) {
        return returnError("PARAM_ERROR: 感谢卡种类标识不合法");
      }

      if (!studentComment || typeof studentComment !== "string" || studentComment.trim().length < 3) {
        return returnError("PARAM_ERROR: 感谢寄语至少输入 3 个字");
      }

      const dto: ISendThanksCardRequestDto = {
        appealId: Number(appealId),
        cardType,
        studentComment: studentComment.trim(),
        vaultToken
      };

      const result = await OfficialReplyService.sendThanksCard(schoolId, userId || 0, dto);
      return returnSuccess(result);
    } catch (err: any) {
      return returnError(err.message || "赠送文创感谢卡失败");
    }
  }

  /**
   * POST /api/v4/feedback/appeals/promote-to-public
   * 将优秀办结诉求推选至 M33 校园公开空间
   */
  public static async handlePromoteToPublic(
    ctx: IOfficialReplyContext,
    body: IPromoteToPublicSpaceDto
  ): Promise<StandardResult<{ message: string }>> {
    try {
      const { schoolId, userId, role = 0 } = ctx;
      if (!schoolId || !userId) {
        return returnError("未授权的用户身份或租户标识丢失");
      }

      if (![3, 4].includes(role)) {
        return returnError("越权拦截: 仅后勤主管或校级管理员有权推选公开动态");
      }

      const appealId = Number(body?.appealId);
      if (!appealId || isNaN(appealId) || appealId <= 0) {
        return returnError("PARAM_ERROR: 缺少合法有效的诉求 ID");
      }

      await OfficialReplyService.promoteToPublicSpace(
        schoolId,
        appealId,
        userId,
        Boolean(body.isTop)
      );

      return returnSuccess({ message: "已成功推选至全校公开空间展示" });
    } catch (err: any) {
      return returnError(err.message || "推选公开动态失败");
    }
  }

  /**
   * GET /api/v4/feedback/appeals/detail
   * 获取诉求详情 (支持 ETag 304 快速放行与官方答复提取)
   */
  public static async handleGetAppealDetail(
    ctx: IOfficialReplyContext,
    params: { appealId: number | string; clientETag?: string; vaultToken?: string }
  ): Promise<StandardResult<any>> {
    try {
      const { schoolId } = ctx;
      if (!schoolId) {
        return returnError("缺少高校租户标识");
      }

      const appealId = Number(params?.appealId);
      if (!appealId || isNaN(appealId) || appealId <= 0) {
        return returnError("PARAM_ERROR: 缺少合法有效的诉求 ID");
      }

      const result = await OfficialReplyService.getAppealDetail(
        schoolId,
        appealId,
        params.clientETag,
        params.vaultToken
      );

      return returnSuccess(result);
    } catch (err: any) {
      return returnError(err.message || "获取诉求详情失败");
    }
  }
}
