/**
 * 高校后勤巡查e速办 v4.0 - M39: 聊天消息长按引用回复与源消息联动单元测试
 * (M39 Chat Quote & Message Source Linking Tests)
 *
 * 核心测试矩阵：
 * 1. 算法 1：引文摘要提取器多形态提取与长度截断 (文本/图片/卡片/系统/撤回降级)
 * 2. 算法 2：视口滚动目标计算器 WXML 节点合法性与列表命中判定
 * 3. 算法 3：极远历史记录对称上下文切片拉取与边界约束 (Anchor 居中、前后半窗口)
 * 4. 扁平化单层引用：绝不允许套娃递归层叠
 * 5. 安全防御：跨房间引用拦截 (403 跨域盗取会话)、引用不存在消息校验
 * 6. DFA 敏感词清洗与拦截
 * 7. 批量注水：populateQuotesForMessages 单次批量注入与防 N+1
 * 8. 控制器与 HTTP API 端点校验 (POST /api/v4/chat/messages/quote & GET context-slice)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { QuotedMessageSummaryExtractor } from "../apps/chat/quotedMessageSummaryExtractor.js";
import { ViewportScrollTargetCalculator } from "../apps/chat/viewportScrollTargetCalculator.js";
import { ChatQuoteService } from "../apps/chat/chatQuoteService.js";
import { ChatQuoteController } from "../apps/chat/chatQuoteController.js";
import { ChatRoomService } from "../apps/chat/chatRoomService.js";
import { ChatMessageService } from "../apps/chat/chatMessageService.js";
import { ChatMessageType } from "../apps/chat/chatMessageTypes.js";

describe("M39: 聊天消息长按引用回复与源消息联动", () => {
  const schoolId = 1;
  const creatorId = 101; // 师生
  const handlerId = 201; // 师傅
  let chatRoomId = 0;
  let quoteService: ChatQuoteService;
  let quoteController: ChatQuoteController;

  beforeEach(() => {
    TestHarness.resetSandbox();
    quoteService = new ChatQuoteService();
    quoteController = new ChatQuoteController(quoteService);

    chatRoomId = 501;
    ChatRoomService.seedMockRoom({
      id: chatRoomId,
      schoolId,
      patrolId: 5001,
      creatorId,
      handlerId
    });
  });

  describe("1. 算法 1：引文摘要智能提取器 (QuotedMessageSummaryExtractor)", () => {
    it("短文本应保留完整内容", () => {
      const { summary, isWithdrawn } = QuotedMessageSummaryExtractor.extract(
        ChatMessageType.TEXT,
        "水龙头漏水已修好",
        0
      );
      expect(summary).toBe("水龙头漏水已修好");
      expect(isWithdrawn).toBe(false);
    });

    it("超过 30 字符的长文本应截断并附带省略号", () => {
      const longText = "这是一段非常冗长的现场勘测描述记录，详细列举了所有需要更换的五金配件型号以及现场施工的难点事项，请注意核实。";
      const { summary, isWithdrawn } = QuotedMessageSummaryExtractor.extract(
        ChatMessageType.TEXT,
        longText,
        0
      );
      expect(summary.length).toBe(33); // 30 + '...'
      expect(summary.endsWith("...")).toBe(true);
      expect(summary.startsWith("这是一段非常冗长的现场勘测描述记录")).toBe(true);
      expect(isWithdrawn).toBe(false);
    });

    it("图片消息应统一转换为 [现场图片] 摘要", () => {
      const { summary, isWithdrawn } = QuotedMessageSummaryExtractor.extract(
        ChatMessageType.IMAGE,
        "https://oss.campus.edu/photos/sink_01.jpg",
        0
      );
      expect(summary).toBe("[现场图片]");
      expect(isWithdrawn).toBe(false);
    });

    it("工单卡片应统一转换为 [工单协同卡片] 摘要", () => {
      const { summary, isWithdrawn } = QuotedMessageSummaryExtractor.extract(
        ChatMessageType.PATROL_CARD,
        "工单 #5001 [处理中]",
        0
      );
      expect(summary).toBe("[工单协同卡片]");
      expect(isWithdrawn).toBe(false);
    });

    it("系统消息应统一转换为 [系统通知] 摘要", () => {
      const { summary, isWithdrawn } = QuotedMessageSummaryExtractor.extract(
        ChatMessageType.SYSTEM,
        "师傅已接单",
        0
      );
      expect(summary).toBe("[系统通知]");
      expect(isWithdrawn).toBe(false);
    });

    it("被撤回消息应降级为 [原消息已被发信人撤回] 且标记 isWithdrawn = true", () => {
      const { summary, isWithdrawn } = QuotedMessageSummaryExtractor.extract(
        ChatMessageType.TEXT,
        "私密内容",
        1
      );
      expect(summary).toBe("[原消息已被发信人撤回]");
      expect(isWithdrawn).toBe(true);
    });
  });

  describe("2. 算法 2：视口滚动目标计算器 (ViewportScrollTargetCalculator)", () => {
    it("toElementId 应生成合法的前缀规范 ID (msg_${id})", () => {
      expect(ViewportScrollTargetCalculator.toElementId(123)).toBe("msg_123");
      expect(ViewportScrollTargetCalculator.toElementId("456")).toBe("msg_456");
      expect(ViewportScrollTargetCalculator.getTargetElementId(789)).toBe("msg_789");
    });

    it("isTargetInCurrentList 应准确判断目标消息是否存在于当前视口渲染列表", () => {
      const list = [{ id: 10 }, { id: 20 }, { id: 30 }];
      expect(ViewportScrollTargetCalculator.isTargetInCurrentList(list, 20)).toBe(true);
      expect(ViewportScrollTargetCalculator.isTargetInCurrentList(list, "30")).toBe(true);
      expect(ViewportScrollTargetCalculator.isTargetInCurrentList(list, 99)).toBe(false);
      expect(ViewportScrollTargetCalculator.isTargetInCurrentList([], 10)).toBe(false);
    });

    it("calculate 应综合返回视口命中状态与合法元素 ID", () => {
      const list = [{ id: 101 }, { id: 102 }];
      const hit = ViewportScrollTargetCalculator.calculate(102, list);
      expect(hit.inViewport).toBe(true);
      expect(hit.elementId).toBe("msg_102");

      const miss = ViewportScrollTargetCalculator.calculate(999, list);
      expect(miss.inViewport).toBe(false);
      expect(miss.elementId).toBe("msg_999");
    });
  });

  describe("3. 引用消息创建与单层扁平化校验", () => {
    it("正常引用回复：应成功落盘并生成引文摘要卡片", async () => {
      // 1. 发送源消息
      const msgService = new ChatMessageService();
      const originMsg = await msgService.sendMessage(schoolId, creatorId, 0, {
        chatRoomId,
        type: ChatMessageType.TEXT,
        content: "请问水龙头何时能修好？"
      });

      // 2. 师傅长按引用回复
      const quoteRes = await quoteService.sendQuotedMessage(schoolId, handlerId, 1, {
        chatRoomId,
        type: ChatMessageType.TEXT,
        content: "马上就到现场处理",
        answerMessageId: originMsg.messageId
      });

      expect(quoteRes.code).toBe(200);
      expect(quoteRes.data.answerMessageId).toBe(originMsg.messageId);
      expect(quoteRes.data.quotedMessage).toBeDefined();
      expect(quoteRes.data.quotedMessage.id).toBe(originMsg.messageId);
      expect(quoteRes.data.quotedMessage.summary).toBe("请问水龙头何时能修好？");
      expect(quoteRes.data.quotedMessage.isWithdrawn).toBe(false);
    });

    it("扁平化单层引用：引用的消息如果本身是引用消息，新引文只指向该消息本身，不嵌套千层饼", async () => {
      const msgService = new ChatMessageService();
      // 消息 A (根消息)
      const msgA = await msgService.sendMessage(schoolId, creatorId, 0, {
        chatRoomId,
        type: ChatMessageType.TEXT,
        content: "根消息 A"
      });

      // 消息 B 引用 消息 A
      const msgB = await quoteService.sendQuotedMessage(schoolId, handlerId, 1, {
        chatRoomId,
        type: ChatMessageType.TEXT,
        content: "回复消息 B",
        answerMessageId: msgA.messageId
      });

      // 消息 C 引用 消息 B (不应该嵌套消息 A)
      const msgC = await quoteService.sendQuotedMessage(schoolId, creatorId, 0, {
        chatRoomId,
        type: ChatMessageType.TEXT,
        content: "回复消息 C",
        answerMessageId: msgB.data.messageId
      });

      expect(msgC.data.answerMessageId).toBe(msgB.data.messageId);
      expect(msgC.data.quotedMessage.id).toBe(msgB.data.messageId);
      expect(msgC.data.quotedMessage.summary).toBe("回复消息 B");
      // 确保单层扁平化结构，不包含递归的 quotedMessage.quotedMessage
      expect((msgC.data.quotedMessage as any).quotedMessage).toBeUndefined();
    });

    it("引用已撤回的消息：应生成已撤回降级提示，且 isWithdrawn 标记为 true", async () => {
      const msgService = new ChatMessageService();
      const origin = await msgService.sendMessage(schoolId, creatorId, 0, {
        chatRoomId,
        type: ChatMessageType.TEXT,
        content: "这条消息稍后会被撤回"
      });

      // 模拟源消息撤回
      const mockEntity = ChatMessageService.getMockMessage(origin.messageId);
      if (mockEntity) mockEntity.isWithDraw = 1;

      // 引用已撤回消息
      const res = await quoteService.sendQuotedMessage(schoolId, handlerId, 1, {
        chatRoomId,
        type: ChatMessageType.TEXT,
        content: "刚才发了什么没看清",
        answerMessageId: origin.messageId
      });

      expect(res.code).toBe(200);
      expect(res.data.quotedMessage.summary).toBe("[原消息已被发信人撤回]");
      expect(res.data.quotedMessage.isWithdrawn).toBe(true);
    });
  });

  describe("4. 安全防御机制与边界拦截", () => {
    it("跨房间引用攻击防御：引用另一个房间的消息应直接拦截并报错", async () => {
      // 建立另一个房间
      const otherRoomId = 502;
      ChatRoomService.seedMockRoom({
        id: otherRoomId,
        schoolId,
        patrolId: 5002,
        creatorId: 102,
        handlerId: 202
      });

      const msgService = new ChatMessageService();
      const otherMsg = await msgService.sendMessage(schoolId, 102, 0, {
        chatRoomId: otherRoomId,
        type: ChatMessageType.TEXT,
        content: "隔壁房间的敏感对话"
      });

      // 试图在当前房间引用 otherRoom 的消息
      await expect(
        quoteService.sendQuotedMessage(schoolId, handlerId, 1, {
          chatRoomId, // 当前房间
          type: ChatMessageType.TEXT,
          content: "跨房间套取引文",
          answerMessageId: otherMsg.messageId // 属于 otherRoom
        })
      ).rejects.toThrow("越权阻断: 禁止跨会话室引用其他房间的消息");
    });

    it("引用不存在的消息 ID 应直接报错", async () => {
      await expect(
        quoteService.sendQuotedMessage(schoolId, handlerId, 1, {
          chatRoomId,
          type: ChatMessageType.TEXT,
          content: "引用空气",
          answerMessageId: 999999
        })
      ).rejects.toThrow("被引用的源消息不存在或已被清理");
    });

    it("DFA 敏感词拦截：回复内容若包含暴恐违规词汇应被拒绝发送", async () => {
      const msgService = new ChatMessageService();
      const origin = await msgService.sendMessage(schoolId, creatorId, 0, {
        chatRoomId,
        type: ChatMessageType.TEXT,
        content: "正常提问"
      });

      await expect(
        quoteService.sendQuotedMessage(schoolId, handlerId, 1, {
          chatRoomId,
          type: ChatMessageType.TEXT,
          content: "回复内容包含炸弹等违规词",
          answerMessageId: origin.messageId
        })
      ).rejects.toThrow("回复内容包含严重违规词汇，已被系统拦截！");
    });
  });

  describe("5. 算法 3：极远历史记录对称上下文切片拉取 (queryContextSlice)", () => {
    it("连续注入 30 条消息时，以第 15 条为锚点拉取窗口大小为 10 的切片", async () => {
      const msgService = new ChatMessageService();
      const createdIds: number[] = [];

      // 连续发送 30 条消息
      for (let i = 1; i <= 30; i++) {
        const m = await msgService.sendMessage(schoolId, creatorId, 0, {
          chatRoomId,
          type: ChatMessageType.TEXT,
          content: `协同消息 #${i}`
        });
        createdIds.push(m.messageId);
      }

      const anchorId = createdIds[14]; // 第 15 条消息
      const sliceResult = await quoteService.queryContextSlice(schoolId, chatRoomId, anchorId, 10);

      expect(sliceResult.anchorMessageId).toBe(anchorId);
      expect(sliceResult.messages.length).toBeGreaterThan(0);
      expect(sliceResult.messages.length).toBeLessThanOrEqual(11); // halfTop(5) + anchor(1) + halfBottom(5)

      // 检查锚点是否在返回列表中
      const hasAnchor = sliceResult.messages.some((m) => m.id === anchorId);
      expect(hasAnchor).toBe(true);

      // 上下文均有更早和更新的消息
      expect(sliceResult.hasMoreOlder).toBe(true);
      expect(sliceResult.hasMoreNewer).toBe(true);
    });

    it("若锚点消息不存在，应报错提示", async () => {
      await expect(
        quoteService.queryContextSlice(schoolId, chatRoomId, 888888, 20)
      ).rejects.toThrow("指定的锚点源消息不存在");
    });
  });

  describe("6. 批量注水：populateQuotesForMessages", () => {
    it("应为多条带有 answerMessageId 的消息批量填充 quotedMessage", async () => {
      const msgService = new ChatMessageService();
      const msg1 = await msgService.sendMessage(schoolId, creatorId, 0, {
        chatRoomId,
        type: ChatMessageType.TEXT,
        content: "源消息 1"
      });
      const msg2 = await msgService.sendMessage(schoolId, handlerId, 1, {
        chatRoomId,
        type: ChatMessageType.IMAGE,
        content: "https://oss.campus.edu/photo.jpg"
      });

      const reply1 = await quoteService.sendQuotedMessage(schoolId, handlerId, 1, {
        chatRoomId,
        type: ChatMessageType.TEXT,
        content: "回复 1",
        answerMessageId: msg1.messageId
      });
      const reply2 = await quoteService.sendQuotedMessage(schoolId, creatorId, 0, {
        chatRoomId,
        type: ChatMessageType.TEXT,
        content: "回复 2",
        answerMessageId: msg2.messageId
      });

      // 从历史接口拉取
      const history = await msgService.queryHistoryMessages(schoolId, creatorId, chatRoomId, 0, 10);
      expect(history.messages.length).toBeGreaterThanOrEqual(4);

      const foundReply1 = history.messages.find((m) => m.id === reply1.data.messageId);
      expect(foundReply1?.quotedMessage).toBeDefined();
      expect(foundReply1?.quotedMessage?.id).toBe(msg1.messageId);
      expect(foundReply1?.quotedMessage?.summary).toBe("源消息 1");

      const foundReply2 = history.messages.find((m) => m.id === reply2.data.messageId);
      expect(foundReply2?.quotedMessage).toBeDefined();
      expect(foundReply2?.quotedMessage?.id).toBe(msg2.messageId);
      expect(foundReply2?.quotedMessage?.summary).toBe("[现场图片]");
    });
  });

  describe("7. 控制器与 HTTP API 端点检验", () => {
    it("ChatQuoteController.sendQuote 成功处理", async () => {
      const msgService = new ChatMessageService();
      const origin = await msgService.sendMessage(schoolId, creatorId, 0, {
        chatRoomId,
        type: ChatMessageType.TEXT,
        content: "准备控制器测试"
      });

      const ctx: any = {
        schoolId,
        userId: handlerId,
        userRole: 1,
        body: {
          chatRoomId,
          type: 0,
          content: "控制器测试回复",
          answerMessageId: origin.messageId,
          clientMsgId: "CLI_123"
        }
      };

      const result = await quoteController.handleSendQuote(ctx);
      expect(result.status).toBe(1);
      expect(result.data.quotedMessage).toBeDefined();
      expect(result.data.quotedMessage.summary).toBe("准备控制器测试");
    });

    it("ChatQuoteController.sendQuote 参数缺失时拒绝", async () => {
      const ctx: any = {
        schoolId,
        userId: handlerId,
        userRole: 1,
        body: {
          chatRoomId,
          // 缺少 answerMessageId
          content: "内容"
        }
      };

      const result = await quoteController.handleSendQuote(ctx);
      expect(result.status).toBe(0);
      expect(result.content).toContain("answerMessageId");
    });

    it("ChatQuoteController.getContextSlice 切片接口处理", async () => {
      const msgService = new ChatMessageService();
      const origin = await msgService.sendMessage(schoolId, creatorId, 0, {
        chatRoomId,
        type: ChatMessageType.TEXT,
        content: "切片测试锚点"
      });

      const ctx: any = {
        schoolId,
        userId: handlerId,
        userRole: 1,
        query: {
          chatRoomId: String(chatRoomId),
          anchorMessageId: String(origin.messageId),
          windowSize: "10"
        }
      };

      const result = await quoteController.handleGetContextSlice(ctx);
      expect(result.status).toBe(1);
      expect(result.data.anchorMessageId).toBe(origin.messageId);
      expect(result.data.messages.length).toBeGreaterThan(0);
    });
  });
});
