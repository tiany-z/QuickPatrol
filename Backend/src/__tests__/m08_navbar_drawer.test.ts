import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  calculateNavbarCentering,
  DeviceAccountRecord,
  filterDeviceAccounts,
  MemoryDeviceAccountStore,
  MemoryTenantStore,
  mergeRemoteTenantState,
  sortTenantAccounts,
} from "../shared/tenantSubstrate.js";

describe("M08: 顶部沉浸式导航与左侧多单位切换抽屉 (Navbar & Tenant Drawer)", () => {
  const miniProgramRoot = path.resolve(
    __dirname,
    "../../../WeChatMiniProgram/miniprogram"
  );

  const mockPhone = "13800138000";
  const mockOtherPhone = "13911112222";

  const mockAccount1: DeviceAccountRecord = {
    schoolId: 1,
    schoolName: "聊城大学",
    schoolCode: "lcu",
    logoUrl: "https://oss.univ.edu.cn/lcu/logo.png",
    campusName: "西校区",
    boundPhone: mockPhone,
    userId: 1001,
    realName: "张三",
    workNo: "2024018",
    role: 2,
    roleName: "水电暖抢修组长",
    token: "mock_jwt_token_school_1",
    tokenExpireAt: "2026-10-01T00:00:00Z",
    isExpired: false,
    sessionStatus: "active",
    unreadCount: 0,
    lastLoginAt: "2026-09-05T12:00:00.000Z",
  };

  const mockAccount2: DeviceAccountRecord = {
    schoolId: 2,
    schoolName: "示范重点大学",
    schoolCode: "sfdx",
    logoUrl: "https://oss.univ.edu.cn/sfdx/logo.png",
    campusName: "海滨校区",
    boundPhone: mockPhone,
    userId: 2002,
    realName: "张三",
    workNo: "SF9901",
    role: 2,
    roleName: "保卫处巡更专员",
    token: "mock_jwt_token_school_2",
    tokenExpireAt: "2026-09-30T00:00:00Z",
    isExpired: false,
    sessionStatus: "valid",
    unreadCount: 3,
    lastLoginAt: "2026-09-04T10:00:00.000Z",
  };

  const mockAccount3: DeviceAccountRecord = {
    schoolId: 3,
    schoolName: "山东理工大学",
    schoolCode: "sdut",
    logoUrl: "https://oss.univ.edu.cn/sdut/logo.png",
    campusName: "南校区",
    boundPhone: mockPhone,
    userId: 3003,
    realName: "张三",
    workNo: "SDUT66",
    role: 1,
    roleName: "兼职指导教师",
    token: "mock_jwt_token_school_3",
    tokenExpireAt: "2026-08-01T00:00:00Z",
    isExpired: true,
    sessionStatus: "expired",
    unreadCount: 1,
    lastLoginAt: "2026-08-15T08:00:00.000Z",
  };

  const mockAccountForeign: DeviceAccountRecord = {
    schoolId: 99,
    schoolName: "其他高校(异号测试)",
    schoolCode: "other",
    logoUrl: "https://oss.univ.edu.cn/other/logo.png",
    campusName: "主校区",
    boundPhone: mockOtherPhone,
    userId: 9901,
    realName: "李四",
    role: 0,
    roleName: "学生",
    token: "mock_foreign_token",
    tokenExpireAt: "2026-10-01T00:00:00Z",
    isExpired: false,
    sessionStatus: "valid",
    unreadCount: 0,
    lastLoginAt: "2026-09-05T09:00:00.000Z",
  };

  beforeEach(() => {
    MemoryDeviceAccountStore.clearAll();
    MemoryTenantStore.clearAll();
  });

  describe("单元 1: 算法 1 - 同手机号绑定与本机存根双重准入过滤 (Dual-Key Access Filter)", () => {
    it("同设备存在多个手机号存根时，必须 100% 隔离阻断异号账号，仅展示当前手机号的高校", () => {
      const allAccounts = [mockAccount1, mockAccount2, mockAccount3, mockAccountForeign];

      const filtered = filterDeviceAccounts(allAccounts, mockPhone);

      expect(filtered.length).toBe(3);
      expect(filtered.map((a) => a.schoolId)).toEqual([1, 2, 3]);
      expect(filtered.some((a) => a.boundPhone === mockOtherPhone)).toBe(false);
    });

    it("空手机号入参时防御性返回空数组", () => {
      const filtered = filterDeviceAccounts([mockAccount1], "");
      expect(filtered).toEqual([]);
    });
  });

  describe("单元 2: 算法 2 - 基于 LRU 活跃度的多校卡片排序 (Tenant LRU Sorter)", () => {
    it("当前激活高校永远固定首位 (Index 0)，其余按最后活跃时间倒序", () => {
      const list = [mockAccount3, mockAccount2, mockAccount1];

      // 指定当前激活单位为示范重点大学 (ID: 2)
      const sorted = sortTenantAccounts(list, 2);

      expect(sorted[0].schoolId).toBe(2);
      // 其余的学校中，聊城大学(9月5日) 比 山东理工大学(8月15日) 更近
      expect(sorted[1].schoolId).toBe(1);
      expect(sorted[2].schoolId).toBe(3);
    });
  });

  describe("单元 3: 算法 3 - 跨校离线未读数聚合与增量比对 (Cross-School Unread Diff Pipeline)", () => {
    it("云端返回新未读工单或过期状态时，准确触发增量合并并置位 hasChanges", () => {
      const local = [mockAccount1, mockAccount2];

      const remoteStateMap = {
        1: { unreadCount: 5, isExpired: false }, // 聊城大学新增 5 条未读
        2: { unreadCount: 3, isExpired: true }, // 示范重点大学会话过期
      };

      const { updatedList, hasChanges } = mergeRemoteTenantState(local, remoteStateMap);

      expect(hasChanges).toBe(true);
      expect(updatedList[0].unreadCount).toBe(5);
      expect(updatedList[1].isExpired).toBe(true);
      expect(updatedList[1].sessionStatus).toBe("expired");
    });

    it("数据未发生变更时 hasChanges 为 false 避免视图无谓重绘", () => {
      const local = [mockAccount1];
      const remoteStateMap = {
        1: { unreadCount: 0, isExpired: false },
      };

      const { updatedList, hasChanges } = mergeRemoteTenantState(local, remoteStateMap);
      expect(hasChanges).toBe(false);
      expect(updatedList[0].unreadCount).toBe(0);
    });
  });

  describe("单元 4: 算法 4 - 胶囊按钮动态避让与标题对称居中度量 (Capsule Centering Metric)", () => {
    it("模拟 iPhone 14 Pro 计算对称避让边距与标题最大安全宽度", () => {
      const screenWidth = 393;
      const capsule = { width: 87, right: 380 }; // capsuleRightMargin = 393 - 380 = 13, capsuleBlock = 100
      const avatarBlock = 68;

      const { symmetricPadding, maxTitleWidth } = calculateNavbarCentering(
        screenWidth,
        capsule,
        avatarBlock
      );

      // symmetricPadding = max(100, 68) = 100
      expect(symmetricPadding).toBe(100);
      // maxTitleWidth = 393 - 2 * 100 = 193
      expect(maxTitleWidth).toBe(193);
    });
  });

  describe("单元 5: 本机存储管理器与 LRU 20 淘汰防护 (DeviceAccountStore)", () => {
    it("保存存根、同手机号获取、标记过期与物理删除操作全链路正确", () => {
      MemoryDeviceAccountStore.saveAccount(mockAccount1);
      MemoryDeviceAccountStore.saveAccount(mockAccount2);
      MemoryDeviceAccountStore.saveAccount(mockAccountForeign);

      // 同手机号过滤获取
      let phoneAccounts = MemoryDeviceAccountStore.getAccountsByPhone(mockPhone);
      expect(phoneAccounts.length).toBe(2);

      // 标记学校 1 过期
      MemoryDeviceAccountStore.markAsExpired(1, mockPhone);
      phoneAccounts = MemoryDeviceAccountStore.getAccountsByPhone(mockPhone);
      expect(phoneAccounts.find((a) => a.schoolId === 1)?.sessionStatus).toBe("expired");

      // 物理删除学校 2
      MemoryDeviceAccountStore.removeAccount(2, mockPhone);
      phoneAccounts = MemoryDeviceAccountStore.getAccountsByPhone(mockPhone);
      expect(phoneAccounts.length).toBe(1);
      expect(phoneAccounts[0].schoolId).toBe(1);
    });

    it("存根数量超过 20 时自动淘汰最陈旧记录，确保存储不超出容量限制", () => {
      for (let i = 1; i <= 25; i++) {
        MemoryDeviceAccountStore.saveAccount({
          ...mockAccount1,
          schoolId: i,
          schoolName: `测试高校_${i}`,
          boundPhone: mockPhone,
          lastLoginAt: new Date(2026, 0, i).toISOString(),
        });
      }

      const all = MemoryDeviceAccountStore.getAllRawRecords();
      expect(all.length).toBe(20);
    });
  });

  describe("单元 6: 0 白屏秒级热切与响应式总线状态机 (TenantStore)", () => {
    it("初始化与切换高校时，触发订阅者回调与 EventBus TENANT_CHANGED 广播", async () => {
      MemoryTenantStore.init(mockAccount1);
      expect(MemoryTenantStore.getCurrentSchoolId()).toBe(1);

      let listenerNotified = false;
      let eventBusNotified = false;

      MemoryTenantStore.subscribe((newSchoolId, account) => {
        if (newSchoolId === 2 && account.schoolName === "示范重点大学") {
          listenerNotified = true;
        }
      });

      MemoryTenantStore.on("TENANT_CHANGED", (payload: any) => {
        if (payload.newSchoolId === 2) {
          eventBusNotified = true;
        }
      });

      const success = await MemoryTenantStore.switchTenant(mockAccount2);

      expect(success).toBe(true);
      expect(MemoryTenantStore.getCurrentSchoolId()).toBe(2);
      expect(MemoryTenantStore.getCurrentAccount()?.schoolName).toBe("示范重点大学");
      expect(listenerNotified).toBe(true);
      expect(eventBusNotified).toBe(true);
    });

    it("切换到当前已激活的相同学校时短路返回 true，不重复触发广播", async () => {
      MemoryTenantStore.init(mockAccount1);

      let callCount = 0;
      MemoryTenantStore.subscribe(() => {
        callCount++;
      });

      const res = await MemoryTenantStore.switchTenant(mockAccount1);
      expect(res).toBe(true);
      expect(callCount).toBe(0);
    });
  });

  describe("单元 7: 小程序物理工程与 Skyline / Glass-Easel 规范断言", () => {
    it("qp-navbar 具备沉浸式导航配置、居中标题与占位 Slot", () => {
      const jsonPath = path.join(
        miniProgramRoot,
        "components/qp-navbar/qp-navbar.json"
      );
      const wxmlPath = path.join(
        miniProgramRoot,
        "components/qp-navbar/qp-navbar.wxml"
      );
      const wxssPath = path.join(
        miniProgramRoot,
        "components/qp-navbar/qp-navbar.wxss"
      );

      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(fs.existsSync(wxmlPath)).toBe(true);
      expect(fs.existsSync(wxssPath)).toBe(true);

      const json = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(json.renderer).toBe("skyline");
      expect(json.componentFramework).toBe("glass-easel");

      const wxml = fs.readFileSync(wxmlPath, "utf-8");
      expect(wxml).toContain("qp-navbar-wrapper");
      expect(wxml).toContain("qp-navbar-title");
      expect(wxml).toContain("showAvatar");
      expect(wxml).toContain("showBack");

      const wxss = fs.readFileSync(wxssPath, "utf-8");
      expect(wxss).toContain(".qp-navbar--translucent");
      expect(wxss).toContain(".qp-navbar-avatar-glow");
    });

    it("qp-tenant-drawer 具备 75% 滑出面板、防穿透 catchtouchmove 与原地续期弹层", () => {
      const jsonPath = path.join(
        miniProgramRoot,
        "components/qp-tenant-drawer/qp-tenant-drawer.json"
      );
      const wxmlPath = path.join(
        miniProgramRoot,
        "components/qp-tenant-drawer/qp-tenant-drawer.wxml"
      );
      const wxssPath = path.join(
        miniProgramRoot,
        "components/qp-tenant-drawer/qp-tenant-drawer.wxss"
      );

      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(fs.existsSync(wxmlPath)).toBe(true);
      expect(fs.existsSync(wxssPath)).toBe(true);

      const json = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(json.renderer).toBe("skyline");
      expect(json.usingComponents["qp-badge"]).toBe("../qp-badge/qp-badge");

      const wxml = fs.readFileSync(wxmlPath, "utf-8");
      expect(wxml).toContain('catchtouchmove="true"');
      expect(wxml).toContain("qp-drawer-panel");
      expect(wxml).toContain("qp-tenant-card--active");
      expect(wxml).toContain("qp-tenant-card--expired");
      expect(wxml).toContain("qp-renew-modal");

      const wxss = fs.readFileSync(wxssPath, "utf-8");
      expect(wxss).toContain(".qp-drawer-root");
      expect(wxss).toContain(".qp-drawer--open");
      expect(wxss).toContain(".qp-logo--gray");
      expect(wxss).toContain(".qp-renew-modal--show");
    });

    it("pages/index/index.json 正确挂载 M08 沉浸式导航与多单位抽屉组件", () => {
      const indexJsonPath = path.join(miniProgramRoot, "pages/index/index.json");
      const indexJson = JSON.parse(fs.readFileSync(indexJsonPath, "utf-8"));

      expect(indexJson.usingComponents["qp-navbar"]).toBe(
        "/components/qp-navbar/qp-navbar"
      );
      expect(indexJson.usingComponents["qp-tenant-drawer"]).toBe(
        "/components/qp-tenant-drawer/qp-tenant-drawer"
      );
    });
  });
});
