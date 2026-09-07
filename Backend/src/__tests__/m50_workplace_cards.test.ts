/**
 * 高校后勤巡查e速办 v4.0 - M50 单元测试套件
 * 文件路径: src/__tests__/m50_workplace_cards.test.ts
 * 验证目标:
 *   1. 访客毛玻璃门禁与公共免密放行 (evaluateAccessStatus)
 *   2. 复合角色与标签门禁精准隔离 (Tag Gate & Role Matrix)
 *   3. 四象限微应用矩阵拓扑聚合 (Four Quadrants Grouping)
 *   4. Promise.allSettled 并发角标聚合与 200ms 熔断隔离 (Concurrent Badge Aggregator)
 *   5. 个人置顶动态编排与持久化 (Topological Pin Merge & Persist)
 *   6. AI Copilot 战略大卡片元数据下发
 *   7. /api/v1/workplace/apps 与 /api/v1/workplace/sort 网关端点集成测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { workplaceService, WorkplaceService } from "../services/workplaceService.js";
import { workplaceController } from "../controllers/workplaceController.js";
import appsApi from "../api/v1/workplace/apps/index.js";
import sortApi from "../api/v1/workplace/sort/index.js";
import { AppAccessStatus } from "../contracts/workplaceContract.js";

describe("M50: 飞书工作台微应用矩阵与动态门禁测试套件", () => {
  beforeEach(() => {
    WorkplaceService.resetMock();
  });

  it("[M50-01] 访客模式门禁判定: 访客访问需校园师生认证的公共应用进入 FROSTED_LOCK", () => {
    const app = {
      id: 2,
      appCode: "app-emergency-chat",
      name: "突发险情",
      minRole: 2,
      requiredTags: null,
      isPublic: 1
    };

    const status = workplaceService.evaluateAccessStatus(app, {
      userId: 0,
      userRole: 0,
      userTagIds: []
    });

    expect(status).toBe<AppAccessStatus>("FROSTED_LOCK");
  });

  it("[M50-02] 访客模式免登开放: 访客访问完全公开无角色门槛的应用进入 ACTIVE", () => {
    const app = {
      id: 5,
      appCode: "app-repair",
      name: "日常报修",
      minRole: 0,
      requiredTags: null,
      isPublic: 1
    };

    const status = workplaceService.evaluateAccessStatus(app, {
      userId: 0,
      userRole: 0,
      userTagIds: []
    });

    expect(status).toBe<AppAccessStatus>("ACTIVE");
  });

  it("[M50-03] 访客模式隐藏内部应用: 内部非公开应用对未登录访客呈现 HIDDEN", () => {
    const app = {
      id: 99,
      appCode: "app-internal-secret",
      name: "内部机要管理",
      minRole: 3,
      requiredTags: null,
      isPublic: 0
    };

    const status = workplaceService.evaluateAccessStatus(app, {
      userId: 0,
      userRole: 0,
      userTagIds: []
    });

    expect(status).toBe<AppAccessStatus>("HIDDEN");
  });

  it("[M50-04] 已登录师生角色鉴权: 普通师生 (userRole = 1) 访问 minRole = 1 的微应用呈现 ACTIVE", () => {
    const app = {
      id: 1,
      appCode: "app-patrol",
      name: "隐患抢修",
      minRole: 1,
      requiredTags: null,
      isPublic: 1
    };

    const status = workplaceService.evaluateAccessStatus(app, {
      userId: 1001,
      userRole: 1,
      userTagIds: []
    });

    expect(status).toBe<AppAccessStatus>("ACTIVE");
  });

  it("[M50-05] 角色越级受限门禁: 普通师生 (userRole = 1) 访问管理端 (minRole = 2 或 3) 呈现 RESTRICTED", () => {
    const app = {
      id: 13,
      appCode: "app-dispatch-center",
      name: "派单中枢",
      minRole: 2,
      requiredTags: null,
      isPublic: 1
    };

    const status = workplaceService.evaluateAccessStatus(app, {
      userId: 1001,
      userRole: 1,
      userTagIds: []
    });

    expect(status).toBe<AppAccessStatus>("RESTRICTED");
  });

  it("[M50-06] 高权限管理员放行: 管理员 (userRole = 3) 访问所有合规应用呈现 ACTIVE", () => {
    const app = {
      id: 14,
      appCode: "app-delay-audit",
      name: "延期审批",
      minRole: 3,
      requiredTags: null,
      isPublic: 1
    };

    const status = workplaceService.evaluateAccessStatus(app, {
      userId: 8888,
      userRole: 3,
      userTagIds: []
    });

    expect(status).toBe<AppAccessStatus>("ACTIVE");
  });

  it("[M50-07] 标签门禁约束: 用户角色达标但未具备指定业务标签时呈现 RESTRICTED", () => {
    const app = {
      id: 2,
      appCode: "app-emergency-chat",
      name: "突发险情",
      minRole: 2,
      requiredTags: [101], // 要求应急抢险组标签
      isPublic: 1
    };

    // 角色达到 2，但没有标签 101
    const status = workplaceService.evaluateAccessStatus(app, {
      userId: 2001,
      userRole: 2,
      userTagIds: [201, 202]
    });

    expect(status).toBe<AppAccessStatus>("RESTRICTED");
  });

  it("[M50-08] 标签匹配放行: 用户拥有 requiredTags 所需标签时成功放行呈现 ACTIVE", () => {
    const app = {
      id: 2,
      appCode: "app-emergency-chat",
      name: "突发险情",
      minRole: 2,
      requiredTags: [101],
      isPublic: 1
    };

    const status = workplaceService.evaluateAccessStatus(app, {
      userId: 2001,
      userRole: 2,
      userTagIds: [101, 202]
    });

    expect(status).toBe<AppAccessStatus>("ACTIVE");
  });

  it("[M50-09] 四象限自动归类: 工作台大盘正确将 14 个基础微应用划分为四大象限且顺序规范", async () => {
    const view = await workplaceService.getWorkplaceView({
      schoolId: 1,
      userId: 1001,
      userRole: 1,
      userTagIds: []
    });

    expect(view.groups).toBeDefined();
    expect(view.groups.length).toBe(4);

    const categories = view.groups.map((g) => g.categoryKey);
    expect(categories).toEqual(["emergency", "service", "daily", "management"]);

    const totalApps = view.groups.reduce((sum, g) => sum + g.apps.length, 0);
    expect(totalApps).toBeGreaterThanOrEqual(13);

    // 超管 (userRole = 4) 包含全部 14 个基础微应用 (包括非公开驾驶舱)
    const adminView = await workplaceService.getWorkplaceView({
      schoolId: 1,
      userId: 1,
      userRole: 4
    });
    expect(adminView.groups.reduce((sum, g) => sum + g.apps.length, 0)).toBeGreaterThanOrEqual(14);
  });

  it("[M50-10] 象限非公开应用门禁: 验证非公开应用进入 HIDDEN 并在象限内正确定位", async () => {
    // 动态添加一个 isPublic = 0 的私有应用
    WorkplaceService.mockApps.push({
      id: 999,
      schoolId: 1,
      appCode: "app-super-secret",
      name: "核心机房专修",
      icon: "🔐",
      category: "management",
      entryRoute: "/pages/secret/index",
      minRole: 3,
      requiredTags: null,
      badgeApi: "",
      sortOrder: 99,
      isPublic: 0,
      isEnabled: 1,
      isDeleted: 0
    });

    // 访客调用: HIDDEN 应用不展示在象限微应用列表中
    const guestView = await workplaceService.getWorkplaceView({
      schoolId: 1,
      userId: 0
    });
    const mgmtGroupGuest = guestView.groups.find((g) => g.categoryKey === "management");
    const secretAppGuest = mgmtGroupGuest?.apps.find((a) => a.appCode === "app-super-secret");
    expect(secretAppGuest).toBeUndefined();

    // 管理员调用: 具备 minRole 权限正常放行 ACTIVE
    const adminView = await workplaceService.getWorkplaceView({
      schoolId: 1,
      userId: 9001,
      userRole: 3
    });
    const mgmtGroupAdmin = adminView.groups.find((g) => g.categoryKey === "management");
    const secretAppAdmin = mgmtGroupAdmin?.apps.find((a) => a.appCode === "app-super-secret");
    expect(secretAppAdmin?.accessStatus).toBe<AppAccessStatus>("ACTIVE");
  });

  it("[M50-11] 并发角标聚合正常响应: aggregateBadgesConcurrently 批量聚合微应用实时待办角标", async () => {
    const appsToTest = [
      {
        id: 1,
        appCode: "app-patrol",
        name: "隐患抢修",
        icon: "⚡",
        category: "emergency" as const,
        entryRoute: "/pages/patrol/index",
        accessStatus: "ACTIVE" as const,
        badgeCount: 0,
        isPinned: false,
        sortOrder: 10,
        badgeApi: "/api/apps/patrol/badge"
      },
      {
        id: 5,
        appCode: "app-repair",
        name: "日常报修",
        icon: "🔧",
        category: "service" as const,
        entryRoute: "/pages/repair/index",
        accessStatus: "ACTIVE" as const,
        badgeCount: 0,
        isPinned: false,
        sortOrder: 20,
        badgeApi: "/api/apps/repair/badge"
      }
    ];

    const badges = await workplaceService.aggregateBadgesConcurrently(1, 1001, appsToTest);
    expect(badges.get("app-patrol")).toBeDefined();
    expect(badges.get("app-repair")).toBeDefined();
  });

  it("[M50-12] 并发角标 200ms 硬超时熔断: 慢服务超时熔断降级为 0，不阻塞工作台整体返回", async () => {
    const appsWithSlowService = [
      {
        id: 88,
        appCode: "app-slow-hang",
        name: "慢假死服务",
        icon: "🐌",
        category: "daily" as const,
        entryRoute: "/pages/slow/index",
        accessStatus: "ACTIVE" as const,
        badgeCount: 0,
        isPinned: false,
        sortOrder: 1,
        // 自定义超时 API
        badgeApi: "http://slow-timeout-test.mock/badge"
      }
    ];

    const start = Date.now();
    const badges = await workplaceService.aggregateBadgesConcurrently(1, 1001, appsWithSlowService);
    const duration = Date.now() - start;

    expect(badges.get("app-slow-hang")).toBe(0);
    // 熔断硬阈值为 200ms，确保在合理容限范围内返回，绝对不能阻塞超过 500ms
    expect(duration).toBeLessThan(400);
  });

  it("[M50-13] 并发角标部分异常容错: 单个微应用 API 抛异常时 Promise.allSettled 确保其他应用不受影响", async () => {
    const appsMixed = [
      {
        id: 1,
        appCode: "app-patrol",
        name: "隐患抢修",
        icon: "⚡",
        category: "emergency" as const,
        entryRoute: "/pages/patrol/index",
        accessStatus: "ACTIVE" as const,
        badgeCount: 0,
        isPinned: false,
        sortOrder: 10,
        badgeApi: "/api/apps/patrol/badge"
      },
      {
        id: 99,
        appCode: "app-error-service",
        name: "错误崩溃服务",
        icon: "💥",
        category: "daily" as const,
        entryRoute: "/pages/error/index",
        accessStatus: "ACTIVE" as const,
        badgeCount: 0,
        isPinned: false,
        sortOrder: 20,
        badgeApi: "error://mock-throw"
      }
    ];

    const badges = await workplaceService.aggregateBadgesConcurrently(1, 1001, appsMixed);
    // 错误崩溃服务降级为 0，不抛未捕获异常
    expect(badges.get("app-error-service")).toBe(0);
    expect(badges.get("app-patrol")).toBeGreaterThanOrEqual(0);
  });

  it("[M50-14] 用户个人置顶列表归并: 用户自定义置顶应用在 pinnedApps 中展示且 isPinned 标记为 true", async () => {
    const userId = 1001;
    const schoolId = 1;

    // 用户置顶服务反馈与失物招领
    await workplaceService.saveUserPins(userId, schoolId, ["app-feedback", "app-lost-found"]);

    const view = await workplaceService.getWorkplaceView({
      schoolId,
      userId,
      userRole: 1
    });

    expect(view.pinnedApps.length).toBe(2);
    expect(view.pinnedApps.map((a) => a.appCode)).toEqual(["app-feedback", "app-lost-found"]);
    expect(view.pinnedApps.every((a) => a.isPinned)).toBe(true);

    // 象限内部对应的应用 isPinned 也应为 true
    const serviceGroup = view.groups.find((g) => g.categoryKey === "service");
    const feedbackApp = serviceGroup?.apps.find((a) => a.appCode === "app-feedback");
    expect(feedbackApp?.isPinned).toBe(true);
  });

  it("[M50-15] 置顶数量上限保护: 客户端传入超额置顶时自动截断保护至多 7 个", async () => {
    const userId = 1002;
    const schoolId = 1;
    const excessivePins = [
      "app-patrol",
      "app-emergency-chat",
      "app-emergency-broadcast",
      "app-emergency-vault",
      "app-repair",
      "app-lost-found",
      "app-service-consult",
      "app-canteen-comment",
      "app-grid-patrol"
    ];

    await workplaceService.saveUserPins(userId, schoolId, excessivePins);

    const view = await workplaceService.getWorkplaceView({
      schoolId,
      userId,
      userRole: 3
    });

    expect(view.pinnedApps.length).toBeLessThanOrEqual(7);
  });

  it("[M50-16] 置顶持久化接口: saveUserPins 存储配置后在后续请求中顺序稳定", async () => {
    const userId = 2005;
    const schoolId = 1;
    const pinned = ["app-lost-found", "app-patrol"];

    await workplaceService.saveUserPins(userId, schoolId, pinned);

    const view1 = await workplaceService.getWorkplaceView({ schoolId, userId, userRole: 1 });
    expect(view1.pinnedApps.map((a) => a.appCode)).toEqual(pinned);

    // 调换顺序
    await workplaceService.saveUserPins(userId, schoolId, ["app-patrol", "app-lost-found"]);
    const view2 = await workplaceService.getWorkplaceView({ schoolId, userId, userRole: 1 });
    expect(view2.pinnedApps.map((a) => a.appCode)).toEqual(["app-patrol", "app-lost-found"]);
  });

  it("[M50-17] 未登录用户禁止保存置顶: userId = 0 调用 saveUserPins 或控制器返回 401 拒绝", async () => {
    let errCaught: any = null;
    try {
      await workplaceService.saveUserPins(0, 1, ["app-patrol"]);
    } catch (e) {
      errCaught = e;
    }
    expect(errCaught).not.toBeNull();

    // 控制器调用
    const resMock = {
      writeHead: () => {},
      end: () => {}
    };
    const ctrlRes = await workplaceController.handleSavePins(
      {},
      resMock,
      { pinnedAppCodes: ["app-patrol"] },
      { userId: 0, schoolId: 1 }
    );
    expect(ctrlRes.code).toBe(401);
  });

  it("[M50-18] 顶部 AI Copilot 战略大卡片元数据: 校验包含问候语、占位符与快捷提问列表", async () => {
    const view = await workplaceService.getWorkplaceView({
      schoolId: 1,
      userId: 1001,
      userRole: 1
    });

    expect(view.aiCopilotBanner).toBeDefined();
    expect(view.aiCopilotBanner.enabled).toBe(true);
    expect(typeof view.aiCopilotBanner.greeting).toBe("string");
    expect(view.aiCopilotBanner.quickPrompts.length).toBeGreaterThanOrEqual(3);
  });

  it("[M50-19] 网关端点 /api/v1/workplace/apps 集成测试: 访客与已登录用户获取工作台聚合矩阵", async () => {
    // 1. 访客请求
    const guestRes = await appsApi.handler(
      {
        req: {} as any,
        res: {} as any,
        query: { schoolId: "1" },
        body: {}
      } as any,
      { userPayload: null } as any
    );

    expect(guestRes.status).toBe(1);
    expect(guestRes.data).toBeDefined();
    expect(guestRes.data.isGuest).toBe(true);
    expect(guestRes.data.groups.length).toBe(4);

    // 2. 师生登录请求
    const authRes = await appsApi.handler(
      {
        req: {} as any,
        res: {} as any,
        query: {},
        body: {}
      } as any,
      {
        userPayload: {
          schoolId: 1,
          userId: 1001,
          role: 1
        }
      } as any
    );

    expect(authRes.status).toBe(1);
    expect(authRes.data.isGuest).toBe(false);
  });

  it("[M50-20] 网关端点 /api/v1/workplace/sort 路由与鉴权集成测试: 保存排序成功与非法参数拒绝", async () => {
    // 1. 正常保存
    const successRes = await sortApi.handler(
      {
        req: {} as any,
        res: {} as any,
        query: {},
        body: {
          pinnedAppCodes: ["app-repair", "app-patrol"]
        }
      } as any,
      {
        userPayload: {
          schoolId: 1,
          userId: 1001
        }
      } as any
    );

    expect(successRes.status).toBe(1);
    expect(successRes.data.success).toBe(true);

    // 2. 未登录拦截
    const unauthRes = await sortApi.handler(
      {
        req: {} as any,
        res: {} as any,
        query: {},
        body: { pinnedAppCodes: ["app-repair"] }
      } as any,
      { userPayload: null } as any
    );

    expect(unauthRes.status).toBe(0);
    expect(unauthRes.content).toContain("请先登录");

    // 3. 非法参数格式拒绝
    const invalidRes = await sortApi.handler(
      {
        req: {} as any,
        res: {} as any,
        query: {},
        body: { pinnedAppCodes: "not-an-array" as any }
      } as any,
      {
        userPayload: {
          schoolId: 1,
          userId: 1001
        }
      } as any
    );

    expect(invalidRes.status).toBe(0);
    expect(invalidRes.content).toContain("参数错误");
  });
});
