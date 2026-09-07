/**
 * M27: 施工整改现场交卷与 Saga 逆序补偿专项单元测试套件
 * (Patrol Handle & Saga Rollback Test Suite)
 * 
 * 核心测试矩阵：
 * 1. M27-01: 身份归属与状态门禁校验 (非责任人拦截、非施工中拦截)
 * 2. M27-02: 完工凭证与工时范围防御性校验 (空照片拦截、越权路径拦截、异常工时拦截、说明过短拦截)
 * 3. M27-03: 合法完工交卷与状态机原子跃迁 (status 1 -> 2、生成 handleId、底表入库)
 * 4. M27-04: 状态互斥防撞与并发锁校验 (已完工待复核状态下拒绝重复交卷)
 * 5. M27-05: Saga 逆序补偿自动回滚与自愈断言 (下游通知故障时工单回退status=1且孤岛记录物理抹除)
 * 6. M27-06: 质检驳回后多轮整改证据链与历史聚合 (1:N 多轮整改追加、工时累计与快照排序)
 * 7. M27-07: 师生知情权穿透与 M25 聊天室完工卡片验证 (向工单会话室注入 type:2 进度卡片)
 * 8. M27-08: API 路由端点与 MasterDispatcher 网关调度验证 (/api/patrol/handle/*)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { PatrolHandleService } from "../apps/patrol/patrolHandleService.js";
import { PatrolHandleController } from "../apps/patrol/patrolHandleController.js";
import { PatrolService } from "../apps/patrol/patrolService.js";
import { ChatService } from "../apps/chat/chatService.js";
import { verifyEvidenceImages, validateDurationHours } from "../apps/patrol/handleUtils.js";

// API 路由端点
import { api as submitApi } from "../api/patrol/handle/submit/index.js";
import { api as historyApi } from "../api/patrol/handle/history/index.js";

describe("M27: 施工整改现场交卷与 Saga 逆序补偿 (Patrol Handle & Saga Rollback)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M27-01: 身份归属与状态门禁校验 - 仅接单责任人且在施工中状态下方可交卷", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 27, caseIndex: 1 });
    const sId = tenant.schoolId;

    // 1. 预置处于“待派单”状态 (status = 0) 的工单
    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9201, ?, 1, 1, 'LCU-HANDLE-01', 101, 801, '自来水总阀破损', '待修', 0)",
      [sId]
    );

    // 1.1 尝试在未派单处理状态下交卷 -> 抛出 INVALID_STATUS_FOR_HANDLE
    await expect(
      PatrolHandleService.submitPatrolHandle(sId, 9201, 801, {
        content: "现场总阀已更换并完成测压",
        images: ["/schools/1/patrol/9201/handle/proof1.jpg"],
        durationHours: 1.5
      })
    ).rejects.toThrow("INVALID_STATUS_FOR_HANDLE");

    // 2. 将工单更新为“施工中” (status = 1)
    PatrolService.updateMockPatrol(9201, { status: 1 });

    // 2.1 冒领责任人 (899 != 801) 尝试代交卷 -> 抛出 FORBIDDEN_NOT_CURRENT_HANDLER
    await expect(
      PatrolHandleService.submitPatrolHandle(sId, 9201, 899, {
        content: "他人冒充交卷测试说明文本",
        images: ["/schools/1/patrol/9201/handle/proof1.jpg"],
        durationHours: 1.5
      })
    ).rejects.toThrow("FORBIDDEN_NOT_CURRENT_HANDLER");
  });

  it("M27-02: 完工凭证与工时范围防御性校验 - 空照片、恶意路径、异常工时与短说明强力拦截", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 27, caseIndex: 2 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9202, ?, 1, 1, 'LCU-HANDLE-02', 102, 802, '水暖管网漏水', '急修', 1)",
      [sId]
    );

    // 1. 无实拍照片或照片为空数组
    await expect(
      PatrolHandleService.submitPatrolHandle(sId, 9202, 802, {
        content: "已修好水管但没有拍现场实照",
        images: [],
        durationHours: 1.0
      })
    ).rejects.toThrow("EVIDENCE_IMAGE_REQUIRED");

    // 2. 恶意目录穿越照片路径
    expect(() =>
      verifyEvidenceImages(sId, 9202, ["/schools/1/patrol/9202/handle/../../hack.jpg"])
    ).toThrow("MALICIOUS_PATH_DETECTED");

    // 3. 异常极大或极小工时
    expect(() => validateDurationHours(0.05)).toThrow("INVALID_DURATION");
    expect(() => validateDurationHours(200)).toThrow("INVALID_DURATION");

    // 4. 整改说明短于 5 字符
    await expect(
      PatrolHandleService.submitPatrolHandle(sId, 9202, 802, {
        content: "搞定",
        images: ["/schools/1/patrol/9202/handle/proof.jpg"],
        durationHours: 1.0
      })
    ).rejects.toThrow("PARAM_ERROR");
  });

  it("M27-03: 合法完工交卷与状态机原子跃迁 - 成功交卷后状态跃迁至 2 且底表入库", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 27, caseIndex: 3 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9203, ?, 1, 1, 'LCU-HANDLE-03', 103, 803, '配电箱空气开关跳闸', '急修', 1)",
      [sId]
    );

    // 责任师傅 803 提交合法交卷
    const res = await PatrolHandleService.submitPatrolHandle(sId, 9203, 803, {
      content: "更换损坏的 32A 空气开关，经绝缘摇表检测阻值正常，负载通电测试无跳闸",
      images: ["/schools/1/patrol/9203/handle/proof1.jpg", "/schools/1/patrol/9203/handle/proof2.jpg"],
      durationHours: 2.5
    });

    expect(res).toBeDefined();
    expect(res.handleId).toBeGreaterThan(0);
    expect(res.status).toBe(2);
    expect(res.statusText).toBe("已整改待复核");

    // 验证工单主表 status 已物理跃迁至 2
    const patrol = PatrolService.getMockPatrol(9203);
    expect(patrol?.status).toBe(2);
    expect(patrol?.completedAt).toBeDefined();

    // 验证 patrols_handle 底表记录存在且字段完整
    const handleRecord = PatrolHandleService.getMockHandleRecord(res.handleId);
    expect(handleRecord).toBeDefined();
    expect(handleRecord?.patrolId).toBe(9203);
    expect(handleRecord?.handlerId).toBe(803);
    expect(handleRecord?.durationHours).toBe(2.5);
    expect(handleRecord?.imagesJson.length).toBe(2);
  });

  it("M27-04: 状态互斥防撞与并发锁校验 - 工单进入 status=2 后严禁重复交卷", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 27, caseIndex: 4 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9204, ?, 1, 1, 'LCU-HANDLE-04', 104, 804, '消防栓渗水', '急修', 1)",
      [sId]
    );

    // 第一次交卷成功
    const firstRes = await PatrolHandleService.submitPatrolHandle(sId, 9204, 804, {
      content: "已更换消防栓阀芯与密封圈，加压 1.0MPa 试压无渗漏",
      images: ["/schools/1/patrol/9204/handle/proof.jpg"],
      durationHours: 1.0
    });
    expect(firstRes.status).toBe(2);

    // 第二次尝试重复交卷 -> 状态机硬门禁拦截
    await expect(
      PatrolHandleService.submitPatrolHandle(sId, 9204, 804, {
        content: "重复提交完工交卷说明",
        images: ["/schools/1/patrol/9204/handle/proof_dup.jpg"],
        durationHours: 1.0
      })
    ).rejects.toThrow("INVALID_STATUS_FOR_HANDLE");
  });

  it("M27-05: Saga 逆序补偿自动回滚与自愈断言 - 下游通知故障时长事务逆向回滚零脏数据", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 27, caseIndex: 5 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9205, ?, 1, 1, 'LCU-HANDLE-05', 105, 805, '食堂抽油烟机故障', '急修', 1)",
      [sId]
    );

    // 模拟下游外部通知服务（如微信网关网络闪断）发生严重崩溃
    PatrolHandleService.setDownstreamNotificationHook(async () => {
      throw new Error("WECHAT_PUSH_GATEWAY_TIMEOUT: 微信模板通知外网请求超时 504");
    });

    // 提交完工交卷，期望下游故障触发 Saga 自动逆序补偿回滚
    await expect(
      PatrolHandleService.submitPatrolHandle(sId, 9205, 805, {
        content: "清理油烟机风机叶轮油垢并重新接线",
        images: ["/schools/1/patrol/9205/handle/proof_saga.jpg"],
        durationHours: 1.5
      })
    ).rejects.toThrow("EXTERNAL_NOTIFY_FAILED");

    // 断言 Saga 逆序补偿生效：工单状态被原子自愈回滚为 1: 进行中
    const patrol = PatrolService.getMockPatrol(9205);
    expect(patrol?.status).toBe(1);
    expect(patrol?.completedAt).toBeNull();

    // 断言 patrols_handle 中刚才写入的孤岛记录已被物理抹除
    const history = await PatrolHandleService.getHandleHistory(sId, 9205);
    expect(history.records.length).toBe(0);
    expect(history.totalRounds).toBe(0);
  });

  it("M27-06: 质检驳回后多轮整改证据链与历史聚合 - 1:N 多轮返工历史追加追溯", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 27, caseIndex: 6 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9206, ?, 1, 1, 'LCU-HANDLE-06', 106, 806, '洗手间天花板漏水', '急修', 1)",
      [sId]
    );

    // 1. 师傅第一次施工交卷 (耗时 2.0h)
    const round1 = await PatrolHandleService.submitPatrolHandle(sId, 9206, 806, {
      content: "第 1 次施工：更换楼上角阀",
      images: ["/schools/1/patrol/9206/handle/round1.jpg"],
      durationHours: 2.0
    });
    expect(round1.status).toBe(2);

    // 2. 模拟质检专家复核驳回 (M28)，工单被重新打回 status = 1
    PatrolService.updateMockPatrol(9206, { status: 1 });

    // 3. 师傅二次进场整改并再次交卷 (耗时 1.5h)
    const round2 = await PatrolHandleService.submitPatrolHandle(sId, 9206, 806, {
      content: "第 2 次施工：重新封堵楼板排水管套管缝隙并刷防水涂料",
      images: ["/schools/1/patrol/9206/handle/round2.jpg"],
      durationHours: 1.5
    });
    expect(round2.status).toBe(2);
    expect(round2.handleId).toBeGreaterThan(round1.handleId);

    // 4. 查询施工整改历史大盘
    const history = await PatrolHandleService.getHandleHistory(sId, 9206);
    expect(history.patrolId).toBe(9206);
    expect(history.totalRounds).toBe(2);
    expect(history.cumulativeDurationHours).toBe(3.5); // 2.0 + 1.5
    expect(history.records.length).toBe(2);
    // records 按 ID 倒序排列，首项为最新一次交卷
    expect(history.records[0].handleId).toBe(round2.handleId);
    expect(history.records[1].handleId).toBe(round1.handleId);
  });

  it("M27-07: 师生知情权穿透与 M25 聊天室完工卡片验证 - 完工后自动注入 type=2 进度卡片", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 27, caseIndex: 7 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9207, ?, 1, 1, 'LCU-HANDLE-07', 107, 807, '宿舍走廊路灯不亮', '常修', 1)",
      [sId]
    );

    // 预置工单对应 M25 聊天室 (已激活)
    const roomRes: any = await TestHarness.executeSql(
      "INSERT INTO chat_rooms (schoolId, patrolId, creatorId, handlerId, initiatedByHandler, isClosed) VALUES (?, 9207, 107, 807, 1, 0)",
      [sId]
    );
    const roomId = roomRes.insertId;

    // 师傅提交完工交卷
    await PatrolHandleService.submitPatrolHandle(sId, 9207, 807, {
      content: "更换损坏的 LED 灯头与光敏控制器，夜间测试照明恢复",
      images: ["/schools/1/patrol/9207/handle/proof.jpg"],
      durationHours: 1.2
    });

    // 验证聊天室消息流中已自动注入完工进度卡片 (type = 2)
    const messages = await ChatService.getMessageList(sId, roomId, 0, 10);
    const noticeMsg = messages.find((m) => m.type === 2);
    expect(noticeMsg).toBeDefined();
    expect(noticeMsg?.content).toContain("【师傅已完成现场抢修整改】");
    expect(noticeMsg?.content).toContain("耗时 1.2 小时");
  });

  it("M27-08: API 路由端点与 MasterDispatcher 网关调度验证 - /api/patrol/handle/*", async () => {
    const tenantMaster = TestHarness.createMockTenantContext({ moduleIndex: 27, caseIndex: 8 });
    const sId = tenantMaster.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9208, ?, 1, 1, 'LCU-HANDLE-08', 108, 808, '教学楼无障碍坡道栏杆松动', '急修', 1)",
      [sId]
    );

    // 1. 师傅调用 /api/patrol/handle/submit 提交现场交卷
    const submitRes = await submitApi.handler(
      {
        body: {
          patrolId: 9208,
          content: "已重新电焊固定栏杆底座立柱并刷防锈漆，承重稳固",
          images: ["/schools/1/patrol/9208/handle/railing.jpg"],
          durationHours: 2.0
        },
        method: "POST"
      } as any,
      {
        userPayload: { schoolId: sId, userId: 808, role: 1, username: "焊工师傅808" }
      } as any
    );
    expect(submitRes.status).toBe(1);
    expect(submitRes.data.handleId).toBeGreaterThan(0);
    expect(submitRes.data.status).toBe(2);

    // 2. 调用 /api/patrol/handle/history 查询施工整改流水
    const histRes = await historyApi.handler(
      {
        query: { patrolId: 9208 },
        method: "GET"
      } as any,
      {
        userPayload: { schoolId: sId, userId: 808, role: 1, username: "焊工师傅808" }
      } as any
    );
    expect(histRes.status).toBe(1);
    expect(histRes.data.patrolId).toBe(9208);
    expect(histRes.data.totalRounds).toBe(1);
    expect(histRes.data.cumulativeDurationHours).toBe(2.0);
    expect(histRes.data.records.length).toBe(1);
  });
});
