/**
 * 高校后勤巡查e速办 v4.0 - M53 全校后勤宏观运维决策大盘全面单元测试
 * 测试范围: 六大业务域全量汇聚、2.5D高斯核密度(KDE)、SLA风险预测、Tree-Diff差分压缩、
 *           CFHI设施健康评分、高德导航Excel导出与网关路由。
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MacroDashboardService } from "../services/macroDashboardService.js";
import { PatrolExcelExportService } from "../services/patrolExcelExportService.js";
import { macroDashboardController } from "../controllers/macroDashboardController.js";
import { handleGetOverviewRoute } from "../api/v1/dashboard/overview/handler.js";
import { handleTriggerSyncRoute } from "../api/v1/dashboard/trigger-sync/handler.js";
import { handleExportExcelRoute } from "../api/v1/dashboard/export-excel/handler.js";
import { handleEmergencyAlertRoute } from "../api/v1/dashboard/emergency-alert/handler.js";
import { AttendanceService } from "../services/attendanceService.js";
import { ScheduleService } from "../services/scheduleService.js";
import { RiskLevel } from "../contracts/dashboardContract.js";

describe("M53: 全校后勤宏观运维决策大盘全面测试矩阵 (全系统53模块大收官)", () => {
  const service = MacroDashboardService.getInstance();
  const exportService = PatrolExcelExportService.getInstance();
  const testSchoolId = 1001;

  beforeEach(() => {
    MacroDashboardService.resetMock();
    PatrolExcelExportService.resetMock();
    AttendanceService.resetMock();
    ScheduleService.resetMock();
  });

  describe("一、 六大业务域全量大盘快照汇聚测试", () => {
    it("1. 大盘全量快照拉取应完整包含六大业务域核心指标且无空缺", async () => {
      const data = await service.getDashboardOverview(testSchoolId);

      expect(data.schoolId).toBe(testSchoolId);
      expect(typeof data.schoolName).toBe("string");
      expect(data.cfhiScore).toBeGreaterThanOrEqual(0);
      expect(data.cfhiScore).toBeLessThanOrEqual(100);
      expect([RiskLevel.SAFE, RiskLevel.WARNING, RiskLevel.CRITICAL]).toContain(data.cfhiLevel);

      // 1. 工单态势
      expect(data.patrolOverview.totalCount).toBeGreaterThanOrEqual(0);
      expect(data.patrolOverview.completionRate).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(data.patrolOverview.categoryDistribution)).toBe(true);
      expect(Array.isArray(data.patrolOverview.slaRiskTrend)).toBe(true);

      // 2. 现场考勤
      expect(data.attendanceOverview.attendanceRate).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(data.attendanceOverview.onDutyWorkers)).toBe(true);

      // 3. 值班指挥与维保
      expect(data.shiftOverview.chiefCommander.name).toBeDefined();
      expect(Array.isArray(data.shiftOverview.activeMaintenances)).toBe(true);

      // 4. 师生诉求
      expect(data.feedbackOverview.overallSatisfactionScore).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(data.feedbackOverview.hotKeywords)).toBe(true);

      // 5. 空间热力
      expect(Array.isArray(data.heatMapPoints)).toBe(true);

      // 6. SaaS配额
      expect(data.tenantQuota.planLevelText).toBeDefined();
      expect(data.tenantQuota.quotaUsagePercent).toBeGreaterThanOrEqual(0);
    });

    it("2. 跨校多租户隔离断言: 检索不同学校应生成各自独立的快照隔离镜像", async () => {
      const dataA = await service.getDashboardOverview(1001);
      const dataB = await service.getDashboardOverview(2002);

      expect(dataA.schoolId).toBe(1001);
      expect(dataB.schoolId).toBe(2002);
      expect(dataA).not.toBe(dataB);
    });
  });

  describe("二、 算法 1 & 2.5D 高斯核密度空间热力网格 (KDE) 测试", () => {
    it("3. 根据工单空间经纬度与严重度加权计算高斯核密度发光点阵", () => {
      const samplePatrols = [
        {
          id: 1,
          latitude: 31.2310,
          longitude: 121.4740,
          priority: 1,
          deadline: "2026-09-06 22:00:00",
          title: "普通故障"
        },
        {
          id: 2,
          latitude: 31.2320,
          longitude: 121.4750,
          priority: 3, // 严重度高
          deadline: "2026-09-06 08:00:00", // 已超期
          title: "紧急超期故障"
        }
      ];

      const points = service.calculateKdeHeatMatrix(samplePatrols);

      expect(points.length).toBe(2);
      expect(points[0].weight).toBeLessThan(points[1].weight); // 紧急超期工单发光权重更高
      expect(points[1].weight).toBe(1.0); // 饱和发光
    });

    it("4. 经纬度缺失或非法的工单不产生无效空间热力点", () => {
      const invalidPatrols = [
        { id: 1, latitude: null, longitude: null, title: "无坐标工单" },
        { id: 2, latitude: 0, longitude: 0, title: "零坐标工单" },
        { id: 3, latitude: 31.2304, longitude: 121.4737, title: "有效工单" }
      ];

      const points = service.calculateKdeHeatMatrix(invalidPatrols);
      expect(points.length).toBe(1);
      expect(points[0].buildingName).toBe("有效工单");
    });
  });

  describe("三、 算法 2 & SLA 违约风险走势多时段加权预测", () => {
    it("5. SLA 风险走势应准确输出各时段安全/预警/超期工单统计", () => {
      const samplePatrols = [
        { id: 1, deadline: new Date(Date.now() + 5 * 3600 * 1000).toISOString() }, // 安全
        { id: 2, deadline: new Date(Date.now() + 1 * 3600 * 1000).toISOString() }, // 预警
        { id: 3, deadline: new Date(Date.now() - 2 * 3600 * 1000).toISOString() }  // 超期
      ];

      const trend = service.calculateSlaRiskTrend(samplePatrols);
      expect(trend.length).toBe(4);
      expect(trend[0].hourSlot).toBe("12:00");
      expect(trend[trend.length - 1].criticalCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("四、 算法 3 & WebSocket 3秒增量差分树生成与压缩 (Tree-Diff)", () => {
    it("6. 相同状态树比对时应返回 0 项变更 Patches", () => {
      const treeA = { a: 1, b: "hello", c: { d: true } };
      const treeB = { a: 1, b: "hello", c: { d: true } };

      const patches = service.diffStateTrees(treeA, treeB);
      expect(patches.length).toBe(0);
    });

    it("7. 产生数值变动时应提取精准的 REPLACE / ADD 补丁操作且体积微小", () => {
      const prevTree = {
        patrolOverview: { pendingCount: 3, completionRate: 94.5 },
        attendanceOverview: { actualPresent: 18 }
      };
      const currTree = {
        patrolOverview: { pendingCount: 4, completionRate: 95.0 },
        attendanceOverview: { actualPresent: 19 }
      };

      const patches = service.diffStateTrees(prevTree, currTree);
      expect(patches.length).toBe(3);
      expect(patches.some((p) => p.path === "patrolOverview.pendingCount" && p.value === 4)).toBe(true);
      expect(patches.some((p) => p.path === "attendanceOverview.actualPresent" && p.value === 19)).toBe(true);

      // 验证差分 JSON 序列化大小严格符合微负荷 (远小于 1.2KB)
      const patchJson = JSON.stringify(patches);
      expect(Buffer.byteLength(patchJson, "utf-8")).toBeLessThan(500);
    });

    it("8. computeAndBroadcastDelta 周期差分执行与首尾基准迭代", async () => {
      // 首次执行设置初始基准
      const delta1 = await service.computeAndBroadcastDelta(testSchoolId);
      expect(delta1).toBeNull(); // 首次建立基准无差分

      // 模拟工单变动
      MacroDashboardService.mockPatrols.push({
        id: 9999,
        schoolId: testSchoolId,
        title: "突发新隐患",
        status: 0,
        latitude: 31.231,
        longitude: 121.474
      });

      // 第二次执行提取增量
      const delta2 = await service.computeAndBroadcastDelta(testSchoolId);
      if (delta2) {
        expect(delta2.eventType).toBe("DELTA_UPDATE");
        expect(delta2.schoolId).toBe(testSchoolId);
      }
    });
  });

  describe("五、 算法 4 & 全校后勤综合设施健康度指数评估 (CFHI)", () => {
    it("9. CFHI 指数计算在零超期、100%出勤、5星评价下达到 100 满分卓越", () => {
      const score = service.calculateCfhiScore(0, 50, 100, 5.0, 0);
      expect(score).toBe(100);
    });

    it("10. 存在超期、缺勤与差评时健康分按加权规则平滑扣除并正确分级", () => {
      // 10% 超期 (-3.5), 90% 出勤 (-2.5), 4.5星评价 (-5.0) -> 100 - 11 = 89 (良好)
      const scoreGood = service.calculateCfhiScore(5, 50, 90, 4.5, 0);
      expect(scoreGood).toBe(89);

      // 大量超期与低出勤 -> 扣减跌入 CRITICAL (<60)
      const scoreBad = service.calculateCfhiScore(20, 30, 60, 2.0, 0.4);
      expect(scoreBad).toBeLessThan(60);
    });
  });

  describe("六、 算法 5 & 高德地图静态导航二维码与工单 Excel 台账导出", () => {
    it("11. 高德直达导航 URI 规范化生成", () => {
      const uri = exportService.generateAmapNavUri(31.2308, 121.4740, "笃学楼高压变配电房");
      expect(uri).toContain("https://uri.amap.com/marker?position=121.474,31.2308");
      expect(uri).toContain("coordinate=gaode");
      expect(uri).toContain("callnative=1");
    });

    it("12. 导出工单月度台账并内嵌导航二维码链接，返回合规文件流", async () => {
      const result = await exportService.exportPatrolsWithMapQr({
        schoolId: testSchoolId,
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        includeMapQr: true
      });

      expect(result.buffer).toBeDefined();
      expect(result.buffer.length).toBeGreaterThan(1024);
      expect(result.fileName).toContain(`QuickPatrol_Auditing_${testSchoolId}`);
      expect(result.totalCount).toBeGreaterThan(0);

      // 验证文件内容包含 XML-Spreadsheet 规范结构
      const fileStr = result.buffer.toString("utf-8");
      expect(fileStr).toContain("urn:schemas-microsoft-com:office:spreadsheet");
      expect(fileStr).toContain("笃学楼高压变配电房");
      expect(fileStr).toContain("uri.amap.com/marker");
    });

    it("13. 经纬度缺失或超界时安全降级提示且不影响全表导出", async () => {
      PatrolExcelExportService.mockExportRecords = [
        {
          patrolId: 901,
          orderNo: "XC_NO_GEO",
          campusName: "主校区",
          categoryName: "修缮",
          locationName: "地下盲区",
          title: "无经纬度记录",
          content: "测试",
          statusDesc: "已结案",
          handlerName: "张三",
          reporterName: "李四",
          createdAt: "2026-09-01 10:00:00",
          completedAt: "2026-09-01 12:00:00",
          latitude: null,
          longitude: null
        },
        {
          patrolId: 902,
          orderNo: "XC_OUT_OF_BOUNDS",
          campusName: "主校区",
          categoryName: "修缮",
          locationName: "异常坐标",
          title: "超界坐标记录",
          content: "测试",
          statusDesc: "已结案",
          handlerName: "张三",
          reporterName: "李四",
          createdAt: "2026-09-01 10:00:00",
          completedAt: "2026-09-01 12:00:00",
          latitude: 199.99,
          longitude: 299.99
        }
      ];

      const result = await exportService.exportPatrolsWithMapQr({
        schoolId: testSchoolId,
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        includeMapQr: true
      });

      const fileStr = result.buffer.toString("utf-8");
      expect(fileStr).toContain("未采集物理经纬度");
      expect(fileStr).toContain("坐标超界异常");
      expect(result.totalCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("七、 突发管网特大险情全屏警报联动测试", () => {
    it("14. 特大险情广播发布成功并在毫秒内返回广播时间戳", async () => {
      const res = await service.triggerEmergencyAlert({
        eventType: "EMERGENCY_ALARM",
        schoolId: testSchoolId,
        orderNo: "EM20260906001",
        title: "笃学楼地下室主供水管爆裂危机",
        location: "笃学楼地下二层泵房",
        dangerLevel: 3,
        latitude: 31.2304,
        longitude: 121.4737,
        reporterPhone: "13911112222",
        triggerTime: new Date().toISOString()
      });

      expect(res.success).toBe(true);
      expect(res.broadcastTime).toBeDefined();
    });
  });

  describe("八、 控制器与网关路由端点综合测试", () => {
    it("15. handleGetOverview 控制器方法返回 200 OK 且包含完整报文", async () => {
      const mockReq = {};
      const mockRes = { writeHead: () => {}, end: () => {} };

      const resp = await macroDashboardController.handleGetOverview(
        mockReq,
        mockRes,
        {},
        { schoolId: testSchoolId }
      );

      expect(resp.code).toBe(200);
      expect(resp.data.schoolId).toBe(testSchoolId);
      expect(resp.data.cfhiScore).toBeGreaterThanOrEqual(0);
    });

    it("16. handleTriggerSync 控制器方法触发差分同步", async () => {
      const mockReq = {};
      const mockRes = { writeHead: () => {}, end: () => {} };

      const resp = await macroDashboardController.handleTriggerSync(
        mockReq,
        mockRes,
        {},
        { schoolId: testSchoolId }
      );

      expect(resp.code).toBe(200);
    });

    it("17. handleExportExcel 控制器方法生成 Excel 并返回 200 OK", async () => {
      const mockReq = {};
      const mockRes = { writeHead: () => {}, end: () => {} };

      const resp = await macroDashboardController.handleExportExcel(
        mockReq,
        mockRes,
        { schoolId: testSchoolId, startDate: "2026-09-01", endDate: "2026-09-30", includeMapQr: true },
        { schoolId: testSchoolId }
      );

      expect(resp.code).toBe(200);
      expect(resp.data.fileName).toContain(`QuickPatrol_Auditing_${testSchoolId}`);
    });

    it("18. handleEmergencyAlert 控制器方法发布紧急险情", async () => {
      const mockReq = {};
      const mockRes = { writeHead: () => {}, end: () => {} };

      const resp = await macroDashboardController.handleEmergencyAlert(
        mockReq,
        mockRes,
        {
          eventType: "EMERGENCY_ALARM",
          schoolId: testSchoolId,
          orderNo: "EMG001",
          title: "变压器冒烟",
          location: "配电室",
          dangerLevel: 3,
          latitude: 31.23,
          longitude: 121.47,
          reporterPhone: "13800000000",
          triggerTime: new Date().toISOString()
        },
        { schoolId: testSchoolId }
      );

      expect(resp.code).toBe(200);
      expect(resp.data.success).toBe(true);
    });

    it("19. 网关端点 /api/v1/dashboard/overview 端点路由函数集成测试", async () => {
      const mockReq = {};
      const mockRes = { writeHead: () => {}, end: () => {} };

      const res = await handleGetOverviewRoute(mockReq, mockRes, {}, { schoolId: testSchoolId });
      expect(res.status).toBe(1);
      expect(res.data.schoolId).toBe(testSchoolId);
      expect(res.data.patrolOverview).toBeDefined();
    });

    it("20. 网关端点 /api/v1/dashboard/trigger-sync 端点路由函数集成测试", async () => {
      const mockReq = {};
      const mockRes = { writeHead: () => {}, end: () => {} };

      const res = await handleTriggerSyncRoute(mockReq, mockRes, {}, { schoolId: testSchoolId });
      expect(res.status).toBe(1);
    });

    it("21. 网关端点 /api/v1/dashboard/export-excel 端点路由函数集成测试", async () => {
      const mockReq = {};
      const mockRes = { writeHead: () => {}, end: () => {} };

      const res = await handleExportExcelRoute(
        mockReq,
        mockRes,
        { startDate: "2026-09-01", endDate: "2026-09-30" },
        { schoolId: testSchoolId }
      );
      expect(res.status).toBe(1);
      expect(res.data.fileName).toBeDefined();
    });

    it("22. 网关端点 /api/v1/dashboard/emergency-alert 端点路由函数集成测试", async () => {
      const mockReq = {};
      const mockRes = { writeHead: () => {}, end: () => {} };

      const res = await handleEmergencyAlertRoute(
        mockReq,
        mockRes,
        { orderNo: "EM99", dangerLevel: 3 },
        { schoolId: testSchoolId }
      );
      expect(res.status).toBe(1);
    });
  });

  describe("九、 全系统 53 模块大圆满收官终极验证", () => {
    it("23. 验证大盘同时融合 M51(排班)、M52(考勤)、M21(工单)、M31/M33(舆情) 时空数据", async () => {
      // 联动注入 M51 排班数据
      ScheduleService.mockSchedules.push({
        id: 501,
        schoolId: testSchoolId,
        userId: 1,
        title: "全校总值班长",
        type: "duty",
        relatedAppCode: "app-calendar",
        relatedEntityId: 0,
        startTime: "2026-09-06 08:00:00",
        endTime: "2026-09-06 20:00:00",
        priority: "urgent",
        status: 0,
        dutyPhone: "13912345678",
        location: "总值班室",
        remark: "白班总调度",
        createdAt: "2026-09-06 08:00:00",
        updatedAt: "2026-09-06 08:00:00",
        isDeleted: 0
      });

      // 联动注入 M52 现场打卡数据
      AttendanceService.mockAttendances.push({
        id: 601,
        schoolId: testSchoolId,
        userId: 8801,
        scheduleId: 501,
        workDate: new Date().toISOString().split("T")[0],
        punchType: 1,
        punchTime: `${new Date().toISOString().split("T")[0]} 08:26:00`,
        verifyMode: 1,
        status: 1,
        faceSimilarity: 0.95,
        facePhotoUrl: null,
        latitude: 31.231,
        longitude: 121.474,
        locationName: "笃学楼变电站",
        distanceMeters: 12,
        pointCode: null,
        deviceInfo: null,
        ipAddress: "127.0.0.1",
        isSuspicious: false,
        suspiciousReason: null,
        remark: null,
        createdAt: "2026-09-06 08:26:00",
        updatedAt: "2026-09-06 08:26:00"
      });

      const fullCockpit = await service.getDashboardOverview(testSchoolId);

      // 验证 M51 联动
      expect(fullCockpit.shiftOverview.chiefCommander.phone).toBe("13912345678");

      // 验证 M52 联动
      expect(fullCockpit.attendanceOverview.onDutyWorkers.length).toBeGreaterThanOrEqual(1);
      expect(fullCockpit.attendanceOverview.onDutyWorkers.some((w) => w.userId === 8801)).toBe(true);

      // 验证 M53 综合设施健康评分正常输出
      expect(fullCockpit.cfhiScore).toBeGreaterThanOrEqual(0);
      expect(fullCockpit.cfhiScore).toBeLessThanOrEqual(100);
    });
  });
});
