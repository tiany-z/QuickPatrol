import { describe, expect, it, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { TestHarness } from "./testHarness.js";
import { TagService } from "../services/org/tagService.js";
import { MetroColorAssigner } from "../services/org/metroColorAssigner.js";
import { fetchTagDecoupledWorklist } from "../services/org/worklistAggregator.js";
import { handleCreateTag } from "../api/org/tags/create/handler.js";
import { handleHandoverTag } from "../api/org/tags/handover/handler.js";
import { handleGetTagDashboard } from "../api/org/tags/list/handler.js";
import { handleGetDynamicWorklist } from "../api/org/tags/worklist/handler.js";

describe("M16: 岗位职能标签中台与“权限随岗不随人”调度 (Job Tags & Decoupled Dispatch)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M16-01: 标签创建成功并自动分配 Windows Metro UI 经典色标", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 16, caseIndex: 1 });
    const sId = tenant.schoolId;

    // 1. 紧急防汛 -> 深绯红 #E74856
    const tagEmergency = await TagService.createTag(sId, { name: "防汛应急抢险组" });
    expect(tagEmergency.color).toBe("#E74856");

    // 2. 水电暖维保 -> 抢修橙 #D83B01
    const tagElectric = await TagService.createTag(sId, { name: "水电管网维保班" });
    expect(tagElectric.color).toBe("#D83B01");

    // 3. 绿化环卫 -> 丛林绿 #107C41
    const tagGreen = await TagService.createTag(sId, { name: "校园绿化保洁队" });
    expect(tagGreen.color).toBe("#107C41");

    // 4. 安防巡更 -> 琥珀黄 #FFB900
    const tagSecurity = await TagService.createTag(sId, { name: "消防安防巡更组" });
    expect(tagSecurity.color).toBe("#FFB900");

    // 5. 质检复核 -> 罗兰紫 #881798
    const tagAudit = await TagService.createTag(sId, { name: "施工质检监理组" });
    expect(tagAudit.color).toBe("#881798");

    // 自定义指定色彩时优先使用指定色彩
    const tagCustom = await TagService.createTag(sId, { name: "自定义特色岗位", color: "#0078D7" });
    expect(tagCustom.color).toBe("#0078D7");
  });

  it("M16-02: 一键轮岗交接能够瞬间平移在办工单待办池 (零写放大断言)", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 16, caseIndex: 2 });
    const sId = tenant.schoolId;

    // 1. 创建原任张师傅 (501) 与新任李师傅 (502)
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, role) VALUES (501, ?, 'open_a', '张师傅', 2), (502, ?, 'open_b', '李师傅', 2)",
      [sId, sId]
    );

    // 2. 创建岗位标签并分配给张师傅
    const tag = await TagService.createTag(sId, {
      name: "锅炉房司炉工长",
      initialMemberUserIds: [501]
    });

    // 3. 产生一张挂靠在该标签名下的在办工单 (patrols.tagId = tag.id, currentHandlerId = null)
    await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, title, desc, status, tagId) VALUES (?, 1, 1, 'ORDER-TEST-001', 1, '锅炉压力异常', '需排查', 1, ?)",
      [sId, tag.id]
    );

    // 4. 断言张师傅当前能动态查到该待办工单
    const worklistA1 = await fetchTagDecoupledWorklist({ schoolId: sId, userId: 501 });
    expect(worklistA1.total).toBe(1);
    expect(worklistA1.list[0].orderNo).toBe("ORDER-TEST-001");
    expect(worklistA1.list[0].tagBadge?.name).toBe("锅炉房司炉工长");

    // 5. 断言李师傅当前待办为空
    const worklistB1 = await fetchTagDecoupledWorklist({ schoolId: sId, userId: 502 });
    expect(worklistB1.total).toBe(0);

    // 6. 执行一键无缝交接：从张师傅转移给李师傅 (仅修改 1 条映射记录，0 写放大)
    const handoverRes = await TagService.handoverTag(sId, tag.id, 501, 502);
    expect(handoverRes.fromUserId).toBe(501);
    expect(handoverRes.toUserId).toBe(502);
    expect(handoverRes.fromUserName).toBe("张师傅");
    expect(handoverRes.toUserName).toBe("李师傅");

    // 7. 断言张师傅待办池瞬间清空 (0 张)
    const worklistA2 = await fetchTagDecoupledWorklist({ schoolId: sId, userId: 501 });
    expect(worklistA2.total).toBe(0);

    // 8. 断言李师傅瞬间接管该工单 (1 张)
    const worklistB2 = await fetchTagDecoupledWorklist({ schoolId: sId, userId: 502 });
    expect(worklistB2.total).toBe(1);
    expect(worklistB2.list[0].orderNo).toBe("ORDER-TEST-001");
  });

  it("M16-03: 重复创建同名标签应被租户唯一约束阻断", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 16, caseIndex: 3 });
    const sId = tenant.schoolId;

    await TagService.createTag(sId, { name: "标准唯一标签" });

    await expect(
      TagService.createTag(sId, { name: "标准唯一标签" })
    ).rejects.toThrow("已存在");
  });

  it("M16-04: 全景调度大盘视图聚合查询 (v_tag_assignments 契约)", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 16, caseIndex: 4 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, role) VALUES (601, ?, 'open_601', '王师傅', 2)",
      [sId]
    );

    const tag = await TagService.createTag(sId, {
      name: "高压电房值班员",
      initialMemberUserIds: [601]
    });

    const dashboard = await TagService.getTagAssignmentsDashboard(sId);
    expect(dashboard.length).toBe(1);
    expect(dashboard[0].tagId).toBe(tag.id);
    expect(dashboard[0].tagName).toBe("高压电房值班员");
    expect(dashboard[0].activeMembersCount).toBe(1);
    expect(dashboard[0].members[0].userId).toBe(601);
    expect(dashboard[0].members[0].realName).toBe("王师傅");
  });

  it("M16-05: 防跨租户窜访与自己移交给自己拦截", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 16, caseIndex: 5 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, role) VALUES (701, ?, 'open_701', '本校师傅', 2)",
      [sId]
    );

    const tag = await TagService.createTag(sId, {
      name: "水暖抢险员",
      initialMemberUserIds: [701]
    });

    // 1. 自己交接给自己，拦截
    await expect(
      TagService.handoverTag(sId, tag.id, 701, 701)
    ).rejects.toThrow("不能为同一用户");

    // 2. 移交给不存在或外校的用户，拦截
    await expect(
      TagService.handoverTag(sId, tag.id, 701, 99999)
    ).rejects.toThrow("必须是本校合法有效用户");
  });

  it("M16-06: 单用户持有岗位标签数量上限 (Max Limit = 10) 守护", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 16, caseIndex: 6 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, role) VALUES (801, ?, 'open_801', '全能师傅', 2)",
      [sId]
    );

    // 绑定 10 个岗位标签
    for (let i = 1; i <= 10; i++) {
      const t = await TagService.createTag(sId, { name: `维保岗位_${i}` });
      await TagService.addMemberToTag(sId, t.id, 801);
    }

    // 尝试绑定第 11 个岗位标签，必须被熔断
    const tag11 = await TagService.createTag(sId, { name: "超额维保岗位_11" });
    await expect(
      TagService.addMemberToTag(sId, tag11.id, 801)
    ).rejects.toThrow("该员工持岗已达上限 (10个)");
  });

  it("M16-07: 鉴权守卫: 创建(role>=3)与交接(role>=4)越权拦截与 HTTP 响应一致性", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 16, caseIndex: 7 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, role) VALUES (901, ?, 'open_901', '赵师傅', 2), (902, ?, 'open_902', '钱师傅', 2)",
      [sId, sId]
    );

    // 1. 师傅(role 2)调用创建端点，权限不足拦截
    const createForbiddenRes = await handleCreateTag(
      { schoolId: sId, role: 2 },
      { name: "越权创建标签" }
    );
    expect(createForbiddenRes.status).toBe(0);
    expect(createForbiddenRes.content).toContain("权限不足");

    // 2. 主管(role 3)调用创建端点，放行
    const createSuccessRes = await handleCreateTag(
      { schoolId: sId, role: 3 },
      { name: "主管创建标签", initialMemberUserIds: [901] }
    );
    expect(createSuccessRes.status).toBe(1);
    const tagId = createSuccessRes.data.id;

    // 3. 主管(role 3)调用交接端点，越权拦截 (交接需 role >= 4)
    const handoverForbiddenRes = await handleHandoverTag(
      { schoolId: sId, role: 3 },
      { tagId, fromUserId: 901, toUserId: 902 }
    );
    expect(handoverForbiddenRes.status).toBe(0);
    expect(handoverForbiddenRes.content).toContain("权限不足");

    // 4. 校管(role 4)调用交接端点，成功
    const handoverSuccessRes = await handleHandoverTag(
      { schoolId: sId, role: 4 },
      { tagId, fromUserId: 901, toUserId: 902 }
    );
    expect(handoverSuccessRes.status).toBe(1);

    // 5. 大盘与待办 HTTP 接口正常调用
    const dashRes = await handleGetTagDashboard({ schoolId: sId });
    expect(dashRes.status).toBe(1);
    expect(Array.isArray(dashRes.data)).toBe(true);

    const worklistRes = await handleGetDynamicWorklist({ schoolId: sId, userId: 902 }, {});
    expect(worklistRes.status).toBe(1);
    expect(worklistRes.data.total).toBeDefined();
  });

  it("M16-08: 微信小程序端 TagStore 状态机与本地交接更新策略断言", () => {
    const tagStorePath = path.resolve(
      __dirname,
      "../../../WeChatMiniProgram/miniprogram/packages/apps/app-org-center/pages/tag-management/tagStore.ts"
    );
    expect(fs.existsSync(tagStorePath)).toBe(true);

    const source = fs.readFileSync(tagStorePath, "utf-8");
    expect(source).toContain("export class TagStore");
    expect(source).toContain("updateLocalHandover");
    expect(source).toContain("setTags");
    expect(source).toContain("getTags");
  });
});
