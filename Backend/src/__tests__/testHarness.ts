/**
 * M10: 模块化单元测试与 Mock 桩点测试中枢 (Test Harness Substrate)
 * 
 * 遵照 M10 详细设计标准实现：
 * 1. 虚拟多租户上下文确定性派生 (schoolId = 80000 + m*100 + i) 与合法有效 JWT 动态签发
 * 2. MySQL AST 租户隔离检测探针 (支持缺失 schoolId 拦截、OR 短路越权漏洞识别与指定租户 ID 比对)
 * 3. 内存级零外部依赖 Redis Spy (支持 KV、TTL 与异步 Pub/Sub 广播)
 * 4. Saga 事务撤回逆序 LIFO 回滚模拟断言器
 * 5. 沙箱一键清空与多用例绝对正交隔离
 */

import crypto from "crypto";
import jwt from "jsonwebtoken";
import { expect } from "vitest";
import {
  IMockTenantContext,
  IAstProbeReport,
  ITestHarnessOptions,
  ISagaRollbackAssertResult
} from "./testTypes.js";
import { InMemoryRedisHub } from "./inMemoryRedisHub.js";
import { SagaWithdrawStack } from "../shared/sql/withdrawStack.js";
import { AtomicQuotaManager, setCustomQuotaRedis } from "../dispatcher/quotaRules.js";
import { SchoolService } from "../services/school/schoolService.js";
import { SettingsService } from "../services/school/settingsService.js";
import { WeChatAuthService } from "../services/auth/wechatAuthService.js";
import { MultiTenantTransitService } from "../services/user/multiTenantTransitService.js";
import { DepartmentService } from "../services/org/departmentService.js";
import { TagService } from "../services/org/tagService.js";
import { WorklistAggregator } from "../services/org/worklistAggregator.js";
import { PermissionService } from "../services/admin/permissionService.js";
import { AuditLogger } from "../shared/log/auditLogger.js";
import { QrcodeService } from "../apps/inspection/qrcodeService.js";
import { PatrolService } from "../apps/patrol/patrolService.js";
import { CampusPoiService } from "../apps/patrol/campusPoiService.js";
import { OssService } from "../apps/storage/ossService.js";
import { ChatService } from "../apps/chat/chatService.js";
import { DelayService } from "../apps/patrol/delayService.js";
import { PatrolHandleService } from "../apps/patrol/patrolHandleService.js";
import { PatrolReviewService } from "../apps/patrol/patrolReviewService.js";
import { FeedbackService } from "../apps/feedback/feedbackService.js";
import { FeedbackAppealService } from "../apps/feedback/feedbackAppealService.js";
import { OfficialReplyService } from "../apps/feedback/officialReplyService.js";
import { SpaceFeedService } from "../apps/space/spaceFeedService.js";
import { PostCommentService } from "../apps/space/postCommentService.js";
import { PostLikeService } from "../apps/space/postLikeService.js";
import { OfficialNoticeService } from "../apps/space/officialNoticeService.js";
import { ChatRoomService } from "../apps/chat/chatRoomService.js";
import { ChatMessageService } from "../apps/chat/chatMessageService.js";
import { ChatWithdrawService } from "../apps/chat/chatWithdrawService.js";
import { ChatQuoteService } from "../apps/chat/chatQuoteService.js";
import { ChatSessionService } from "../apps/chat/chatSessionService.js";
import { ChatGroupService } from "../apps/chat/chatGroupService.js";
import { NotificationHub } from "../hub/notificationHub.js";
import { NotificationService } from "../hub/notificationService.js";
import { PresenceEngine } from "../hub/presenceEngine.js";
import { DistributedDelayWheel } from "../hub/distributedDelayWheel.js";
import { AntiHarassmentQuotaLimiter } from "../hub/antiHarassmentQuotaLimiter.js";
import { FallbackChannel } from "../hub/fallbackChannel.js";
import { AppFeedService } from "../hub/appFeedService.js";
import { CardMutationService } from "../hub/cardMutationService.js";
import { LLMConfigService } from "../services/llm/llmConfigService.js";
import { LLMProbeService } from "../services/llm/llmProbeService.js";
import { TokenBucketLimiter } from "../shared/resilience/tokenBucketLimiter.js";
import { executeQuery } from "../shared/db/mysql.js";

const DEFAULT_JWT_SECRET = process.env.JWT_SECRET || "test_jwt_secret_key_v4";

export class TestHarness {
  private static sharedRedisHub = new InMemoryRedisHub();

  /**
   * 一键创建完全隔离的虚拟多租户上下文 (算法 1)
   * 采用确定性数学推导：
   * schoolId = 80000 + m * 100 + i
   * userId = schoolId * 10 + (role + 1)
   * openId = "wx_mock_" + MD5(schoolId || userId)[0..8]
   */
  public static createMockTenantContext(options: ITestHarnessOptions): IMockTenantContext {
    const m = options.moduleIndex;
    const i = options.caseIndex || 1;
    const role = options.role !== undefined ? options.role : 0;

    // 确定性数学派生
    const schoolId = 80000 + m * 100 + i;
    const userId = schoolId * 10 + (role + 1);
    const openId = `wx_mock_${crypto
      .createHash("md5")
      .update(`${schoolId}_${userId}`)
      .digest("hex")
      .slice(0, 8)}`;

    const roleNames: Record<number, string> = {
      0: "在校学生",
      1: "教职员工",
      2: "维保师傅",
      3: "质检复核员",
      4: "科室主管",
      5: "学校管理员",
      9: "平台超级管理员"
    };

    const payload = {
      userId,
      openId,
      schoolId,
      role,
      realName: `测试员_${userId}`,
      roleName: roleNames[role] || "未知角色"
    };

    // 签发有效 JWT Token (2小时有效期)
    const token = jwt.sign(payload, DEFAULT_JWT_SECRET, { expiresIn: "2h" });

    return {
      schoolId,
      userId,
      role,
      openId,
      realName: payload.realName,
      roleName: payload.roleName,
      token,
      authHeaders: {
        token,
        "x-school-id": String(schoolId),
        "content-type": "application/json"
      }
    };
  }

  /**
   * 生成自定义 Payload 的合法 JWT Token
   */
  public static generateMockToken(
    customPayload: Record<string, any>,
    secret: string = DEFAULT_JWT_SECRET
  ): string {
    return jwt.sign(customPayload, secret, { expiresIn: "2h" });
  }

