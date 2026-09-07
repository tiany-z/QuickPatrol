/**
 * 高校后勤巡查e速办 v4.0 - M45: 卡片 JSON 快照增量差异修补与结构重铸算法引擎
 * (Card Payload Delta Patch & Morphism Engine)
 */

import { IStructuredCardPayload, ICardFieldPayload, ICardActionPayload } from "./appFeedTypes.js";
import { CardActionType } from "./cardMutationTypes.js";

/**
 * 算法 1: 卡片快照增量重铸算法
 */
export class CardPayloadMorphismEngine {
  /**
   * 将旧卡片快照基于当前动作与操作人执行同态重塑变迁
   */
  public static morph(
    oldPayload: IStructuredCardPayload,
    action: CardActionType | string,
    operatorName: string,
    extraPayload?: Record<string, any>
  ): IStructuredCardPayload {
    // 1. 深拷贝原始快照，确保原有上报点位、原图、SLA 履约截止时间等基础元数据绝对完整保留
    const next: IStructuredCardPayload = JSON.parse(JSON.stringify(oldPayload || {
      header: { badgeTitle: "特急派单", statusPill: "待处理", statusColor: "volcano", timestamp: "刚刚" },
      fields: []
    }));

    if (!next.header) {
      next.header = { badgeTitle: "工单派发", statusPill: "待处理", statusColor: "volcano", timestamp: "刚刚" };
    }
    if (!Array.isArray(next.fields)) {
      next.fields = [];
    }

    // 辅助方法: 增量覆写或追加字段 (保留原字段顺序与唯一性)
    const upsertField = (label: string, value: string, highlight = false) => {
      const existing = next.fields.find(f => f.label === label);
      if (existing) {
        existing.value = value;
        if (highlight !== undefined) existing.highlight = highlight;
      } else {
        next.fields.push({ label, value, highlight });
      }
    };

    // 2. 根据动作类型推导卡片多层次演变形态
    switch (action) {
      case CardActionType.ACCEPT_ORDER: {
        // 头部胶囊演变: 抢修中 (blue)
        next.header.statusPill = "抢修中";
        next.header.statusColor = "blue";

        // 核心键值对追加责任师傅
        upsertField("责任师傅", operatorName || "抢修师傅", true);
        if (extraPayload?.expectedMinutes) {
          upsertField("预计用时", `${extraPayload.expectedMinutes} 分钟`);
        }

        // 动作按钮阶梯推演: 演进为现场交卷与申请延期
        next.actions = [
          { actionId: "FINISH_WORK", text: "现场交卷", type: "primary" },
          { actionId: "APPLY_DELAY", text: "申请延期", type: "default" },
          { actionId: "CALL_CREATOR", text: "联系提报人", type: "default" }
        ];
        break;
      }

      case CardActionType.APPLY_DELAY: {
        // 头部胶囊演变: 延期审批中 (orange)
        next.header.statusPill = "延期审批中";
        next.header.statusColor = "orange";

        const reason = extraPayload?.delayReason || extraPayload?.reason || "缺少备件，已提交延期申请";
        upsertField("延期申请", reason, true);

        // 动作按钮演变: 查看延期进度 (置灰等待)
        next.actions = [
          { actionId: "CHECK_DELAY", text: "查看延期进度", type: "default", disabled: true }
        ];
        break;
      }

      case CardActionType.FINISH_WORK: {
        // 头部胶囊演变: 待复核 (green)
        next.header.statusPill = "待复核";
        next.header.statusColor = "green";

        const desc = extraPayload?.workDesc || extraPayload?.handleDesc || "施工完成现场已交卷，请等待核验";
        upsertField("施工存根", desc, false);

        // 动作按钮演变: 质检核验中 (置灰禁用)
        next.actions = [
          { actionId: "WAIT_REVIEW", text: "等待网格长核验", type: "default", disabled: true }
        ];
        break;
      }

      case CardActionType.CLOSE_ORDER: {
        // 头部胶囊演变: 已办结 (gray)
        next.header.statusPill = "已办结";
        next.header.statusColor = "gray";

        const result = extraPayload?.reviewResult || "质检合格，工单圆满办结归档";
        upsertField("归档结论", result, false);

        // 动作按钮演变: 已彻底归档
        next.actions = [
          { actionId: "VIEW_ARCHIVE", text: "工单已归档", type: "default", disabled: true }
        ];
        break;
      }

      case CardActionType.REJECT_REVIEW: {
        // 质检不合格打回重修: 胶囊变回抢修中 (volcano/blue)
        next.header.statusPill = "抢修中(已驳回)";
        next.header.statusColor = "volcano";

        const rejectReason = extraPayload?.rejectReason || "核验未通过，请重新整改交卷";
        upsertField("驳回原因", rejectReason, true);

        // 动作按钮演变: 重新交卷
        next.actions = [
          { actionId: "FINISH_WORK", text: "重新交卷", type: "primary" },
          { actionId: "APPLY_DELAY", text: "申请延期", type: "default" }
        ];
        break;
      }

      default: {
        // 兜底维持原样或通用自定义动作
        if (extraPayload?.statusPill) {
          next.header.statusPill = extraPayload.statusPill;
        }
        if (extraPayload?.statusColor) {
          next.header.statusColor = extraPayload.statusColor;
        }
        break;
      }
    }

    return next;
  }
}
