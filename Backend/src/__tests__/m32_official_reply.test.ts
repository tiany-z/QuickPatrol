/**
 * 高校后勤巡查e速办 v4.0 - M32: 诉求责任科室流转与官方正式答复流单元测试
 * 
 * 核心断言覆盖：
 * 1. DeptDispatcher 智能分派器 (关键词词频拓扑、分类偏置、低置信度降级公海池)
 * 2. 整改承诺动态 SLA 倒计时与红黄绿三色督办日历
 * 3. 匿名诉求无状态 ETag 增量版本计算与比对
 * 4. 科室口碑效能分与星级荣耀算法
 * 5. 科室主动认领、退单综合办仲裁与强制二次指派防推单
 * 6. 官方正式红头答复公函出具 (16位数字防伪码、正文字数门禁、状态跃迁、评论自增)
 * 7. 师生文创感谢卡正向激励闭环 (实名赠送、匿名 VaultToken 防伪验签、积分勋章、一单一卡防刷)
 * 8. 优秀办结公函一键推选至 M33 校园公开空间
 * 9. Controller 控制器与 Gateway 网关端点模块集成
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { DeptDispatcher } from "../apps/feedback/deptDispatcher.js";
import { OfficialReplyService } from "../apps/feedback/officialReplyService.js";
import { OfficialReplyController } from "../apps/feedback/officialReplyController.js";
import { ConfidentialVaultService } from "../apps/feedback/confidentialVaultService.js";
import { SchoolService } from "../services/school/schoolService.js";
import { WeChatAuthService } from "../services/auth/wechatAuthService.js";
import { AuditLogger } from "../shared/log/auditLogger.js";
import claimApi from "../api/feedback/appeals/claim/index.js";
import rejectApi from "../api/feedback/appeals/reject-to-office/index.js";
import assignApi from "../api/feedback/appeals/assign-department/index.js";
import replyApi from "../api/feedback/appeals/official-reply/index.js";
import thanksApi from "../api/feedback/appeals/send-thanks-card/index.js";
import promoteApi from "../api/feedback/appeals/promote-to-public/index.js";
import detailApi from "../api/feedback/appeals/detail/index.js";

describe("M32: 诉求责任科室流转与官方正式答复流核心测试", () => {
  const schoolId = 1001;
  const studentUserId = 2001;
  const officerUserId = 3001;
  const adminUserId = 4001;

  beforeEach(() => {
    TestHarness.resetSandbox();
    OfficialReplyService.resetMockData();
    AuditLogger.clearMockLogs();

    // 注册高校租户
    SchoolService.mockRegisterSchool({
      id: schoolId,
      name: "同济大学",
      code: "TONGJI",
      status: 1
    } as any);

    // 注册学生
    WeChatAuthService.mockRegisterUser({
      id: studentUserId,
      schoolId,
      openId: "o_student_2001",
      realName: "张小同",
      role: 0,
      phone: "13800001111"
    });

    // 注册饮食服务科主管
    WeChatAuthService.mockRegisterUser({
      id: officerUserId,
      schoolId,
      openId: "o_officer_3001",
      realName: "李科长",
      role: 2,
      phone: "13800002222"
    });

    // 注册后勤综合办总协调主管
    WeChatAuthService.mockRegisterUser({
      id: adminUserId,
      schoolId,
      openId: "o_admin_4001",
      realName: "赵主任",
      role: 3,
      phone: "13800003333"
    });
  });

  // ==========================================
  // 1. DeptDispatcher 核心算法测试
  // ==========================================
  describe("1. DeptDispatcher 算法与模型测试", () => {
    it("1.1 包含食堂餐饮高频特征词应精准预分派至饮食服务中心 (deptId=3)", () => {
      const res = DeptDispatcher.dispatch(
        "二楼档口热干面偏硬且饭菜偏凉",
        "希望后勤阿姨注意保温台温度，保证米饭软硬适中和菜价合理。",
        "canteen"
      );
      expect(res.recommendedDeptId).toBe(3);
      expect(res.recommendedDeptName).toBe("饮食服务中心");
      expect(res.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("1.2 包含宿舍违章电器与宿管门禁词汇应精准预分派至学生公寓管理中心 (deptId=4)", () => {
      const res = DeptDispatcher.dispatch(
        "关于十号楼宿舍门禁与洗澡水温建议",
        "晚上宿管大爷经常提前熄灯，且三层淋浴间水温忽冷忽热，吹风机插座也常常跳闸。",
        "dorm"
      );
      expect(res.recommendedDeptId).toBe(4);
      expect(res.recommendedDeptName).toBe("学生公寓管理服务中心");
      expect(res.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("1.3 包含水管漏水与路灯故障应预分派至动力修缮中心 (deptId=5)", () => {
      const res = DeptDispatcher.dispatch(
        "四教后侧路灯不亮且下水管道破损",
        "雨天路面坑洼积水严重，地下管道漏水，急需工程队前来进行修缮报修。",
        "service"
      );
      expect(res.recommendedDeptId).toBe(5);
      expect(res.recommendedDeptName).toBe("后勤动力与修缮工程中心");
    });

    it("1.4 语义模糊或通用建议在置信度过低时安全降级至综合办公室公海池 (deptId=1)", () => {
      const res = DeptDispatcher.dispatch(
        "随手提一个小小的随笔建议",
        "今天天气真不错，希望能多搞一些校园文化活动展示。",
        "other"
      );
      expect(res.recommendedDeptId).toBe(1);
      expect(res.recommendedDeptName).toBe("后勤管理处综合办公室");
      expect(res.confidence).toBe(0);
    });

    it("1.5 整改承诺动态 SLA 倒计时算法：绿牌正常、黄牌临期预警与红牌超时罚分", () => {
      const now = Date.now();
      const repliedAt = now - 2 * 3600 * 1000; // 2小时前答复

      // 1. 承诺3天，剩余约70小时 -> 绿牌
      const greenSla = DeptDispatcher.calculateSla(repliedAt, 3, false, now);
      expect(greenSla.slaStatus).toBe("GREEN");
      expect(greenSla.remainingHours).toBeGreaterThan(24);
      expect(greenSla.penaltyScore).toBe(0);

      // 2. 剩余10小时 -> 黄牌预警
      const targetYellowRepliedAt = now - (3 * 24 - 10) * 3600 * 1000;
      const yellowSla = DeptDispatcher.calculateSla(targetYellowRepliedAt, 3, false, now);
      expect(yellowSla.slaStatus).toBe("YELLOW");
      expect(yellowSla.remainingHours).toBeLessThanOrEqual(24);
      expect(yellowSla.remainingHours).toBeGreaterThan(0);

      // 3. 超期24小时 -> 红牌扣分
      const targetRedRepliedAt = now - (3 * 24 + 24) * 3600 * 1000;
      const redSla = DeptDispatcher.calculateSla(targetRedRepliedAt, 3, false, now);
      expect(redSla.slaStatus).toBe("RED");
      expect(redSla.remainingHours).toBeLessThan(0);
      expect(redSla.penaltyScore).toBeGreaterThan(2.0);

      // 4. 诉求已彻底核销办结 (isClosed = true)
      const closedSla = DeptDispatcher.calculateSla(targetRedRepliedAt, 3, true, now);
      expect(closedSla.slaStatus).toBe("GREEN");
      expect(closedSla.statusText).toContain("核销办结");
    });

    it("1.6 算法 4: 匿名诉求无状态 ETag 增量版本比对算法", () => {
      const post = { id: 101, status: 0, updatedAt: "2026-09-06T08:00:00.000Z" };
      const etag1 = DeptDispatcher.checkETag(post, null);

      expect(etag1.isModified).toBe(true);
      expect(etag1.currentETag).toMatch(/^"[a-f0-9]{32}"$/);

      // 客户端携带相同 ETag 时判定为无修改 (304)
      const etagCheckSame = DeptDispatcher.checkETag(post, null, etag1.currentETag);
      expect(etagCheckSame.isModified).toBe(false);

      // 科室出具新答复后，ETag 变更，isModified 变为 true
      const reply = { id: 501, createdAt: "2026-09-06T09:00:00.000Z" };
      const etagCheckUpdated = DeptDispatcher.checkETag(post, reply, etag1.currentETag);
      expect(etagCheckUpdated.isModified).toBe(true);
      expect(etagCheckUpdated.currentETag).not.toBe(etag1.currentETag);
    });

    it("1.7 算法 3: 师生文创感谢卡加权口碑与效能星级评估", () => {
      const cards = [
        { cardType: "SPEED" },  // 5
        { cardType: "WARMTH" }, // 5
        { cardType: "ACTION" }, // 6
        { cardType: "PRAISE" }  // 8
      ]; // sumWeight = 24, bonus = 24 * 1.5 = 36

      // 答复了 20 件诉求，基础分 40，总分 40 + 36 = 76 (3星)
      const scoreRes = DeptDispatcher.calculateGratitudeScore(cards, 20);
      expect(scoreRes.monthlyReputationScore).toBe(76);
      expect(scoreRes.starLevel).toBe(3);
    });
  });

  // ==========================================
  // 2. 科室主动认领与退回仲裁测试
  // ==========================================
  describe("2. 科室流转与仲裁机制测试", () => {
    it("2.1 科室主管主动认领诉求，更新归属科室并记录审计日志", async () => {
      OfficialReplyService.mockRegisterPost({
        id: 101,
        schoolId,
        creatorId: studentUserId,
        title: "梅园餐厅二楼打饭窗口保温建议",
        status: 0
      });

      await OfficialReplyService.claimAppeal(schoolId, 101, officerUserId, 3);

      const post = OfficialReplyService.getMockPost(101);
      expect(post?.targetDeptId).toBe(3);

      const logs = AuditLogger.getMockLogs();
      const claimLog = logs.find(l => l.action === "CLAIM_APPEAL");
      expect(claimLog).toBeDefined();
      expect(claimLog?.userId).toBe(officerUserId);
    });

    it("2.2 科室主管申请退回综合办仲裁，诉求归属退回综合办 (deptId=1)", async () => {
      OfficialReplyService.mockRegisterPost({
        id: 102,
        schoolId,
        creatorId: studentUserId,
        title: "关于校园外围市政道路路灯不亮",
        status: 0,
        targetDeptId: 5
      });

      await OfficialReplyService.rejectToOffice(
        schoolId,
        102,
        officerUserId,
        "经查该路段属于市政路网非校内管辖，请综合办协调市政部门"
      );

      const post = OfficialReplyService.getMockPost(102);
      expect(post?.targetDeptId).toBe(1); // 归还综合办公海池

      const logs = AuditLogger.getMockLogs();
      const rejectLog = logs.find(l => l.action === "REJECT_TO_OFFICE");
      expect(rejectLog).toBeDefined();
    });

    it("2.3 申请退回理由少于5字时硬阻断", async () => {
      OfficialReplyService.mockRegisterPost({
        id: 103,
        schoolId,
        creatorId: studentUserId,
        title: "测试退回",
        status: 0
      });

      await expect(
        OfficialReplyService.rejectToOffice(schoolId, 103, officerUserId, "不归我管")
      ).rejects.toThrow("申请退回理由不能少于 5 个字");
    });

    it("2.4 综合办总调度二次强制指派责任科室", async () => {
      OfficialReplyService.mockRegisterPost({
        id: 104,
        schoolId,
        creatorId: studentUserId,
        title: "疑难争议事项",
        status: 0,
        targetDeptId: 1
      });

      await OfficialReplyService.forceAssignDepartment(
        schoolId,
        104,
        adminUserId,
        3,
        "综合办行政仲裁裁定由饮食中心主办",
        true
      );

      const post = OfficialReplyService.getMockPost(104);
      expect(post?.targetDeptId).toBe(3);
    });
  });

  // ==========================================
  // 3. 官方正式答复公函出具测试
  // ==========================================
  describe("3. 官方正式答复公函出具测试", () => {
    it("3.1 科室主管发布官方正式答复，生成16位防伪特征码且 posts 状态流转为 1 (已答复)", async () => {
      OfficialReplyService.mockRegisterPost({
        id: 201,
        schoolId,
        creatorId: studentUserId,
        title: "食堂二楼打饭窗口分量偏少且饭菜偏凉",
        status: 0,
        commentCount: 0
      });

      const res = await OfficialReplyService.submitOfficialReply(
        schoolId,
        201,
        officerUserId,
        3,
        {
          appealId: 201,
          decreeTitle: "关于梅园餐厅二楼打饭窗口保温与分量问题的整改说明",
          responderTitle: "饮食服务科监管主管",
          content: "饮食服务科已于当日召集二楼档口经理进行现场约谈，责令更换新式恒温保温台并规范打饭标准。",
          imageUrls: ["https://oss.campus.edu/decree_img1.jpg"],
          promiseDays: 2
        }
      );

      expect(res.replyId).toBeGreaterThan(0);
      expect(res.digitalFingerprint).toHaveLength(16);
      expect(res.departmentName).toBe("饮食服务中心");
      expect(res.responderTitle).toBe("饮食服务科监管主管");
      expect(res.deadlineAt).toBeDefined();

      // 断言主表状态流转为 1 (已答复)，评论数自增
      const post = OfficialReplyService.getMockPost(201);
      expect(post?.status).toBe(1);
      expect(post?.commentCount).toBe(1);

      // 断言审计日志
      const logs = AuditLogger.getMockLogs();
      const replyLog = logs.find(l => l.action === "OFFICIAL_REPLY_SUBMIT");
      expect(replyLog).toBeDefined();
    });

    it("3.2 官方答复正文少于20字时硬门禁阻断，拒绝敷衍公文", async () => {
      OfficialReplyService.mockRegisterPost({
        id: 202,
        schoolId,
        creatorId: studentUserId,
        title: "测试答复正文字数门禁",
        status: 0
      });

      await expect(
        OfficialReplyService.submitOfficialReply(
          schoolId,
          202,
          officerUserId,
          3,
          {
            appealId: 202,
            decreeTitle: "已知悉并正在处理中",
            responderTitle: "主管",
            content: "情况已知悉，已转办处理。", // 仅13字
            promiseDays: 2
          }
        )
      ).rejects.toThrow("不能少于 20 个字");
    });
  });

  // ==========================================
  // 4. 师生文创感谢卡双向正向激励测试
  // ==========================================
  describe("4. 师生文创感谢卡双向激励测试", () => {
    it("4.1 实名师生对已答复工单赠送文创感谢卡，点赞自增且发放啄木鸟积分", async () => {
      // 准备已答复诉求
      OfficialReplyService.mockRegisterPost({
        id: 301,
        schoolId,
        creatorId: studentUserId,
        title: "自习室空调温度过低反馈",
        status: 1, // 已答复
        likeCount: 5,
        commentCount: 1
      });

      const res = await OfficialReplyService.sendThanksCard(
        schoolId,
        studentUserId,
        {
          appealId: 301,
          cardType: "WARMTH",
          studentComment: "感谢后勤老师耐心细致的解释，当天就调整好了空调温度，非常暖心！"
        }
      );

      expect(res.cardId).toBeGreaterThan(0);
      expect(res.cardType).toBe("WARMTH");
      expect(res.cardTypeName).toBe("🌸 暖心关怀卡");
      expect(res.pointsAwarded).toBe(10);
      expect(res.badgeAwarded).toBe("暖心使者");

      // 验证 posts 点赞数自增
      const post = OfficialReplyService.getMockPost(301);
      expect(post?.likeCount).toBe(6);
    });

    it("4.2 绝对匿名提报人凭有效 VaultToken 成功赠送文创感谢卡", async () => {
      // 1. 创建绝对匿名诉求 (creatorId = 0)
      OfficialReplyService.mockRegisterPost({
        id: 302,
        schoolId,
        creatorId: 0,
        title: "关于九号楼电梯异响匿名建言",
        status: 1
      });

      // 2. 签发该诉求的有效 VaultToken
      const validToken = ConfidentialVaultService.mintVaultToken({
        schoolId,
        postId: 302,
        anonymousHash: "anon_hash_302",
        nonceSalt: "nonce_302",
        createdAt: Date.now()
      });

      // 3. 匿名赠送感谢卡
      const res = await OfficialReplyService.sendThanksCard(
        schoolId,
        0,
        {
          appealId: 302,
          cardType: "SPEED",
          studentComment: "维修速度太快了，点赞后勤师傅！",
          vaultToken: validToken
        }
      );

      expect(res.cardType).toBe("SPEED");
      expect(res.cardTypeName).toBe("⚡ 神速解决卡");
      expect(res.pointsAwarded).toBe(10);
      expect(res.badgeAwarded).toBe("神速使者");
    });

    it("4.3 携带伪造或与目标 appealId 不匹配的 VaultToken 赠送时被强阻断", async () => {
      OfficialReplyService.mockRegisterPost({
        id: 303,
        schoolId,
        creatorId: 0,
        title: "诉求303",
        status: 1
      });

      // 伪造针对 postId: 999 的 Token
      const fakeToken = ConfidentialVaultService.mintVaultToken({
        schoolId,
        postId: 999,
        anonymousHash: "anon_fake",
        nonceSalt: "nonce_fake",
        createdAt: Date.now()
      });

      await expect(
        OfficialReplyService.sendThanksCard(schoolId, 0, {
          appealId: 303,
          cardType: "ACTION",
          studentComment: "非法尝试赠送感谢卡",
          vaultToken: fakeToken
        })
      ).rejects.toThrow("感谢卡必须由该诉求的原提报人赠送");
    });

    it("4.4 未收到官方正式答复 (status = 0) 时禁止赠送感谢卡", async () => {
      OfficialReplyService.mockRegisterPost({
        id: 304,
        schoolId,
        creatorId: studentUserId,
        title: "待答复诉求",
        status: 0 // 仍在核实中
      });

      await expect(
        OfficialReplyService.sendThanksCard(schoolId, studentUserId, {
          appealId: 304,
          cardType: "PRAISE",
          studentComment: "抢先赠送"
        })
      ).rejects.toThrow("尚未收到官方正式答复");
    });

    it("4.5 一单一卡防刷风控：针对同一诉求重复赠送感谢卡直接拒绝", async () => {
      OfficialReplyService.mockRegisterPost({
        id: 305,
        schoolId,
        creatorId: studentUserId,
        title: "防刷测试诉求",
        status: 1
      });

      // 第一次赠送
      await OfficialReplyService.sendThanksCard(schoolId, studentUserId, {
        appealId: 305,
        cardType: "WARMTH",
        studentComment: "第一次真诚致谢"
      });

      // 第二次赠送应被拦截
      await expect(
        OfficialReplyService.sendThanksCard(schoolId, studentUserId, {
          appealId: 305,
          cardType: "SPEED",
          studentComment: "第二次刷卡尝试"
        })
      ).rejects.toThrow("针对该诉求您已赠送过文创感谢卡，请勿重复赠送");
    });
  });

  // ==========================================
  // 5. 推选至 M33 校园公开空间测试
  // ==========================================
  describe("5. 优秀答复推选至 M33 校园公开空间测试", () => {
    it("5.1 办结答复成功推选至公开空间，更新 isTop 标记", async () => {
      OfficialReplyService.mockRegisterPost({
        id: 401,
        schoolId,
        creatorId: studentUserId,
        title: "优秀办结案例：南门共享单车规范停放改善",
        status: 1,
        isTop: 0
      });

      await OfficialReplyService.promoteToPublicSpace(schoolId, 401, adminUserId, true);

      const post = OfficialReplyService.getMockPost(401);
      expect(post?.isTop).toBe(1);

      const logs = AuditLogger.getMockLogs();
      const promoteLog = logs.find(l => l.action === "PROMOTE_TO_PUBLIC");
      expect(promoteLog).toBeDefined();
    });
  });

  // ==========================================
  // 6. 控制器与网关端点集成测试
  // ==========================================
  describe("6. 控制器与网关 API 端点集成测试", () => {
    it("6.1 OfficialReplyController 端点全流程调用测试", async () => {
      // 1. 初始化待办诉求
      OfficialReplyService.mockRegisterPost({
        id: 501,
        schoolId,
        creatorId: studentUserId,
        title: "Controller端到端测试诉求标题",
        content: "这是详细的正文内容测试描述，包含详细的描述信息。",
        status: 0
      });

      // 2. 认领
      const claimRes = await OfficialReplyController.handleClaimAppeal(
        { schoolId, userId: officerUserId, role: 2, departmentId: 3 },
        { appealId: 501, departmentId: 3 }
      );
      expect(claimRes.status).toBe(1);

      // 3. 出具官方答复
      const replyRes = await OfficialReplyController.handleSubmitReply(
        { schoolId, userId: officerUserId, role: 2, departmentId: 3 },
        {
          appealId: 501,
          decreeTitle: "关于Controller端点诉求的官方答复公函",
          responderTitle: "饮食科主管",
          content: "我们已经全面进行了现场排查与设备调试，各项指标均已恢复合规标准，感谢您的监督！",
          promiseDays: 3
        }
      );
      expect(replyRes.status).toBe(1);
      expect(replyRes.data?.digitalFingerprint).toBeDefined();

      // 4. 获取诉求详情 (带 ETag)
      const detailRes = await OfficialReplyController.handleGetAppealDetail(
        { schoolId, userId: studentUserId },
        { appealId: 501 }
      );
      expect(detailRes.status).toBe(1);
      expect(detailRes.data?.appeal?.officialReply).toBeDefined();
      expect(detailRes.data?.sla?.slaStatus).toBe("GREEN");

      // 5. 赠送文创感谢卡
      const thanksRes = await OfficialReplyController.handleSendThanksCard(
        { schoolId, userId: studentUserId },
        {
          appealId: 501,
          cardType: "PRAISE",
          studentComment: "满分后勤典范，非常感谢！"
        }
      );
      expect(thanksRes.status).toBe(1);
      expect(thanksRes.data?.pointsAwarded).toBe(20);

      // 6. 推选至公开空间 (管理人员 role=3)
      const promoteRes = await OfficialReplyController.handlePromoteToPublic(
        { schoolId, userId: adminUserId, role: 3 },
        {
          appealId: 501,
          recommendReason: "整改迅速，师生满意度高",
          isTop: false
        }
      );
      expect(promoteRes.status).toBe(1);
    });

    it("6.2 API Gateway 端点模块执行测试", async () => {
      OfficialReplyService.mockRegisterPost({
        id: 601,
        schoolId,
        creatorId: studentUserId,
        title: "Gateway测试诉求公函标题",
        status: 0
      });

      const mockReq: any = {
        socket: { remoteAddress: "127.0.0.1" },
        headers: { "x-school-id": "1001" }
      };

      const ctxOfficer: any = {
        requestId: "req-officer-uuid",
        schoolId,
        userPayload: {
          schoolId,
          userId: officerUserId,
          role: 2,
          departmentId: 3
        }
      };

      // 测试 claimApi
      const claimRes = await claimApi.handler(
        { req: mockReq, body: { appealId: 601, departmentId: 3 }, query: {} },
        ctxOfficer
      );
      expect(claimRes.status).toBe(1);

      // 测试 replyApi
      const replyRes = await replyApi.handler(
        {
          req: mockReq,
          body: {
            appealId: 601,
            decreeTitle: "网关测试公函答复标题",
            responderTitle: "饮食科长",
            content: "经过科室全面实地调研与现场整改部署，已经全面完成整改目标并建立长效巡查机制！",
            promiseDays: 2
          },
          query: {}
        },
        ctxOfficer
      );
      expect(replyRes.status).toBe(1);

      // 测试 thanksApi (匿名/免密通道)
      const ctxStudent: any = {
        requestId: "req-student-uuid",
        schoolId,
        userPayload: {
          schoolId,
          userId: studentUserId,
          role: 0
        }
      };

      const thanksRes = await thanksApi.handler(
        {
          req: mockReq,
          body: {
            appealId: 601,
            cardType: "WARMTH",
            studentComment: "网关端点赠送暖心卡测试"
          },
          query: {}
        },
        ctxStudent
      );
      expect(thanksRes.status).toBe(1);

      // 测试 detailApi
      const detailRes = await detailApi.handler(
        {
          req: mockReq,
          body: {},
          query: { appealId: "601" }
        },
        ctxStudent
      );
      expect(detailRes.status).toBe(1);
      expect(detailRes.data?.appeal?.id).toBe(601);
    });
  });
});