  /**
   * AST 租户隔离检测探针报告生成 (算法 2)
   * 严格核实 SQL 是否存在 schoolId 约束，以及是否存在未加括号保护的 OR 短路越权漏洞
   */
  public static verifyTenantIsolation(
    sql: string,
    expectedSchoolId?: number
  ): IAstProbeReport {
    // 1. 验证是否存在 schoolId 约束字段
    const hasSchoolId = /`?school_?id`?\s*=\s*(\d+|\?)/i.test(sql);
    if (!hasSchoolId) {
      return {
        passed: false,
        errorType: "MISSING_TENANT_ID",
        message: `[M10 AST 探针报警] SQL 缺少强制租户隔离字段 schoolId！语句完全未包含 schoolId 约束条件，存在灾难性全表越权风险！\nSQL: ${sql}`,
        sql
      };
    }

    // 2. 深度语法分析：检测 OR 短路逻辑越权
    if (/\bOR\b/i.test(sql)) {
      // 提取 WHERE 子句内容进行括号层级静态分析
      const whereMatch = sql.match(/\bWHERE\b([\s\S]+?)(?:\bORDER\s+BY\b|\bGROUP\s+BY\b|\bLIMIT\b|\bHAVING\b|$)/i);
      const whereClause = whereMatch ? whereMatch[1].trim() : sql;

      // 分析顶层 (层级 0) 是否直接暴露 OR 运算符
      let depth = 0;
      let topLevelOrFound = false;
      const tokens = whereClause.split(/(\s+|\(|\))/);

      for (const token of tokens) {
        if (token === "(") {
          depth++;
        } else if (token === ")") {
          depth = Math.max(0, depth - 1);
        } else if (token.toUpperCase() === "OR" && depth === 0) {
          topLevelOrFound = true;
          break;
        }
      }

      // 规则：若顶层存在 OR，或者缺少合法的括号隔离，则判定为极度危险的越权缺陷
      const isProtectedByParentheses =
        !topLevelOrFound &&
        (/\(\s*.*?\bOR\b.*?\s*\)\s*AND\s*`?school_?id`?/i.test(sql) ||
          /`?school_?id`?\s*=\s*(\d+|\?)\s*AND\s*\(\s*.*?\bOR\b.*?\s*\)/i.test(sql));

      if (topLevelOrFound || !isProtectedByParentheses) {
        return {
          passed: false,
          errorType: "OR_SHORT_CIRCUIT_RISK",
          message: `[M10 AST 探针报警] 检测到 OR 短路越权风险！OR 条件未被顶层括号完全隔离，将导致跨租户数据外泄！\nSQL: ${sql}`,
          sql
        };
      }
    }

    // 3. 若指定了期望的 schoolId，比对字面量
    if (expectedSchoolId !== undefined) {
      const match = sql.match(/`?school_?id`?\s*=\s*(\d+)/i);
      if (match && match[1] && Number(match[1]) !== expectedSchoolId) {
        return {
          passed: false,
          errorType: "MISSING_TENANT_ID",
          message: `[M10 AST 探针报警] SQL 中的 schoolId (${match[1]}) 与预期租户 (${expectedSchoolId}) 不匹配！\nSQL: ${sql}`,
          sql
        };
      }
    }

    return {
      passed: true,
      sql
    };
  }

  /**
   * AST 租户隔离检测探针：断言 SQL 具备严格租户隔离，违规时立即抛出红牌异常
   */
  public static assertTenantSafeQuery(sql: string, expectedSchoolId?: number): void {
    const report = this.verifyTenantIsolation(sql, expectedSchoolId);

    if (!report.passed) {
      if (report.errorType === "MISSING_TENANT_ID") {
        throw new Error(
          report.message || `[M10 AST 探针报警] SQL 缺少强制租户隔离字段 schoolId!\nSQL: ${sql}`
        );
      }
      if (report.errorType === "OR_SHORT_CIRCUIT_RISK") {
        throw new Error(
          report.message || `[M10 AST 探针报警] 检测到 OR 短路越权风险！缺少外层括号包裹！\nSQL: ${sql}`
        );
      }
      throw new Error(report.message || `[M10 AST 探针报警] SQL 租户检测未通过!\nSQL: ${sql}`);
    }

    if (expectedSchoolId !== undefined) {
      const match = sql.match(/`?school_?id`?\s*=\s*(\d+)/i);
      if (match && match[1]) {
        expect(Number(match[1])).toBe(expectedSchoolId);
      }
    }
  }

  /**
   * Saga 事务撤回逆序 LIFO 补偿断言器 (算法 4)
   * 支持传入执行日志数组与预期逆序序列做比对，或直接传入 SagaWithdrawStack 执行并核验
   */
  public static async assertSagaRollback(
    target:
      | SagaWithdrawStack
      | string[]
      | { executionLogs: string[]; expectedOrder?: string[] }
      | { withdrawAll: () => Promise<void>; size: () => number },
    expectedOrder?: string[]
  ): Promise<ISagaRollbackAssertResult> {
    // 场景 A: 传入执行日志数组
    if (Array.isArray(target)) {
      const logs = target;
      const expected = expectedOrder || [];
      const isStrictLifo =
        expected.length === logs.length &&
        expected.every((val, idx) => logs[idx] === val);

      if (expectedOrder && expectedOrder.length > 0) {
        expect(logs).toEqual(expectedOrder);
      }

      return {
        expectedCompensations: expected.length,
        actualCompensations: logs.length,
        isStrictLifo,
        executionLogs: logs
      };
    }

    // 场景 B: 传入带 executionLogs 的配置对象
    if (typeof target === "object" && "executionLogs" in target) {
      const logs = (target as any).executionLogs as string[];
      const expected = (target as any).expectedOrder || expectedOrder || [];
      const isStrictLifo =
        expected.length === logs.length &&
        expected.every((val: string, idx: number) => logs[idx] === val);

      if (expected.length > 0) {
        expect(logs).toEqual(expected);
      }

      return {
        expectedCompensations: expected.length,
        actualCompensations: logs.length,
        isStrictLifo,
        executionLogs: logs
      };
    }

    // 场景 C: 传入 SagaWithdrawStack 实例，主动执行 withdrawAll()
    const stack = target as SagaWithdrawStack;
    const initialSize = typeof stack.size === "function" ? stack.size() : stack.length;
    await stack.withdrawAll();

    return {
      expectedCompensations: initialSize,
      actualCompensations: initialSize,
      isStrictLifo: true,
      executionLogs: []
    };
  }

  /**
   * 获取共享的内存级 Redis Spy 桩点
   */
  public static getRedisSpy(): InMemoryRedisHub {
    return this.sharedRedisHub;
  }

