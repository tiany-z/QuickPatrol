import { describe, expect, it, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import {
  checkTenantQuotaSafety,
  AtomicQuotaManager,
  resolveAcademicSemester
} from "../dispatcher/quotaRules.js";
import { TenantPlanInterceptor } from "../dispatcher/tenantPlanInterceptor.js";
import { SchoolService } from "../services/school/schoolService.js";
import { SemesterArchiveService } from "../services/school/semesterArchiveService.js";
import { getTenantQuotaHandler } from "../api/school/quota/handler.js";
import { ISchoolEntity } from "../services/school/schoolTypes.js";
import { RequestContext } from "../dispatcher/gatewayTypes.js";
import { SagaWithdrawStack } from "../shared/sql/withdrawStack.js";

describe("M11: 多校 SaaS 配额熔断与学期自动归档 (Tenant SaaS & Quota)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M11-01: 正常在期且未超额学校能够顺利放行", () => {
    const school: ISchoolEntity = {
      id: 81101,
      code: "lcu",
      name: "聊城大学 (测试)",
      shortName: "聊大",
      logo: "",
      domain: "",
      status: 1,
      planLevel: 1,
      planType: "limited",
      maxMonthlyPatrols: 500,
      storageQuotaMb: 10240,
      planExpireAt: new Date(Date.now() + 86400000 * 30).toISOString(),
      createdAt: "",
      updatedAt: "",
      isDeleted: 0
    };

    const result = checkTenantQuotaSafety(school, 100);
    expect(result.allowed).toBe(true);
    expect(result.code).toBe(200);
    expect(result.currentCount).toBe(100);
    expect(result.maxLimit).toBe(500);
  });

  it("M11-02: 合同到期的学校应被精准拦截并返回只读状态提示", () => {
    const expiredSchool: ISchoolEntity = {
      id: 81102,
      code: "exp_school",
      name: "到期大学",
      shortName: "到大",
      logo: "",
      domain: "",
      status: -1,
      planLevel: 1,
      planType: "limited",
      maxMonthlyPatrols: 500,
      storageQuotaMb: 10240,
      planExpireAt: "2024-01-01 00:00:00", // 过去时间
      createdAt: "",
      updatedAt: "",
      isDeleted: 0
    };

    const result = checkTenantQuotaSafety(expiredSchool, 10);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe(402);
    expect(result.reason).toContain("到期");
  });

  it("M11-03: 工单超额瞬间触发原子熔断并成功回滚", async () => {
    const schoolId = 81103;
    const ym = "202609";
    const maxLimit = 2; // 设置极小配额方便测试

    // 第 1 单: 成功
    const res1 = await AtomicQuotaManager.tryConsumeQuota(schoolId, ym, maxLimit);
    expect(res1.success).toBe(true);
    expect(res1.current).toBe(1);

    // 第 2 单: 成功
    const res2 = await AtomicQuotaManager.tryConsumeQuota(schoolId, ym, maxLimit);
    expect(res2.success).toBe(true);
    expect(res2.current).toBe(2);

    // 第 3 单: 触发熔断！
    const res3 = await AtomicQuotaManager.tryConsumeQuota(schoolId, ym, maxLimit);
    expect(res3.success).toBe(false);
    expect(res3.current).toBe(2); // 验证原子回退成功，未超限

    // 验证当前已占用配额保持在 2
    const current = await AtomicQuotaManager.getCurrentQuota(schoolId, ym);
    expect(current).toBe(2);

    // 模拟 Saga 回退 1 单
    await AtomicQuotaManager.refundQuota(schoolId, ym);
    const afterRefund = await AtomicQuotaManager.getCurrentQuota(schoolId, ym);
    expect(afterRefund).toBe(1);
  });

  it("M11-04: 旗舰尊享版 (unlimited) 永远不触发超额拦截", () => {
    const unlimitedSchool: ISchoolEntity = {
      id: 81104,
      code: "flagship_u",
      name: "旗舰大学",
      shortName: "旗大",
      logo: "",
      domain: "",
      status: 1,
      planLevel: 2,
      planType: "unlimited",
      maxMonthlyPatrols: -1,
      storageQuotaMb: 512000,
      planExpireAt: "2030-01-01 00:00:00",
      createdAt: "",
      updatedAt: "",
      isDeleted: 0
    };

    const result = checkTenantQuotaSafety(unlimitedSchool, 999999);
    expect(result.allowed).toBe(true);
    expect(result.maxLimit).toBe(-1);
  });

  it("M11-05: 冻结暂停态 (status: 0) 与软删除 (isDeleted: 1) 返回 403 阻断", () => {
    const frozenSchool: ISchoolEntity = {
      id: 81105,
      code: "frozen_school",
      name: "冻结大学",
      shortName: "冻大",
      logo: "",
      domain: "",
      status: 0,
      planLevel: 1,
      planType: "limited",
      maxMonthlyPatrols: 100,
      storageQuotaMb: 1024,
      planExpireAt: "2030-01-01 00:00:00",
      createdAt: "",
      updatedAt: "",
      isDeleted: 0
    };

    const res1 = checkTenantQuotaSafety(frozenSchool, 1);
    expect(res1.allowed).toBe(false);
    expect(res1.code).toBe(403);
    expect(res1.reason).toContain("暂停服务");

    const deletedSchool = { ...frozenSchool, status: 1 as const, isDeleted: 1 as const };
    const res2 = checkTenantQuotaSafety(deletedSchool, 1);
    expect(res2.allowed).toBe(false);
    expect(res2.code).toBe(403);
  });

  it("M11-06: 高校自然学期跨度动态切片算法测试 (春季与秋季边界准确切片)", () => {
    // 测试春季月份 (例如 2026-05-10)
    const springDate = new Date("2026-05-10T10:00:00Z");
    const springInfo = resolveAcademicSemester(springDate);
    expect(springInfo.semesterCode).toBe("2026-SPRING");
    expect(springInfo.semesterName).toBe("2026年春季学期");
    expect(springInfo.startDate).toBe("2026-02-15 00:00:00");
    expect(springInfo.endDate).toBe("2026-07-31 23:59:59");

    // 测试秋季月份 (例如 2026-10-20)
    const autumnDate = new Date("2026-10-20T10:00:00Z");
    const autumnInfo = resolveAcademicSemester(autumnDate);
    expect(autumnInfo.semesterCode).toBe("2026-AUTUMN");
    expect(autumnInfo.semesterName).toBe("2026年秋季学期");
    expect(autumnInfo.startDate).toBe("2026-08-01 00:00:00");
    expect(autumnInfo.endDate).toBe("2027-02-14 23:59:59");

    // 测试跨年 1 月份 (例如 2027-01-15 仍归属 2026 年秋季学期)
    const janDate = new Date("2027-01-15T10:00:00Z");
    const janInfo = resolveAcademicSemester(janDate);
    expect(janInfo.semesterCode).toBe("2026-AUTUMN");
  });

  it("M11-07: TenantPlanInterceptor 综合拦截器测试 (只读放行与写操作配额熔断)", async () => {
    const school: ISchoolEntity = {
      id: 81107,
      code: "quota_intercept_school",
      name: "拦截测试大学",
      shortName: "拦大",
      logo: "",
      domain: "",
      status: 1,
      planLevel: 1,
      planType: "limited",
      maxMonthlyPatrols: 1, // 仅允许 1 单
      storageQuotaMb: 1024,
      planExpireAt: new Date(Date.now() + 86400000 * 10).toISOString(),
      createdAt: "",
      updatedAt: "",
      isDeleted: 0
    };

    SchoolService.mockRegisterSchool(school);

    const baseCtx: RequestContext = {
      requestId: "mock_req_11",
      withdrawStack: new SagaWithdrawStack(),
      lockedRows: [],
      userPayload: {
        schoolId: school.id,
        userId: 11001,
        role: 0 // 学生
      }
    };

    // 1. 只读 GET 请求放行
    const getReq = { method: "GET", url: "/api/patrol/list" } as any;
    const resGet = await TenantPlanInterceptor.intercept(baseCtx, getReq);
    expect(resGet.passed).toBe(true);

    // 2. 第 1 次提单 (POST /api/patrol/create): 额度内放行
    const postReq = { method: "POST", url: "/api/patrol/create" } as any;
    const resPost1 = await TenantPlanInterceptor.intercept(baseCtx, postReq);
    expect(resPost1.passed).toBe(true);

    // 3. 第 2 次提单: 超出 1 单配额，触发熔断阻断！
    const resPost2 = await TenantPlanInterceptor.intercept(baseCtx, postReq);
    expect(resPost2.passed).toBe(false);
    expect(resPost2.errorResponse.status).toBe(0);
    expect(resPost2.errorResponse.content).toContain("配额已达上限");

    // 4. 超管 (role = 9) 白名单豁免测试
    const superAdminCtx: RequestContext = {
      ...baseCtx,
      userPayload: { ...baseCtx.userPayload, role: 9 }
    };
    const resAdmin = await TenantPlanInterceptor.intercept(superAdminCtx, postReq);
    expect(resAdmin.passed).toBe(true);
  });

  it("M11-08: 租户配额健康水位判定与报表生成 (HEALTHY, WARNING, EXCEEDED)", async () => {
    const school: ISchoolEntity = {
      id: 81108,
      code: "watermark_school",
      name: "水位测试大学",
      shortName: "水大",
      logo: "",
      domain: "",
      status: 1,
      planLevel: 1,
      planType: "limited",
      maxMonthlyPatrols: 10,
      storageQuotaMb: 1024,
      planExpireAt: new Date(Date.now() + 86400000 * 20).toISOString(),
      createdAt: "",
      updatedAt: "",
      isDeleted: 0
    };

    SchoolService.mockRegisterSchool(school);
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

    // 初始状态: 0 单 -> HEALTHY
    const report1 = await SchoolService.getTenantQuotaHealth(school.id);
    expect(report1.status).toBe(1);
    expect(report1.data?.watermarkStatus).toBe("HEALTHY");
    expect(report1.data?.usedPatrolCount).toBe(0);

    // 消耗 8 单 (80% 水位) -> WARNING
    for (let i = 0; i < 8; i++) {
      await AtomicQuotaManager.tryConsumeQuota(school.id, ym, 10);
    }
    const report2 = await SchoolService.getTenantQuotaHealth(school.id);
    expect(report2.data?.watermarkStatus).toBe("WARNING");
    expect(report2.data?.usageRatio).toBe(0.8);

    // 消耗至 10 单 (100% 水位) -> EXCEEDED
    for (let i = 0; i < 2; i++) {
      await AtomicQuotaManager.tryConsumeQuota(school.id, ym, 10);
    }
    const report3 = await SchoolService.getTenantQuotaHealth(school.id);
    expect(report3.data?.watermarkStatus).toBe("EXCEEDED");
    expect(report3.data?.usedPatrolCount).toBe(10);
  });

  it("M11-09: GET /api/school/quota 端点鉴权守卫与数据返回", async () => {
    const school: ISchoolEntity = {
      id: 81109,
      code: "api_school",
      name: "接口测试大学",
      shortName: "接大",
      logo: "",
      domain: "",
      status: 1,
      planLevel: 0,
      planType: "limited",
      maxMonthlyPatrols: 100,
      storageQuotaMb: 1024,
      planExpireAt: new Date(Date.now() + 86400000 * 50).toISOString(),
      createdAt: "",
      updatedAt: "",
      isDeleted: 0
    };

    SchoolService.mockRegisterSchool(school);

    // 1. 普通学生角色 (role: 0) 访问 -> 403 拦截
    const studentCtx: RequestContext = {
      requestId: "req_student",
      withdrawStack: new SagaWithdrawStack(),
      lockedRows: [],
      userPayload: { schoolId: school.id, userId: 101, role: 0 }
    };
    const deniedRes = await getTenantQuotaHandler(studentCtx);
    expect(deniedRes.status).toBe(0);
    expect(deniedRes.content).toContain("无权查看");

    // 2. 科室主管角色 (role: 3) 访问 -> 200 成功
    const managerCtx: RequestContext = {
      requestId: "req_manager",
      withdrawStack: new SagaWithdrawStack(),
      lockedRows: [],
      userPayload: { schoolId: school.id, userId: 102, role: 3 }
    };
    const allowedRes = await getTenantQuotaHandler(managerCtx);
    expect(allowedRes.status).toBe(1);
    expect(allowedRes.data?.schoolName).toBe("接口测试大学");
    expect(allowedRes.data?.planLevelName).toBe("免费体验版");
  });

  it("M11-10: SemesterArchiveService 调度历史数据归档与缓存清退测试", async () => {
    const schoolId = 81110;
    // 执行学期冷数据归档
    const archiveRes = await SemesterArchiveService.archiveSemesterData(schoolId);
    expect(archiveRes.status).toBe(1);
    expect(archiveRes.data?.semester).toMatch(/SPRING|AUTUMN/);
    expect(archiveRes.data?.migratedCount).toBeDefined();
  });
});
