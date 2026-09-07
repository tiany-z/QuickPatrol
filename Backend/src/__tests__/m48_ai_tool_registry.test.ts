/**
 * 高校后勤巡查e速办 v4.0 - M48: 7 大受控后勤事实数据工具箱 (AI Tool Registry & Sandbox) 单元测试套件
 * 覆盖 20 项核心功能、参数盲区防越狱、多级数据脱敏、超时熔断、7大事实工具与 ReAct 调度联动
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { aiToolRegistry, AIToolRegistry } from "../services/aiToolRegistry.js";
import { ToolSecuritySandbox } from "../shared/sandbox/toolSecuritySandbox.js";
import { patrolTools, PatrolTools } from "../services/tools/patrolTools.js";
import { campusTools, CampusTools } from "../services/tools/campusTools.js";
import { aiChatService, AIChatService } from "../services/aiChatService.js";
import { llmConfigService, LLMConfigService } from "../services/llm/llmConfigService.js";
import { IToolExecutionContext } from "../contracts/aiToolContract.js";
import { CopilotSSEEventType } from "../contracts/copilotContract.js";

describe("M48: 7 大受控后勤事实数据工具箱 (AI Tool Registry & Sandbox)", () => {
  const mockContext: IToolExecutionContext = {
    schoolId: 1,
    userId: 1001,
    userRole: "student"
  };

  beforeEach(() => {
    LLMConfigService.resetMockData();
    AIChatService.resetMock();
    PatrolTools.resetMock();
    CampusTools.resetMock();
    vi.restoreAllMocks();
  });

  it("[M48-01] 7 大受控事实工具注册完整性: 注册表应输出 7 个标准受控工具定义", () => {
    const decls = aiToolRegistry.getDeclarations();
    expect(decls.length).toBe(7);

    const names = decls.map((d) => d.function.name);
    expect(names).toContain("query_patrol_stats");
    expect(names).toContain("query_patrol_list");
    expect(names).toContain("query_patrol_detail");
    expect(names).toContain("query_my_patrols");
    expect(names).toContain("query_campus_and_departments");
    expect(names).toContain("query_post_feeds");
    expect(names).toContain("query_service_regulations");
  });

  it("[M48-02] Schema 参数盲区检验: 所有工具声明中绝对严禁暴露 schoolId 字段", () => {
    const decls = aiToolRegistry.getDeclarations();
    for (const d of decls) {
      const props = Object.keys(d.function.parameters.properties);
      expect(props).not.toContain("schoolId");
      expect(props).not.toContain("school_id");
      expect(props).not.toContain("tenantId");
      expect(props).not.toContain("tenant_id");
    }
  });

  it("[M48-03] Prompt 越狱伪造租户物理清洗: 当模型传入伪造的 schoolId 时，沙箱应物理丢弃", () => {
    const maliciousArgs = {
      keyword: "配电箱",
      schoolId: 999, // 企图越权窃取学校 999 的数据
      tenantId: 888,
      adminPass: "hack123",
      userRole: "super_admin"
    };

    const clean = ToolSecuritySandbox.sanitizeArguments("query_patrol_list", maliciousArgs);
    expect(clean.keyword).toBe("配电箱");
    expect(clean.schoolId).toBeUndefined();
    expect(clean.tenantId).toBeUndefined();
    expect(clean.adminPass).toBeUndefined();
    expect(clean.userRole).toBeUndefined();
  });

  it("[M48-04] 手机号隐私脱敏掩码: 事实数据中的手机号应被安全脱敏为前三后四", () => {
    const masked = ToolSecuritySandbox.maskPhoneNumber("13812345678");
    expect(masked).toBe("138****5678");

    const nonStandard = ToolSecuritySandbox.maskPhoneNumber("0535-6677889");
    expect(nonStandard).toBe("0535-6677889"); // 非11位号码不破坏
  });

  it("[M48-05] 匿名诉求工单脱敏: 标记为 isAnonymous 的工单上报人统一置换为匿名同学", () => {
    const rawFact = {
      patrolSn: "#PATROL-101",
      title: "宿舍夜间私拉电线",
      reporterName: "张三",
      reporterPhone: "13912345678",
      isAnonymous: true
    };

    const clean = ToolSecuritySandbox.redactSensitiveData(rawFact, mockContext);
    expect(clean.reporterName).toBe("匿名同学");
    expect(clean.reporterPhone).toBe("139****5678");
  });

  it("[M48-06] 慢查询 3000ms 熔断保护: 执行超时应强制中断并抛出熔断异常", async () => {
    const hangingPromise = new Promise((resolve) => setTimeout(resolve, 500));
    await expect(ToolSecuritySandbox.executeWithTimeout(hangingPromise, 50)).rejects.toThrow(
      /事实数据沙箱查询超时.*熔断/
    );
  });

  it("[M48-07] 内部系统字段物理剔除: 输出对象中的内部涉密与软删除字段必须被剥离", () => {
    const raw = {
      id: 1,
      title: "水龙头报修",
      schoolId: 1,
      deletedAt: null,
      tenantVersion: 2,
      salt: "salt_hash",
      adminPass: "pass123"
    };

    const clean = ToolSecuritySandbox.redactSensitiveData(raw, mockContext);
    expect(clean.schoolId).toBeUndefined();
    expect(clean.deletedAt).toBeUndefined();
    expect(clean.tenantVersion).toBeUndefined();
    expect(clean.salt).toBeUndefined();
    expect(clean.adminPass).toBeUndefined();
    expect(clean.title).toBe("水龙头报修");
  });

  it("[M48-08] 只读沙箱安全检验: 7 大事实工具均属于纯只读查询，严禁任何写操作", () => {
    const decls = aiToolRegistry.getDeclarations();
    for (const d of decls) {
      expect(d.function.name.startsWith("query_")).toBe(true);
      expect(d.function.description).not.toContain("修改");
      expect(d.function.description).not.toContain("创建");
      expect(d.function.description).not.toContain("删除");
    }
  });

  it("[M48-09] 工具 1 query_patrol_stats 宏观运行大盘统计: 正确聚合报修总数与 SLA 履约率", async () => {
    // 注入模拟工单
    PatrolTools.mockPatrols = [
      { id: 1, schoolId: 1, status: 4 }, // 办结
      { id: 2, schoolId: 1, status: 1 }, // 抢修中
      { id: 3, schoolId: 1, status: 0 }  // 待接单
    ];

    const res = await patrolTools.queryPatrolStats({ timeRange: "TODAY" }, mockContext);
    expect(res.totalReported).toBe(3);
    expect(res.completedCount).toBe(1);
    expect(res.inProgressCount).toBe(1);
    expect(res.pendingAcceptCount).toBe(1);
    expect(res.slaComplianceRate).toBe("33.3%");
  });

  it("[M48-10] 工具 2 query_patrol_list 多条件复合检索: 按关键字与加急等级筛选工单", async () => {
    PatrolTools.mockPatrols = [
      { id: 1, schoolId: 1, title: "12号楼配电箱跳闸冒烟", locationName: "西校区12号楼", urgencyLevel: 3, status: 1 },
      { id: 2, schoolId: 1, title: "食堂水龙头滴水", locationName: "东校区食堂", urgencyLevel: 1, status: 0 },
      { id: 3, schoolId: 1, title: "配电房绝缘垫老化", locationName: "西校区配电房", urgencyLevel: 2, status: 1 }
    ];

    const res = await patrolTools.queryPatrolList({ keyword: "配电", urgency: 3 }, mockContext);
    expect(res.length).toBe(1);
    expect(res[0].id).toBe(1);
    expect(res[0].title).toContain("配电箱跳闸");
    expect(res[0].urgencyLevel).toBe(3);
  });

  it("[M48-11] 工具 2 query_patrol_list 上限截断: 请求 limit 超过 5 时强制截断为 5 条", async () => {
    PatrolTools.mockPatrols = Array.from({ length: 10 }).map((_, idx) => ({
      id: idx + 1,
      schoolId: 1,
      title: `工单 #${idx + 1}`,
      status: 0,
      urgencyLevel: 1
    }));

    const res = await patrolTools.queryPatrolList({ limit: 10 }, mockContext);
    expect(res.length).toBe(5); // 强制上限 5
  });

  it("[M48-12] 工具 3 query_patrol_detail 单笔工单全景档案: 调取施工存根与核验结果", async () => {
    PatrolTools.mockPatrols = [
      {
        id: 91,
        schoolId: 1,
        patrolSn: "#LCU-2026-0091",
        title: "西校区配电箱跳闸",
        locationName: "西区12号楼302",
        description: "空气开关跳闸，有焦糊味",
        status: 4, // 办结
        reporterName: "王同学",
        reporterPhone: "13511112222",
        handlerName: "张电工",
        handleRemark: "更换 32A 空气开关，负荷测试正常",
        evaluationStars: 5
      }
    ];

    const detail = await patrolTools.queryPatrolDetail(
      { patrolSnOrId: "#LCU-2026-0091" },
      mockContext
    );

    expect(detail).not.toBeNull();
    expect(detail!.patrolSn).toBe("#LCU-2026-0091");
    expect(detail!.handlerName).toBe("张电工");
    expect(detail!.handleRemark).toBe("更换 32A 空气开关，负荷测试正常");
    expect(detail!.inspectionResult).toContain("合格");
  });

  it("[M48-13] 工具 3 query_patrol_detail 不存在工单优雅返回 null", async () => {
    const detail = await patrolTools.queryPatrolDetail(
      { patrolSnOrId: "NON_EXISTENT_SN" },
      mockContext
    );
    expect(detail).toBeNull();
  });

  it("[M48-14] 工具 4 query_my_patrols 个人追踪: 仅调取当前登录人关联的工单", async () => {
    PatrolTools.mockPatrols = [
      { id: 1, schoolId: 1, reporterUserId: 1001, title: "我的报修 1", status: 0 },
      { id: 2, schoolId: 1, reporterUserId: 2002, title: "他人报修 2", status: 0 },
      { id: 3, schoolId: 1, handlerUserId: 1001, title: "我负责维修的工单 3", status: 1 }
    ];

    const res = await patrolTools.queryMyPatrols({ statusFilter: "ALL" }, mockContext);
    expect(res.length).toBe(2);
    const ids = res.map((r) => r.id);
    expect(ids).toContain(1);
    expect(ids).toContain(3);
    expect(ids).not.toContain(2);
  });

  it("[M48-15] 工具 5 query_campus_and_departments 架构与电话查询: 成功检索科室与值班热线", async () => {
    CampusTools.mockDepartments = [
      {
        schoolId: 1,
        deptName: "水电维保科",
        campusName: "西校区",
        officeLocation: "西区动力楼 103",
        hotlinePhone: "0535-6612345",
        dutyLeader: "李班长",
        serviceScope: "全校水电与给排水抢修"
      }
    ];

    const res = await campusTools.queryCampusAndDepartments(
      { campusKeyword: "西校区", serviceCategory: "水电" },
      mockContext
    );

    expect(res.length).toBeGreaterThanOrEqual(1);
    expect(res[0].deptName).toBe("水电维保科");
    expect(res[0].hotlinePhone).toBe("0535-6612345");
  });

  it("[M48-16] 工具 6 query_post_feeds 公共广场检修通告: 检索官方发布的停水停电预警", async () => {
    CampusTools.mockPostFeeds = [
      {
        id: 88,
        schoolId: 1,
        title: "关于西校区配电变压器预防性检修停电通告",
        content: "因西校区高压变电所例行维保，西区1~15号公寓将于本周六上午 8:00~12:00 停电...",
        publisherDeptName: "后勤动力服务中心",
        isOfficialNotice: true,
        affectedBuildings: "西校区1~15号宿舍楼"
      }
    ];

    const res = await campusTools.queryPostFeeds({ keyword: "停电" }, mockContext);
    expect(res.length).toBe(1);
    expect(res[0].title).toContain("停电通告");
    expect(res[0].affectedBuildings).toBe("西校区1~15号宿舍楼");
  });

  it("[M48-17] 工具 7 query_service_regulations 规章字典查询: 精准检索突发险情 15 分钟 SLA 承诺", async () => {
    const res = await campusTools.queryServiceRegulations(
      { category: "SLA_LIMITS" },
      mockContext
    );

    expect(res.length).toBeGreaterThanOrEqual(1);
    const emergencyRule = res.find((r) => r.ruleCode === "SLA_EMERGENCY_01");
    expect(emergencyRule).toBeDefined();
    expect(emergencyRule!.commitmentTimeText).toContain("15 分钟");
  });

  it("[M48-18] 多租户隔离防护: A 学校用户绝对无法调取 B 学校的数据", async () => {
    PatrolTools.mockPatrols = [
      { id: 1, schoolId: 1, title: "聊城大学水龙头漏水", status: 0 },
      { id: 2, schoolId: 2, title: "清华大学配电房故障", status: 0 } // B 学校
    ];

    const res = await patrolTools.queryPatrolList({}, { schoolId: 1, userId: 1001, userRole: "student" });
    expect(res.length).toBe(1);
    expect(res[0].title).toBe("聊城大学水龙头漏水");
  });

  it("[M48-19] 未知工具调度防御: 调用未注册工具时沙箱安全拦截并返回失败状态", async () => {
    const res = await aiToolRegistry.executeTool("unknown_nonexistent_tool", {}, mockContext);
    expect(res.success).toBe(false);
    expect(res.errorMessage).toContain("未注册");
  });

  it("[M48-20] 与 M47 AIChatService 的 Function Calling 协同联动: 完整生命周期流式闭环", async () => {
    await llmConfigService.saveConfig(1, 88, {
      selectedProvider: "deepseek",
      primary: {
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        apiKeyPlain: "sk-mock-key-8888",
        temperature: 0.3,
        maxTokens: 1024
      }
    });

    PatrolTools.mockPatrols = [
      { id: 10, schoolId: 1, title: "西区12号楼水管爆裂", status: 1, locationName: "12号楼" }
    ];

    const sseEvents: Array<{ event: string; data: any }> = [];
    const sseEmitter = {
      sendEvent: (event: string, data: any) => {
        sseEvents.push({ event, data });
      },
      close: vi.fn()
    };

    // 模拟大模型返回 tool_calls 指令
    AIChatService.mockFetch = vi.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"query_patrol_list","arguments":"{\\"keyword\\":\\"水管\\"}"}}]}}]}\n\n' +
              'data: {"choices":[{"delta":{"content":"已帮您查到相关工单。"}}]}\n\n' +
              'data: [DONE]\n\n'
            )
          );
          controller.close();
        }
      });
      return { ok: true, status: 200, body: stream } as any;
    });

    await aiChatService.processCopilotChatStream({
      schoolId: 1,
      userId: 1001,
      prompt: "西区水管漏水处理了吗？",
      history: [],
      sseEmitter,
      abortSignal: new AbortController().signal
    });

    // 验证是否正确发射了 tool_start 与 tool_end
    const toolStartEvents = sseEvents.filter((e) => e.event === CopilotSSEEventType.TOOL_START);
    const toolEndEvents = sseEvents.filter((e) => e.event === CopilotSSEEventType.TOOL_END);
    const textDeltaEvents = sseEvents.filter((e) => e.event === CopilotSSEEventType.TEXT_DELTA);
    const doneEvents = sseEvents.filter((e) => e.event === CopilotSSEEventType.DONE);

    expect(toolStartEvents.length).toBe(1);
    expect(toolStartEvents[0].data.toolInfo.toolName).toBe("query_patrol_list");

    expect(toolEndEvents.length).toBe(1);
    expect(toolEndEvents[0].data.toolInfo.success).toBe(true);
    expect(toolEndEvents[0].data.toolInfo.summary).toContain("西区12号楼水管爆裂");

    expect(textDeltaEvents.length).toBeGreaterThan(0);
    expect(doneEvents.length).toBe(1);
  });
});
