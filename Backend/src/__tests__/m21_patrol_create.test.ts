/**
 * M21: 隐患巡查上报与全屏地图选点独立单元测试套件
 * (Patrol Work Order Creation & Campus POI Snapping Test Suite)
 */

import { describe, expect, it, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { PatrolService } from "../apps/patrol/patrolService.js";
import { CampusPoiService } from "../apps/patrol/campusPoiService.js";
import { SchoolService } from "../services/school/schoolService.js";
import { handleCreatePatrol } from "../api/patrol/create/handler.js";
import { handleSnapPoi } from "../api/patrol/poi/snap/handler.js";

describe("M21: 隐患巡查上报与全屏地图选点 (Patrol Report & Campus POI)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M21-01: 完整提单流程 - 包含 3 张图片的常规提报应成功落盘 status=0 且单号与 SLA 合规", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 21, caseIndex: 1 });
    const sId = tenant.schoolId;
    const userId = 101;

    // 预置高校租户基础信息
    SchoolService.mockRegisterSchool({
      id: sId,
      code: `sch_${sId}`,
      name: "聊城大学",
      shortName: "聊大",
      logo: "",
      domain: "lcu.edu.cn",
      status: 1,
      planLevel: 1,
      planType: "limited",
      maxMonthlyPatrols: 100,
      storageQuotaMb: 1024,
      planExpireAt: "2030-12-31 23:59:59",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: 0
    });

    // 预置分类: 水电暖通，标准工期 2 天
    await TestHarness.executeSql(
      "INSERT INTO categories (id, schoolId, name, defaultDays) VALUES (1, ?, '水电暖通', 2)",
      [sId]
    );

    const res = await PatrolService.createPatrol(sId, userId, "127.0.0.1", {
      campusId: 1,
      categoryId: 1,
      title: "科技楼3楼开水间渗水",
      desc: "地面有积水，疑似地下冷水管法兰盘松动",
      images: [
        "https://oss.school.edu.cn/img1.jpg",
        "https://oss.school.edu.cn/img2.jpg",
        "https://oss.school.edu.cn/img3.jpg"
      ],
      location1: "科技楼",
      location2: "3楼开水间",
      latitude: 36.123456,
      longitude: 115.123456,
      priorityLevel: 1, // 中等 (0.6x)
      isPublic: 1,
      clientToken: "TOKEN-TEST-001"
    });

    expect(res.patrolId).toBeGreaterThan(0);
    expect(res.status).toBe(0);
    expect(res.statusText).toBe("待处理 / 待派单");
    expect(res.orderNo).toMatch(/^LCU-\d{8}-\d{4}$/);
    expect(res.deadline).toBeDefined();

    // 验证底层工单数据落盘
    const rows = await TestHarness.executeSql("SELECT * FROM patrols WHERE id = ?", [res.patrolId]);
    expect(rows.length).toBe(1);
    const patrol = rows[0];
    expect(patrol.schoolId).toBe(sId);
    expect(patrol.status).toBe(0);
    expect(patrol.currentHandlerId).toBe(0); // 待派单状态
    expect(patrol.title).toBe("科技楼3楼开水间渗水");

    // 验证 imagesJson 是否正确存储为 3 个元素的 JSON 数组
    const imgs = JSON.parse(patrol.imagesJson);
    expect(Array.isArray(imgs)).toBe(true);
    expect(imgs.length).toBe(3);
    expect(imgs[0]).toBe("https://oss.school.edu.cn/img1.jpg");
  });

  it("M21-02: 幂等性防御 - 短时间内使用相同 clientToken 重复提单应被强力拦截", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 21, caseIndex: 2 });
    const sId = tenant.schoolId;
    const sameToken = "TOKEN-IDEMPOTENT-XYZ";

    SchoolService.mockRegisterSchool({
      id: sId,
      code: `sch_${sId}`,
      name: "聊城大学",
      shortName: "聊大",
      logo: "",
      domain: "lcu.edu.cn",
      status: 1,
      planLevel: 1,
      planType: "limited",
      maxMonthlyPatrols: 100,
      storageQuotaMb: 1024,
      planExpireAt: "2030-12-31 23:59:59",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: 0
    });

    // 第一次提单成功
    const p1 = PatrolService.createPatrol(sId, 102, "127.0.0.1", {
      campusId: 1,
      categoryId: 1,
      title: "路灯不亮",
      desc: "西区大门正对面的3号路灯接触不良",
      images: ["https://oss.school.edu.cn/light.jpg"],
      location1: "西区大门",
      location2: "3号路灯柱",
      clientToken: sameToken
    });

    // 几乎同毫秒发起并发第二次提单 (相同 clientToken)
    const p2 = PatrolService.createPatrol(sId, 102, "127.0.0.1", {
      campusId: 1,
      categoryId: 1,
      title: "路灯不亮",
      desc: "西区大门正对面的3号路灯接触不良",
      images: ["https://oss.school.edu.cn/light.jpg"],
      location1: "西区大门",
      location2: "3号路灯柱",
      clientToken: sameToken
    });

    await expect(Promise.all([p1, p2])).rejects.toThrow("正在全力提交中");
  });

  it("M21-03: 校内 POI 空间吸附算法验证 - 20米内图钉精准吸附最近建筑，超出35米不吸附", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 21, caseIndex: 3 });
    const sId = tenant.schoolId;

    // 预置建筑 POI: 图书馆 (36.500000, 115.500000)
    await TestHarness.executeSql(
      "INSERT INTO campuses_poi (schoolId, campusId, name, latitude, longitude) VALUES (?, 1, '中心图书馆', 36.500000, 115.500000)",
      [sId]
    );

    // 模拟图钉在偏差约 15 米处 (36.500130, 115.500000)
    const snapHit = await CampusPoiService.snapNearestBuilding(sId, 1, 36.500130, 115.500000);
    expect(snapHit.isSnapped).toBe(true);
    expect(snapHit.buildingName).toBe("中心图书馆");
    expect(snapHit.distanceMeters).toBeLessThan(35.0);
    expect(snapHit.snappedLat).toBe(36.500000);
    expect(snapHit.snappedLng).toBe(115.500000);

    // 模拟图钉在偏差约 120 米处 (36.501100, 115.500000) -> 超出 35米吸附半径
    const snapMiss = await CampusPoiService.snapNearestBuilding(sId, 1, 36.501100, 115.500000);
    expect(snapMiss.isSnapped).toBe(false);
    expect(snapMiss.buildingName).toBe("");
    expect(snapMiss.distanceMeters).toBeGreaterThan(35.0);
    expect(snapMiss.snappedLat).toBe(36.501100);
    expect(snapMiss.snappedLng).toBe(115.500000);
  });

  it("M21-04: M11 SaaS 租户配额与到期硬门禁拦截 - 配额超限或服务到期时优雅阻断", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 21, caseIndex: 4 });
    const sId = tenant.schoolId;

    // 场景 A: 租户月配额为 1 张工单
    SchoolService.mockRegisterSchool({
      id: sId,
      code: `sch_${sId}`,
      name: "配额受限高校",
      shortName: "受限校",
      logo: "",
      domain: "limit.edu.cn",
      status: 1,
      planLevel: 0,
      planType: "limited",
      maxMonthlyPatrols: 1, // 仅允许 1 张
      storageQuotaMb: 50,
      planExpireAt: "2030-12-31 23:59:59",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: 0
    });

    // 提报第 1 张工单 (消耗唯一配额)
    const res1 = await PatrolService.createPatrol(sId, 103, "127.0.0.1", {
      campusId: 1,
      categoryId: 1,
      title: "第1张工单",
      desc: "正常消耗额度",
      images: ["https://oss.school.edu.cn/img1.jpg"],
      location1: "教学楼",
      location2: "101",
      clientToken: "TOKEN-QUOTA-001"
    });
    expect(res1.patrolId).toBeGreaterThan(0);

    // 提报第 2 张工单 (触发配额熔断)
    await expect(
      PatrolService.createPatrol(sId, 103, "127.0.0.1", {
        campusId: 1,
        categoryId: 1,
        title: "第2张工单",
        desc: "超额应该被拦截",
        images: ["https://oss.school.edu.cn/img2.jpg"],
        location1: "教学楼",
        location2: "102",
        clientToken: "TOKEN-QUOTA-002"
      })
    ).rejects.toThrow("配额已达上限");

    // 场景 B: 租户服务已到期
    const expiredSchoolId = sId + 1;
    SchoolService.mockRegisterSchool({
      id: expiredSchoolId,
      code: `sch_${expiredSchoolId}`,
      name: "已到期高校",
      shortName: "到期校",
      logo: "",
      domain: "expired.edu.cn",
      status: 1,
      planLevel: 1,
      planType: "limited",
      maxMonthlyPatrols: 100,
      storageQuotaMb: 1024,
      planExpireAt: "2020-01-01 00:00:00", // 已过期
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: 0
    });

    await expect(
      PatrolService.createPatrol(expiredSchoolId, 104, "127.0.0.1", {
        campusId: 1,
        categoryId: 1,
        title: "到期校工单",
        desc: "到期无法提交",
        images: ["https://oss.school.edu.cn/img.jpg"],
        location1: "教学楼",
        location2: "103",
        clientToken: "TOKEN-EXPIRED-001"
      })
    ).rejects.toThrow("目前处于只读保护状态");
  });

  it("M21-05: 边界防御性输入校验 - 缺少字段或图片数量不合规时强力校验拦截", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 21, caseIndex: 5 });
    const sId = tenant.schoolId;

    SchoolService.mockRegisterSchool({
      id: sId,
      code: `sch_${sId}`,
      name: "校验测试校",
      shortName: "测试校",
      logo: "",
      domain: "test.edu.cn",
      status: 1,
      planLevel: 2,
      planType: "unlimited",
      maxMonthlyPatrols: -1,
      storageQuotaMb: -1,
      planExpireAt: "2030-12-31 23:59:59",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: 0
    });

    // 1. 空标题拦截
    await expect(
      PatrolService.createPatrol(sId, 105, "127.0.0.1", {
        campusId: 1,
        categoryId: 1,
        title: "",
        desc: "有效且较长的详细描述内容",
        images: ["https://oss.school.edu.cn/img.jpg"],
        location1: "综合楼",
        location2: "201",
        clientToken: "TOKEN-VALID-1"
      })
    ).rejects.toThrow("故障标题不可为空且长度不得少于2个字");

    // 2. 详细描述过短 (< 5 字)
    await expect(
      PatrolService.createPatrol(sId, 105, "127.0.0.1", {
        campusId: 1,
        categoryId: 1,
        title: "空调故障",
        desc: "坏了",
        images: ["https://oss.school.edu.cn/img.jpg"],
        location1: "综合楼",
        location2: "201",
        clientToken: "TOKEN-VALID-2"
      })
    ).rejects.toThrow("故障详细描述不得少于5个字");

    // 3. 缺少图片 (0 张)
    await expect(
      PatrolService.createPatrol(sId, 105, "127.0.0.1", {
        campusId: 1,
        categoryId: 1,
        title: "水暖管道漏水",
        desc: "详细描述故障内容超过五字",
        images: [],
        location1: "综合楼",
        location2: "201",
        clientToken: "TOKEN-VALID-3"
      })
    ).rejects.toThrow("现场勘验实况图片至少需要上传 1 张");

    // 4. 图片超限 (> 9 张)
    await expect(
      PatrolService.createPatrol(sId, 105, "127.0.0.1", {
        campusId: 1,
        categoryId: 1,
        title: "水暖管道漏水",
        desc: "详细描述故障内容超过五字",
        images: new Array(10).fill("https://oss.school.edu.cn/img.jpg"),
        location1: "综合楼",
        location2: "201",
        clientToken: "TOKEN-VALID-4"
      })
    ).rejects.toThrow("单笔工单最多允许上传 9 张现场照片");
  });

  it("M21-06: MasterDispatcher 路由端点处理器验证 - 契约与 HTTP Handler 联调通过", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 21, caseIndex: 6 });
    const sId = tenant.schoolId;

    SchoolService.mockRegisterSchool({
      id: sId,
      code: `sch_${sId}`,
      name: "路由联调校",
      shortName: "联调校",
      logo: "",
      domain: "route.edu.cn",
      status: 1,
      planLevel: 1,
      planType: "limited",
      maxMonthlyPatrols: 100,
      storageQuotaMb: 1024,
      planExpireAt: "2030-12-31 23:59:59",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: 0
    });

    // 预置 POI
    await CampusPoiService.mockRegisterPoi({
      schoolId: sId,
      campusId: 1,
      name: "逸夫楼",
      latitude: 36.400000,
      longitude: 115.400000
    });

    // 1. 调用 handleSnapPoi
    const snapResult = await handleSnapPoi(
      { schoolId: sId, userId: tenant.userId },
      { campusId: 1, latitude: 36.400100, longitude: 115.400000 }
    );
    expect(snapResult.status).toBe(1);
    expect(snapResult.data.isSnapped).toBe(true);
    expect(snapResult.data.buildingName).toBe("逸夫楼");

    // 2. 调用 handleCreatePatrol
    const createResult = await handleCreatePatrol(
      { schoolId: sId, userId: tenant.userId, role: tenant.role, ip: "127.0.0.1" },
      {
        campusId: 1,
        categoryId: 1,
        title: "逸夫楼窗户损坏",
        desc: "2楼南侧走廊窗户把手脱落无法关闭",
        images: ["https://oss.school.edu.cn/window.jpg"],
        location1: snapResult.data.buildingName,
        location2: "2楼走廊",
        latitude: 36.400000,
        longitude: 115.400000,
        priorityLevel: 0,
        isPublic: 1,
        clientToken: "TOKEN-HANDLER-001"
      }
    );

    expect(createResult.status).toBe(1);
    expect(createResult.data.patrolId).toBeGreaterThan(0);
    expect(createResult.data.orderNo).toMatch(/^LCU-\d{8}-\d{4}$/);
  });
});
