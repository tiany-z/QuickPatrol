/**
 * 高校后勤巡查e速办 v4.0 - M45: 卡片原地演进端点控制器
 * (Card Mutation Controller - Tenant Context & Error Code Mapping)
 */

import { CardMutationService } from "./cardMutationService.js";
import { ICardActionRequestDto, CardActionType } from "./cardMutationTypes.js";

export interface IChatHttpCtx {
  schoolId: number;
  userId: number;
  userRole?: number;
  body?: any;
}

export class CardMutationController {
  constructor(private readonly mutationService: CardMutationService) {}

  /**
   * POST /api/v4/notification/card-action
   * 执行卡片内部动作指令，触发业务状态流转与快照原地重铸
   */
  public async handleCardAction(ctx: IChatHttpCtx): Promise<any> {
    const { schoolId, userId, body } = ctx;
    const { messageId, patrolId, actionId, actionPayload } = body || {};

    if (!messageId || !patrolId || !actionId) {
      return {
        code: 400,
        message: "缺少必要参数: messageId, patrolId 或 actionId"
      };
    }

    const parsedMessageId = parseInt(String(messageId), 10);
    const parsedPatrolId = parseInt(String(patrolId), 10);

    if (isNaN(parsedMessageId) || parsedMessageId <= 0 || isNaN(parsedPatrolId) || parsedPatrolId <= 0) {
      return {
        code: 400,
        message: "非法的 messageId 或 patrolId 参数格式"
      };
    }

    const dto: ICardActionRequestDto = {
      messageId: parsedMessageId,
      patrolId: parsedPatrolId,
      actionId: actionId as CardActionType,
      actionPayload
    };

    try {
      const result = await this.mutationService.executeCardAction(schoolId, userId, dto);
      return result;
    } catch (err: unknown) {
      const errorMsg = (err as Error)?.message || "动作执行失败";

      // 409 竞态落败冲突友好识别
      if (errorMsg.includes("已被其他师傅认领") || errorMsg.includes("手慢了一步")) {
        return {
          code: 409,
          message: errorMsg,
          fallbackState: "LOST_RACE"
        };
      }

      // 404 资源不存在或跨租户隔离阻断
      if (errorMsg.includes("不存在或无权访问")) {
        return {
          code: 404,
          message: errorMsg
        };
      }

      // 400 校验异常
      if (errorMsg.includes("缺少") || errorMsg.includes("无效") || errorMsg.includes("不支持")) {
        return {
          code: 400,
          message: errorMsg
        };
      }

      return {
        code: 500,
        message: errorMsg
      };
    }
  }
}
