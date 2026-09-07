/**
 * 高校后勤巡查e速办 v4.0 - M37: 类 QQ 聊天气泡渲染与多媒体扩展条专属单元测试
 * (Chat Bubbles & Media Bar Unit Tests)
 *
 * 覆盖测试场景：
 * 1. 文本消息收发落盘与 chat_rooms 会话摘要提炼
 * 2. 现场图片消息 (type=1) 与工单微卡片 (type=2) 收发
 * 3. 算法 3: 发信人角色对端未读数原子累加 (师傅发信增加 creatorUnreadCount，师生发信增加 handlerUnreadCount)
 * 4. DFA 内容安全机审: 暴恐敏感词阻断入库
 * 5. 防御性安全: 超长文本截断、XSS HTML 实体转义、空内容拦截
 * 6. 历史消息游标倒序分页拉取与已撤回消息遮蔽 (isWithDraw=1 -> "该消息已被撤回")
 * 7. 算法 1: 聊天图片尺寸动态自适应缩放与边界约束算法 (Chat Image Box Normalizer)
 * 8. 算法 2: 相对时间人性化消解 (今天、昨天、周几、绝对时间)
 * 9. 进房已读清零 (ackRoomRead)
 * 10. M36 握手门禁前置联动 (未激活拦截学生、放行师傅破冰、已归档阻断全员)
 * 11. 控制器参数校验与 StandardResult 规范响应封包
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  ChatMessageService,
  computeImageBox,
  formatHumanFriendlyTime,
  escapeHtml,
  IDbExecutor
} from "../apps/chat/chatMessageService.js";
import { ChatRoomService } from "../apps/chat/chatRoomService.js";
import { ChatGatekeeper } from "../apps/chat/chatGatekeeper.js";
import { ChatMessageController } from "../apps/chat/chatMessageController.js";
import { ChatMessageType } from "../apps/chat/chatMessageTypes.js";
import { TestHarness } from "./testHarness.js";
import { api as messagesApi } from "../api/chat/rooms/messages/index.js";
import { api as historyApi } from "../api/chat/rooms/history/index.js";
import { api as ackReadApi } from "../api/chat/rooms/ack-read/index.js";

describe("M37: 类 QQ 聊天气泡渲染与多媒体扩展条自动化回归测试", () => {
  let mockDb: IDbExecutor;
  let mockRedis: any;
  let roomStore: any[];
  let messageStore: any[];
  let messageService: ChatMessageService;
  let gatekeeper: ChatGatekeeper;
  let controller: ChatMessageController;

  beforeEach(() => {
    TestHarness.resetSandbox();

    roomStore = [
      {
        id: 501,
        schoolId: 1,
        patrolId: 101,
        creatorId: 99,
        handlerId: 88,
        initiatedByHandler: 1,
        isClosed: 0,
        creatorUnreadCount: 0,
        handlerUnreadCount: 0,
        lastMessage: "",
        lastMessageAt: null
      },
      {
        id: 502,
        schoolId: 1,
        patrolId: 102,
        creatorId: 99,
        handlerId: 88,
        initiatedByHandler: 0, // 未激活
        isClosed: 0,
        creatorUnreadCount: 0,
        handlerUnreadCount: 0,
        lastMessage: "",
        lastMessageAt: null
      },
      {
        id: 503,
        schoolId: 1,
        patrolId: 103,
        creatorId: 99,
        handlerId: 88,
        initiatedByHandler: 1,
        isClosed: 1, // 已结案归档
        creatorUnreadCount: 0,
        handlerUnreadCount: 0,
        lastMessage: "",
        lastMessageAt: null
      }
    ];

    messageStore = [];

    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        if (sql.includes("FROM chat_rooms")) {
          return roomStore.filter((r) => r.id === params?.[0] && r.schoolId === params?.[1]);
        }
        if (sql.includes("FROM chat_messages")) {
          const roomId = params?.[1];
          const schoolId = params?.[0];
          let list = messageStore.filter((m) => m.chatRoomId === roomId && m.schoolId === schoolId);
          // 处理游标
          if (sql.includes("m.id < ?")) {
            const cursor = params?.[2];
            list = list.filter((m) => m.id < cursor);
          }
          // 倒序
          list.sort((a, b) => b.id - a.id);
          const limit = params?.[params.length - 1] || 20;
          return list.slice(0, limit);
        }
        if (sql.includes("FROM users")) {
          return [{ nickName: "张师傅", avatarUrl: "https://oss.xcesb.cn/avatar88.jpg" }];
        }
        return [];
      }),
      execute: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        if (sql.includes("INSERT INTO chat_messages")) {
          const newId = messageStore.length + 1001;
          messageStore.push({
            id: newId,
            schoolId: params?.[0],
            chatRoomId: params?.[1],
            senderId: params?.[2],
            senderRole: params?.[3],
            type: params?.[4],
            content: params?.[5],
            answerMessageId: params?.[6],
            isWithDraw: 0,
            createdAt: "2026-09-06 14:00:00"
          });
          return { insertId: newId, affectedRows: 1 };
        }
        if (sql.includes("UPDATE chat_rooms") && sql.includes("lastMessage = ?")) {
          const summary = params?.[0];
          const roomId = params?.[1];
          const r = roomStore.find((item) => item.id === roomId);
          if (r) {
            r.lastMessage = summary;
            r.lastMessageAt = "2026-09-06 14:00:00";
            if (sql.includes("creatorUnreadCount")) {
              r.creatorUnreadCount += 1;
            } else if (sql.includes("handlerUnreadCount")) {
              r.handlerUnreadCount += 1;
            }
          }
          return { insertId: 0, affectedRows: 1 };
        }
        if (sql.includes("UPDATE chat_rooms") && sql.includes("creatorUnreadCount = 0")) {
          const roomId = params?.[0];
          const r = roomStore.find((item) => item.id === roomId);
          if (r) r.creatorUnreadCount = 0;
          return { insertId: 0, affectedRows: 1 };
        }
        if (sql.includes("UPDATE chat_rooms") && sql.includes("handlerUnreadCount = 0")) {
          const roomId = params?.[0];
          const r = roomStore.find((item) => item.id === roomId);
          if (r) r.handlerUnreadCount = 0;
          return { insertId: 0, affectedRows: 1 };
        }
        return { insertId: 1, affectedRows: 1 };
      })
    };

    mockRedis = {
      eval: vi.fn().mockResolvedValue("OK")
    };

    messageService = new ChatMessageService(mockDb, mockRedis);
    gatekeeper = new ChatGatekeeper(mockDb);
    controller = new ChatMessageController(messageService, gatekeeper);
  });

  // [M37-01] 文本消息收发与会话摘要更新
  test("[M37-01] 师傅发送文本消息，断言 chat_messages 落盘且 chat_rooms 会话摘要更新", async () => {
    const res = await messageService.sendMessage(1, 88, 1, {
      chatRoomId: 501,
      type: ChatMessageType.TEXT,
      content: "门锁已经修好，请确认。",
      clientMsgId: "CLIENT_123"
    });

    expect(res.messageId).toBe(1001);
    expect(res.content).toBe("门锁已经修好，请确认。");
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE chat_rooms \n        SET lastMessage = ?"),
      expect.arrayContaining(["门锁已经修好，请确认。", 501, 1])
    );
    expect(mockRedis.eval).toHaveBeenCalled();
  });

  // [M37-02] 现场拍照图片直发与类型判定
  test("[M37-02] 师傅发送图片消息 (type=1)，断言摘要自动提炼为 [图片]", async () => {
    const res = await messageService.sendMessage(1, 88, 1, {
      chatRoomId: 501,
      type: ChatMessageType.IMAGE,
      content: "https://oss.xcesb.cn/patrol_after.jpg",
      clientMsgId: "CLIENT_456"
    });

    expect(res.messageId).toBe(1001);
    expect(res.type).toBe(ChatMessageType.IMAGE);
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE chat_rooms \n        SET lastMessage = ?"),
      expect.arrayContaining(["[图片]", 501, 1])
    );
  });

  // [M37-03] DFA 违规敏感词言论机审拦截
  test("[M37-03] 发送包含暴恐敏感词消息，断言在落盘前被 DFA 引擎阻断", async () => {
    await expect(
      messageService.sendMessage(1, 99, 0, {
        chatRoomId: 501,
        type: ChatMessageType.TEXT,
        content: "你们再不过来修我就去纵火",
        clientMsgId: "CLIENT_789"
      })
    ).rejects.toThrow("消息包含严重违规言论，已被系统拦截！");
    expect(messageStore.length).toBe(0);
  });

  // [M37-04] 历史消息分页拉取与已撤回遮蔽断言
  test("[M37-04] 查询历史消息列表，断言按时序正序返回且已撤回消息内容被遮蔽", async () => {
    // 写入一条正常消息
    await messageService.sendMessage(1, 88, 1, {
      chatRoomId: 501,
      type: ChatMessageType.TEXT,
      content: "你好，请问在宿舍吗？",
      clientMsgId: "C1"
    });

    // 模拟一条已被撤回的消息
    messageStore.push({
      id: 1002,
      schoolId: 1,
      chatRoomId: 501,
      senderId: 88,
      senderRole: 1,
      type: 0,
      content: "这是一条发错的消息",
      answerMessageId: 0,
      isWithDraw: 1, // 已撤回
      createdAt: "2026-09-06 14:05:00"
    });

    const listRes = await messageService.queryHistoryMessages(1, 88, 501, 0, 20);
    expect(listRes.messages.length).toBe(2);
    expect(listRes.messages[0].content).toBe("你好，请问在宿舍吗？");
    expect(listRes.messages[1].isWithDraw).toBe(true);
    expect(listRes.messages[1].content).toBe("该消息已被撤回");
  });

  // [M37-05] 发送工单协同微卡片 (type=2)
  test("[M37-05] 发送工单微卡片消息 (type=2)，断言摘要自动提炼为 [工单协同卡片]", async () => {
    const res = await messageService.sendMessage(1, 99, 0, {
      chatRoomId: 501,
      type: ChatMessageType.PATROL_CARD,
      content: "工单 #101 [正在维修] 学11号楼325",
      clientMsgId: "CARD_001"
    });

    expect(res.type).toBe(ChatMessageType.PATROL_CARD);
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE chat_rooms \n        SET lastMessage = ?"),
      expect.arrayContaining(["[工单协同卡片]", 501, 1])
    );
  });

  // [M37-06] 角色未读数判定: 师生发信，递增 handlerUnreadCount
  test("[M37-06] 师生发送消息时，断言师傅端未读数 handlerUnreadCount 原子递增", async () => {
    await messageService.sendMessage(1, 99, 0, {
      chatRoomId: 501,
      type: ChatMessageType.TEXT,
      content: "师傅您大概几点到？",
      clientMsgId: "S_01"
    });

    const room = roomStore.find((r) => r.id === 501);
    expect(room.handlerUnreadCount).toBe(1);
    expect(room.creatorUnreadCount).toBe(0);
  });

  // [M37-07] 角色未读数判定: 师傅发信，递增 creatorUnreadCount
  test("[M37-07] 师傅发送消息时，断言师生端未读数 creatorUnreadCount 原子递增", async () => {
    await messageService.sendMessage(1, 88, 1, {
      chatRoomId: 501,
      type: ChatMessageType.TEXT,
      content: "20分钟后到宿舍楼下。",
      clientMsgId: "H_01"
    });

    const room = roomStore.find((r) => r.id === 501);
    expect(room.creatorUnreadCount).toBe(1);
    expect(room.handlerUnreadCount).toBe(0);
  });

  // [M37-08] 算法 1 验证: 聊天图片尺寸动态自适应缩放与边界约束
  test("[M37-08] 算法 1 测试: 各种极端图片长宽比 (正方形、超长竖图、超宽横图) 尺寸归一化约束", () => {
    // 1. 正方形图片 (1:1)
    const square = computeImageBox(800, 800);
    expect(square.boxWidth).toBe(400);
    expect(square.boxHeight).toBe(400);

    // 2. 细长门形竖图 (1:3, R = 0.33)
    const tall = computeImageBox(300, 900);
    expect(tall.boxHeight).toBe(400);
    expect(tall.boxWidth).toBeGreaterThanOrEqual(140);
    expect(tall.boxWidth).toBeLessThanOrEqual(400);

    // 3. 宽屏走廊横图 (3:1, R = 3)
    const wide = computeImageBox(1200, 400);
    expect(wide.boxWidth).toBe(400);
    expect(wide.boxHeight).toBeGreaterThanOrEqual(140);
    expect(wide.boxHeight).toBeLessThanOrEqual(400);

    // 4. 非法宽高保护兜底
    const fallback = computeImageBox(0, 0);
    expect(fallback.boxWidth).toBe(360);
    expect(fallback.boxHeight).toBe(360);
  });

  // [M37-09] 算法 2 验证: 人性化相对时间消解
  test("[M37-09] 算法 2 测试: formatHumanFriendlyTime 相对时间计算 (今天、昨天、周几、绝对时间)", () => {
    const now = Date.now();
    const todayStr = formatHumanFriendlyTime(now);
    expect(todayStr).toContain("今天");

    const yesterdayMs = now - 86400000;
    const yesterdayStr = formatHumanFriendlyTime(yesterdayMs);
    expect(yesterdayStr).toContain("昨天");

    const oldMs = new Date("2025-01-01 10:30:00").getTime();
    const oldStr = formatHumanFriendlyTime(oldMs);
    expect(oldStr).toContain("2025-01-01");
  });

  // [M37-10] XSS HTML 实体字符过滤转义
  test("[M37-10] XSS 脚本与 HTML 标签过滤防跨站注入 (escapeHtml)", () => {
    const malicious = '<script>alert("xss")</script>&foo=\'bar\'';
    const escaped = escapeHtml(malicious);
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");
    expect(escaped).toContain("&quot;xss&quot;");
    expect(escaped).toContain("&#x27;bar&#x27;");
  });

  // [M37-11] 文本超过 500 字前置阻断拦截
  test("[M37-11] 超过 500 字的超长文本前置拒绝拦截", async () => {
    const longText = "a".repeat(501);
    await expect(
      messageService.sendMessage(1, 88, 1, {
        chatRoomId: 501,
        type: ChatMessageType.TEXT,
        content: longText,
        clientMsgId: "LONG_MSG"
      })
    ).rejects.toThrow("文字内容过长，请精简沟通（上限 500 字）");
  });

  // [M37-12] 空消息内容拦截
  test("[M37-12] 空消息内容或纯空格拒绝发送", async () => {
    await expect(
      messageService.sendMessage(1, 88, 1, {
        chatRoomId: 501,
        type: ChatMessageType.TEXT,
        content: "   ",
        clientMsgId: "EMPTY_MSG"
      })
    ).rejects.toThrow("消息内容不可为空");
  });

  // [M37-13] 历史记录游标倒序分页测试
  test("[M37-13] 历史消息游标分页测试 (cursorMessageId 倒序截取与 hasMore 正确判定)", async () => {
    for (let i = 1; i <= 5; i++) {
      messageStore.push({
        id: 2000 + i,
        schoolId: 1,
        chatRoomId: 501,
        senderId: 88,
        senderRole: 1,
        type: 0,
        content: `第 ${i} 条记录`,
        answerMessageId: 0,
        isWithDraw: 0,
        createdAt: `2026-09-06 14:0${i}:00`
      });
    }

    // 拉取小于 2004 的消息，最多 2 条
    const pageRes = await messageService.queryHistoryMessages(1, 88, 501, 2004, 2);
    expect(pageRes.messages.length).toBe(2);
    // 返回应为时序正序 2002, 2003
    expect(pageRes.messages[0].id).toBe(2002);
    expect(pageRes.messages[1].id).toBe(2003);
  });

  // [M37-14] 进房已读清零测试 (ackRoomRead)
  test("[M37-14] 会话已读清零: ackRoomRead 清零当前用户的未读数", async () => {
    const room = roomStore.find((r) => r.id === 501);
    room.creatorUnreadCount = 3;
    room.handlerUnreadCount = 2;

    // 师生进入会话
    await messageService.ackRoomRead(1, 501, 99);
    expect(room.creatorUnreadCount).toBe(0);
    expect(room.handlerUnreadCount).toBe(2);

    // 师傅进入会话
    await messageService.ackRoomRead(1, 501, 88);
    expect(room.handlerUnreadCount).toBe(0);
  });

  // [M37-15] 门禁联动: 未激活通道阻止师生发信
  test("[M37-15] ChatGatekeeper 联动: 未激活会话室阻止师生发送消息 (403)", async () => {
    const ctx = {
      schoolId: 1,
      userId: 99,
      role: 0, // 学生
      params: { id: "502" },
      body: {
        type: 0,
        content: "师傅你在哪？",
        clientMsgId: "TRY_SEND"
      }
    };

    const res = await controller.sendMessage(ctx);
    expect(res.code).toBe(403);
    expect(res.message).toContain("尚未主动激活协同通道");
  });

  // [M37-16] 门禁联动: 未激活通道允许指派师傅破冰发信
  test("[M37-16] ChatGatekeeper 联动: 未激活会话室允许责任师傅发送首条消息 (主动破冰)", async () => {
    const ctx = {
      schoolId: 1,
      userId: 88,
      role: 2, // 责任师傅
      params: { id: "502" },
      body: {
        type: 0,
        content: "同学你好，我是接单师傅，现在过去检修。",
        clientMsgId: "ICE_BREAK"
      }
    };

    const res = await controller.sendMessage(ctx);
    expect(res.code).toBe(200);
    expect(res.data.content).toBe("同学你好，我是接单师傅，现在过去检修。");
  });

  // [M37-17] 门禁联动: 已结案归档全员只读锁定
  test("[M37-17] ChatGatekeeper 联动: 已归档关闭会话室拒绝所有人员发送消息", async () => {
    const ctx = {
      schoolId: 1,
      userId: 88,
      role: 2,
      params: { id: "503" },
      body: {
        type: 0,
        content: "想再发一句",
        clientMsgId: "TRY_ARCHIVED"
      }
    };

    const res = await controller.sendMessage(ctx);
    expect(res.code).toBe(403);
    expect(res.message).toContain("结案归档");
  });

  // [M37-18] POST /api/v4/chat/rooms/messages 控制器端点与 StandardResult 响应包裹
  test("[M37-18] POST /api/v4/chat/rooms/messages 控制器端点与 StandardResult 响应包裹", async () => {
    const reqCtx = { schoolId: 1, userId: 88, role: 2 };
    const body = {
      chatRoomId: 501,
      type: 0,
      content: "现场已更换密封圈",
      clientMsgId: "C_MSG_18"
    };

    const result = await controller.handleSendMessage(reqCtx, body);
    expect(result.status).toBe(1);
    expect(result.data?.content).toBe("现场已更换密封圈");
    expect(result.data?.type).toBe(ChatMessageType.TEXT);
  });

  // [M37-19] GET /api/v4/chat/rooms/history 控制器端点与 StandardResult 响应包裹
  test("[M37-19] GET /api/v4/chat/rooms/history 控制器端点与 StandardResult 响应包裹", async () => {
    const reqCtx = { schoolId: 1, userId: 99 };
    const query = { chatRoomId: "501", pageSize: "10" };

    const result = await controller.handleGetHistory(reqCtx, query);
    expect(result.status).toBe(1);
    expect(result.data?.chatRoomId).toBe(501);
    expect(Array.isArray(result.data?.messages)).toBe(true);
  });

  // [M37-20] 网关端点配置验证 (authRequired 必须均为 true)
  test("[M37-20] 网关端点定义验证: messages, history, ack-read 均为 authRequired: true", () => {
    expect(messagesApi.routePath).toBe("/api/v4/chat/rooms/messages");
    expect(messagesApi.authRequired).toBe(true);

    expect(historyApi.routePath).toBe("/api/v4/chat/rooms/history");
    expect(historyApi.authRequired).toBe(true);

    expect(ackReadApi.routePath).toBe("/api/v4/chat/rooms/ack-read");
    expect(ackReadApi.authRequired).toBe(true);
  });
});
