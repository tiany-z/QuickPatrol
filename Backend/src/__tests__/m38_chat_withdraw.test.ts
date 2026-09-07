/**
 * 高校后勤巡查e速办 v4.0 - M38: 类 QQ 2分钟消息撤回与审计存根测试套件
 * (Message Withdrawal & Audit Stub Test Suite)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ChatWithdrawService } from "../apps/chat/chatWithdrawService.js";
import { ChatWithdrawController } from "../apps/chat/chatWithdrawController.js";
import { ChatAuditController } from "../apps/chat/chatAuditController.js";
import { WithdrawalTimeWindowEvaluator } from "../apps/chat/withdrawalTimeWindowEvaluator.js";
import { ChatMessageType, WithdrawOperatorType, IChatMessageEntity } from "../apps/chat/chatWithdrawTypes.js";
import { BubbleInPlaceMutationMachine, ILocalBubbleModel } from "../apps/chat/bubbleInPlaceMutationMachine.js";
import { ChatMessageService } from "../apps/chat/chatMessageService.js";
import { ChatRoomService } from "../apps/chat/chatRoomService.js";
import { TestHarness } from "./testHarness.js";

describe("[M38] 类 QQ 2分钟消息撤回与审计存根中枢测试套件", () => {
  const schoolId = 1;
  const chatRoomId = 501;

  let withdrawService: ChatWithdrawService;
  let mockDb: any;
  let mockRedis: any;
  let fakeMessages: IChatMessageEntity[];
  let fakeLogs: any[];
  let fakeRoom: any;

  beforeEach(() => {
    TestHarness.resetSandbox();

    fakeMessages = [
      {
        id: 101,
        schoolId,
        chatRoomId,
        senderId: 88,
        senderRole: 0,
        type: ChatMessageType.TEXT,
        content: "张师傅，我填错宿舍号了，是 302 不是 301",
        answerMessageId: 0,
        isWithDraw: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 102,
        schoolId,
        chatRoomId,
        senderId: 88,
        senderRole: 0,
        type: ChatMessageType.TEXT,
        content: "这条是 10 分钟前发的超时消息",
        answerMessageId: 0,
        isWithDraw: 0,
        createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10分钟前
      }
    ];

    fakeLogs = [];
    fakeRoom = {
      id: chatRoomId,
      schoolId,
      lastMessage: "这条是 10 分钟前发的超时消息",
      lastMessageAt: new Date().toISOString(),
      creatorUnreadCount: 0,
      handlerUnreadCount: 2
    };

    mockDb = {
      query: vi.fn(async (sql: string, params: any[] = []) => {
        if (sql.includes("FROM chat_messages") && sql.includes("FOR UPDATE")) {
          return fakeMessages.filter(
            (m) => m.id === params[0] && m.schoolId === params[1] && m.chatRoomId === params[2]
          );
        }
        if (sql.includes("SELECT id, type, content, createdAt") && sql.includes("FROM chat_messages")) {
          // 探针查询上一条未撤回消息
          return fakeMessages
            .filter((m) => m.id !== params[2] && m.schoolId === params[0] && m.chatRoomId === params[1] && m.isWithDraw === 0)
            .sort((a, b) => b.id - a.id);
        }
        if (sql.includes("FROM users") && sql.includes("nickName")) {
          return [{ nickName: "测试同学" }];
        }
        if (sql.includes("FROM chat_messages m") && sql.includes("operation_logs")) {
          return fakeMessages
            .filter((m) => m.schoolId === params[0] && m.isWithDraw === 1)
            .map((m) => {
              const l = fakeLogs.find((log) => log[3] === m.id);
              return {
                messageId: m.id,
                chatRoomId: m.chatRoomId,
                originalType: m.type,
                originalContent: m.content,
                sentAt: m.createdAt,
                senderId: m.senderId,
                senderName: "测试同学",
                senderNo: "2024001",
                senderRole: m.senderRole,
                operatorId: l ? l[4] : m.senderId,
                operatorName: l && l[5] === 4 ? "安全管理员" : "测试同学",
                operatorRole: l ? l[5] : m.senderRole,
                auditAction: l ? l[2] : "MESSAGE_WITHDRAW",
                withdrawnAt: new Date().toISOString(),
                clientIp: l ? l[6] : "127.0.0.1",
                snapshotPayload: l ? l[8] : null
              };
            });
        }
        return [];
      }),
      execute: vi.fn(async (sql: string, params: any[] = []) => {
        if (sql.includes("UPDATE chat_messages") && sql.includes("isWithDraw = 1")) {
          const target = fakeMessages.find((m) => m.id === params[0]);
          if (target) target.isWithDraw = 1;
          return { insertId: 0, affectedRows: 1 };
        }
        if (sql.includes("INSERT INTO operation_logs")) {
          fakeLogs.push(params);
          return { insertId: fakeLogs.length, affectedRows: 1 };
        }
        if (sql.includes("UPDATE chat_rooms") && sql.includes("lastMessage =")) {
          fakeRoom.lastMessage = params[0];
          fakeRoom.lastMessageAt = params[1];
          return { insertId: 0, affectedRows: 1 };
        }
        if (sql.includes("UPDATE chat_rooms") && sql.includes("handlerUnreadCount =")) {
          fakeRoom.handlerUnreadCount = Math.max(0, fakeRoom.handlerUnreadCount - 1);
          return { insertId: 0, affectedRows: 1 };
        }
        if (sql.includes("UPDATE chat_rooms") && sql.includes("creatorUnreadCount =")) {
          fakeRoom.creatorUnreadCount = Math.max(0, fakeRoom.creatorUnreadCount - 1);
          return { insertId: 0, affectedRows: 1 };
        }
        return { insertId: 0, affectedRows: 1 };
      })
    };

    mockRedis = {
      eval: vi.fn().mockResolvedValue(1),
      publish: vi.fn().mockResolvedValue(1)
    };

    withdrawService = new ChatWithdrawService(mockDb, mockRedis);
  });

  // ==========================================
  // 1. 核心撤回业务流程测试
  // ==========================================
  it("[M38-01] 发信人 120 秒内撤回消息，断言逻辑置位、审计留痕、未读消除与 WS 广播", async () => {
    const res = await withdrawService.withdrawMessage(
      schoolId,
      88,
      0,
      { messageId: 101, chatRoomId },
      "192.168.1.100",
      "WeChat-MiniProgram"
    );

    expect(res.code).toBe(200);
    expect(res.data.isWithDraw).toBe(true);
    expect(res.data.reEditable).toBe(true);
    expect(res.data.originalText).toBe("张师傅，我填错宿舍号了，是 302 不是 301");
    expect(res.data.operatorType).toBe(WithdrawOperatorType.SENDER_SELF);

    // 断言数据库置位: isWithDraw 改为 1，原 content 绝对保留
    expect(fakeMessages[0].isWithDraw).toBe(1);
    expect(fakeMessages[0].content).toBe("张师傅，我填错宿舍号了，是 302 不是 301");

    // 断言审计日志 operation_logs 入库
    expect(fakeLogs.length).toBe(1);
    expect(fakeLogs[0][1]).toBe("CHAT_IM");
    expect(fakeLogs[0][2]).toBe("MESSAGE_WITHDRAW");
    expect(fakeLogs[0][3]).toBe(101); // targetId
    expect(fakeLogs[0][4]).toBe(88);  // operatorId
    const snapshot = JSON.parse(fakeLogs[0][8]);
    expect(snapshot.originalContent).toBe("张师傅，我填错宿舍号了，是 302 不是 301");

    // 断言未读数安全递减 (-1 纠偏)
    expect(fakeRoom.handlerUnreadCount).toBe(1);

    // 断言已发布 Redis / WS 广播
    expect(mockRedis.eval).toHaveBeenCalled();
  });

  it("[M38-02] 尝试撤回已发送 10 分钟的超时消息，断言抛出时限阻断异常", async () => {
    await expect(
      withdrawService.withdrawMessage(schoolId, 88, 0, {
        messageId: 102,
        chatRoomId
      })
    ).rejects.toThrow("无法撤回");

    // 状态保持不变
    expect(fakeMessages[1].isWithDraw).toBe(0);
    expect(fakeLogs.length).toBe(0);
  });

  it("[M38-03] 非发信人且非管理员尝试撤回他人消息，断言抛出越权 403 异常", async () => {
    await expect(
      withdrawService.withdrawMessage(schoolId, 999, 0, { // 操作人 999 并非发信人 88
        messageId: 101,
        chatRoomId
      })
    ).rejects.toThrow("操作权限不足: 仅发送人本人或学校安全管理员有权撤回该消息");

    expect(fakeMessages[0].isWithDraw).toBe(0);
  });

  it("[M38-04] 学校管理员 (Role 4) 越级撤回超期违规消息，断言成功且记录 ADMIN_FORCE 存根", async () => {
    const adminRes = await withdrawService.withdrawMessage(
      schoolId,
      9001,
      4, // Role 4 管理员
      {
        messageId: 102,
        chatRoomId,
        adminReason: "涉嫌严重违规涉敏广告"
      },
      "10.0.0.1"
    );

    expect(adminRes.code).toBe(200);
    expect(adminRes.data.operatorType).toBe(WithdrawOperatorType.ADMIN_FORCE);
    expect(adminRes.data.reEditable).toBe(false); // 管理员越级撤回不提供普通重新编辑
    expect(fakeMessages[1].isWithDraw).toBe(1);

    // 断言审计日志动作类型为 ADMIN_FORCE_WITHDRAW
    expect(fakeLogs.length).toBe(1);
    expect(fakeLogs[0][2]).toBe("ADMIN_FORCE_WITHDRAW");
    const snapshot = JSON.parse(fakeLogs[0][8]);
    expect(snapshot.adminReason).toBe("涉嫌严重违规涉敏广告");
  });

  it("[M38-05] 并发/重复撤回幂等性断言：若消息已撤回，直接返回 200 提示且不重复写日志", async () => {
    // 第一次撤回
    await withdrawService.withdrawMessage(schoolId, 88, 0, { messageId: 101, chatRoomId });
    expect(fakeLogs.length).toBe(1);
    expect(fakeRoom.handlerUnreadCount).toBe(1);

    // 第二次并发/重试撤回
    const retryRes = await withdrawService.withdrawMessage(schoolId, 88, 0, { messageId: 101, chatRoomId });
    expect(retryRes.code).toBe(200);
    expect(retryRes.message).toBe("该消息已处于撤回状态");
    expect(retryRes.data.isWithDraw).toBe(true);

    // 审计日志未增加，未读数未再次扣减
    expect(fakeLogs.length).toBe(1);
    expect(fakeRoom.handlerUnreadCount).toBe(1);
  });

  // ==========================================
  // 2. 算法 2: 会话最新摘要自愈倒退与历史重探
  // ==========================================
  it("[M38-06] 算法 2：撤回会话最新一条消息时，自动探针回溯上一条有效消息摘要", async () => {
    fakeMessages = [
      {
        id: 200,
        schoolId,
        chatRoomId,
        senderId: 88,
        senderRole: 0,
        type: ChatMessageType.TEXT,
        content: "最早的一条消息",
        answerMessageId: 0,
        isWithDraw: 0,
        createdAt: new Date(Date.now() - 60000).toISOString()
      },
      {
        id: 201,
        schoolId,
        chatRoomId,
        senderId: 88,
        senderRole: 0,
        type: ChatMessageType.TEXT,
        content: "张师傅，我填错宿舍号了，是 302 不是 301",
        answerMessageId: 0,
        isWithDraw: 0,
        createdAt: new Date(Date.now() - 30000).toISOString()
      },
      {
        id: 202,
        schoolId,
        chatRoomId,
        senderId: 88,
        senderRole: 0,
        type: ChatMessageType.IMAGE,
        content: "https://oss.campus.edu/pic.jpg",
        answerMessageId: 0,
        isWithDraw: 0,
        createdAt: new Date().toISOString()
      }
    ];

    // 撤回该图片消息 (202)
    await withdrawService.withdrawMessage(schoolId, 88, 0, { messageId: 202, chatRoomId });

    // 断言 chat_rooms.lastMessage 回退到了上一条有效消息 (201) 的文本内容
    expect(fakeRoom.lastMessage).toBe("张师傅，我填错宿舍号了，是 302 不是 301");
  });

  it("[M38-07] 算法 2：当会话中所有消息均已被撤回时，摘要优雅回退为 '[消息已撤回]'", async () => {
    // 将所有消息均置为已撤回
    fakeMessages.forEach((m) => {
      m.isWithDraw = 1;
    });

    const rollback = await withdrawService.resolveSessionSummaryRollback(schoolId, chatRoomId, 101);
    expect(rollback.lastMessage).toBe("[消息已撤回]");
    expect(fakeRoom.lastMessage).toBe("[消息已撤回]");
  });

  // ==========================================
  // 3. 算法 3: 接收方未读计数器原子纠偏
  // ==========================================
  it("[M38-08] 算法 3：师傅发信被撤回扣减 creatorUnreadCount，师生发信被撤回扣减 handlerUnreadCount", async () => {
    fakeRoom.creatorUnreadCount = 3;
    fakeRoom.handlerUnreadCount = 2;

    // 师傅发信 (senderRole = 1) -> 影响 creatorUnreadCount
    await withdrawService.decrementReceiverUnreadCount(schoolId, chatRoomId, 1);
    expect(fakeRoom.creatorUnreadCount).toBe(2);

    // 师生发信 (senderRole = 0) -> 影响 handlerUnreadCount
    await withdrawService.decrementReceiverUnreadCount(schoolId, chatRoomId, 0);
    expect(fakeRoom.handlerUnreadCount).toBe(1);

    // 未读数为 0 时再次递减不变成负数
    fakeRoom.handlerUnreadCount = 0;
    await withdrawService.decrementReceiverUnreadCount(schoolId, chatRoomId, 0);
    expect(fakeRoom.handlerUnreadCount).toBe(0);
  });

  // ==========================================
  // 4. 算法 1: 时间窗口判定器边界与容差
  // ==========================================
  describe("[M38-09] 算法 1：高精度分布式服务器时间差判定算法", () => {
    it("60 秒内的正常消息判定允许撤回", () => {
      const created = new Date(Date.now() - 60 * 1000);
      const evalRes = WithdrawalTimeWindowEvaluator.evaluate(created, new Date());
      expect(evalRes.allowed).toBe(true);
      expect(evalRes.deltaSeconds).toBeGreaterThanOrEqual(59);
    });

    it("120 秒临界点 + 3 秒网络补偿因子内判定允许撤回 (122 秒)", () => {
      const created = new Date(Date.now() - 122 * 1000);
      const evalRes = WithdrawalTimeWindowEvaluator.evaluate(created, new Date());
      expect(evalRes.allowed).toBe(true);
    });

    it("超过 123 秒严格阻断", () => {
      const created = new Date(Date.now() - 124 * 1000);
      const evalRes = WithdrawalTimeWindowEvaluator.evaluate(created, new Date());
      expect(evalRes.allowed).toBe(false);
      expect(evalRes.reason).toContain("允许上限 120 秒");
    });

    it("负向时间差超过 5 秒（严重时钟漂移/未来时间穿越）判定非法", () => {
      const future = new Date(Date.now() + 10000); // 未来 10 秒
      const evalRes = WithdrawalTimeWindowEvaluator.evaluate(future, new Date());
      expect(evalRes.allowed).toBe(false);
      expect(evalRes.reason).toContain("时间戳超前");
    });

    it("校级管理员特权通道一律豁免时限", () => {
      const oldTime = new Date(Date.now() - 3600 * 1000); // 1 小时前
      const evalRes = WithdrawalTimeWindowEvaluator.evaluate(oldTime, new Date(), true);
      expect(evalRes.allowed).toBe(true);
      expect(evalRes.deltaSeconds).toBe(0);
    });
  });

  // ==========================================
  // 5. 算法 4: 客户端气泡原地置换状态机
  // ==========================================
  describe("[M38-10] 算法 4：客户端本地气泡就地重铸与动效状态机", () => {
    it("发信人收到自己撤回的文本信令，原地展示'你撤回了一条消息'并赋予重新编辑能力", () => {
      const localList: ILocalBubbleModel[] = [
        {
          id: 5001,
          type: 0,
          content: "这是刚发的一条文字",
          isSelf: true,
          isWithDraw: 0
        },
        {
          id: 5002,
          type: 1,
          content: "https://oss.campus.edu/a.png",
          isSelf: false,
          isWithDraw: 0
        }
      ];

      const { updatedList, hitIndex } = BubbleInPlaceMutationMachine.mutate(
        localList,
        5001,
        88,
        88, // 当前用户是 88，操作人也是 88
        "这是刚发的一条文字",
        false
      );

      expect(hitIndex).toBe(0);
      expect(updatedList[0].isWithDraw).toBe(1);
      expect(updatedList[0].content).toBe("你撤回了一条消息");
      expect(updatedList[0].canReEdit).toBe(true);
      expect(updatedList[0].originalText).toBe("这是刚发的一条文字");
      // 未被撤回的其他消息不受影响
      expect(updatedList[1].isWithDraw).toBe(0);
    });

    it("收信方收到对方撤回信令，原地展示'对方撤回了一条消息'且不可重新编辑", () => {
      const localList: ILocalBubbleModel[] = [
        {
          id: 5001,
          type: 0,
          content: "这是对方发的一条文字",
          isSelf: false,
          isWithDraw: 0
        }
      ];

      const { updatedList, hitIndex } = BubbleInPlaceMutationMachine.mutate(
        localList,
        5001,
        88,
        99, // 当前用户是 99 (收信人)，操作人是 88
        undefined,
        false
      );

      expect(hitIndex).toBe(0);
      expect(updatedList[0].content).toBe("对方撤回了一条消息");
      expect(updatedList[0].canReEdit).toBe(false);
    });

    it("收到管理员强制熔断信令，展示'【系统管理员】撤回了一条违规消息'", () => {
      const localList: ILocalBubbleModel[] = [
        {
          id: 5001,
          type: 0,
          content: "违规言论",
          isSelf: false,
          isWithDraw: 0
        }
      ];

      const { updatedList } = BubbleInPlaceMutationMachine.mutate(
        localList,
        5001,
        9001,
        99,
        undefined,
        true // isSystemRecall
      );

      expect(updatedList[0].content).toBe("【系统管理员】撤回了一条违规消息");
    });
  });

  // ==========================================
  // 6. 安全审计存根调阅端点测试 (ChatAuditController)
  // ==========================================
  describe("[M38-11] 安全审计存根调阅端点权限与数据输出", () => {
    let auditController: ChatAuditController;

    beforeEach(() => {
      auditController = new ChatAuditController(mockDb);
    });

    it("非校级管理员 (Role != 4) 调阅存根，阻断并返回 403 越权拒绝", async () => {
      const res = await auditController.getWithdrawnAuditStubs({
        schoolId,
        userId: 88,
        userRole: 0, // 普通学生
        query: { chatRoomId: "501" }
      });

      expect(res.code).toBe(403);
      expect(res.message).toContain("越权拒绝");
    });

    it("校级安全管理员 (Role 4) 调阅存根成功，返回已撤回消息明细与操作快照", async () => {
      // 先让 101 处于撤回状态
      fakeMessages[0].isWithDraw = 1;
      fakeLogs.push([
        schoolId,
        "CHAT_IM",
        "MESSAGE_WITHDRAW",
        101,
        88,
        0,
        "192.168.1.100",
        "WeChat",
        JSON.stringify({ originalContent: "原消息" })
      ]);

      const res = await auditController.getWithdrawnAuditStubs({
        schoolId,
        userId: 9001,
        userRole: 4, // 管理员
        query: { chatRoomId: "501", page: "1", pageSize: "10" }
      });

      expect(res.code).toBe(200);
      expect(res.data.records.length).toBe(1);
      const record = res.data.records[0];
      expect(record.messageId).toBe(101);
      expect(record.originalContent).toBe("张师傅，我填错宿舍号了，是 302 不是 301");
      expect(record.sender.name).toBe("测试同学");
      expect(record.operatorType).toBe(WithdrawOperatorType.SENDER_SELF);
    });
  });

  // ==========================================
  // 7. HTTP 控制器端点测试 (ChatWithdrawController)
  // ==========================================
  describe("[M38-12] HTTP 控制器层请求洗炼与 StandardResult 包装", () => {
    let controller: ChatWithdrawController;

    beforeEach(() => {
      controller = new ChatWithdrawController(withdrawService);
    });

    it("缺少 messageId 或 chatRoomId 时返回 400 校验错误", async () => {
      const res1 = await controller.withdraw({
        schoolId,
        userId: 88,
        userRole: 0,
        ip: "127.0.0.1",
        body: { chatRoomId: 501 } // 缺少 messageId
      });
      expect(res1.code).toBe(400);

      const res2 = await controller.withdraw({
        schoolId,
        userId: 88,
        userRole: 0,
        ip: "127.0.0.1",
        body: { messageId: 101 } // 缺少 chatRoomId
      });
      expect(res2.code).toBe(400);
    });

    it("正常调用 handleWithdraw 返回 status === 1 的 StandardResult", async () => {
      const stdRes = await controller.handleWithdraw({
        schoolId,
        userId: 88,
        userRole: 0,
        ip: "127.0.0.1",
        body: { messageId: 101, chatRoomId: 501 }
      });

      expect(stdRes.status).toBe(1);
      expect(stdRes.data?.isWithDraw).toBe(true);
      expect(stdRes.data?.reEditable).toBe(true);
    });

    it("非管理员调用 adminForceWithdraw 返回 403 阻断", async () => {
      const adminRes = await controller.adminForceWithdraw({
        schoolId,
        userId: 88,
        userRole: 0, // 非管理员
        ip: "127.0.0.1",
        body: { messageId: 102, chatRoomId: 501 }
      });

      expect(adminRes.code).toBe(403);
      expect(adminRes.message).toContain("仅校级安全管理员有权");
    });
  });

  // ==========================================
  // 8. 内存沙箱模式独立运行测试
  // ==========================================
  it("[M38-13] 内存沙箱模式下执行撤回、自愈、审计与未读递减全链路自洽", async () => {
    // 使用纯沙箱服务 (无 customDb)
    const sandboxService = new ChatWithdrawService();

    // 在 ChatMessageService 沙箱中放入一条消息
    ChatMessageService.setMockMessage(8801, {
      id: 8801,
      schoolId: 2,
      chatRoomId: 901,
      senderId: 77,
      senderRole: 1, // 师傅发信
      type: ChatMessageType.TEXT,
      content: "同学，水管修好了",
      answerMessageId: 0,
      isWithDraw: 0,
      createdAt: new Date().toISOString()
    });

    // 放入房间
    ChatRoomService.setMockRoom(901, {
      id: 901,
      schoolId: 2,
      patrolId: 1001,
      creatorId: 55,
      handlerId: 77,
      status: 1,
      isClosed: 0,
      lastMessage: "同学，水管修好了",
      lastMessageAt: new Date().toISOString(),
      creatorUnreadCount: 1,
      handlerUnreadCount: 0
    });

    const res = await sandboxService.withdrawMessage(2, 77, 1, {
      messageId: 8801,
      chatRoomId: 901
    });

    expect(res.code).toBe(200);
    expect(res.data.isWithDraw).toBe(true);

    // 校验沙箱房间状态
    const room = ChatRoomService.getMockRoom(901);
    expect(room?.creatorUnreadCount).toBe(0); // 师傅发信被撤回 -> 师生未读清零
    expect(room?.lastMessage).toBe("[消息已撤回]"); // 唯一消息被撤回后自愈回滚

    // 校验审计日志
    const logs = ChatWithdrawService.getMockLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].targetId).toBe(8801);
  });
});
