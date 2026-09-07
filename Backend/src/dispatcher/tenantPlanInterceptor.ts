/**
 * M11: 租户 SaaS 付费级别与月度配额熔断拦截器 (Tenant Plan & Quota Interceptor)
 * 
 * 核心职责：
 * 1. 在请求进入业务 Controller 之前进行租户状态与到期时间硬性判定
 * 2. 对已到期租户实行优雅“只读降级”：GET 放行，写操作统一阻断并返回 402
 * 3. 针对高并发提单写操作 (/patrol/create) 执行微秒级 Redis 原子预扣，超额立即 429 熔断
 * 4. 超管 (role=9) 与免密公共探测请求白名单自动放行
 */

import http from "http";
import { RequestContext } from "./gatewayTypes.js";
import { returnError } from "../shared/flow/result.js";
import { TerminalLogger } from "../shared/log/terminalLogger.js";
import { SchoolService } from "../services/school/schoolService.js";
import { AtomicQuotaManager } from "./quotaRules.js";

export class TenantPlanInterceptor {
  /**
   * 拦截需要扣减配额或受 SaaS 状态管控的请求
   * (白名单豁免：无租户公共探测、超管运维端点)
   */
  public static async intercept(
    ctx: RequestContext,
    req?: http.IncomingMessage
  ): Promise<{ passed: boolean; errorResponse?: any }> {
    const schoolId = ctx.userPayload?.schoolId || (ctx as any).schoolId;

    // 1. 无租户身份的系统级公共探测直接放行
    if (!schoolId || schoolId <= 0) {
      return { passed: true };
    }

    // 2. 超管身份 (role === 9) 豁免商业化配额与到期限制
    const role = ctx.userPayload?.role !== undefined ? ctx.userPayload.role : (ctx as any).role;
    if (role === 9) {
      return { passed: true };
    }

    // 3. 读取租户学校核心配置 (优先二级缓存)
    const schoolRes = await SchoolService.getSchoolById(schoolId);
    if (schoolRes.status !== 1 || !schoolRes.data) {
      return {
        passed: false,
        errorResponse: returnError("当前高校租户不存在或已被注销")
      };
    }

    const school = schoolRes.data;

    // 4. 判定请求方法与路径
    const incomingReq = req || (ctx as any).rawReq;
    const method = incomingReq?.method?.toUpperCase() || "POST";
    const pathname = incomingReq?.url || "";
    const isWriteOperation = method === "POST" || method === "PUT" || method === "DELETE";

    // 4.1 状态位硬性判定 (冻结或软删除)
    if (school.isDeleted === 1 || school.status === 0) {
      TerminalLogger.warn(
        `[M11 配额拦截] 高校 [${school.name}] 已被冻结或软删除，拒绝访问`,
        "SaaSQuota"
      );
      return {
        passed: false,
        errorResponse: returnError("该高校租户已被系统暂停服务或注销")
      };
    }

    // 4.2 到期时间判定 (到期后写操作熔断，只读请求放行)
    const expireTimestamp = new Date(school.planExpireAt).getTime();
    if (Date.now() > expireTimestamp) {
      if (isWriteOperation) {
        TerminalLogger.warn(
          `[M11 配额拦截] 高校 [${school.name}] 授权已到期，写操作已熔断`,
          "SaaSQuota"
        );
        return {
          passed: false,
          errorResponse: returnError(
            `该校后勤 SaaS 服务授权已于 ${school.planExpireAt} 到期，目前处于只读保护状态`
          )
        };
      }
      return { passed: true }; // 只读查询放行
    }

    // 5. 针对提报新工单的专用配额预扣拦截 (POST /api/patrol/create 等)
    if (isWriteOperation && pathname.includes("/patrol/create")) {
      const now = new Date();
      const currentYearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

      const consumeRes = await AtomicQuotaManager.tryConsumeQuota(
        schoolId,
        currentYearMonth,
        school.maxMonthlyPatrols
      );

      if (!consumeRes.success) {
        TerminalLogger.warn(
          `[M11 配额熔断] 高校 [${school.name}] 本月工单配额已超标 (${consumeRes.current}/${school.maxMonthlyPatrols})`,
          "SaaSQuota"
        );
        return {
          passed: false,
          errorResponse: returnError(
            `本校本月工单提报配额已达上限 (${consumeRes.current}/${school.maxMonthlyPatrols})，请联系后勤主管升级套餐`
          )
        };
      }
    }

    return { passed: true };
  }
}
