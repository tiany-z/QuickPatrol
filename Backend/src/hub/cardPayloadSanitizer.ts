/**
 * 高校后勤巡查e速办 v4.0 - M42: 算法 4 - 富卡片元数据动态校验与 Schema 清洗算法
 * (Card Payload Schema Sanitizer)
 */

import { IStructuredCardPayload, ICardField, ICardAction } from "./notificationTypes.js";

export class CardPayloadSanitizer {
  public static readonly MAX_FIELDS_COUNT = 10;
  public static readonly MAX_ACTIONS_COUNT = 3;
  public static readonly MAX_JSON_BYTES = 128 * 1024; // 128KB 物理硬截断上限

  /**
   * 清洗危险文本 (防范 XSS、注入与恶意脚本执行)
   */
  public static cleanText(text: any, maxLength: number = 256): string {
    if (text === null || text === undefined) return "";
    let str = String(text);

    // 过滤 script 标签、javascript: 伪协议及常见 DOM 事件钩子
    str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    str = str.replace(/javascript\s*:/gi, "");
    str = str.replace(/vbscript\s*:/gi, "");
    str = str.replace(/on\w+\s*=/gi, "");
    str = str.replace(/<[^>]+>/g, ""); // 移除多余 HTML 尖括号标签

    if (str.length > maxLength) {
      str = str.substring(0, maxLength);
    }
    return str.trim();
  }

  /**
   * 结构化清洗与约束标准化
   */
  public static sanitize(rawPayload?: IStructuredCardPayload | null): IStructuredCardPayload {
    const nowIso = new Date().toISOString();

    if (!rawPayload || typeof rawPayload !== "object") {
      return {
        header: {
          badgeTitle: "通知提醒",
          statusPill: "已送达",
          statusColor: "blue",
          timestamp: nowIso
        },
        fields: []
      };
    }

    // 1. 清洗 Header 头部
    const rawHeader = rawPayload.header || ({} as any);
    const validColors = ["blue", "green", "orange", "volcano", "gray"] as const;
    const color = validColors.includes(rawHeader.statusColor as any) ? rawHeader.statusColor : "blue";

    const header = {
      badgeTitle: this.cleanText(rawHeader.badgeTitle || "通知提醒", 32),
      statusPill: this.cleanText(rawHeader.statusPill || "已送达", 16),
      statusColor: color,
      timestamp: rawHeader.timestamp ? this.cleanText(rawHeader.timestamp, 32) : nowIso
    };

    // 2. 清洗 Fields 字段数组 (上限 10 项)
    const fields: ICardField[] = [];
    if (Array.isArray(rawPayload.fields)) {
      for (const f of rawPayload.fields.slice(0, this.MAX_FIELDS_COUNT)) {
        if (!f || typeof f !== "object") continue;
        fields.push({
          label: this.cleanText(f.label, 32),
          value: this.cleanText(f.value, 128),
          highlight: Boolean(f.highlight)
        });
      }
    }

    // 3. 清洗 Actions 动作按钮组 (上限 3 项)
    const actions: ICardAction[] = [];
    if (Array.isArray(rawPayload.actions)) {
      const validActionTypes = ["primary", "default", "warn"] as const;
      for (const a of rawPayload.actions.slice(0, this.MAX_ACTIONS_COUNT)) {
        if (!a || typeof a !== "object") continue;
        const aType = validActionTypes.includes(a.type as any) ? a.type : "default";
        actions.push({
          actionId: this.cleanText(a.actionId || "ACTION_DEFAULT", 32),
          text: this.cleanText(a.text || "查看详情", 16),
          type: aType,
          url: a.url ? this.cleanText(a.url, 256) : undefined
        });
      }
    }

    let thumbnailUrl: string | undefined = rawPayload.thumbnailUrl
      ? this.cleanText(rawPayload.thumbnailUrl, 256 * 1024)
      : undefined;

    let resultPayload: IStructuredCardPayload = {
      header,
      fields,
      thumbnailUrl,
      actions: actions.length > 0 ? actions : undefined
    };

    // 4. 128KB 物理硬截断检查 (防止 Base64 超大图撑爆数据库)
    let jsonStr = JSON.stringify(resultPayload);
    let byteLen = Buffer.byteLength(jsonStr, "utf8");

    if (byteLen > this.MAX_JSON_BYTES) {
      // 第一步降级：剥离外链与按钮
      resultPayload.thumbnailUrl = undefined;
      resultPayload.actions = undefined;

      // 第二步降级：截短 fields
      resultPayload.fields = resultPayload.fields.map((f) => ({
        label: f.label.substring(0, 16),
        value: f.value.substring(0, 32),
        highlight: f.highlight
      }));

      jsonStr = JSON.stringify(resultPayload);
      byteLen = Buffer.byteLength(jsonStr, "utf8");

      // 极端保底：若仍然超限，保留前 3 个字段
      if (byteLen > this.MAX_JSON_BYTES) {
        resultPayload.fields = resultPayload.fields.slice(0, 3);
      }
    }

    return resultPayload;
  }
}
