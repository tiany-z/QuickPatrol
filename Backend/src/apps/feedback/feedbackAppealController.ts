/**
 * 高校后勤巡查e速办 v4.0 - M31: 师生诉求与绝对匿名加盐散列保险箱控制器
 * (Feedback Appeal & Confidential Vault Controller)
 */

import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";
import { FeedbackAppealService } from "./feedbackAppealService.js";
import {
  ICreateAppealRequestDto,
  ICreateAppealResponseDto,
  IAnonymousAppealDetailDto,
  IAppendInquiryRequestDto,
  IAppendInquiryResponseDto
} from "./feedbackAppealTypes.js";

export interface IFeedbackAppealContext {
  schoolId: number;
  userId: number;
  openId?: string;
  role?: number;
  ip?: string;
  realName?: string;
}

export class FeedbackAppealController {
  /**
   * POST /api/v4/feedback/appeals / POST /api/feedback/appeals/create
   * 提交师生建言诉求 (支持实名/绝对匿名双轨)
   */
  public static async handleSubmitAppeal(
    ctx: IFeedbackAppealContext,
    body: ICreateAppealRequestDto
  ): Promise<StandardResult<ICreateAppealResponseDto>> {
    try {
      const { schoolId, userId, openId = `open_id_${userId}`, ip = "127.0.0.1" } = ctx;

      if (!schoolId || !userId) {
        return returnError("未授权的用户身份或租户标识丢失");
      }

      if (!body || typeof body !== "object") {
        return returnError("PARAM_ERROR: 请求体必须为合法的 JSON 对象");
      }

      const { title, content, isAnonymous, categoryType = "other" } = body;

      if (!title || typeof title !== "string" || title.trim().length < 5 || title.trim().length > 60) {
        return returnError("PARAM_ERROR: 建言标题长度须在 5~60 字之间");
      }

      if (!content || typeof content !== "string" || content.trim().length < 10 || content.trim().length > 1000) {
        return returnError("PARAM_ERROR: 建言详细内容长度须在 10~1000 字之间");
      }

      const dto: ICreateAppealRequestDto = {
        title: title.trim(),
        content: content.trim(),
        categoryType,
        isAnonymous: Boolean(isAnonymous),
        allowPublicDisplay: Boolean(body.allowPublicDisplay),
        imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls : [],
        campusId: body.campusId,
        targetDepartmentId: body.targetDepartmentId,
        contactPhone: isAnonymous ? undefined : body.contactPhone
      };

      const res = await FeedbackAppealService.submitAppeal(schoolId, openId, userId, dto, ip);
      return returnSuccess(res);
    } catch (err: any) {
      return returnError(err.message || "提交建言诉求失败");
    }
  }

  /**
   * POST /api/v4/feedback/appeals/batch-query-by-tokens / POST /api/feedback/appeals/batch-query-by-tokens
   * 凭客户端 Vault Tokens 批量匿名查询办理进展
   */
  public static async handleBatchQueryByTokens(
    ctx: IFeedbackAppealContext,
    body: { vaultTokens: string[] }
  ): Promise<StandardResult<IAnonymousAppealDetailDto[]>> {
    try {
      const { schoolId } = ctx;
      if (!schoolId) {
        return returnError("未授权的高校租户标识");
      }

      const tokens = body?.vaultTokens;
      if (!Array.isArray(tokens)) {
        return returnError("PARAM_ERROR: vaultTokens 必须为字符串数组");
      }

      if (tokens.length > 50) {
        return returnError("PARAM_ERROR: 单次最多支持查询 50 个凭证卡");
      }

      const list = await FeedbackAppealService.batchQueryByVaultTokens(schoolId, tokens);
      return returnSuccess(list);
    } catch (err: any) {
      return returnError(err.message || "凭证卡查询失败");
    }
  }

  /**
   * POST /api/v4/feedback/appeals/append-inquiry / POST /api/feedback/appeals/append-inquiry
   * 凭借 Vault Token 进行针对答复的匿名追问
   */
  public static async handleAppendInquiry(
    ctx: IFeedbackAppealContext,
    body: IAppendInquiryRequestDto
  ): Promise<StandardResult<IAppendInquiryResponseDto>> {
    try {
      const { schoolId, ip = "127.0.0.1" } = ctx;
      if (!schoolId) {
        return returnError("未授权的高校租户标识");
      }

      const { appealId, vaultToken, inquiryContent } = body || {};
      if (!appealId || isNaN(Number(appealId)) || Number(appealId) <= 0) {
        return returnError("PARAM_ERROR: 缺少合法有效的诉求 ID");
      }

      if (!vaultToken || typeof vaultToken !== "string") {
        return returnError("AUTH_ERROR: 必须携带有效的私钥凭证卡 (vaultToken)");
      }

      if (!inquiryContent || typeof inquiryContent !== "string" || inquiryContent.trim().length < 5) {
        return returnError("PARAM_ERROR: 追问内容不能少于 5 个字符");
      }

      const dto: IAppendInquiryRequestDto = {
        appealId: Number(appealId),
        vaultToken,
        inquiryContent: inquiryContent.trim(),
        imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls : []
      };

      const res = await FeedbackAppealService.appendAnonymousInquiry(schoolId, dto, ip);
      return returnSuccess(res);
    } catch (err: any) {
      return returnError(err.message || "追问提交失败");
    }
  }
}
