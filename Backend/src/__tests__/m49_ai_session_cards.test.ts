/**
 * 高校后勤巡查e速办 v4.0 - M49 单元测试套件
 * 文件路径: src/__tests__/m49_ai_session_cards.test.ts
 * 验证目标:
 *   1. 多校工单序列号正则自适应匹配与去重 (SnExtractor)
 *   2. 实体数据批量水合与 Action Cards 状态胶囊组装 (AIActionCardService)
 *   3. 虚构单号优雅降级防白屏与多租户隔离
 *   4. 会话智能标题提炼、相对时间计算与会话生命周期 (AISessionService)
 *   5. 异步流水持久化落库、Token 审计与历史会话漫游
 *   6. AISessionController 鉴权拦截与多租户安全回溯
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SnExtractor, aiActionCardService } from "../services/aiActionCardService.js";
import { aiSessionService, AISessionService } from "../services/aiSessionService.js";
import { PatrolTools } from "../services/tools/patrolTools.js";
import { aiSessionController } from "../controllers/aiSessionController.js";
import { aiChatService, AIChatService } from "../services/aiChatService.js";
import { llmConfigService } from "../services/llm/llmConfigService.js";
import { CopilotSSEEventType } from "../contracts/copilotContract.js";

describe("M49: AI 会话持久化与智能工单卡片直达测试套件", () => {
  beforeEach(() => {
    AISessionService.resetMock();
    PatrolTools.resetMock();
    AIChatService.resetMock();

    // 填充测试工单沙箱数据
    PatrolTools.mockPatrols.push(
      {
        id: 101,
        schoolId: 1,
        patrolSn: "#LCU-2026-0091",
        title: "西校区12号楼302配电箱跳闸险情",
        locationName: "西校区12号楼302",
        urgencyLevel: 2,
        status: 1, // 抢修中
        handlerName: "张三师傅",
        handleRemark: "已更换 380V 空开并恢复主干供电"
      },
      {
        id: 102,
        schoolId: 1,
        patrolSn: "#PATROL-1002",
        title: "南区食堂一楼水管破裂喷水",
        locationName: "南区食堂一楼后厨",
        urgencyLevel: 3,
        status: 4, // 已办结
        handlerName: "李四师傅",
        handleRemark: "已重新压制 PPR 管道弯头"
      },
      {
        id: 201,
        schoolId: 2, // 属于学校 2 的工单
        patrolSn: "#LCU-2026-9999",
        title: "隔壁校区路灯损坏",
        locationName: "东区林荫道",
        urgencyLevel: 1,
        status: 0,
        handlerName: "王师傅"
      }
    );
  });

  describe("一、 工单序列号正则自适应匹配与去重 (SnExtractor)", () => {
    it("M49-01: 精准提取多种格式的工单号并去重", () => {
      const sampleText = `
        同学你好，关于你的报修 #LCU-2026-0091 已经有师傅接单。
        另外之前的工单 #PATROL-1002 已经办结，重复提到的 #LCU-2026-0091 不应重复。
      `;
      const sns = SnExtractor.extractUniqueSns(sampleText);
      expect(sns.length).toBe(2);
      expect(sns).toContain("#LCU-2026-0091");
      expect(sns).toContain("#PATROL-1002");
    });

    it("M49-02: 无工单号时安全返回空数组", () => {
      const sns = SnExtractor.extractUniqueSns("普通的后勤服务咨询，没有任何具体工单编号。");
      expect(sns).toEqual([]);
    });

    it("M49-03: 各种前后标点符号包裹下的鲁棒性断言", () => {
      const complexText = `查阅了工单(#LCU-2026-0091)、【#PATROL-1002】以及“#MED-GD-2026-881”。`;
      const sns = SnExtractor.extractUniqueSns(complexText);
      expect(sns.length).toBe(3);
      expect(sns).toContain("#LCU-2026-0091");
      expect(sns).toContain("#PATROL-1002");
      expect(sns).toContain("#MED-GD-2026-881");
    });

    it("M49-04: 空串或非法非字符串类型防护", () => {
      expect(SnExtractor.extractUniqueSns("")).toEqual([]);
      expect(SnExtractor.extractUniqueSns(null as any)).toEqual([]);
      expect(SnExtractor.extractUniqueSns(undefined as any)).toEqual([]);
    });
  });

  describe("二、 实体数据批量水合与 Action Cards 装配 (AIActionCardService)", () => {
    it("M49-05: 真实工单命中批量水合为结构化卡片", async () => {
      const assistantText = "已核查工单 #LCU-2026-0091，张师傅正在处理中。";
      const cards = await aiActionCardService.extractAndHydrateActionCards(1, assistantText);

      expect(cards.length).toBe(1);
      const card = cards[0];
      expect(card.patrolId).toBe(101);
      expect(card.patrolSn).toBe("#LCU-2026-0091");
      expect(card.statusText).toContain("抢修中");
      expect(card.statusBadgeColor).toBe("blue");
      expect(card.actions[0].actionType).toBe("NAVIGATE_PATROL_DETAIL");
      expect(card.actions[0].targetParam).toContain("id=101");
    });

    it("M49-06: 状态胶囊颜色映射正确 (待派工=orange, 已办结=green, 抢修中=blue)", async () => {
      const text = "办结单：#PATROL-1002";
      const cards = await aiActionCardService.extractAndHydrateActionCards(1, text);
      expect(cards.length).toBe(1);
      expect(cards[0].statusBadgeColor).toBe("green");
      expect(cards[0].statusText).toContain("已办结");
      expect(cards[0].slaRemainingText).toBe("工单已圆满办结");
    });

    it("M49-07: 虚构单号优雅降级防白屏 (模型幻觉)", async () => {
      const fakeText = "为您生成了虚构单号 #LCU-9999-0000 正在排队。";
      const cards = await aiActionCardService.extractAndHydrateActionCards(1, fakeText);
      expect(cards).toEqual([]);
    });

    it("M49-08: 跨校多租户严格物理隔离 (无法水合他校工单)", async () => {
      const crossSchoolText = "工单 #LCU-2026-9999 是二校区的。";
      // 以 schoolId = 1 查询属于 schoolId = 2 的单号
      const cards = await aiActionCardService.extractAndHydrateActionCards(1, crossSchoolText);
      expect(cards.length).toBe(0);
    });

    it("M49-09: 单次最大水合卡片数限制为 3 张", async () => {
      // 构造更多工单
      for (let i = 1; i <= 5; i++) {
        PatrolTools.mockPatrols.push({
          id: 500 + i,
          schoolId: 1,
          patrolSn: `#PATROL-500${i}`,
          title: `批量工单${i}`,
          status: 1
        });
      }
      const multiText = "检索到 #PATROL-5001 #PATROL-5002 #PATROL-5003 #PATROL-5004 #PATROL-5005";
      const cards = await aiActionCardService.extractAndHydrateActionCards(1, multiText);
      expect(cards.length).toBe(3);
    });
  });

  describe("三、 会话智能标题与时间格式化 (AISessionService)", () => {
    it("M49-10: 过滤礼貌前缀并生成精炼标题", () => {
      const t1 = aiSessionService.generateSmartTitle("请问一下西校区配电箱什么时候能修好？");
      expect(t1).toBe("西校区配电箱什么时候能修好");

      const t2 = aiSessionService.generateSmartTitle("麻烦问下宿舍漏水找哪个师傅处理呢？？");
      expect(t2).toBe("宿舍漏水找哪个师傅处理呢");
    });

    it("M49-11: 超长提问截断与空串优雅兜底", () => {
      const longPrompt = "西校区12号楼302宿舍配电箱跳闸严重且伴随焦糊味请问加急处理需要多久？";
      const title = aiSessionService.generateSmartTitle(longPrompt);
      expect(title.endsWith("...")).toBe(true);
      expect(title.length).toBeLessThanOrEqual(18);

      const emptyTitle = aiSessionService.generateSmartTitle("？？？！！！");
      expect(emptyTitle).toBe("后勤咨询服务");
    });

    it("M49-12: 相对时间文本准确计算 (刚刚 / 分钟前 / 小时前)", () => {
      const now = new Date();
      expect(aiSessionService.formatRelativeTime(new Date(now.getTime() - 20 * 1000))).toBe("刚刚");
      expect(aiSessionService.formatRelativeTime(new Date(now.getTime() - 5 * 60 * 1000))).toBe("5分钟前");
      expect(aiSessionService.formatRelativeTime(new Date(now.getTime() - 3 * 3600 * 1000))).toBe("3小时前");
    });
  });

  describe("四、 会话生命周期与异步流水持久化 (AISessionService)", () => {
    it("M49-13: 获取或创建用户新会话 (生成唯一 UUID)", async () => {
      const session = await aiSessionService.getOrCreateActiveSession(1, 1001);
      expect(session.sessionUuid.startsWith("sess_")).toBe(true);
      expect(session.schoolId).toBe(1);
      expect(session.userId).toBe(1001);
      expect(session.messageCount).toBe(0);
      expect(session.totalTokensUsed).toBe(0);
    });

    it("M49-14: 携带已有 sessionUuid 能够精准复用原会话", async () => {
      const s1 = await aiSessionService.getOrCreateActiveSession(1, 1001, "sess_custom_test_999");
      expect(s1.sessionUuid).toBe("sess_custom_test_999");

      const s2 = await aiSessionService.getOrCreateActiveSession(1, 1001, "sess_custom_test_999");
      expect(s2.id).toBe(s1.id);
    });

    it("M49-15: persistChatTurn 完整记录一轮问答流水并累计 Token", async () => {
      const turnResult = await aiSessionService.persistChatTurn({
        schoolId: 1,
        userId: 1001,
        sessionUuid: "sess_turn_01",
        userPrompt: "请问西校区配电箱修好了吗？",
        assistantContent: "已查到工单 #LCU-2026-0091，张师傅抢修完成！",
        reasoningContent: "正在查询数据库配电箱状态...",
        metrics: {
          promptTokens: 20,
          completionTokens: 30,
          totalTokens: 50,
          durationMs: 800
        }
      });

      expect(turnResult.actionCards.length).toBe(1);
      expect(turnResult.actionCards[0].patrolSn).toBe("#LCU-2026-0091");
      expect(turnResult.sessionUuid).toBe("sess_turn_01");

      const session = await aiSessionService.getOrCreateActiveSession(1, 1001, "sess_turn_01");
      expect(session.messageCount).toBe(2);
      expect(session.totalTokensUsed).toBe(50);
      expect(session.title).toBe("西校区配电箱修好了吗");
    });

    it("M49-16: getUserSessionList 抽屉侧边栏按置顶与时间倒序返回分页列表", async () => {
      // 创建 3 个会话
      const s1 = await aiSessionService.getOrCreateActiveSession(1, 1001, "sess_list_01");
      const s2 = await aiSessionService.getOrCreateActiveSession(1, 1001, "sess_list_02");
      s2.isPinned = 1;

      const list = await aiSessionService.getUserSessionList(1, 1001, 1, 10);
      expect(list.length).toBeGreaterThanOrEqual(2);
      // 置顶的排在最前
      expect(list[0].sessionUuid).toBe("sess_list_02");
      expect(list[0].isPinned).toBe(true);
    });

    it("M49-17: getSessionDetail 回溯调取单笔会话全量消息与卡片快照", async () => {
      await aiSessionService.persistChatTurn({
        schoolId: 1,
        userId: 1001,
        sessionUuid: "sess_detail_01",
        userPrompt: "查一下食堂工单",
        assistantContent: "这是食堂工单 #PATROL-1002"
      });

      const detail = await aiSessionService.getSessionDetail(1, 1001, "sess_detail_01");
      expect(detail).not.toBeNull();
      expect(detail!.sessionUuid).toBe("sess_detail_01");
      expect(detail!.messages.length).toBe(2);
      expect(detail!.messages[0].role).toBe("user");
      expect(detail!.messages[1].role).toBe("assistant");
      expect(detail!.messages[1].actionCards?.length).toBe(1);
    });

    it("M49-18: 跨校越权调取他人会话必须返回 null", async () => {
      await aiSessionService.getOrCreateActiveSession(1, 1001, "sess_secret_01");
      // 用 schoolId = 2 调取 schoolId = 1 的会话
      const detail = await aiSessionService.getSessionDetail(2, 1001, "sess_secret_01");
      expect(detail).toBeNull();
    });
  });

  describe("五、 AISessionController 与端到端集成", () => {
    it("M49-19: AISessionController 鉴权拦截 (缺少租户或用户返回 401)", async () => {
      const res1 = await aiSessionController.handleSessionsRoute({}, null, {}, null);
      expect(res1.code).toBe(401);
    });

    it("M49-20: AIChatService 流式结束时自动水合 Action Cards 并发射 action_cards 帧", async () => {
      await llmConfigService.saveConfig(1, 88, {
        selectedProvider: "deepseek",
        primary: {
          provider: "deepseek",
          modelName: "deepseek-chat",
          baseUrl: "https://api.deepseek.com/v1",
          apiKeyPlain: "sk-test-m49"
        }
      });

      const events: Array<{ event: string; data: any }> = [];
      const sseEmitter = {
        sendEvent: (eventName: string, dataObj: any) => {
          events.push({ event: eventName, data: dataObj });
        },
        close: () => {}
      };

      // Mock 上游大模型吐出包含工单号的文本
      const mockStreamChunk = {
        choices: [
          {
            delta: {
              content: "同学你好，您咨询的配电箱问题工单为 #LCU-2026-0091，正在抢修中。"
            }
          }
        ]
      };
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(mockStreamChunk)}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      });

      AIChatService.mockFetch = async () => new Response(stream, { status: 200 });

      await aiChatService.processCopilotChatStream({
        schoolId: 1,
        userId: 1001,
        prompt: "配电箱修好了吗？",
        history: [],
        sseEmitter,
        abortSignal: new AbortController().signal
      });

      // 断言是否发射了 action_cards 帧
      const actionCardEvent = events.find((e) => e.event === CopilotSSEEventType.ACTION_CARDS);
      expect(actionCardEvent).toBeDefined();
      expect(actionCardEvent!.data.cards.length).toBe(1);
      expect(actionCardEvent!.data.cards[0].patrolSn).toBe("#LCU-2026-0091");

      // 断言 DONE 帧是否包含了 sessionUuid
      const doneEvent = events.find((e) => e.event === CopilotSSEEventType.DONE);
      expect(doneEvent).toBeDefined();
      expect(doneEvent!.data.sessionUuid).toBeDefined();
    });
  });
});
