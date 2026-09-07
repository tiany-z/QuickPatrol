import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  IMicroAppRoute,
  MemoryAuthStore,
  MemoryRouterGuard,
  RoleBitmask,
  RoleMatcher,
} from "../shared/routerSubstrate.js";

describe("M09: 飞书式 4-Tab 导航中枢与微前端路由守卫 (TabBar & Router Guard)", () => {
  const miniProgramRoot = path.resolve(
    __dirname,
    "../../../WeChatMiniProgram/miniprogram"
  );

  const mockPublicApp: IMicroAppRoute = {
    appId: "app-campus-space",
    name: "校园公开空间",
    icon: "/assets/icons/space.png",
    entryPath: "/sub-space/pages/index",
    requiredRoleMask: RoleBitmask.GUEST | RoleBitmask.STUDENT | RoleBitmask.STAFF,
    isPublic: true,
  };

  const mockPatrolApp: IMicroAppRoute = {
    appId: "app-patrol",
    name: "隐患巡查提报",
    icon: "/assets/icons/patrol.png",
    entryPath: "/sub-patrol/pages/create",
    requiredRoleMask: RoleBitmask.STUDENT | RoleBitmask.STAFF,
    isPublic: false,
    loginPromptText: "登录后即可提报校园安全隐患",
  };

  const mockMasterApp: IMicroAppRoute = {
    appId: "app-master-desk",
    name: "师傅接单工作台",
    icon: "/assets/icons/worker.png",
    entryPath: "/sub-master/pages/desk",
    requiredRoleMask: RoleBitmask.WORKER | RoleBitmask.SUPERVISOR,
    isPublic: false,
    loginPromptText: "维修师傅登录后即可现场抢单",
  };

  beforeEach(() => {
    MemoryAuthStore.clearAll();
    MemoryRouterGuard.clearAll();
    MemoryRouterGuard.registerApp(mockPublicApp);
    MemoryRouterGuard.registerApp(mockPatrolApp);
    MemoryRouterGuard.registerApp(mockMasterApp);
  });

  describe("单元 1: 算法 1 - 基于位掩码的 O(1) 权限判定 (Role Bitmask Matcher)", () => {
    it("角色枚举准确映射至二进制位权", () => {
      expect(RoleMatcher.rolesToMask([])).toBe(RoleBitmask.GUEST);
      expect(RoleMatcher.rolesToMask([0])).toBe(RoleBitmask.STUDENT); // 2
      expect(RoleMatcher.rolesToMask([1])).toBe(RoleBitmask.STAFF); // 4
      expect(RoleMatcher.rolesToMask([2])).toBe(RoleBitmask.WORKER); // 8
      expect(RoleMatcher.rolesToMask([3])).toBe(RoleBitmask.INSPECTOR); // 16
      expect(RoleMatcher.rolesToMask([4])).toBe(RoleBitmask.SUPERVISOR); // 32
      expect(RoleMatcher.rolesToMask([5])).toBe(RoleBitmask.ADMIN); // 64
      expect(RoleMatcher.rolesToMask([9])).toBe(RoleBitmask.ROOT); // 128
    });

    it("多角色复合身份正确生成合并掩码", () => {
      // 既是教职工又是师傅: 4 | 8 = 12
      const combinedMask = RoleMatcher.rolesToMask([1, 2]);
      expect(combinedMask).toBe(RoleBitmask.STAFF | RoleBitmask.WORKER);
      expect(combinedMask).toBe(12);
    });

    it("位掩码交集准入判定高效精准", () => {
      const studentMask = RoleBitmask.STUDENT;
      const workerMask = RoleBitmask.WORKER;
      const targetRequired = RoleBitmask.STUDENT | RoleBitmask.STAFF; // 2 | 4 = 6

      // 学生命中巡查
      expect(RoleMatcher.hasAccess(studentMask, targetRequired)).toBe(true);
      // 师傅未命中巡查
      expect(RoleMatcher.hasAccess(workerMask, targetRequired)).toBe(false);
      // 超管具备无条件通行权
      expect(RoleMatcher.hasAccess(RoleBitmask.ROOT, targetRequired)).toBe(true);
      expect(RoleMatcher.hasAccess(RoleBitmask.ROOT, 0)).toBe(true);
    });
  });

  describe("单元 2: 算法 2 - 路由拦截意图队列挂起与异步放行 (Pending Intent Pipeline)", () => {
    it("挂起意图能被冲刷放行并重置状态", () => {
      MemoryRouterGuard.setPendingIntentForTest({
        appId: "app-patrol",
        url: "/sub-patrol/pages/create?type=fire",
        timestamp: Date.now(),
      });

      expect(MemoryRouterGuard.getPendingIntent()).not.toBeNull();
      const flushed = MemoryRouterGuard.flushPendingIntent();

      expect(flushed).toBe(true);
      expect(MemoryRouterGuard.lastNavigatedUrl).toBe("/sub-patrol/pages/create?type=fire");
      expect(MemoryRouterGuard.getPendingIntent()).toBeNull();
    });

    it("超过 5 分钟 (300s) 的滞留意图自动失效拒绝放行", () => {
      const expiredTimestamp = Date.now() - 301 * 1000;
      MemoryRouterGuard.setPendingIntentForTest({
        appId: "app-patrol",
        url: "/sub-patrol/pages/create?type=fire",
        timestamp: expiredTimestamp,
      });

      const flushed = MemoryRouterGuard.flushPendingIntent();
      expect(flushed).toBe(false);
      expect(MemoryRouterGuard.getPendingIntent()).toBeNull();
    });
  });

  describe("单元 3: 访客免密浏览与渐进式授权拦截 (Progressive Authorization)", () => {
    it("访客访问公开微应用直接放行，0 弹窗打扰", () => {
      const allowed = MemoryRouterGuard.navigateToApp("app-campus-space");
      expect(allowed).toBe(true);
      expect(MemoryRouterGuard.lastNavigatedUrl).toBe("/sub-space/pages/index");
      expect(MemoryRouterGuard.getPendingIntent()).toBeNull();
    });

    it("访客访问受限微应用时拦截，挂起意图并呼起半屏授权", () => {
      let promptReceived = "";
      MemoryRouterGuard.bindLoginModalTrigger((promptText) => {
        promptReceived = promptText;
      });

      const allowed = MemoryRouterGuard.navigateToApp(
        "app-patrol",
        undefined,
        { floor: 3 }
      );

      expect(allowed).toBe(false);
      expect(promptReceived).toBe("登录后即可提报校园安全隐患");
      const pending = MemoryRouterGuard.getPendingIntent();
      expect(pending).not.toBeNull();
      expect(pending?.url).toBe("/sub-patrol/pages/create?floor=3");
    });

    it("访客完成一键登录后，意图自动放行直达被拦截页面", () => {
      MemoryRouterGuard.navigateToApp("app-patrol", undefined, { floor: 3 });
      expect(MemoryRouterGuard.getPendingIntent()).not.toBeNull();

      // 模拟微信手机号授权成功
      MemoryAuthStore.setAuth({
        userId: 1001,
        openId: "wx_openid",
        boundPhone: "13800000000",
        realName: "张三",
        role: 0,
        roleName: "在校学生",
        roleMask: RoleBitmask.STUDENT,
        schoolId: 1,
        schoolName: "聊城大学",
        token: "jwt_token_123",
      });

      expect(MemoryAuthStore.isLoggedIn()).toBe(true);
      const flushed = MemoryRouterGuard.flushPendingIntent();

      expect(flushed).toBe(true);
      expect(MemoryRouterGuard.lastNavigatedUrl).toBe("/sub-patrol/pages/create?floor=3");
      expect(MemoryRouterGuard.getPendingIntent()).toBeNull();
    });
  });

  describe("单元 4: 角色越权隔离拦截", () => {
    it("学生身份访问师傅端被无情拦截并展示友好提示，绝不误弹登录层", () => {
      let modalCalled = false;
      MemoryRouterGuard.bindLoginModalTrigger(() => {
        modalCalled = true;
      });

      MemoryAuthStore.setAuth({
        userId: 1001,
        openId: "wx_openid",
        boundPhone: "13800000000",
        realName: "学生小王",
        role: 0,
        roleName: "在校学生",
        roleMask: RoleBitmask.STUDENT,
        schoolId: 1,
        schoolName: "聊城大学",
        token: "jwt_token_123",
      });

      const allowed = MemoryRouterGuard.navigateToApp("app-master-desk");

      expect(allowed).toBe(false);
      expect(modalCalled).toBe(false);
      expect(MemoryRouterGuard.lastToastMessage).toBe("当前身份无权访问该微应用");
      expect(MemoryRouterGuard.getPendingIntent()).toBeNull();
    });
  });

  describe("单元 5: 深链外链直达防越权校验 (Deep Link Direct Access)", () => {
    it("未登录状态下允许直达公开应用，禁止直达受限应用", () => {
      expect(MemoryRouterGuard.validateDirectAccess("app-campus-space")).toBe(true);
      expect(MemoryRouterGuard.validateDirectAccess("app-patrol")).toBe(false);
      expect(MemoryRouterGuard.validateDirectAccess("app-master-desk")).toBe(false);
    });

    it("师傅身份允许直达师傅端工作台", () => {
      MemoryAuthStore.setAuth({
        userId: 2002,
        openId: "wx_openid_worker",
        boundPhone: "13800000000",
        realName: "李师傅",
        role: 2,
        roleName: "维保师傅",
        roleMask: RoleBitmask.WORKER,
        schoolId: 1,
        schoolName: "聊城大学",
        token: "jwt_token_worker",
      });

      expect(MemoryRouterGuard.validateDirectAccess("app-master-desk")).toBe(true);
    });
  });

  describe("单元 6: Skyline 渲染引擎与 Glass-Easel 核心组件断言", () => {
    it("qp-tabbar 具备 Skyline/Glass-Easel 配置与 qp-badge 依赖", () => {
      const jsonPath = path.join(
        miniProgramRoot,
        "components/qp-tabbar/qp-tabbar.json"
      );
      const wxmlPath = path.join(
        miniProgramRoot,
        "components/qp-tabbar/qp-tabbar.wxml"
      );
      const wxssPath = path.join(
        miniProgramRoot,
        "components/qp-tabbar/qp-tabbar.wxss"
      );

      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(fs.existsSync(wxmlPath)).toBe(true);
      expect(fs.existsSync(wxssPath)).toBe(true);

      const json = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(json.renderer).toBe("skyline");
      expect(json.componentFramework).toBe("glass-easel");
      expect(json.usingComponents["qp-badge"]).toBe("../qp-badge/qp-badge");

      const wxml = fs.readFileSync(wxmlPath, "utf-8");
      expect(wxml).toContain("qp-tabbar-wrapper");
      expect(wxml).toContain("qp-tabbar-panel");
      expect(wxml).toContain("qp-tabbar-safe-bottom");

      const wxss = fs.readFileSync(wxssPath, "utf-8");
      expect(wxss).toContain(".qp-tabbar-wrapper");
      expect(wxss).toContain(".qp-tabbar-item--active");
      expect(wxss).toContain("var(--qp-safe-bottom)");
    });

    it("qp-quick-login 具备防穿透 catchtouchmove、微信原生手机号授权与半屏抽屉结构", () => {
      const jsonPath = path.join(
        miniProgramRoot,
        "components/qp-quick-login/qp-quick-login.json"
      );
      const wxmlPath = path.join(
        miniProgramRoot,
        "components/qp-quick-login/qp-quick-login.wxml"
      );
      const wxssPath = path.join(
        miniProgramRoot,
        "components/qp-quick-login/qp-quick-login.wxss"
      );

      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(fs.existsSync(wxmlPath)).toBe(true);
      expect(fs.existsSync(wxssPath)).toBe(true);

      const json = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(json.renderer).toBe("skyline");

      const wxml = fs.readFileSync(wxmlPath, "utf-8");
      expect(wxml).toContain('catchtouchmove="true"');
      expect(wxml).toContain('open-type="getPhoneNumber"');
      expect(wxml).toContain("qp-login-sheet");

      const wxss = fs.readFileSync(wxssPath, "utf-8");
      expect(wxss).toContain(".qp-login-root");
      expect(wxss).toContain(".qp-login--show");
      expect(wxss).toContain(".qp-btn-phone");
    });

    it("pages/index/index.json 正确挂载 M09 底部导航与快捷登录组件", () => {
      const indexJsonPath = path.join(miniProgramRoot, "pages/index/index.json");
      const indexJson = JSON.parse(fs.readFileSync(indexJsonPath, "utf-8"));

      expect(indexJson.usingComponents["qp-tabbar"]).toBe(
        "/components/qp-tabbar/qp-tabbar"
      );
      expect(indexJson.usingComponents["qp-quick-login"]).toBe(
        "/components/qp-quick-login/qp-quick-login"
      );
    });
  });
});
