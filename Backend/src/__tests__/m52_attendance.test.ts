/**
 * 高校后勤巡查e速办 v4.0 - M52 师傅现场考勤打卡与人脸识别真实性核验单元测试
 * 测试范围: 活体防翻拍算法、Haversine空间地理围栏、M20资产码降级、M51排班FSM状态机、
 *           补卡申诉自愈闭环、月度画像统计与网关路由。
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AttendanceService } from "../services/attendanceService.js";
import { attendanceController } from "../controllers/attendanceController.js";
import { FaceAntiSpoofing } from "../shared/utils/faceAntiSpoofing.js";
import { ScheduleService } from "../services/scheduleService.js";
import {
  AttendanceStatus,
  PunchType,
  VerifyMode,
  AppealType,
  AppealApprovalStatus
} from "../contracts/attendanceContract.js";

describe("M52: 师傅现场考勤打卡与人脸识别真实性核验全面测试矩阵", () => {
  const service = AttendanceService.getInstance();
  const testSchoolId = 1001;
  const testUserId = 8801;

  // 生成合法人脸帧 Base64 模拟数据
  const validFaceBase64 = Buffer.from(
    "VALID_AUTHENTIC_HUMAN_FACE_HD_FRAME_DATA_WITH_NATURAL_SKIN_TEXTURE"
  ).toString("base64");

  beforeEach(() => {
    AttendanceService.resetMock();
    ScheduleService.resetMock();
  });

  describe("一、 算法 1 & 活体防翻拍真实性核验测试", () => {
    it("1. 合法人脸帧与有效 Nonce 应顺利通过活体检测且相似度 >= 0.88", async () => {
      const result = await FaceAntiSpoofing.verifyLivenessAndMatch(
        testSchoolId,
        testUserId,
        validFaceBase64,
        "NONCE_VALID_1234"
      );

      expect(result.isSuccess).toBe(true);
      expect(result.similarity).toBeGreaterThanOrEqual(0.88);
      expect(result.isSuspicious).toBe(false);
      expect(result.snapshotUrl).toContain("oss-storage.university.edu");
    });

    it("2. 空白或损坏的人脸数据应立即驳回", async () => {
      const result = await FaceAntiSpoofing.verifyLivenessAndMatch(
        testSchoolId,
        testUserId,
        "",
        "NONCE_VALID_1234"
      );

      expect(result.isSuccess).toBe(false);
      expect(result.failReason).toContain("人脸图像数据无效");
    });

    it("3. 缺少或过期 Nonce 凭证应触发防重放拦截并标记可疑", async () => {
      const result = await FaceAntiSpoofing.verifyLivenessAndMatch(
        testSchoolId,
        testUserId,
        validFaceBase64,
        ""
      );

      expect(result.isSuccess).toBe(false);
      expect(result.isSuspicious).toBe(true);
      expect(result.suspiciousReason).toContain("Invalid_Liveness_Nonce");
    });

    it("4. 低方差模糊照片/静态打印纸张应被拉普拉斯算子拦截 (算法 1A)", async () => {
      const blurryBase64 = Buffer.from("BLURRY_PAPER_PHOTO_SAMPLE").toString("base64");
      const result = await FaceAntiSpoofing.verifyLivenessAndMatch(
        testSchoolId,
        testUserId,
        blurryBase64,
        "NONCE_VALID_1234"
      );

      expect(result.isSuccess).toBe(false);
      expect(result.failReason).toContain("清晰度不足或存在纸质漫反射");
      expect(result.isSuspicious).toBe(true);
    });

    it("5. 手机/显示器二次翻拍屏幕摩尔纹应被频域检测算子强力拦截 (算法 1B)", async () => {
      const moireBase64 = Buffer.from("MOIRE_SCREEN_REPLAY_FRAME").toString("base64");
      const result = await FaceAntiSpoofing.verifyLivenessAndMatch(
        testSchoolId,
        testUserId,
        moireBase64,
        "NONCE_VALID_1234"
      );

      expect(result.isSuccess).toBe(false);
      expect(result.failReason).toContain("检测到屏幕二次翻拍特征");
      expect(result.isSuspicious).toBe(true);
    });

    it("6. 非本人面部特征比对余弦相似度 < 0.88 应被拒认", async () => {
      const notMyFaceBase64 = Buffer.from("NOT_MY_FACE_ATTACKER").toString("base64");
      const result = await FaceAntiSpoofing.verifyLivenessAndMatch(
        testSchoolId,
        testUserId,
        notMyFaceBase64,
        "NONCE_VALID_1234"
      );

      expect(result.isSuccess).toBe(false);
      expect(result.similarity).toBeLessThan(0.88);
      expect(result.isSuspicious).toBe(true);
    });
  });

  describe("二、 算法 2 & 空间地理围栏与 M20 资产码降级测试", () => {
    it("7. Haversine 距离防 NaN 边界计算准确性", () => {
      // 相同两点距离必须严格为 0
      const distZero = FaceAntiSpoofing.calculateHaversineDistance(31.2304, 121.4737, 31.2304, 121.4737);
      expect(distZero).toBe(0);

      // 计算校区中心与近邻点距离
      const dist = FaceAntiSpoofing.calculateHaversineDistance(31.2304, 121.4737, 31.2314, 121.4747);
      expect(dist).toBeGreaterThan(50);
      expect(dist).toBeLessThan(300);
    });

    it("8. 校内有效打卡点在 800m 围栏内判定为通过", () => {
      const check = FaceAntiSpoofing.verifyGeoFence(testSchoolId, 31.2310, 121.4740);
      expect(check.isInside).toBe(true);
      expect(check.distanceMeters).toBeLessThanOrEqual(800);
    });

    it("9. 偏离校区 10 公里外的大幅越界打卡应被拦截", async () => {
      await expect(
        service.processPunchIn(
          testSchoolId,
          testUserId,
          {
            punchType: PunchType.PUNCH_IN,
            faceImageBase64: validFaceBase64,
            livenessNonce: "NONCE_VALID_1234",
            latitude: 31.3500, // 远距离
            longitude: 121.6000
          },
          "127.0.0.1"
        )
      ).rejects.toThrow(/超出允许打卡范围/);
    });

    it("10. 地下配电房弱信号时携带 M20 资产二维码成功降级打卡", async () => {
      const result = await service.processPunchIn(
        testSchoolId,
        testUserId,
        {
          punchType: PunchType.PUNCH_IN,
          faceImageBase64: validFaceBase64,
          livenessNonce: "NONCE_VALID_1234",
          latitude: 0,
          longitude: 0,
          pointCode: "POINT-TEST-001" // 合法预置二维码点位
        },
        "127.0.0.1"
      );

      expect(result.attendanceId).toBeGreaterThan(0);
      const saved = AttendanceService.mockAttendances.find((a) => a.id === result.attendanceId);
      expect(saved?.verifyMode).toBe(VerifyMode.FACE_AND_QR_POINT);
      expect(saved?.pointCode).toBe("POINT-TEST-001");
    });

    it("11. 伪造或不存在的资产二维码打卡应被拒绝", async () => {
      await expect(
        service.processPunchIn(
          testSchoolId,
          testUserId,
          {
            punchType: PunchType.PUNCH_IN,
            faceImageBase64: validFaceBase64,
            livenessNonce: "NONCE_VALID_1234",
            latitude: 0,
            longitude: 0,
            pointCode: "INVALID_UNKNOWN_POINT_999"
          },
          "127.0.0.1"
        )
      ).rejects.toThrow(/固定资产巡查二维码不存在/);
    });
  });

  describe("三、 算法 3 & 基于 M51 排班的确定性有限状态机推导", () => {
    const plannedStart = "2026-09-06 08:30:00";
    const plannedEnd = "2026-09-06 17:30:00";

    it("12. 上班卡: 在起始时间前或宽限期 10 分钟内打卡记为正常出勤 (NORMAL)", () => {
      // 08:35 打卡 (宽限期内)
      const nowInGrace = new Date("2026-09-06T08:35:00");
      const status = FaceAntiSpoofing.evaluateAttendanceStatus(
        PunchType.PUNCH_IN,
        plannedStart,
        plannedEnd,
        nowInGrace
      );
      expect(status).toBe(AttendanceStatus.NORMAL);
    });

    it("13. 上班卡: 超过 10 分钟且在 60 分钟内打卡记为迟到 (LATE)", () => {
      // 08:45 打卡 (迟到 15 分钟)
      const nowLate = new Date("2026-09-06T08:45:00");
      const status = FaceAntiSpoofing.evaluateAttendanceStatus(
        PunchType.PUNCH_IN,
        plannedStart,
        plannedEnd,
        nowLate
      );
      expect(status).toBe(AttendanceStatus.LATE);
    });

    it("14. 上班卡: 超过起始时间 60 分钟打卡记为严重迟到/旷工 (ABSENT)", () => {
      // 09:40 打卡 (晚 70 分钟)
      const nowAbsent = new Date("2026-09-06T09:40:00");
      const status = FaceAntiSpoofing.evaluateAttendanceStatus(
        PunchType.PUNCH_IN,
        plannedStart,
        plannedEnd,
        nowAbsent
      );
      expect(status).toBe(AttendanceStatus.ABSENT);
    });

    it("15. 下班卡: 早于提前 15 分钟打卡记为早退 (EARLY)", () => {
      // 17:05 打卡 (提前 25 分钟离开)
      const nowEarly = new Date("2026-09-06T17:05:00");
      const status = FaceAntiSpoofing.evaluateAttendanceStatus(
        PunchType.PUNCH_OUT,
        plannedStart,
        plannedEnd,
        nowEarly
      );
      expect(status).toBe(AttendanceStatus.EARLY);
    });

    it("16. 下班卡: 正常窗口或下班后打卡记为正常 (NORMAL)", () => {
      // 17:35 打卡
      const nowNormal = new Date("2026-09-06T17:35:00");
      const status = FaceAntiSpoofing.evaluateAttendanceStatus(
        PunchType.PUNCH_OUT,
        plannedStart,
        plannedEnd,
        nowNormal
      );
      expect(status).toBe(AttendanceStatus.NORMAL);
    });

    it("17. 无排班自由打卡记为外勤在岗 (FIELD)", () => {
      const status = FaceAntiSpoofing.evaluateAttendanceStatus(
        PunchType.PUNCH_IN,
        null,
        null,
        new Date()
      );
      expect(status).toBe(AttendanceStatus.FIELD);
    });
  });

  describe("四、 补卡申诉多级审批与数据自愈闭环", () => {
    it("18. 发起异常考勤补卡申诉并持久化", async () => {
      const appealRes = await service.createAppeal(testSchoolId, testUserId, {
        appealType: AppealType.MISSING_OUT,
        targetDate: "2026-09-05",
        targetPunchType: PunchType.PUNCH_OUT,
        targetTime: "2026-09-05 17:35:00",
        reason: "因公抢修消防栓延误下班打卡",
        relatedPatrolId: 2001
      });

      expect(appealRes.appealId).toBeGreaterThan(0);
      const savedAppeal = AttendanceService.mockAppeals.find((a) => a.id === appealRes.appealId);
      expect(savedAppeal?.approvalStatus).toBe(AppealApprovalStatus.PENDING);
      expect(savedAppeal?.reason).toContain("抢修消防栓");
    });

    it("19. 主管终审通过补卡申诉，原有异常考勤自动自愈翻转为 APPEALED 状态", async () => {
      // 先生成一条迟到考勤
      AttendanceService.mockAttendances.push({
        id: 7701,
        schoolId: testSchoolId,
        userId: testUserId,
        scheduleId: 1,
        workDate: "2026-09-04",
        punchType: PunchType.PUNCH_IN,
        punchTime: "2026-09-04 08:50:00",
        verifyMode: VerifyMode.FACE_AND_GPS,
        status: AttendanceStatus.LATE,
        faceSimilarity: 0.95,
        facePhotoUrl: null,
        latitude: 31.2304,
        longitude: 121.4737,
        locationName: "大门",
        distanceMeters: 10,
        pointCode: null,
        deviceInfo: null,
        ipAddress: "127.0.0.1",
        isSuspicious: false,
        suspiciousReason: null,
        remark: null,
        createdAt: "2026-09-04 08:50:00",
        updatedAt: "2026-09-04 08:50:00"
      });

      // 提交申诉
      const appealRes = await service.createAppeal(testSchoolId, testUserId, {
        attendanceId: 7701,
        appealType: AppealType.EMERGENCY_REPAIR,
        targetDate: "2026-09-04",
        targetPunchType: PunchType.PUNCH_IN,
        targetTime: "2026-09-04 08:30:00",
        reason: "台风突发排水抢险"
      });

      // 主管通过
      await service.approveAppeal(testSchoolId, 9901, {
        appealId: appealRes.appealId,
        action: "PASS",
        remark: "核实抢修任务无误，同意自愈修正"
      });

      const updatedRecord = AttendanceService.mockAttendances.find((a) => a.id === 7701);
      expect(updatedRecord?.status).toBe(AttendanceStatus.APPEALED);

      const updatedAppeal = AttendanceService.mockAppeals.find((a) => a.id === appealRes.appealId);
      expect(updatedAppeal?.approvalStatus).toBe(AppealApprovalStatus.PASSED);
    });

    it("20. 主管终审通过全新缺卡申诉，系统自愈补插入考勤事实流水", async () => {
      const appealRes = await service.createAppeal(testSchoolId, testUserId, {
        appealType: AppealType.MISSING_IN,
        targetDate: "2026-09-03",
        targetPunchType: PunchType.PUNCH_IN,
        targetTime: "2026-09-03 08:28:00",
        reason: "手机没电，已向组长报备"
      });

      await service.approveAppeal(testSchoolId, 9901, {
        appealId: appealRes.appealId,
        action: "PASS",
        remark: "情况属实"
      });

      const newRecord = AttendanceService.mockAttendances.find(
        (a) => a.workDate === "2026-09-03" && a.punchType === PunchType.PUNCH_IN
      );
      expect(newRecord).toBeDefined();
      expect(newRecord?.status).toBe(AttendanceStatus.APPEALED);
      expect(newRecord?.verifyMode).toBe(VerifyMode.APPEAL_OVERWRITE);
    });

    it("21. 驳回申诉与防终态重复审批测试", async () => {
      const appealRes = await service.createAppeal(testSchoolId, testUserId, {
        appealType: AppealType.MISSING_OUT,
        targetDate: "2026-09-02",
        targetPunchType: PunchType.PUNCH_OUT,
        targetTime: "2026-09-02 17:30:00",
        reason: "忘了打卡"
      });

      // 驳回
      await service.approveAppeal(testSchoolId, 9901, {
        appealId: appealRes.appealId,
        action: "REJECT",
        remark: "无正当理由"
      });

      const appeal = AttendanceService.mockAppeals.find((a) => a.id === appealRes.appealId);
      expect(appeal?.approvalStatus).toBe(AppealApprovalStatus.REJECTED);

      // 再次审批应报错
      await expect(
        service.approveAppeal(testSchoolId, 9901, {
          appealId: appealRes.appealId,
          action: "PASS",
          remark: "再次审批"
        })
      ).rejects.toThrow(/禁止重复处理/);
    });
  });

  describe("五、 算法 4 & 月度出勤率与信用画像衰减计算", () => {
    it("22. 算法 4 信用分扣除衰减权重核算", () => {
      const records = [
        { status: AttendanceStatus.NORMAL },
        { status: AttendanceStatus.NORMAL },
        { status: AttendanceStatus.LATE }, // -2
        { status: AttendanceStatus.EARLY }, // -3
        { status: AttendanceStatus.ABSENT }, // -10
        { status: AttendanceStatus.APPEALED }, // +0.5
        { status: AttendanceStatus.NORMAL, isSuspicious: true } // -25
      ];
      // 100 - (2 + 3 + 10 + 25 - 0.5) = 100 - 39.5 = 60.5
      const stats = FaceAntiSpoofing.calculateMonthlyCreditAndRate(records, 7);
      expect(stats.creditScore).toBe(60.5);
      expect(stats.lateCount).toBe(1);
      expect(stats.earlyCount).toBe(1);
      expect(stats.absentCount).toBe(1);
      expect(stats.appealedCount).toBe(1);
    });

    it("23. 个人月度考勤明细报表与出勤日历单元格输出", async () => {
      // 注入 2 天记录
      AttendanceService.mockAttendances.push(
        {
          id: 101,
          schoolId: testSchoolId,
          userId: testUserId,
          scheduleId: null,
          workDate: "2026-09-01",
          punchType: PunchType.PUNCH_IN,
          punchTime: "2026-09-01 08:25:00",
          verifyMode: VerifyMode.FACE_AND_GPS,
          status: AttendanceStatus.NORMAL,
          faceSimilarity: 0.95,
          facePhotoUrl: null,
          latitude: 31.2304,
          longitude: 121.4737,
          locationName: "校区中心",
          distanceMeters: 10,
          pointCode: null,
          deviceInfo: null,
          ipAddress: "127.0.0.1",
          isSuspicious: false,
          suspiciousReason: null,
          remark: null,
          createdAt: "2026-09-01 08:25:00",
          updatedAt: "2026-09-01 08:25:00"
        },
        {
          id: 102,
          schoolId: testSchoolId,
          userId: testUserId,
          scheduleId: null,
          workDate: "2026-09-01",
          punchType: PunchType.PUNCH_OUT,
          punchTime: "2026-09-01 17:35:00",
          verifyMode: VerifyMode.FACE_AND_GPS,
          status: AttendanceStatus.NORMAL,
          faceSimilarity: 0.95,
          facePhotoUrl: null,
          latitude: 31.2304,
          longitude: 121.4737,
          locationName: "校区中心",
          distanceMeters: 10,
          pointCode: null,
          deviceInfo: null,
          ipAddress: "127.0.0.1",
          isSuspicious: false,
          suspiciousReason: null,
          remark: null,
          createdAt: "2026-09-01 17:35:00",
          updatedAt: "2026-09-01 17:35:00"
        }
      );

      const report = await service.getMonthlyReport(testSchoolId, testUserId, "2026-09");
      expect(report.schoolId).toBe(testSchoolId);
      expect(report.summary.normalCount).toBe(2);
      expect(report.summary.creditScore).toBe(100);
      expect(report.days.length).toBe(1);
      expect(report.days[0].punchInTime).toBe("08:25");
      expect(report.days[0].punchOutTime).toBe("17:35");
    });
  });

  describe("六、 控制器与网关路由端点综合调用测试", () => {
    it("24. handlePunchIn 控制器方法处理打卡与多租户隔离", async () => {
      const mockReq = { ip: "192.168.1.100" };
      const mockRes = {
        writeHead: () => {},
        end: () => {}
      };

      const resp = await attendanceController.handlePunchIn(
        mockReq,
        mockRes,
        {
          punchType: PunchType.PUNCH_IN,
          faceImageBase64: validFaceBase64,
          livenessNonce: "NONCE_VALID_1234",
          latitude: 31.2304,
          longitude: 121.4737
        },
        { schoolId: testSchoolId, userId: testUserId }
      );

      expect(resp.code).toBe(200);
      expect(resp.data.attendanceId).toBeGreaterThan(0);
      expect(resp.data.status).toBe(AttendanceStatus.FIELD);
    });

    it("25. handleGetTodayStatus 控制器方法返回今日打卡进度", async () => {
      const mockReq = {};
      const mockRes = { writeHead: () => {}, end: () => {} };

      const resp = await attendanceController.handleGetTodayStatus(
        mockReq,
        mockRes,
        { date: "2026-09-06" },
        { schoolId: testSchoolId, userId: testUserId }
      );

      expect(resp.code).toBe(200);
      expect(resp.data.livenessNonce).toBeDefined();
      expect(resp.data.geoCenter.maxRadiusMeters).toBe(800);
    });

    it("26. 未登录或非法凭据直接阻断 401", async () => {
      const mockRes = { writeHead: () => {}, end: () => {} };
      const resp = await attendanceController.handlePunchIn(
        {},
        mockRes,
        {} as any,
        { schoolId: 0, userId: 0 } // 无效登录态
      );
      expect(resp.code).toBe(401);
    });
  });
});
