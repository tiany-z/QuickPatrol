/**
 * M20: 线下固定资产二维码与防作弊打卡独立单元测试套件
 * (QR Points & Anti-Cheating Inspection Scan Test Suite)
 */

import fs from "fs";
import path from "path";
import { describe, expect, it, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { QrcodeService } from "../apps/inspection/qrcodeService.js";
import { GeoUtils } from "../shared/utils/geoUtils.js";
import { Base62Utils } from "../shared/utils/base62Utils.js";
import { handleCreatePoint } from "../api/inspection/qrcode/create/handler.js";
import { handleVerifyScan } from "../api/inspection/qrcode/verify/handler.js";

describe("M20: 线下固定资产二维码与防作弊打卡 (QR Points & Anti-Cheating Inspection Scan)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M20-01: Haversine 几何算法防 NaN 截断验证与 Base62 压缩测试", () => {
    // 1. 测试重合坐标 (距离理论为 0)
    const dZero = GeoUtils.computeHaversineDistance(39.9042, 116.4074, 39.9042, 116.4074);
    expect(dZero).toBe(0);
    expect(isNaN(dZero)).toBe(false);

    // 2. 测试极端微小位移 (防浮点数精度溢出导致的 NaN)
    const dTiny = GeoUtils.computeHaversineDistance(
      39.9042,
      116.4074,
      39.90420000000001,
      116.40740000000001
    );
    expect(dTiny).toBeGreaterThanOrEqual(0);
    expect(isNaN(dTiny)).toBe(false);

    // 3. 测试标准两点 (天安门至故宫约 800 ~ 1100 米)
    const dTianGugong = GeoUtils.computeHaversineDistance(39.9087, 116.3975, 39.9163, 116.3971);
    expect(dTianGugong).toBeGreaterThan(800);
    expect(dTianGugong).toBeLessThan(1100);

    // 4. Base62 压缩测试
    expect(Base62Utils.encode(0)).toBe("0");
    expect(Base62Utils.encode(100)).toBe("1C");
    const testNum = 8848123;
    const encoded = Base62Utils.encode(testNum);
    expect(Base62Utils.decode(encoded)).toBe(testNum);
  });

  it("M20-02: 完整流程 - 创建资产二维码并在有效围栏内 (20米) 正常打卡", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 20, caseIndex: 1 });
    const sId = tenant.schoolId;

    // 创建点位: 基准坐标 (36.500000, 115.500000)
    const created = await QrcodeService.createPoint(sId, {
      campusId: 1,
      name: "东校区1号弱电井",
      address: "实验楼B101",
      latitude: 36.500000,
      longitude: 115.500000,
      categoryId: 2
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.scenePayload).toMatch(/^p:[0-9a-zA-Z]+:[0-9a-f]{8}$/);
    expect(created.qrcodeUrl).toContain("cdn.quickpatrol.edu.cn");

    // 模拟现场在 20 米偏差内扫码 (36.500150, 115.500000 约偏差 16.6 米)
    const verifyRes = await QrcodeService.verifyAndRecordScan(sId, 1001, "127.0.0.1", {
      scene: created.scenePayload,
      userLatitude: 36.500150,
      userLongitude: 115.500000,
      accuracy: 5.0,
      scanSource: "camera"
    });

    expect(verifyRes.isVerified).toBe(true);
    expect(verifyRes.distanceMeters).toBeLessThan(50.0);
    expect(verifyRes.accuracyLevel).toBe("PERFECT");
    expect(verifyRes.scanCount).toBe(1);
    expect(verifyRes.pointName).toBe("东校区1号弱电井");
    expect(verifyRes.locationText).toBe("实验楼B101");
  });

  it("M20-03: 防作弊拦截 - 远程扫码 (偏差 1500 米) 应被强力拒绝", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 20, caseIndex: 2 });
    const sId = tenant.schoolId;

    const created = await QrcodeService.createPoint(sId, {
      campusId: 1,
      name: "北校区锅炉房",
      address: "动力中心1号炉",
      latitude: 36.500000,
      longitude: 115.500000
    });

    // 模拟远在宿舍代扫 (36.515000, 115.500000 约偏差 1667 米)
    await expect(
      QrcodeService.verifyAndRecordScan(sId, 1002, "127.0.0.1", {
        scene: created.scenePayload,
        userLatitude: 36.515000,
        userLongitude: 115.500000,
        accuracy: 10.0,
        scanSource: "camera"
      })
    ).rejects.toThrow("偏差过大");
  });

  it("M20-04: 安全防伪 - 篡改 HMAC-SHA256 签名应被 100% 拒识", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 20, caseIndex: 3 });
    const sId = tenant.schoolId;

    const created = await QrcodeService.createPoint(sId, {
      campusId: 1,
      name: "地下污水泵站",
      address: "东门化粪池旁",
      latitude: 36.500000,
      longitude: 115.500000
    });

    // 故意篡改签名后几位
    const forgedScene = created.scenePayload.slice(0, -4) + "ffff";

    await expect(
      QrcodeService.verifyAndRecordScan(sId, 1003, "127.0.0.1", {
        scene: forgedScene,
        userLatitude: 36.500000,
        userLongitude: 115.500000,
        accuracy: 5.0,
        scanSource: "camera"
      })
    ).rejects.toThrow("数字签名校验失败");
  });

  it("M20-05: 防作弊拦截 - 尝试使用相册选图代扫被坚决阻断", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 20, caseIndex: 5 });
    const sId = tenant.schoolId;

    const created = await QrcodeService.createPoint(sId, {
      campusId: 1,
      name: "食堂变电箱",
      address: "学一食堂后厨",
      latitude: 36.500000,
      longitude: 115.500000
    });

    // 来源为相册选图 (album)
    await expect(
      QrcodeService.verifyAndRecordScan(sId, 1005, "127.0.0.1", {
        scene: created.scenePayload,
        userLatitude: 36.500000,
        userLongitude: 115.500000,
        accuracy: 5.0,
        scanSource: "album"
      })
    ).rejects.toThrow("严禁使用手机相册图片代打卡");
  });

  it("M20-06: 弱信号漂移过渡区 (50m ~ 100m) 告警放行打卡", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 20, caseIndex: 6 });
    const sId = tenant.schoolId;

    const created = await QrcodeService.createPoint(sId, {
      campusId: 1,
      name: "地下变电所",
      address: "地下一层高压室",
      latitude: 36.500000,
      longitude: 115.500000
    });

    // 约偏差 66.7 米 (处于 50m ~ 100m 容差区)
    const verifyRes = await QrcodeService.verifyAndRecordScan(sId, 1006, "127.0.0.1", {
      scene: created.scenePayload,
      userLatitude: 36.500600,
      userLongitude: 115.500000,
      accuracy: 8.0,
      scanSource: "camera"
    });

    expect(verifyRes.isVerified).toBe(true);
    expect(verifyRes.distanceMeters).toBeGreaterThan(50.0);
    expect(verifyRes.distanceMeters).toBeLessThanOrEqual(100.0);
    expect(verifyRes.accuracyLevel).toBe("ACCEPTABLE");
    expect(verifyRes.warningMessage).toContain("轻微漂移");
  });

  it("M20-07: 原子自增断言 - 连续打卡 scanCount 精准递增", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 20, caseIndex: 7 });
    const sId = tenant.schoolId;

    const created = await QrcodeService.createPoint(sId, {
      campusId: 1,
      name: "巡更点A",
      address: "南门岗亭",
      latitude: 36.500000,
      longitude: 115.500000
    });

    // 连续打卡 3 次
    const res1 = await QrcodeService.verifyAndRecordScan(sId, 2001, "127.0.0.1", {
      scene: created.scenePayload,
      userLatitude: 36.500000,
      userLongitude: 115.500000,
      accuracy: 5.0,
      scanSource: "camera"
    });
    expect(res1.scanCount).toBe(1);

    const res2 = await QrcodeService.verifyAndRecordScan(sId, 2002, "127.0.0.1", {
      scene: created.scenePayload,
      userLatitude: 36.500000,
      userLongitude: 115.500000,
      accuracy: 5.0,
      scanSource: "camera"
    });
    expect(res2.scanCount).toBe(2);

    const res3 = await QrcodeService.verifyAndRecordScan(sId, 2003, "127.0.0.1", {
      scene: created.scenePayload,
      userLatitude: 36.500000,
      userLongitude: 115.500000,
      accuracy: 5.0,
      scanSource: "camera"
    });
    expect(res3.scanCount).toBe(3);
  });

  it("M20-08: HTTP 端点鉴权与网关处理测试 (/create 门禁 role>=2 与 /verify 全员放行)", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 20, caseIndex: 8 });
    const sId = tenant.schoolId;

    // 1. 普通在校学生 (role=0) 无权建档二维码
    const forbiddenCreate = await handleCreatePoint(
      { schoolId: sId, userId: 1, role: 0 },
      {
        campusId: 1,
        name: "测试点位",
        address: "测试地址",
        latitude: 36.5,
        longitude: 115.5
      }
    );
    expect(forbiddenCreate.status).toBe(0);
    expect(forbiddenCreate.content).toContain("权限不足");

    // 2. 维保师傅 (role=2) 成功建档
    const allowedCreate = await handleCreatePoint(
      { schoolId: sId, userId: 2, role: 2 },
      {
        campusId: 1,
        name: "师傅建档点位",
        address: "科技楼302",
        latitude: 36.5,
        longitude: 115.5
      }
    );
    expect(allowedCreate.status).toBe(1);
    expect(allowedCreate.data.id).toBeGreaterThan(0);

    // 3. 普通师生 (role=0) 具备全员扫码打卡权限
    const allowedVerify = await handleVerifyScan(
      { schoolId: sId, userId: 1, role: 0, ip: "127.0.0.1" },
      {
        scene: allowedCreate.data.scenePayload,
        userLatitude: 36.5,
        userLongitude: 115.5,
        accuracy: 5,
        scanSource: "camera"
      }
    );
    expect(allowedVerify.status).toBe(1);
    expect(allowedVerify.data.isVerified).toBe(true);
  });

  it("M20-09: 微信小程序端扫码打卡页面代码完整性断言", () => {
    const pagePath = path.resolve(
      __dirname,
      "../../../WeChatMiniProgram/miniprogram/packages/apps/app-inspection/pages/scan-point/index.ts"
    );
    expect(fs.existsSync(pagePath)).toBe(true);
    const code = fs.readFileSync(pagePath, "utf-8");

    // 核心安全约束与接口断言
    expect(code).toContain("onlyFromCamera: true");
    expect(code).toContain("isHighAccuracy: true");
    expect(code).toContain("wx.getLocation");
    expect(code).toContain("/api/inspection/qrcode/verify");
    expect(code).toContain("wx.vibrateShort");
    expect(code).toContain("packages/apps/app-patrol/pages/create/index");
  });
});