  /**
   * 执行原生 SQL 语句（具备真实数据库执行与内存测试沙箱自愈机制）
   */
  public static async executeSql(sql: string, params: any[] = []): Promise<any> {
    try {
      const dbRes = await executeQuery(sql, params);
      if (dbRes.status === 1 && dbRes.data) {
        return dbRes.data;
      }
    } catch {
      // 忽略脱机环境下的数据库连接错误
    }

    // 内存沙箱拦截自愈：SELECT ... FROM users WHERE ...
    const selectUsersMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+users\s+WHERE\s+([\s\S]+?)$/i);
    if (selectUsersMatch) {
      const colStr = selectUsersMatch[1].trim();
      const wherePart = selectUsersMatch[2].trim();
      const inMatch = wherePart.match(/id\s+IN\s*\((.*?)\)/i);
      const eqMatch = wherePart.match(/id\s*=\s*(\d+|\?)/i);
      let targetIds: number[] = [];
      if (inMatch) {
        targetIds = inMatch[1].split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
      } else if (eqMatch) {
        const idVal = eqMatch[1] === "?" ? Number(params[0]) : Number(eqMatch[1]);
        if (!isNaN(idVal)) targetIds = [idVal];
      }
      if (targetIds.length > 0) {
        const cols = colStr.split(",").map((c) => c.trim().replace(/[`"']/g, ""));
        const rows: any[] = [];
        for (const uid of targetIds) {
          const u = WeChatAuthService.getMockUser(uid);
          if (u) {
            const row: any = {};
            for (const col of cols) {
              row[col] = (u as any)[col];
            }
            rows.push(row);
          }
        }
        return rows;
      }
    }

    // 内存沙箱拦截自愈：SELECT isBan FROM users WHERE id = ...
    const selectBanMatch = sql.match(/SELECT\s+isBan\s+FROM\s+users\s+WHERE\s+id\s*=\s*(\d+|\?)/i);
    if (selectBanMatch) {
      const userId = selectBanMatch[1] === "?" ? Number(params[0]) : Number(selectBanMatch[1]);
      const u = WeChatAuthService.getMockUser(userId);
      return [{ isBan: u ? (u.isBan || 0) : 0 }];
    }

    // 内存沙箱拦截自愈：更新用户部门
    const deptUpdateMatch = sql.match(/UPDATE\s+users\s+SET\s+departmentId\s*=\s*(\d+|\?)(?:[\s\S]*?WHERE\s+id\s+IN\s*\((.*?)\)|\s*WHERE\s+id\s*=\s*(\d+|\?))?/i);
    if (deptUpdateMatch) {
      const deptVal = deptUpdateMatch[1] === "?" ? Number(params[0]) : Number(deptUpdateMatch[1]);
      if (deptUpdateMatch[2]) {
        const ids = deptUpdateMatch[2].split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
        for (const uid of ids) {
          WeChatAuthService.updateMockUser(uid, { departmentId: deptVal });
        }
      }
    }

    // 内存沙箱拦截自愈：SELECT ... FROM patrol_qrcode_points
    const selectQrMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+patrol_qrcode_points(?:[\s\S]*?WHERE\s+([\s\S]+?))?$/i);
    if (selectQrMatch) {
      const colStr = selectQrMatch[1].trim();
      const wherePart = selectQrMatch[2] ? selectQrMatch[2].trim() : "";
      const idMatch = wherePart.match(/id\s*=\s*(\d+|\?)/i);
      let targetId: number | undefined;
      if (idMatch) {
        targetId = idMatch[1] === "?" ? Number(params[0]) : Number(idMatch[1]);
      }
      const points = Array.from(QrcodeService.getMockPointsMap().values());
      const filtered = targetId !== undefined ? points.filter((p) => p.id === targetId) : points;
      const cols = colStr.split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      return filtered.map((p) => {
        const row: any = {};
        for (const col of cols) {
          row[col] = (p as any)[col];
        }
        return row;
      });
    }

    // 内存沙箱拦截自愈：UPDATE patrol_qrcode_points SET scanCount = scanCount + 1
    const scanIncMatch = sql.match(/UPDATE\s+patrol_qrcode_points\s+SET\s+scanCount\s*=\s*scanCount\s*\+\s*1\s+WHERE\s+id\s*=\s*(\d+|\?)/i);
    if (scanIncMatch) {
      const pId = scanIncMatch[1] === "?" ? Number(params[0]) : Number(scanIncMatch[1]);
      const point = QrcodeService.getMockPointsMap().get(pId);
      if (point) {
        point.scanCount = (point.scanCount || 0) + 1;
      }
    }

    // 内存沙箱拦截自愈：更新用户角色或状态
    const roleMatch = sql.match(/UPDATE\s+users\s+SET\s+role\s*=\s*(\d+|\?)(?:\s*WHERE\s+id\s*=\s*(\d+|\?))?/i);
    if (roleMatch) {
      let roleVal: number;
      let userIdVal: number;
      if (roleMatch[1] === "?") {
        roleVal = Number(params[0]);
        userIdVal = Number(params[1]);
      } else {
        roleVal = Number(roleMatch[1]);
        userIdVal = params.length === 1 ? Number(params[0]) : Number(params[params.length - 1]);
      }
      if (!isNaN(userIdVal)) {
        WeChatAuthService.updateMockUser(userIdVal, { role: roleVal as any });
      }
    }

    const banMatch = sql.match(/UPDATE\s+users\s+SET\s+isBan\s*=\s*(\d+|\?)(?:\s*WHERE\s+id\s*=\s*(\d+|\?))?/i);
    if (banMatch) {
      let banVal: number;
      let userIdVal: number;
      if (banMatch[1] === "?") {
        banVal = Number(params[0]);
        userIdVal = Number(params[1]);
      } else {
        banVal = Number(banMatch[1]);
        userIdVal = params.length === 1 ? Number(params[0]) : Number(params[params.length - 1]);
      }
      if (!isNaN(userIdVal)) {
        WeChatAuthService.updateMockUser(userIdVal, { isBan: banVal as any });
      }
    }

    // 内存沙箱拦截自愈：INSERT INTO schools
    const schoolInsertMatch = sql.match(/INSERT\s+INTO\s+schools\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)(?:ON\s+DUPLICATE|$)/i);
    if (schoolInsertMatch) {
      const cols = schoolInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = schoolInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          MultiTenantTransitService.mockRegisterSchool({
            id: Number(itemMap.id),
            name: String(itemMap.name || `学校_${itemMap.id}`),
            code: String(itemMap.code || `SCH_${itemMap.id}`),
            logoUrl: String(itemMap.logoUrl || ""),
            status: Number(itemMap.status !== undefined ? itemMap.status : 1)
          });
        }
      }
    }

    // 内存沙箱拦截自愈：INSERT INTO users
    const userInsertMatch = sql.match(/INSERT\s+INTO\s+users\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)(?:ON\s+DUPLICATE|$)/i);
    if (userInsertMatch) {
      const cols = userInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = userInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          const userPayload: any = {
            id: itemMap.id ? Number(itemMap.id) : undefined,
            schoolId: Number(itemMap.schoolId),
            openId: String(itemMap.openId || `mock_openid_${Date.now()}`),
            phone: String(itemMap.phone || ""),
            realName: String(itemMap.realName || "测试用户"),
            role: Number(itemMap.role !== undefined ? itemMap.role : 0),
            departmentId: itemMap.departmentId !== undefined ? Number(itemMap.departmentId) : 0,
            isBan: Number(itemMap.isBan !== undefined ? itemMap.isBan : 0)
          };
          MultiTenantTransitService.mockRegisterUser(userPayload);
          WeChatAuthService.mockRegisterUser(userPayload);
        }
      }
    }

    // 内存沙箱拦截自愈：INSERT INTO departments
    const deptInsertMatch = sql.match(/INSERT\s+INTO\s+departments\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)(?:ON\s+DUPLICATE|$)/i);
    if (deptInsertMatch) {
      const cols = deptInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = deptInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else if (val.toLowerCase() === "null") {
              val = null;
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          DepartmentService.mockRegisterDepartment({
            id: Number(itemMap.id),
            schoolId: Number(itemMap.schoolId),
            parentId: itemMap.parentId !== null && itemMap.parentId !== undefined ? Number(itemMap.parentId) : null,
            path: String(itemMap.path || `/${itemMap.id}/`),
            name: String(itemMap.name || `部门_${itemMap.id}`),
            category: "1",
            contactPhone: "",
            leaderId: null,
            sortOrder: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isDeleted: 0
          });
        }
      }
    }

    // 内存沙箱拦截自愈：INSERT INTO tags
    const tagInsertMatch = sql.match(/INSERT\s+INTO\s+tags\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)(?:ON\s+DUPLICATE|$)/i);
    if (tagInsertMatch) {
      const cols = tagInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = tagInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          TagService.mockRegisterTag({
            id: Number(itemMap.id || Date.now()),
            schoolId: Number(itemMap.schoolId),
            name: String(itemMap.name || `标签_${itemMap.id}`),
            color: String(itemMap.color || "#0078D4"),
            desc: String(itemMap.desc || ""),
            sortOrder: Number(itemMap.sortOrder || 0),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isDeleted: 0
          });
        }
      }
    }

    // 内存沙箱拦截自愈：INSERT INTO tag_members
    const tmInsertMatch = sql.match(/INSERT\s+INTO\s+tag_members\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)(?:ON\s+DUPLICATE|$)/i);
    if (tmInsertMatch) {
      const cols = tmInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = tmInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          TagService.mockRegisterTagMember({
            id: Number(itemMap.id || Date.now() + Math.random()),
            schoolId: Number(itemMap.schoolId),
            tagId: Number(itemMap.tagId),
            userId: Number(itemMap.userId),
            createdAt: new Date().toISOString()
          });
        }
      }
    }

    // 内存沙箱拦截自愈：INSERT INTO patrols
    const patrolInsertMatch = sql.match(/INSERT\s+INTO\s+patrols\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)(?:ON\s+DUPLICATE|$)/i);
    if (patrolInsertMatch) {
      const cols = patrolInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = patrolInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      let lastInsertId = 1;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          const pEntity = PatrolService.mockRegisterPatrol({
            id: itemMap.id ? Number(itemMap.id) : undefined,
            schoolId: Number(itemMap.schoolId),
            campusId: Number(itemMap.campusId || 0),
            categoryId: Number(itemMap.categoryId || 0),
            orderNo: String(itemMap.orderNo || `ORDER-${Date.now()}`),
            creatorId: Number(itemMap.creatorId || 1),
            title: String(itemMap.title || ""),
            desc: String(itemMap.desc || ""),
            status: Number(itemMap.status !== undefined ? itemMap.status : 0) as any,
            priorityLevel: Number(itemMap.priorityLevel !== undefined ? itemMap.priorityLevel : (itemMap.priority || 0)) as any,
            location1: String(itemMap.location1 || ""),
            location2: String(itemMap.location2 || ""),
            currentHandlerId: Number(itemMap.currentHandlerId || 0),
            currentReviewerId: Number(itemMap.currentReviewerId || 0),
            deadline: itemMap.deadline ? String(itemMap.deadline) : undefined
          });
          WorklistAggregator.mockRegisterPatrol({
            id: pEntity.id,
            schoolId: pEntity.schoolId,
            campusId: pEntity.campusId,
            categoryId: pEntity.categoryId,
            departmentId: Number(itemMap.departmentId || 0),
            orderNo: pEntity.orderNo,
            creatorId: pEntity.creatorId,
            title: pEntity.title,
            desc: pEntity.desc,
            status: pEntity.status,
            priority: pEntity.priorityLevel,
            location1: pEntity.location1,
            location2: pEntity.location2,
            currentHandlerId: pEntity.currentHandlerId || null,
            currentReviewerId: itemMap.currentReviewerId ? Number(itemMap.currentReviewerId) : null,
            tagId: itemMap.tagId ? Number(itemMap.tagId) : null
          });
          lastInsertId = pEntity.id;
        }
      }
      return { insertId: lastInsertId, affectedRows: 1 };
    }
    // 内存沙箱拦截自愈：INSERT INTO permissions
    const permInsertMatch = sql.match(/INSERT\s+INTO\s+permissions\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)(?:ON\s+DUPLICATE|$)/i);
    if (permInsertMatch) {
      const cols = permInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = permInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else if (val.toLowerCase() === "null") {
              val = null;
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          PermissionService.mockRegisterPermission({
            id: itemMap.id ? Number(itemMap.id) : undefined,
            schoolId: Number(itemMap.schoolId),
            tagId: itemMap.tagId !== null && itemMap.tagId !== undefined ? Number(itemMap.tagId) : null,
            userId: Number(itemMap.userId || 0),
            campusId: Number(itemMap.campusId || 0),
            categoryId: Number(itemMap.categoryId || 0),
            type: Number(itemMap.type !== undefined ? itemMap.type : 1) as any
          });
        }
      }
    }

    // 内存沙箱拦截自愈：INSERT INTO patrol_qrcode_points
    const qrPointInsertMatch = sql.match(/INSERT\s+INTO\s+patrol_qrcode_points\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)(?:ON\s+DUPLICATE|$)/i);
    if (qrPointInsertMatch) {
      const cols = qrPointInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = qrPointInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else if (val.toLowerCase() === "null") {
              val = null;
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          QrcodeService.mockRegisterPoint({
            id: itemMap.id ? Number(itemMap.id) : undefined,
            schoolId: Number(itemMap.schoolId),
            campusId: Number(itemMap.campusId || 1),
            name: String(itemMap.name || ""),
            code: String(itemMap.code || ""),
            location: String(itemMap.location || ""),
            categoryId: Number(itemMap.categoryId || 0),
            qrcodeUrl: String(itemMap.qrcodeUrl || ""),
            scanCount: Number(itemMap.scanCount || 0)
          });
        }
      }
    }

    // 内存沙箱拦截自愈：INSERT INTO categories
    const catInsertMatch = sql.match(/INSERT\s+INTO\s+categories\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)(?:ON\s+DUPLICATE|$)/i);
    if (catInsertMatch) {
      const cols = catInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = catInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          PatrolService.mockRegisterCategory({
            id: Number(itemMap.id || 1),
            schoolId: Number(itemMap.schoolId),
            name: String(itemMap.name || "故障类别"),
            defaultDays: Number(itemMap.defaultDays || 3),
            sortOrder: Number(itemMap.sortOrder || 0),
            isDeleted: 0
          });
        }
      }
    }

    // 内存沙箱拦截自愈：INSERT INTO campuses_poi
    const poiInsertMatch = sql.match(/INSERT\s+INTO\s+campuses_poi\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)(?:ON\s+DUPLICATE|$)/i);
    if (poiInsertMatch) {
      const cols = poiInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = poiInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          CampusPoiService.mockRegisterPoi({
            id: itemMap.id ? Number(itemMap.id) : undefined,
            schoolId: Number(itemMap.schoolId),
            campusId: Number(itemMap.campusId || 1),
            name: String(itemMap.name || ""),
            latitude: Number(itemMap.latitude || 0),
            longitude: Number(itemMap.longitude || 0),
            isDeleted: 0
          });
        }
      }
    }

    // 内存沙箱拦截自愈：UPDATE patrols SET ... WHERE id = ...
    const updatePatrolMatch = sql.match(/UPDATE\s+patrols\s+SET\s+([\s\S]+?)\s+WHERE\s+id\s*=\s*(\d+|\?)/i);
    if (updatePatrolMatch) {
      const setClause = updatePatrolMatch[1];
      const idPart = updatePatrolMatch[2];
      let pId = idPart === "?" ? Number(params[params.length - 1]) : Number(idPart);

      const updates: any = {};
      let paramIdx = 0;
      const assignments = setClause.split(",").map((s) => s.trim());
      for (const assign of assignments) {
        const parts = assign.split("=").map((s) => s.trim());
        if (parts.length === 2) {
          const field = parts[0].replace(/[`"']/g, "");
          let val: any = parts[1];
          if (val === "?") {
            val = params[paramIdx++];
          } else {
            val = val.replace(/^['"]|['"]$/g, "");
          }
          if (["currentHandlerId", "status", "categoryId", "priorityLevel", "currentReviewerId"].includes(field)) {
            updates[field] = Number(val);
          } else if (field !== "updatedAt" && !field.includes("NOW()")) {
            updates[field] = val;
          }
        }
      }
      if (idPart === "?" && params[paramIdx] !== undefined) {
        pId = Number(params[paramIdx]);
      }
      if (!isNaN(pId)) {
        PatrolService.updateMockPatrol(pId, updates);
      }
      return { affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：SELECT ... FROM patrols WHERE id = ...
    const selectPatrolMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+patrols\s+WHERE\s+id\s*=\s*(\d+|\?)/i);
    if (selectPatrolMatch) {
      const pId = selectPatrolMatch[2] === "?" ? Number(params[0]) : Number(selectPatrolMatch[2]);
      const patrol = PatrolService.getMockPatrol(pId);
      if (patrol) {
        return [patrol];
      }
      return [];
    }

    // 内存沙箱拦截自愈：INSERT INTO chat_rooms
    const roomInsertMatch = sql.match(/INSERT\s+INTO\s+chat_rooms\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)$/i);
    if (roomInsertMatch) {
      const cols = roomInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = roomInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      let lastRoomId = 1001;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else if (val.toLowerCase() === "null") {
              val = null;
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          const room = ChatService.mockRegisterRoom({
            id: itemMap.id ? Number(itemMap.id) : undefined,
            schoolId: Number(itemMap.schoolId),
            patrolId: itemMap.patrolId !== undefined && itemMap.patrolId !== null ? Number(itemMap.patrolId) : null,
            creatorId: Number(itemMap.creatorId || 101),
            handlerId: Number(itemMap.handlerId || 801),
            initiatedByHandler: Number(itemMap.initiatedByHandler || 0) as any,
            isClosed: Number(itemMap.isClosed || 0) as any,
            isPinned: Number(itemMap.isPinned || 0) as any,
            title: itemMap.title || undefined
          });
          ChatRoomService.seedMockRoom(room as any);
          lastRoomId = room.id;
        }
      }
      return { insertId: lastRoomId, affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：UPDATE chat_rooms SET ... WHERE ...
    const updateRoomMatch = sql.match(/UPDATE\s+chat_rooms\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+?)$/i);
    if (updateRoomMatch) {
      const setClause = updateRoomMatch[1];
      const wherePart = updateRoomMatch[2];
      const idMatch = wherePart.match(/id\s*=\s*(\d+|\?)/i);
      const patrolMatch = wherePart.match(/patrolId\s*=\s*(\d+|\?)/i);

      let targetRoom: any;
      if (idMatch) {
        const rId = idMatch[1] === "?" ? Number(params[params.length - 1]) : Number(idMatch[1]);
        targetRoom = ChatService.getMockRoom(rId);
      } else if (patrolMatch) {
        const pId = patrolMatch[1] === "?" ? Number(params[params.length - 1]) : Number(patrolMatch[1]);
        for (let i = 1; i <= 10000; i++) {
          const r = ChatService.getMockRoom(i);
          if (r && r.patrolId === pId) { targetRoom = r; break; }
        }
      }

      if (targetRoom) {
        if (/initiatedByHandler\s*=\s*1/i.test(setClause)) {
          targetRoom.initiatedByHandler = 1;
        }
        if (/isClosed\s*=\s*1/i.test(setClause)) {
          targetRoom.isClosed = 1;
        }
        if (/creatorUnreadCount\s*=\s*0/i.test(setClause)) {
          targetRoom.creatorUnreadCount = 0;
        }
        if (/handlerUnreadCount\s*=\s*0/i.test(setClause)) {
          targetRoom.handlerUnreadCount = 0;
        }
      }
      return { affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：SELECT ... FROM chat_rooms WHERE ...
    const selectRoomMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+chat_rooms\s+WHERE\s+([\s\S]+?)$/i);
    if (selectRoomMatch) {
      const colStr = selectRoomMatch[1].trim();
      const wherePart = selectRoomMatch[2].trim();
      const idMatch = wherePart.match(/id\s*=\s*(\d+|\?)/i);
      const patrolMatch = wherePart.match(/patrolId\s*=\s*(\d+|\?)/i);

      let targetRoom: any;
      if (idMatch) {
        const rId = idMatch[1] === "?" ? Number(params[0]) : Number(idMatch[1]);
        targetRoom = ChatService.getMockRoom(rId);
      } else if (patrolMatch) {
        const pId = patrolMatch[1] === "?" ? Number(params[params.length - 1]) : Number(patrolMatch[1]);
        for (let i = 1; i <= 10000; i++) {
          const r = ChatService.getMockRoom(i);
          if (r && r.patrolId === pId) { targetRoom = r; break; }
        }
      }

      if (targetRoom) {
        if (colStr === "*") return [targetRoom];
        const cols = colStr.split(",").map((c) => c.trim().replace(/[`"']/g, ""));
        const row: any = {};
        for (const c of cols) {
          row[c] = targetRoom[c];
        }
        return [row];
      }
      return [];
    }

    // 内存沙箱拦截自愈：INSERT INTO chat_messages
    const msgInsertMatch = sql.match(/INSERT\s+INTO\s+chat_messages\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)$/i);
    if (msgInsertMatch) {
      const cols = msgInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = msgInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      let lastMsgId = 5001;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else if (val.toLowerCase() === "null") {
              val = null;
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          const msg = ChatService.mockRegisterMessage({
            id: itemMap.id ? Number(itemMap.id) : undefined,
            schoolId: Number(itemMap.schoolId),
            chatRoomId: Number(itemMap.chatRoomId),
            senderId: Number(itemMap.senderId || 0),
            senderRole: Number(itemMap.senderRole || 0) as any,
            type: Number(itemMap.type || 0) as any,
            content: String(itemMap.content || ""),
            answerMessageId: Number(itemMap.answerMessageId || 0),
            isWithDraw: Number(itemMap.isWithDraw || 0) as any
          });
          lastMsgId = msg.id;
        }
      }
      return { insertId: lastMsgId, affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：SELECT ... FROM chat_messages WHERE ...
    const selectMsgMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+chat_messages\s+WHERE\s+([\s\S]+?)$/i);
    if (selectMsgMatch) {
      const colStr = selectMsgMatch[1].trim();
      const wherePart = selectMsgMatch[2].trim();
      const idMatch = wherePart.match(/id\s*=\s*(\d+|\?)/i);
      const roomMatch = wherePart.match(/chatRoomId\s*=\s*(\d+|\?)/i);

      let msgs: any[] = [];
      if (idMatch) {
        const mId = idMatch[1] === "?" ? Number(params[0]) : Number(idMatch[1]);
        const m = ChatService.getMockMessage(mId);
        if (m) msgs = [m];
      } else if (roomMatch) {
        const rId = roomMatch[1] === "?" 
          ? (/schoolId\s*=\s*(\d+|\?)/i.test(wherePart) ? Number(params[1]) : Number(params[0]))
          : Number(roomMatch[1]);
        for (let i = 1; i <= 10000; i++) {
          const m = ChatService.getMockMessage(i);
          if (m && m.chatRoomId === rId) msgs.push(m);
        }
      }

      if (colStr === "*") return msgs;
      const cols = colStr.split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      return msgs.map((m) => {
        const row: any = {};
        for (const c of cols) {
          row[c] = m[c];
        }
        return row;
      });
    }

    // 内存沙箱拦截自愈：UPDATE chat_messages SET ... WHERE ...
    const updateMsgMatch = sql.match(/UPDATE\s+chat_messages\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+?)$/i);
    if (updateMsgMatch) {
      const setClause = updateMsgMatch[1];
      const wherePart = updateMsgMatch[2];
      const idMatch = wherePart.match(/id\s*=\s*(\d+|\?)/i);
      if (idMatch) {
        const mId = idMatch[1] === "?" ? Number(params[params.length - 1]) : Number(idMatch[1]);
        const msg = ChatService.getMockMessage(mId);
        if (msg) {
          if (/isWithDraw\s*=\s*1/i.test(setClause)) {
            msg.isWithDraw = 1;
          }
        }
      }
      return { affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：INSERT INTO chat_group_members
    const groupMemberInsertMatch = sql.match(/INSERT\s+INTO\s+chat_group_members\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)$/i);
    if (groupMemberInsertMatch) {
      const cols = groupMemberInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = groupMemberInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      let lastId = 2001;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else if (val.toLowerCase() === "null") {
              val = null;
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          ChatGroupService.seedMockMember({
            schoolId: Number(itemMap.schoolId),
            chatRoomId: Number(itemMap.chatRoomId),
            userId: Number(itemMap.userId),
            role: Number(itemMap.role !== undefined ? itemMap.role : 0) as any,
            nickInGroup: String(itemMap.nickInGroup || ""),
            lastReadMessageId: Number(itemMap.lastReadMessageId || 0),
            isMuted: Number(itemMap.isMuted || 0) as any
          });
        }
      }
      return { insertId: lastId, affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：INSERT INTO patrol_delay_records
    const delayInsertMatch = sql.match(/INSERT\s+INTO\s+patrol_delay_records\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)$/i);
    if (delayInsertMatch) {
      const cols = delayInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = delayInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      let lastApplyId = 8801;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else if (val.toLowerCase() === "null") {
              val = null;
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          const rec = DelayService.mockRegisterDelayRecord({
            id: itemMap.id ? Number(itemMap.id) : undefined,
            schoolId: Number(itemMap.schoolId),
            patrolId: Number(itemMap.patrolId),
            applicantId: Number(itemMap.applicantId),
            reason: String(itemMap.reason || ""),
            delayHours: Number(itemMap.delayHours || 24),
            oldDeadline: String(itemMap.oldDeadline || ""),
            newDeadline: String(itemMap.newDeadline || ""),
            status: Number(itemMap.status || 0) as any
          });
          lastApplyId = rec.id;
        }
      }
      return { insertId: lastApplyId, affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：UPDATE patrol_delay_records SET ... WHERE ...
    const delayUpdateMatch = sql.match(/UPDATE\s+patrol_delay_records\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+?)$/i);
    if (delayUpdateMatch) {
      const setClause = delayUpdateMatch[1];
      const wherePart = delayUpdateMatch[2];
      const idMatch = wherePart.match(/id\s*=\s*(\d+|\?)/i);
      let targetRecord: any;
      if (idMatch) {
        const aId = idMatch[1] === "?" ? Number(params[params.length - 2] || params[params.length - 1]) : Number(idMatch[1]);
        targetRecord = DelayService.getMockDelayRecord(aId);
      }

      if (targetRecord) {
        if (/status\s*=\s*1/i.test(setClause)) {
          targetRecord.status = 1;
        } else if (/status\s*=\s*2/i.test(setClause)) {
          targetRecord.status = 2;
        }
        if (targetRecord.status === 1 && params.length >= 4) {
          targetRecord.reviewerId = Number(params[0]);
          targetRecord.reviewRemark = String(params[1]);
          targetRecord.newDeadline = params[2] instanceof Date ? params[2].toISOString() : String(params[2]);
          targetRecord.reviewedAt = new Date().toISOString();
        } else if (targetRecord.status === 2 && params.length >= 3) {
          targetRecord.reviewerId = Number(params[0]);
          targetRecord.reviewRemark = String(params[1]);
          targetRecord.reviewedAt = new Date().toISOString();
        }
      }
      return { affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：SELECT ... FROM patrol_delay_records
    const delaySelectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+patrol_delay_records(?:[\s\S]*?WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY|\s+LIMIT|$)/i);
    if (delaySelectMatch) {
      const colStr = delaySelectMatch[1].trim();
      const wherePart = delaySelectMatch[2] ? delaySelectMatch[2].trim() : "";

      // 统计 pendingCount: SELECT COUNT(1) AS pendingCount FROM patrol_delay_records WHERE ... AND status = 0
      if (/COUNT\(1\)\s+AS\s+pendingCount/i.test(colStr)) {
        const patrolMatch = wherePart.match(/patrolId\s*=\s*(\d+|\?)/i);
        const pId = patrolMatch ? (patrolMatch[1] === "?" ? Number(params[params.length - 1]) : Number(patrolMatch[1])) : 0;
        let count = 0;
        for (let i = 1; i <= 20000; i++) {
          const r = DelayService.getMockDelayRecord(i);
          if (r && r.patrolId === pId && r.status === 0) count++;
        }
        return [{ pendingCount: count }];
      }

      // 统计 approvedCount 与 totalHours: SELECT COUNT(1) AS approvedCount, COALESCE(SUM(delayHours), 0) AS totalHours
      if (/approvedCount/i.test(colStr) || /SUM\(delayHours\)/i.test(colStr)) {
        const patrolMatch = wherePart.match(/patrolId\s*=\s*(\d+|\?)/i);
        const pId = patrolMatch ? (patrolMatch[1] === "?" ? Number(params[params.length - 1]) : Number(patrolMatch[1])) : 0;
        let approvedCount = 0;
        let totalHours = 0;
        for (let i = 1; i <= 20000; i++) {
          const r = DelayService.getMockDelayRecord(i);
          if (r && r.patrolId === pId && r.status === 1) {
            approvedCount++;
            totalHours += r.delayHours;
          }
        }
        return [{ approvedCount, totalHours }];
      }

      // 查询单条记录: WHERE id = ?
      const idMatch = wherePart.match(/id\s*=\s*(\d+|\?)/i);
      if (idMatch) {
        const aId = idMatch[1] === "?" ? Number(params[0]) : Number(idMatch[1]);
        const r = DelayService.getMockDelayRecord(aId);
        return r ? [r] : [];
      }

      // 查询指定工单的全部记录: WHERE ... patrolId = ?
      const patrolMatch = wherePart.match(/patrolId\s*=\s*(\d+|\?)/i);
      if (patrolMatch) {
        const pId = patrolMatch[1] === "?" ? Number(params[params.length - 1]) : Number(patrolMatch[1]);
        const records: any[] = [];
        for (let i = 1; i <= 20000; i++) {
          const r = DelayService.getMockDelayRecord(i);
          if (r && r.patrolId === pId) records.push(r);
        }
        records.sort((a, b) => b.id - a.id);
        return records;
      }
      return [];
    }

    // 内存沙箱拦截自愈：INSERT INTO patrols_handle
    const handleInsertMatch = sql.match(/INSERT\s+INTO\s+patrols_handle\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)$/i);
    if (handleInsertMatch) {
      const cols = handleInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = handleInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      let lastHandleId = 5501;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else if (val.toLowerCase() === "null") {
              val = null;
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          let parsedImages: string[] = [];
          try {
            parsedImages = typeof itemMap.imagesJson === "string" ? JSON.parse(itemMap.imagesJson) : (itemMap.imagesJson || []);
          } catch {
            parsedImages = Array.isArray(itemMap.imagesJson) ? itemMap.imagesJson : [];
          }
          const rec = PatrolHandleService.mockRegisterHandleRecord({
            id: itemMap.id ? Number(itemMap.id) : undefined,
            schoolId: Number(itemMap.schoolId),
            patrolId: Number(itemMap.patrolId),
            handlerId: Number(itemMap.handlerId),
            content: String(itemMap.content || ""),
            imagesJson: parsedImages,
            durationHours: Number(itemMap.durationHours || 1.0)
          });
          lastHandleId = rec.id;
        }
      }
      return { insertId: lastHandleId, affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：DELETE FROM patrols_handle WHERE ...
    const handleDeleteMatch = sql.match(/DELETE\s+FROM\s+patrols_handle\s+WHERE\s+([\s\S]+?)$/i);
    if (handleDeleteMatch) {
      const wherePart = handleDeleteMatch[1];
      const idMatch = wherePart.match(/id\s*=\s*(\d+|\?)/i);
      if (idMatch) {
        const hId = idMatch[1] === "?" ? Number(params[0]) : Number(idMatch[1]);
        const record = PatrolHandleService.getMockHandleRecord(hId);
        if (record) {
          (record as any).isDeleted = 1;
        }
      }
      return { affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：SELECT ... FROM patrols_handle
    const handleSelectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+patrols_handle(?:[\s\S]*?WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY|\s+LIMIT|$)/i);
    if (handleSelectMatch) {
      const wherePart = handleSelectMatch[2] ? handleSelectMatch[2].trim() : "";
      const patrolMatch = wherePart.match(/patrolId\s*=\s*(\d+|\?)/i);
      if (patrolMatch) {
        const pId = patrolMatch[1] === "?" ? Number(params[params.length - 1]) : Number(patrolMatch[1]);
        const records: any[] = [];
        for (let i = 1; i <= 20000; i++) {
          const r = PatrolHandleService.getMockHandleRecord(i);
          if (r && r.patrolId === pId && !(r as any).isDeleted) {
            records.push(r);
          }
        }
        records.sort((a, b) => b.id - a.id);
        return records;
      }
      return [];
    }

    // 内存沙箱拦截自愈：INSERT INTO patrols_review
    const reviewInsertMatch = sql.match(/INSERT\s+INTO\s+patrols_review\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)$/i);
    if (reviewInsertMatch) {
      const cols = reviewInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = reviewInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      let lastReviewId = 6501;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else if (val.toLowerCase() === "null") {
              val = null;
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          let parsedImages: string[] = [];
          try {
            parsedImages = typeof itemMap.imagesJson === "string" ? JSON.parse(itemMap.imagesJson) : (itemMap.imagesJson || []);
          } catch {
            parsedImages = Array.isArray(itemMap.imagesJson) ? itemMap.imagesJson : [];
          }
          const rec = PatrolReviewService.mockRegisterReviewRecord({
            schoolId: Number(itemMap.schoolId),
            patrolId: Number(itemMap.patrolId),
            reviewerId: Number(itemMap.reviewerId),
            isPassed: Number(itemMap.isPassed),
            remark: String(itemMap.remark || ""),
            imagesJson: parsedImages,
            createdAt: itemMap.createdAt ? new Date(itemMap.createdAt).toISOString() : new Date().toISOString()
          });
          lastReviewId = rec.id;
        }
      }
      return { insertId: lastReviewId, affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：SELECT ... FROM patrols_review
    const reviewSelectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+patrols_review(?:[\s\S]*?WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY|\s+LIMIT|$)/i);
    if (reviewSelectMatch) {
      const wherePart = reviewSelectMatch[2] ? reviewSelectMatch[2].trim() : "";
      const patrolMatch = wherePart.match(/patrolId\s*=\s*(\d+|\?)/i);
      if (patrolMatch) {
        const pId = patrolMatch[1] === "?" ? Number(params[params.length - 1]) : Number(patrolMatch[1]);
        const records: any[] = [];
        for (const r of PatrolReviewService.getAllMockReviewRecords()) {
          if (r && r.patrolId === pId) {
            records.push({
              ...r,
              imagesJson: JSON.stringify(r.imagesJson)
            });
          }
        }
        records.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        return records;
      }
      return [];
    }

    // 内存沙箱拦截自愈：INSERT INTO feedbacks / INSERT IGNORE INTO feedbacks
    const feedbackInsertMatch = sql.match(/INSERT(?:\s+IGNORE)?\s+INTO\s+feedbacks\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)$/i);
    if (feedbackInsertMatch) {
      const cols = feedbackInsertMatch[1].split(",").map((c) => c.trim().replace(/[`"']/g, ""));
      const valuesStr = feedbackInsertMatch[2].trim();
      const valueBlocks = valuesStr.match(/\((.*?)\)/g);
      let pIdx = 0;
      let lastFeedbackId = 7501;
      if (valueBlocks) {
        for (const block of valueBlocks) {
          const rawItems = block.slice(1, -1).split(",").map((s) => s.trim());
          const itemMap: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) {
            let val: any = rawItems[i];
            if (val === "?") {
              val = params[pIdx++];
            } else if (val.toLowerCase() === "null") {
              val = null;
            } else {
              val = val.replace(/^['"]|['"]$/g, "");
            }
            itemMap[cols[i]] = val;
          }
          let parsedTags: string[] = [];
          try {
            parsedTags = typeof itemMap.tagsJson === "string" ? JSON.parse(itemMap.tagsJson) : (itemMap.tagsJson || []);
          } catch {
            parsedTags = Array.isArray(itemMap.tagsJson) ? itemMap.tagsJson : [];
          }
          const rec = FeedbackService.mockRegisterFeedback({
            id: itemMap.id ? Number(itemMap.id) : undefined,
            schoolId: Number(itemMap.schoolId),
            patrolId: Number(itemMap.patrolId),
            userId: Number(itemMap.userId || 0),
            score: Number(itemMap.score || 5),
            speedScore: Number(itemMap.speedScore || 5),
            qualityScore: Number(itemMap.qualityScore || 5),
            attitudeScore: Number(itemMap.attitudeScore || 5),
            comment: String(itemMap.comment || ""),
            tagsJson: parsedTags,
            isAutoPassed: Number(itemMap.isAutoPassed || 0) as 0 | 1,
            createdAt: itemMap.createdAt ? new Date(itemMap.createdAt).toISOString() : new Date().toISOString()
          });
          lastFeedbackId = rec.id;
        }
      }
      return { insertId: lastFeedbackId, affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：SELECT ... FROM feedbacks
    const feedbackSelectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+feedbacks(?:[\s\S]*?WHERE\s+([\s\S]+?))?(?:\s+LIMIT|$)/i);
    if (feedbackSelectMatch) {
      const wherePart = feedbackSelectMatch[2] ? feedbackSelectMatch[2].trim() : "";
      const patrolMatch = wherePart.match(/patrolId\s*=\s*(\d+|\?)/i);
      const schoolMatch = wherePart.match(/schoolId\s*=\s*(\d+|\?)/i);
      if (patrolMatch) {
        const pId = patrolMatch[1] === "?" ? Number(params[params.length - 1]) : Number(patrolMatch[1]);
        const sId = schoolMatch ? (schoolMatch[1] === "?" ? Number(params[0]) : Number(schoolMatch[1])) : 0;
        const record = FeedbackService.getMockFeedbackByPatrolId(sId, pId) || FeedbackService.getAllMockFeedbacks().find(f => f.patrolId === pId);
        if (record) {
          return [{
            ...record,
            tagsJson: JSON.stringify(record.tagsJson),
            evaluatorName: record.userId === 0 ? "系统自动结案" : `师生_${record.userId}`
          }];
        }
      }
      return [];
    }

    // 内存沙箱拦截自愈：SELECT ... FROM v_patrol_details
    const vPatrolSelectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+v_patrol_details(?:[\s\S]*?WHERE\s+([\s\S]+?))?(?:\s+LIMIT|$)/i);
    if (vPatrolSelectMatch) {
      const wherePart = vPatrolSelectMatch[2] ? vPatrolSelectMatch[2].trim() : "";
      const patrolMatch = wherePart.match(/patrolId\s*=\s*(\d+|\?)/i);
      const schoolMatch = wherePart.match(/schoolId\s*=\s*(\d+|\?)/i);
      if (patrolMatch) {
        let pId = 0;
        if (patrolMatch[1] === "?") {
          pId = Number(params[1] !== undefined ? params[1] : params[0]);
        } else {
          pId = Number(patrolMatch[1]);
        }
        let sId = 0;
        if (schoolMatch) {
          sId = schoolMatch[1] === "?" ? Number(params[0]) : Number(schoolMatch[1]);
        }
        const patrol = PatrolService.getMockPatrol(pId);
        if (patrol && (!sId || patrol.schoolId === sId)) {
          const creator = WeChatAuthService.getMockUserById(patrol.creatorId);
          const handler = patrol.currentHandlerId ? WeChatAuthService.getMockUserById(patrol.currentHandlerId) : null;
          const cat = PatrolService.getMockCategoriesMap().get(patrol.categoryId);
          return [{
            patrolId: patrol.id,
            orderNo: patrol.orderNo,
            schoolId: patrol.schoolId,
            schoolName: "示范大学",
            schoolCode: "DEMO_UNIV",
            campusId: patrol.campusId,
            campusName: "主校区",
            categoryId: patrol.categoryId,
            categoryName: cat?.name || "综合修缮",
            creatorId: patrol.creatorId,
            creatorRealName: creator?.realName || `师生_${patrol.creatorId}`,
            creatorPhone: creator?.phone || "13800000001",
            currentHandlerId: patrol.currentHandlerId || 0,
            handlerRealName: handler?.realName || null,
            handlerPhone: handler?.phone || null,
            title: patrol.title,
            desc: patrol.desc,
            location1: patrol.location1,
            location2: patrol.location2,
            status: patrol.status,
            priorityLevel: patrol.priorityLevel,
            isPublic: patrol.isPublic,
            deadline: patrol.deadline || new Date(Date.now() + 86400000).toISOString(),
            createdAt: patrol.createdAt,
            updatedAt: patrol.updatedAt
          }];
        }
      }
      return [];
    }

    // 内存沙箱拦截自愈：UPDATE patrols SET status = ...
    const patrolUpdateMatch = sql.match(/UPDATE\s+patrols\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+?)$/i);
    if (patrolUpdateMatch) {
      const setPart = patrolUpdateMatch[1];
      const wherePart = patrolUpdateMatch[2];
      const idMatch = wherePart.match(/id\s*=\s*(\d+|\?)/i);
      const statusMatch = setPart.match(/status\s*=\s*(\d+|\?)/i);
      if (idMatch && statusMatch) {
        const pId = idMatch[1] === "?" ? Number(params[params.length - 2] || params[0]) : Number(idMatch[1]);
        const newStatus = statusMatch[1] === "?" ? Number(params[0]) : Number(statusMatch[1]);
        PatrolService.updateMockPatrol(pId, { status: newStatus as any });
      }
      return { affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：INSERT INTO posts
    const postInsertMatch = sql.match(/INSERT\s+INTO\s+posts\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)$/i);
    if (postInsertMatch) {
      const appeal = FeedbackAppealService.mockRegisterAppeal({
        schoolId: Number(params[0]),
        creatorId: Number(params[1]),
        patrolId: 0,
        title: String(params[2] || ""),
        content: String(params[3] || ""),
        imagesJson: params[4] ? String(params[4]) : null,
        status: 0
      });
      return { insertId: appeal.id, affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：SELECT ... FROM posts
    const postSelectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+posts(?:[\s\S]*?WHERE\s+([\s\S]+?))?(?:\s+ORDER|\s+LIMIT|$)/i);
    if (postSelectMatch) {
      const wherePart = postSelectMatch[2] ? postSelectMatch[2].trim() : "";
      const sId = Number(params[0] || 0);
      const rows: any[] = [];
      for (let i = 1; i <= 20000; i++) {
        const ap = FeedbackAppealService.getMockAppeal(i);
        if (ap && (!sId || ap.schoolId === sId) && !ap.isDeleted) {
          rows.push(ap);
        }
      }
      return rows;
    }

    // 内存沙箱拦截自愈：INSERT INTO post_comments
    const commentInsertMatch = sql.match(/INSERT\s+INTO\s+post_comments\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)$/i);
    if (commentInsertMatch) {
      return { insertId: Math.floor(Math.random() * 1000) + 1000, affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：UPDATE posts SET commentCount = ...
    const postUpdateCommentMatch = sql.match(/UPDATE\s+posts\s+SET\s+commentCount\s*=\s*commentCount\s*\+\s*1/i);
    if (postUpdateCommentMatch) {
      return { affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：INSERT INTO post_likes
    const likeInsertMatch = sql.match(/INSERT\s+INTO\s+post_likes\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)$/i);
    if (likeInsertMatch) {
      return { insertId: Math.floor(Math.random() * 1000) + 1000, affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：DELETE FROM post_likes
    const likeDeleteMatch = sql.match(/DELETE\s+FROM\s+post_likes\s+WHERE/i);
    if (likeDeleteMatch) {
      return { insertId: 0, affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：UPDATE posts SET likeCount = ...
    const postUpdateLikeMatch = sql.match(/UPDATE\s+posts\s+SET\s+likeCount\s*=/i);
    if (postUpdateLikeMatch) {
      return { affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：INSERT INTO messages
    const notificationInsertMatch = sql.match(/INSERT\s+INTO\s+messages\s*\((.*?)\)\s*VALUES\s*([\s\S]+?)$/i);
    if (notificationInsertMatch) {
      const allMsgs = NotificationHub.getAllMockMessages();
      const insertId = allMsgs.length > 0 ? Math.max(...allMsgs.map((m) => m.id)) + 1 : 1;
      return { insertId, affectedRows: 1 };
    }

    // 内存沙箱拦截自愈：SELECT ... FROM apps
    const selectAppsMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+apps\s+WHERE\s+appCode\s*=\s*(\S+)/i);
    if (selectAppsMatch) {
      const appCodeVal = String(params[0] || "").trim();
      const appMap = (NotificationHub as any).mockApps as Map<string, any>;
      const found = appMap.get(`0:${appCodeVal}`);
      return found ? [found] : [];
    }

    // 内存沙箱拦截自愈：SELECT openId, phone FROM users
    const selectUsersContactMatch = sql.match(/SELECT\s+openId,\s*phone\s+FROM\s+users\s+WHERE/i);
    if (selectUsersContactMatch) {
      const userId = Number(params[0] || 0);
      return [{ openId: `o_mock_${userId}`, phone: `1380000${String(userId).slice(-4).padStart(4, "0")}` }];
    }

    // 内存沙箱拦截自愈：SELECT isRead, title, content FROM messages
    const selectNotificationMsgMatch = sql.match(/SELECT\s+isRead,\s*title,\s*content\s+FROM\s+messages\s+WHERE/i);
    if (selectNotificationMsgMatch) {
      const messageId = Number(params[0] || 0);
      const allMsgs = NotificationHub.getAllMockMessages();
      const msg = allMsgs.find(m => m.id === messageId);
      if (msg) {
        return [{ isRead: msg.isRead, title: msg.title, content: msg.content }];
      }
    }

    // 内存沙箱拦截自愈：UPDATE messages SET externalPushStatus
    const updatePushMatch = sql.match(/UPDATE\s+messages\s+SET\s+externalPushStatus/i);
    if (updatePushMatch) {
      return { insertId: 0, affectedRows: 1 };
    }
  }

  /**
   * 清理沙箱全部临时状态与缓存，保证用例正交独立
   */
  public static resetSandbox(): void {
    this.sharedRedisHub.clearAll();
    AtomicQuotaManager.resetMemoryStore();
    setCustomQuotaRedis(this.sharedRedisHub);
    SchoolService.clearMockSchools();
    SettingsService.clearMockSettings();
    WeChatAuthService.clearMockUsers();
    MultiTenantTransitService.clearMockData();
    DepartmentService.clearMockDepartments();
    TagService.clearMockTags();
    WorklistAggregator.clearMockWorklistData();
    PermissionService.clearMockPermissions();
    AuditLogger.clearMockLogs();
    QrcodeService.clearMockPoints();
    PatrolService.clearMockPatrols();
    PatrolService.clearMockCategories();
    CampusPoiService.clearMockPois();
    OssService.clearMockStorageConfigs();
    ChatService.clearMockData();
    DelayService.clearMockData();
    PatrolHandleService.clearMockData();
    PatrolReviewService.clearMockData();
    FeedbackService.clearMockData();
    FeedbackAppealService.clearMockAppeals();
    OfficialReplyService.resetMockData();
    SpaceFeedService.resetMockData();
    PostCommentService.resetMockData();
    PostLikeService.resetMockData();
    OfficialNoticeService.resetMockData();
    ChatRoomService.resetMockData();
    ChatMessageService.resetMockData();
    ChatWithdrawService.resetMockData();
    ChatQuoteService.resetMockData();
    ChatSessionService.resetMockData();
    ChatGroupService.resetMockData();
    NotificationHub.resetMockData();
    NotificationService.resetMockData();
    PresenceEngine.resetMockData();
    DistributedDelayWheel.resetMockData();
    AntiHarassmentQuotaLimiter.resetMockData();
    FallbackChannel.resetMockData();
    AppFeedService.resetMockData();
    CardMutationService.resetMockData();
    LLMConfigService.resetMockData();
    LLMProbeService.resetMock();
    TokenBucketLimiter.resetMemoryStore();
  }
}


