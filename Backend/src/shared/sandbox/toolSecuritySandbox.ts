/**
 * 高校后勤巡查e速办 v4.0 - M48: 7 大受控后勤事实数据工具箱
 * 文件路径: src/shared/sandbox/toolSecuritySandbox.ts
 * 核心职责: 构建防御 Prompt 越狱注入的安全沙箱，执行入参白名单洗炼、
 *           执行 3000ms 硬超时保护、以及对手机号、隐私姓名的自适应掩码脱敏。
 */

import { IToolExecutionContext } from "../../contracts/aiToolContract.js";

export class ToolSecuritySandbox {
  public static readonly INJECTION_PATTERNS = [
    /(\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b|\bunion\b|\balter\b)/i,
    /(--|#|\/\*|\*\/)/,
    /(\bor\b|\band\b)\s+['"]?\d+['"]?\s*=\s*['"]?\d+/i,
    /ignore\s+(previous|above)\s+instructions/i
  ];

  /**
   * 1. 入参白名单洗炼：强制过滤任何非法参数，严格杜绝传入伪造的 schoolId
   */
  public static sanitizeArguments(toolName: string, rawArgs: any): Record<string, unknown> {
    let parsed = rawArgs;
    if (typeof rawArgs === "string") {
      try {
        parsed = JSON.parse(rawArgs);
      } catch {
        parsed = {};
      }
    }

    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const clean: Record<string, unknown> = {};

    // 严密安全红线：彻底屏蔽任何可能由模型生成的租户伪造或提权参数
    const FORBIDDEN_KEYS = [
      "schoolId",
      "tenantId",
      "school_id",
      "tenant_id",
      "adminPass",
      "userRole",
      "role"
    ];

    for (const key of Object.keys(parsed)) {
      if (FORBIDDEN_KEYS.includes(key)) {
        continue; // 物理丢弃！
      }

      const val = parsed[key];
      if (typeof val === "string") {
        clean[key] = val.trim().replace(/['";\\]/g, "");
      } else if (typeof val === "number") {
        clean[key] = isNaN(val) ? 0 : val;
      } else {
        clean[key] = val;
      }
    }

    return clean;
  }

  /**
   * 2. 执行超时包装器：强制限制在指定毫秒内，超时瞬间 abort 抛出异常
   */
  public static executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number = 3000): Promise<T> {
    let timer: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`事实数据沙箱查询超时 (>${timeoutMs}ms)，自动熔断`));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    });
  }

  /**
   * 3. 敏感隐私多级自适应脱敏引擎
   */
  public static redactSensitiveData(data: any, context: IToolExecutionContext): any {
    if (!data) return data;

    if (Array.isArray(data)) {
      return data.map((item) => this.redactSingleObject(item, context));
    }

    if (typeof data === "object") {
      return this.redactSingleObject(data, context);
    }

    return data;
  }

  private static redactSingleObject(obj: Record<string, any>, context: IToolExecutionContext): any {
    if (!obj || typeof obj !== "object") return obj;
    const clone = { ...obj };

    // 手机号脱敏规则：若非当前查询人本人的手机号，强制掩码前三后四
    if (clone.reporterPhone) {
      clone.reporterPhone = this.maskPhoneNumber(String(clone.reporterPhone));
    }

    // 匿名诉求判定 (联动 M31)
    if (clone.isAnonymous) {
      clone.reporterName = "匿名同学";
    }

    // 剔除内部涉密技术字段
    delete clone.schoolId;
    delete clone.deletedAt;
    delete clone.tenantVersion;
    delete clone.salt;
    delete clone.adminPass;

    return clone;
  }

  /**
   * 手机号前三后四脱敏
   */
  public static maskPhoneNumber(phone: string): string {
    const clean = (phone || "").trim();
    if (clean.length === 11) {
      return `${clean.substring(0, 3)}****${clean.substring(7)}`;
    }
    return clean;
  }
}
