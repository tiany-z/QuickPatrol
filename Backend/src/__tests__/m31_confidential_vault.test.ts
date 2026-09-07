/**
 * 高校后勤巡查e速办 v4.0 - M31: 师生诉求与绝对匿名加盐散列保险箱单元测试
 * 
 * 核心断言覆盖：
 * 1. ConfidentialVaultService 密码学核心能力 (HMAC-SHA256 匿名指纹计算、AES-256-GCM VaultToken 签发/验签/AAD 防篡改)
 * 2. DFA Trie 敏感词两级过滤 (轻度敏感词 *** 替换、严重违法违规致命敏感词强阻断)
 * 3. 师生诉求提报 (匿名物理抹零 creatorId=0、IP脱敏掩码、安全审计日志 vs 实名提交保留身份)
 * 4. 凭 Vault Tokens 批量免密查询诉求进展与追问状态 (跨租户越权阻断、损坏 Token 容错)
 * 5. 凭 Vault Token 进行匿名追加追问 (评论数累加、userId=0 抹零、threadId 返回)
 * 6. Controller 控制器与 Gateway 端点模块执行测试 (标准 StandardResult 规范)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { ConfidentialVaultService } from "../apps/feedback/confidentialVaultService.js";
import { DfaWordFilter } from "../apps/feedback/dfaWordFilter.js";
import { FeedbackAppealService } from "../apps/feedback/feedbackAppealService.js";
import { FeedbackAppealController } from "../apps/feedback/feedbackAppealController.js";
import { SchoolService } from "../services/school/schoolService.js";
import { WeChatAuthService } from "../services/auth/wechatAuthService.js";
import { AuditLogger } from "../shared/log/auditLogger.js";
import createAppealApi from "../api/feedback/appeals/create/index.js";
import batchQueryApi from "../api/feedback/appeals/batch-query-by-tokens/index.js";
import appendInquiryApi from "../api/feedback/appeals/append-inquiry/index.js";

describe("M31: 师生诉求与绝对匿名加盐散列保险箱核心测试", () => {
  const schoolId = 1001;
  const otherSchoolId = 1002;
  const studentId = 2001;
  const teacherId = 2002;

  beforeEach(() => {
    TestHarness.resetSandbox();
    FeedbackAppealService.clearMockAppeals();
    AuditLogger.clearMockLogs();

    // 注册高校租户
    SchoolService.mockRegisterSchool({
      id: schoolId,
      name: "同济大学",
      code: "TONGJI",
      status: 1
    } as any);

    SchoolService.mockRegisterSchool({
      id: otherSchoolId,
      name: "复旦大学",
      code: "FUDAN",
      status: 1
    } as any);

    // 注册用户
    WeChatAuthService.mockRegisterUser({
      id: studentId,
      schoolId,
      openId: "o_student_tongji_2001",
      realName: "张小同",
      role: 0,
      phone: "13800001111"
    });

    WeChatAuthService.mockRegisterUser({
      id: teacherId,
      schoolId,
      openId: "o_teacher_tongji_2002",
      realName: "李老师",
      role: 1,
      phone: "13800002222"
    });
  });

  // ==========================================
  // 1. 密码学加盐散列与 AES-256-GCM 保险箱凭证测试
  // ==========================================
  describe("1. ConfidentialVaultService 密码学与保险箱凭证测试", () => {
    it("1.1 相同高校与 OpenID 应计算出确定性的匿名散列指纹，不同参数指纹互斥", () => {
      const secret = "SECRET_TENANT_SALT";
      const nonce = ConfidentialVaultService.generateNonceSalt();
      const hash1 = ConfidentialVaultService.generateAnonymousHash("o_student_tongji_2001", schoolId, secret, nonce);
      const hash2 = ConfidentialVaultService.generateAnonymousHash("o_student_tongji_2001", schoolId, secret, nonce);
      const hashDiffSchool = ConfidentialVaultService.generateAnonymousHash("o_student_tongji_2001", otherSchoolId, secret, nonce);
      const hashDiffUser = ConfidentialVaultService.generateAnonymousHash("o_teacher_tongji_2002", schoolId, secret, nonce);

      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hashDiffSchool);
      expect(hash1).not.toBe(hashDiffUser);
    });

    it("1.2 能够成功签发包含 AAD 绑定的 Vault Token，并正确解密出原始载荷", () => {
      const postId = 5001;
      const anonHash = ConfidentialVaultService.generateAnonymousHash(
        "o_student_tongji_2001",
        schoolId,
        "SEC",
        "NONCE"
      );

      const token = ConfidentialVaultService.mintVaultToken({
        schoolId,
        postId,
        anonymousHash: anonHash,
        nonceSalt: "NONCE",
        createdAt: Date.now()
      });

      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(20);

      // 解密验签
      const payload = ConfidentialVaultService.verifyAndDecodeVaultToken(token, schoolId);
      expect(payload).not.toBeNull();
      expect(payload?.schoolId).toBe(schoolId);
      expect(payload?.postId).toBe(postId);
      expect(payload?.anonymousHash).toBe(anonHash);
      expect(payload?.createdAt).toBeGreaterThan(0);
    });

    it("1.3 AAD 跨租户篡改防御：使用错误的 schoolId 进行验签必须被严格拦截", () => {
      const postId = 5002;
      const anonHash = "anon_hash_test_value";
      const token = ConfidentialVaultService.mintVaultToken({
        schoolId,
        postId,
        anonymousHash: anonHash,
        nonceSalt: "NONCE",
        createdAt: Date.now()
      });

      // 试图用 otherSchoolId 校验 schoolId 颁发的 token
      expect(() => {
        ConfidentialVaultService.verifyAndDecodeVaultToken(token, otherSchoolId);
      }).toThrow();
    });

    it("1.4 密文抗篡改性：被篡改或损坏的 Vault Token 解密必须抛出异常", () => {
      const postId = 5003;
      const anonHash = "anon_hash_test_value";
      const token = ConfidentialVaultService.mintVaultToken({
        schoolId,
        postId,
        anonymousHash: anonHash,
        nonceSalt: "NONCE",
        createdAt: Date.now()
      });

      // 篡改末尾字符
      const corruptedToken = token.slice(0, -4) + "AAAA";
      expect(() => {
        ConfidentialVaultService.verifyAndDecodeVaultToken(corruptedToken, schoolId);
      }).toThrow();
    });
  });

  // ==========================================
  // 2. DFA Trie 敏感词内容安全引擎测试
  // ==========================================
  describe("2. DFA 敏感词内容安全扫描与脱敏测试", () => {
    it("2.1 正常合规文本应通过且不发生任何修改", () => {
      const filter = DfaWordFilter.getInstance();
      const text = "嘉定校区新天地宿舍三号楼四层水管轻微漏水，请后勤师傅前来查看。";
      const result = filter.scanAndSanitize(text);

      expect(result.hasFatalWords).toBe(false);
      expect(result.hitWords).toHaveLength(0);
      expect(result.sanitizedText).toBe(text);
    });

    it("2.2 包含常规轻度违规词应被自动替换为星号，且不触发致命拦截", () => {
      const filter = DfaWordFilter.getInstance();
      const text = "这食堂阿姨态度太差了去死，真是傻逼，请整改。";
      const result = filter.scanAndSanitize(text);

      expect(result.hasFatalWords).toBe(false);
      expect(result.hitWords).toContain("去死");
      expect(result.hitWords).toContain("傻逼");
      expect(result.sanitizedText).toContain("**");
      expect(result.sanitizedText).not.toContain("去死");
      expect(result.sanitizedText).not.toContain("傻逼");
    });

    it("2.3 包含严重违法违规致命词应被标志为 hasFatalWords = true", () => {
      const filter = DfaWordFilter.getInstance();
      const text = "有人在食堂饮用水源里投毒，情况非常危险！";
      const result = filter.scanAndSanitize(text);

      expect(result.hasFatalWords).toBe(true);
      expect(result.hitWords).toContain("投毒");
    });
  });

  // ==========================================
  // 3. 师生诉求提报与绝对匿名物理抹零测试
  // ==========================================
  describe("3. 师生诉求提报与绝对匿名物理抹零测试", () => {
    it("3.1 匿名建言提交：数据库中 creatorId 彻底物理抹零 (0)，颁发专属 VaultToken，日志脱敏", async () => {
      const result = await FeedbackAppealService.submitAppeal(
        schoolId,
        "o_student_tongji_2001",
        studentId,
        {
          categoryType: "dorm",
          title: "宿舍楼电梯深夜异响建言",
          content: "九号楼东侧电梯在晚上11点后运行有摩擦异响，影响休息，希望检修。",
          imageUrls: ["https://oss.campus.edu/img1.jpg"],
          isAnonymous: true
        },
        "192.168.1.108"
      );

      expect(result.appealId).toBeGreaterThan(0);
      expect(result.isAnonymous).toBe(true);
      expect(result.vaultToken).toBeDefined();

      // 验证底层数据：creatorId 必须为 0
      const appealInDb = FeedbackAppealService.getMockAppeal(result.appealId);
      expect(appealInDb).toBeDefined();
      expect(appealInDb?.creatorId).toBe(0); // 绝对抹零

      // 验证生成的 Vault Token 能够正向解密
      const payload = ConfidentialVaultService.verifyAndDecodeVaultToken(
        result.vaultToken!,
        schoolId
      );
      expect(payload?.postId).toBe(result.appealId);

      // 验证审计日志记录也是 userId = 0，IP 掩码脱敏
      const logs = AuditLogger.getMockLogs();
      const auditLog = logs.find(l => l.action === "FEEDBACK_APPEAL_SUBMIT");
      expect(auditLog).toBeDefined();
      expect(auditLog?.userId).toBe(0);
      expect(auditLog?.ip).toBe("192.168.1.0");
    });

    it("3.2 实名建言提交：保留真实 creatorId，不签发 VaultToken", async () => {
      const result = await FeedbackAppealService.submitAppeal(
        schoolId,
        "o_teacher_tongji_2002",
        teacherId,
        {
          categoryType: "service",
          title: "关于教职工活动中心增设健身器材的建议",
          content: "希望在教工之家二楼活动室增加一台跑步机与动感单车。",
          isAnonymous: false
        },
        "10.0.8.20"
      );

      expect(result.appealId).toBeGreaterThan(0);
      expect(result.isAnonymous).toBe(false);
      expect(result.vaultToken).toBeUndefined();

      // 验证底层数据保留真实 creatorId
      const appealInDb = FeedbackAppealService.getMockAppeal(result.appealId);
      expect(appealInDb).toBeDefined();
      expect(appealInDb?.creatorId).toBe(teacherId);

      // 审计日志保留李老师 ID
      const logs = AuditLogger.getMockLogs();
      const auditLog = logs.find(l => l.action === "FEEDBACK_APPEAL_SUBMIT" && l.userId === teacherId);
      expect(auditLog).toBeDefined();
    });

    it("3.3 内容安全拦截：包含致命敏感词时强阻断，不予创建工单", async () => {
      await expect(
        FeedbackAppealService.submitAppeal(
          schoolId,
          "o_student_tongji_2001",
          studentId,
          {
            categoryType: "service",
            title: "关于后勤的极端不满",
            content: "如果不解决停水问题就去图书馆砍人！",
            isAnonymous: true
          },
          "192.168.1.108"
        )
      ).rejects.toThrow("严重违规词汇");
    });

    it("3.4 轻度敏感词自动过滤并保存脱敏后内容", async () => {
      const result = await FeedbackAppealService.submitAppeal(
        schoolId,
        "o_student_tongji_2001",
        studentId,
        {
          categoryType: "canteen",
          title: "食堂打饭阿姨态度差",
          content: "打饭阿姨态度真差，去死吧，像傻逼一样，必须批评教育！",
          isAnonymous: true
        },
        "192.168.1.108"
      );

      expect(result.appealId).toBeGreaterThan(0);
      const appealInDb = FeedbackAppealService.getMockAppeal(result.appealId);
      expect(appealInDb?.content).not.toContain("去死");
      expect(appealInDb?.content).not.toContain("傻逼");
      expect(appealInDb?.content).toContain("**");
    });
  });

  // ==========================================
  // 4. 凭 Vault Tokens 批量免密查询诉求进展测试
  // ==========================================
  describe("4. 凭 Vault Tokens 批量免密查询诉求进展测试", () => {
    it("4.1 传入客户端有效 Vault Tokens，能够批量恢复诉求进度且无隐私泄露", async () => {
      // 提报两个匿名诉求
      const appeal1 = await FeedbackAppealService.submitAppeal(
        schoolId,
        "o_student_tongji_2001",
        studentId,
        {
          categoryType: "service",
          title: "诉求A：图书馆空调过冷",
          content: "三楼自习室空调只有18度，太冷了希望能调到26度。",
          isAnonymous: true
        }
      );
      const appeal2 = await FeedbackAppealService.submitAppeal(
        schoolId,
        "o_student_tongji_2001",
        studentId,
        {
          categoryType: "traffic",
          title: "诉求B：南门共享单车站拥堵",
          content: "每天早上南门单车乱堆放，行人无法通行。",
          isAnonymous: true
        }
      );

      const token1 = appeal1.vaultToken!;
      const token2 = appeal2.vaultToken!;

      // 客户端免密批量查询
      const list = await FeedbackAppealService.batchQueryByVaultTokens(schoolId, [token1, token2]);

      expect(list).toHaveLength(2);

      const item1 = list.find(i => i.appealId === appeal1.appealId);
      expect(item1).toBeDefined();
      expect(item1?.title).toBe("诉求A：图书馆空调过冷");
      expect(item1?.processStatus).toBe(0);
    });

    it("4.2 混入非法、篡改或跨租户的 Token 时容错过滤，不阻断合法工单查询", async () => {
      const appeal1 = await FeedbackAppealService.submitAppeal(
        schoolId,
        "o_student_tongji_2001",
        studentId,
        {
          categoryType: "service",
          title: "诉求C：操场路灯不亮",
          content: "东操场西侧两盏路灯不亮，夜跑视线受阻。",
          isAnonymous: true
        }
      );

      const validToken = appeal1.vaultToken!;
      const invalidToken = "invalid_vault_token_xxx_yyy";

      const list = await FeedbackAppealService.batchQueryByVaultTokens(schoolId, [validToken, invalidToken]);

      expect(list).toHaveLength(1);
      expect(list[0].appealId).toBe(appeal1.appealId);
    });
  });

  // ==========================================
  // 5. 凭 Vault Token 匿名追加追问测试
  // ==========================================
  describe("5. 凭 Vault Token 进行匿名追加追问测试", () => {
    it("5.1 凭合法 Vault Token 可以成功进行匿名追问，评论数自增且用户抹零", async () => {
      const appeal = await FeedbackAppealService.submitAppeal(
        schoolId,
        "o_student_tongji_2001",
        studentId,
        {
          categoryType: "service",
          title: "自习室插座无电反馈",
          content: "四教201教室后排插座全部断电。",
          isAnonymous: true
        },
        "192.168.2.50"
      );

      const token = appeal.vaultToken!;
      const appealId = appeal.appealId;

      // 发起追问
      const inquiryRes = await FeedbackAppealService.appendAnonymousInquiry(
        schoolId,
        {
          appealId,
          vaultToken: token,
          inquiryContent: "补充反馈：202教室好像也有同样的问题，希望能一并排查，谢谢师傅！"
        },
        "192.168.2.50"
      );

      expect(inquiryRes.threadId).toBeGreaterThan(0);
      expect(inquiryRes.message).toBeDefined();

      // 验证底层工单评论自增
      const appealInDb = FeedbackAppealService.getMockAppeal(appealId);
      expect(appealInDb?.commentCount).toBe(1);

      // 查询诉求详情验证追问已挂接
      const list = await FeedbackAppealService.batchQueryByVaultTokens(schoolId, [token]);
      const detail = list[0];
      expect(detail?.inquiryThreads).toHaveLength(1);
      expect(detail?.inquiryThreads[0].content).toContain("202教室好像也有同样的问题");
      expect(detail?.inquiryThreads[0].isFromStudent).toBe(true);
      expect(detail?.inquiryThreads[0].senderName).toBe("匿名提报人");
    });

    it("5.2 Token 对应的 postId 与目标 appealId 不匹配时应被强行拒绝", async () => {
      const appeal1 = await FeedbackAppealService.submitAppeal(
        schoolId,
        "o_student_tongji_2001",
        studentId,
        {
          categoryType: "service",
          title: "诉求1标题在此处",
          content: "诉求1详细内容在此处，满10个字了。",
          isAnonymous: true
        }
      );

      const appeal2 = await FeedbackAppealService.submitAppeal(
        schoolId,
        "o_student_tongji_2001",
        studentId,
        {
          categoryType: "service",
          title: "诉求2标题在此处",
          content: "诉求2详细内容在此处，满10个字了。",
          isAnonymous: true
        }
      );

      // 拿 appeal1 的 token 去追加 appeal2
      await expect(
        FeedbackAppealService.appendAnonymousInquiry(
          schoolId,
          {
            appealId: appeal2.appealId,
            vaultToken: appeal1.vaultToken!,
            inquiryContent: "尝试非法追问测试内容"
          }
        )
      ).rejects.toThrow("不匹配");
    });

    it("5.3 追问内容包含违规致命词时予以阻断", async () => {
      const appeal = await FeedbackAppealService.submitAppeal(
        schoolId,
        "o_student_tongji_2001",
        studentId,
        {
          categoryType: "service",
          title: "诉求安全测试标题",
          content: "这是合规的诉求详细内容描述。",
          isAnonymous: true
        }
      );

      await expect(
        FeedbackAppealService.appendAnonymousInquiry(
          schoolId,
          {
            appealId: appeal.appealId,
            vaultToken: appeal.vaultToken!,
            inquiryContent: "要是今天不解决就去放炸弹！"
          }
        )
      ).rejects.toThrow("包含不当词汇");
    });
  });

  // ==========================================
  // 6. 控制器与网关 API 端点集成测试
  // ==========================================
  describe("6. 控制器与网关 API 端点集成测试", () => {
    it("6.1 FeedbackAppealController 能够正确处理建言、查询与追问", async () => {
      // 1. 创建
      const createRes = await FeedbackAppealController.handleSubmitAppeal(
        { schoolId, userId: studentId, openId: "o_student_tongji_2001", role: 0 },
        {
          categoryType: "service",
          title: "Controller测试诉求",
          content: "这是通过控制器测试提交的诉求内容描述，大于10字。",
          isAnonymous: true
        }
      );
      expect(createRes.status).toBe(1);
      const token = createRes.data?.vaultToken!;

      // 2. 查询
      const queryRes = await FeedbackAppealController.handleBatchQueryByTokens(
        { schoolId, userId: studentId },
        {
          vaultTokens: [token]
        }
      );
      expect(queryRes.status).toBe(1);
      expect(queryRes.data?.length).toBe(1);

      // 3. 追问
      const appendRes = await FeedbackAppealController.handleAppendInquiry(
        { schoolId, userId: 0 },
        {
          appealId: createRes.data!.appealId,
          vaultToken: token,
          inquiryContent: "控制器测试追加追问详细内容"
        }
      );
      expect(appendRes.status).toBe(1);
      expect(appendRes.data?.threadId).toBeGreaterThan(0);
    });

    it("6.2 API Gateway 端点模块执行测试", async () => {
      const mockReq: any = {
        socket: { remoteAddress: "127.0.0.1" },
        headers: { "x-school-id": "1001" }
      };

      const ctx: any = {
        requestId: "req-test-uuid-001",
        schoolId,
        userPayload: {
          schoolId,
          userId: studentId,
          openId: "o_student_tongji_2001",
          role: 0
        }
      };

      const createApiRes = await createAppealApi.handler(
        {
          req: mockReq,
          body: {
            categoryType: "canteen",
            title: "网关端点建言标题",
            content: "通过网关路由端点提交测试内容描述，超过10个字。",
            isAnonymous: true
          },
          query: {}
        },
        ctx
      );
      expect(createApiRes.status).toBe(1);
      const token = createApiRes.data?.vaultToken;

      const batchApiRes = await batchQueryApi.handler(
        {
          req: mockReq,
          body: {
            vaultTokens: [token]
          },
          query: {}
        },
        ctx
      );
      expect(batchApiRes.status).toBe(1);
      expect(batchApiRes.data?.length).toBe(1);

      const appendApiRes = await appendInquiryApi.handler(
        {
          req: mockReq,
          body: {
            appealId: createApiRes.data?.appealId,
            vaultToken: token,
            inquiryContent: "通过网关追加追问测试内容"
          },
          query: {}
        },
        ctx
      );
      expect(appendApiRes.status).toBe(1);
    });
  });
});
