/**
 * M25: 责任人主动发起聊天与师生多媒体会话专项单元测试套件
 * (Patrol Chat & Media Session Test Suite)
 * 
 * 核心测试矩阵：
 * 1. M25-01: 防骚扰静默门禁验证 (未激活前师生发言被 100% 物理拦截)
 * 2. M25-02: 责任人主动激活流程 (师傅激活后解锁、系统欢迎帧注入、非责任人拦截)
 * 3. M25-03: 消息撤回安全时效断言 (120秒内成功撤回、超期强力阻断、非本人撤回拒绝)
 * 4. M25-04: 类 QQ 引用回复链与优雅降级模型 (正常引用、原消息撤回后优雅降级)
 * 5. M25-05: 进房未读原子清零与游标增量分页拉取 (未读自增与进房清零、游标分页拉取)
 * 6. M25-06: 结案归档联动与终态只读锁定 (结案后禁止发言与禁止重复激活)
 * 7. M25-07: API 路由端点与 MasterDispatcher 网关调度验证 (/api/chat/*)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { ChatService } from "../apps/chat/chatService.js";
import { ChatSessionService } from "../apps/chat/chatSessionService.js";
import { ChatController } from "../apps/chat/chatController.js";
import { WeChatAuthService } from "../services/auth/wechatAuthService.js";
import { PatrolService } from "../apps/patrol/patrolService.js";
import { AuditLogger } from "../shared/log/auditLogger.js";

// API 路由端点
import { api as initiateApi } from "../api/chat/room/initiate/index.js";
import { api as sendApi } from "../api/chat/message/send/index.js";
import { api as withdrawApi } from "../api/chat/message/withdraw/index.js";
import { api as listApi } from "../api/chat/message/list/index.js";
import { api as markReadApi } from "../api/chat/room/mark-read/index.js";
import { api as sessionsApi } from "../api/chat/sessions/index.js";

describe("M25: 责任人主动发起聊天与师生多媒体会话 (Patrol Chat & Media Session)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M25-01: 防骚扰门禁验证 - 会话未被师傅激活前，师生发消息应被 100% 物理拦截", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 25, caseIndex: 1 });
    const sId = tenant.schoolId;

    // 1. 预置工单与静默会话室 (initiatedByHandler = 0)
    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9001, ?, 1, 1, 'LCU-CHAT-01', 101, 801, '龙头漏水', '急修', 1)",
      [sId]
    );

    const roomRes: any = await TestHarness.executeSql(
      "INSERT INTO chat_rooms (schoolId, patrolId, creatorId, handlerId, initiatedByHandler, isClosed) VALUES (?, 9001, 101, 801, 0, 0)",
      [sId]
    );
    const roomId = roomRes.insertId;

    // 2. 师生 (senderRole=0) 企图在静默期发送催单消息 -> 物理拦截
    await expect(
      ChatService.sendMessage(sId, 101, 0, {
        chatRoomId: roomId,
        type: 0,
        content: "师傅您什么时候过来？"
      })
    ).rejects.toThrow("处于备料静默期");
  });

  it("M25-02: 责任人激活流程 - 师傅主动联络后会话解锁且自动插入系统欢迎帧", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 25, caseIndex: 2 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9002, ?, 1, 1, 'LCU-CHAT-02', 102, 802, '水管破裂', '急修', 1)",
      [sId]
    );

    const roomRes: any = await TestHarness.executeSql(
      "INSERT INTO chat_rooms (schoolId, patrolId, creatorId, handlerId, initiatedByHandler, isClosed) VALUES (?, 9002, 102, 802, 0, 0)",
      [sId]
    );
    const roomId = roomRes.insertId;

    // 1. 非责任师傅 (899) 试图激活 -> 必须被拒绝
    await expect(
      ChatService.initiateRoomByHandler(sId, 899, 9002, "127.0.0.1")
    ).rejects.toThrow("只有当前工单的责任维修师傅有权主动发起会话");

    // 2. 责任师傅 802 主动发起激活
    const initRes = await ChatService.initiateRoomByHandler(sId, 802, 9002, "127.0.0.1");
    expect(initRes.success).toBe(true);
    expect(initRes.chatRoomId).toBe(roomId);

    // 3. 验证会话室状态已跃迁为 1
    const room = ChatService.getMockRoom(roomId);
    expect(room?.initiatedByHandler).toBe(1);

    // 4. 验证自动写入了系统欢迎通知帧 (type = 3, senderRole = 9)
    const msgs = await ChatService.getMessageList(sId, roomId, 0, 10);
    expect(msgs.length).toBe(1);
    expect(msgs[0].type).toBe(3);
    expect(msgs[0].content).toContain("责任维修师傅已主动开启现场协同通道");

    // 5. 此时师生再次发消息应畅通通过
    const sendRes = await ChatService.sendMessage(sId, 102, 0, {
      chatRoomId: roomId,
      type: 0,
      content: "师傅您好，漏水在阳台洗衣机下面！"
    });
    expect(sendRes.messageId).toBeGreaterThan(0);
    expect(sendRes.content).toBe("师傅您好，漏水在阳台洗衣机下面！");

    // 6. 审计日志验证
    const logs = AuditLogger.getMockLogs();
    const initLog = logs.find((l) => l.action === "CHAT_ROOM_INITIATED");
    expect(initLog).toBeDefined();
    expect(initLog?.schoolId).toBe(sId);
  });

  it("M25-03: 消息撤回安全时效断言 - 2分钟内可成功撤回，超期或越权则强力阻断", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 25, caseIndex: 3 });
    const sId = tenant.schoolId;

    const roomRes: any = await TestHarness.executeSql(
      "INSERT INTO chat_rooms (schoolId, patrolId, creatorId, handlerId, initiatedByHandler, isClosed) VALUES (?, 9003, 103, 803, 1, 0)",
      [sId]
    );
    const roomId = roomRes.insertId;

    // 1. 师傅 803 发送一条消息
    const sendRes = await ChatService.sendMessage(sId, 803, 1, {
      chatRoomId: roomId,
      type: 0,
      content: "手抖发错了内部进货单价"
    });

    // 2. 提报人 103 试图越权撤回师傅发送的消息 -> 拒绝
    await expect(
      ChatService.withdrawMessage(sId, 103, sendRes.messageId, "127.0.0.1")
    ).rejects.toThrow("只能撤回自己发送的消息");

    // 3. 师傅 803 立即撤回 -> 应该成功
    const withRes = await ChatService.withdrawMessage(sId, 803, sendRes.messageId, "127.0.0.1");
    expect(withRes.success).toBe(true);

    const msg = ChatService.getMockMessage(sendRes.messageId);
    expect(msg?.isWithDraw).toBe(1);

    // 4. 重复撤回 -> 拒绝
    await expect(
      ChatService.withdrawMessage(sId, 803, sendRes.messageId, "127.0.0.1")
    ).rejects.toThrow("该消息早已被撤回");

    // 5. 模拟一条 125 秒前发送的陈旧消息
    const oldMsg = ChatService.mockRegisterMessage({
      schoolId: sId,
      chatRoomId: roomId,
      senderId: 803,
      senderRole: 1,
      type: 0,
      content: "这是一条两分钟之前的消息",
      isWithDraw: 0,
      createdAt: new Date(Date.now() - 125 * 1000).toISOString()
    });

    await expect(
      ChatService.withdrawMessage(sId, 803, oldMsg.id, "127.0.0.1")
    ).rejects.toThrow("超过 2 分钟");

    // 6. 验证撤回审计流水
    const logs = AuditLogger.getMockLogs();
    const withLog = logs.find((l) => l.action === "CHAT_MESSAGE_WITHDRAW");
    expect(withLog).toBeDefined();
  });

  it("M25-04: 类 QQ 引用回复链与优雅降级模型 - 正常引用与被撤回后安全降级", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 25, caseIndex: 4 });
    const sId = tenant.schoolId;

    WeChatAuthService.mockRegisterUser({ id: 104, schoolId: sId, openId: "op_104", realName: "张同学", role: 0 });
    WeChatAuthService.mockRegisterUser({ id: 804, schoolId: sId, openId: "op_804", realName: "王师傅", role: 1 });

    const roomRes: any = await TestHarness.executeSql(
      "INSERT INTO chat_rooms (schoolId, patrolId, creatorId, handlerId, initiatedByHandler, isClosed) VALUES (?, 9004, 104, 804, 1, 0)",
      [sId]
    );
    const roomId = roomRes.insertId;

    // 1. 学生发送现场疑问
    const qMsg = await ChatService.sendMessage(sId, 104, 0, {
      chatRoomId: roomId,
      type: 0,
      content: "请问需要停水多长时间？"
    });

    // 2. 师傅引用回复第 1 条消息
    const answerMsg = await ChatService.sendMessage(sId, 804, 1, {
      chatRoomId: roomId,
      type: 0,
      content: "大约停水 30 分钟即可完成热熔熔接",
      answerMessageId: qMsg.messageId
    });

    expect(answerMsg.quotedMessage).toBeDefined();
    expect(answerMsg.quotedMessage?.id).toBe(qMsg.messageId);
    expect(answerMsg.quotedMessage?.summary).toContain("停水多长时间");

    // 3. 学生撤回刚才的提问
    await ChatService.withdrawMessage(sId, 104, qMsg.messageId, "127.0.0.1");

    // 4. 再次针对该消息进行回复或拉取时，引用自动优雅降级
    const replyAfterWithdrawn = await ChatService.sendMessage(sId, 804, 1, {
      chatRoomId: roomId,
      type: 0,
      content: "收到，那我准时停水",
      answerMessageId: qMsg.messageId
    });

    expect(replyAfterWithdrawn.quotedMessage?.summary).toBe("该引用消息已被撤回");
  });

  it("M25-05: 进房未读原子清零与游标增量分页拉取 - 未读数双向维护与高效分页", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 25, caseIndex: 5 });
    const sId = tenant.schoolId;

    const roomRes: any = await TestHarness.executeSql(
      "INSERT INTO chat_rooms (schoolId, patrolId, creatorId, handlerId, initiatedByHandler, isClosed) VALUES (?, 9005, 105, 805, 1, 0)",
      [sId]
    );
    const roomId = roomRes.insertId;

    // 1. 学生连发 3 条消息 -> 师傅未读数应递增为 3
    await ChatService.sendMessage(sId, 105, 0, { chatRoomId: roomId, type: 0, content: "消息1" });
    await ChatService.sendMessage(sId, 105, 0, { chatRoomId: roomId, type: 0, content: "消息2" });
    const m3 = await ChatService.sendMessage(sId, 105, 0, { chatRoomId: roomId, type: 0, content: "消息3" });

    let room = ChatService.getMockRoom(roomId);
    expect(room?.handlerUnreadCount).toBe(3);
    expect(room?.creatorUnreadCount).toBe(0);

    // 2. 师傅进房，执行 markRoomAsRead -> 师傅未读数清零
    await ChatService.markRoomAsRead(sId, 805, roomId);
    room = ChatService.getMockRoom(roomId);
    expect(room?.handlerUnreadCount).toBe(0);

    // 3. 游标分页拉取测试：拉取 m3 之前的消息 (cursorId = m3.messageId)
    const history = await ChatService.getMessageList(sId, roomId, m3.messageId, 2);
    expect(history.length).toBe(2);
    expect(history[0].content).toBe("消息1");
    expect(history[1].content).toBe("消息2");
  });

  it("M25-06: 结案归档联动与终态只读锁定 - 结案工单全角色发言与重复激活硬锁定", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 25, caseIndex: 6 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9006, ?, 1, 1, 'LCU-CHAT-06', 106, 806, '已完工工单', '已验收', 4)",
      [sId]
    );

    // 预置已结案归档的会话室 (isClosed = 1)
    const roomRes: any = await TestHarness.executeSql(
      "INSERT INTO chat_rooms (schoolId, patrolId, creatorId, handlerId, initiatedByHandler, isClosed) VALUES (?, 9006, 106, 806, 1, 1)",
      [sId]
    );
    const roomId = roomRes.insertId;

    // 1. 师傅试图再次激活已结案会话 -> 拦截
    await expect(
      ChatService.initiateRoomByHandler(sId, 806, 9006, "127.0.0.1")
    ).rejects.toThrow("工单已结案归档");

    // 2. 师傅试图发消息 -> 拦截
    await expect(
      ChatService.sendMessage(sId, 806, 1, {
        chatRoomId: roomId,
        type: 0,
        content: "你好还在吗？"
      })
    ).rejects.toThrow("结案归档");

    // 3. 师生试图发消息 -> 拦截
    await expect(
      ChatService.sendMessage(sId, 106, 0, {
        chatRoomId: roomId,
        type: 0,
        content: "感谢师傅！"
      })
    ).rejects.toThrow("结案归档");
  });

  it("M25-07: MasterDispatcher 路由端点动态调度与鉴权拦截 (/api/chat/*)", async () => {
    const tenantMaster = TestHarness.createMockTenantContext({ moduleIndex: 25, caseIndex: 7, role: 1 });
    const tenantStudent = TestHarness.createMockTenantContext({ moduleIndex: 25, caseIndex: 8, role: 0 });
    const sId = tenantMaster.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9007, ?, 1, 1, 'LCU-CHAT-07', 107, 807, '门锁损坏', '报修', 1)",
      [sId]
    );

    const roomRes: any = await TestHarness.executeSql(
      "INSERT INTO chat_rooms (schoolId, patrolId, creatorId, handlerId, initiatedByHandler, isClosed) VALUES (?, 9007, 107, 807, 0, 0)",
      [sId]
    );
    const roomId = roomRes.insertId;

    // 1. 师傅调用 /api/chat/room/initiate
    const initRes = await initiateApi.handler(
      { body: { patrolId: 9007 }, method: "POST" } as any,
      { userPayload: { schoolId: sId, userId: 807, role: 1, username: "师傅807" } } as any
    );
    expect(initRes.status).toBe(1);
    expect(initRes.data.chatRoomId).toBe(roomId);

    // 2. 提报人调用 /api/chat/message/send
    const sendRes = await sendApi.handler(
      {
        body: { chatRoomId: roomId, type: 0, content: "门锁钥匙转不动了" },
        method: "POST"
      } as any,
      { userPayload: { schoolId: sId, userId: 107, role: 0, username: "学生107" } } as any
    );
    expect(sendRes.status).toBe(1);
    expect(sendRes.data.messageId).toBeGreaterThan(0);

    // 3. 拉取列表 /api/chat/message/list
    const listRes = await listApi.handler(
      { query: { chatRoomId: roomId, limit: 10 }, method: "GET" } as any,
      { userPayload: { schoolId: sId, userId: 107, role: 0 } } as any
    );
    expect(listRes.status).toBe(1);
    expect(listRes.data.length).toBeGreaterThanOrEqual(2); // 系统欢迎帧 + 刚才学生消息

    // 4. 清除未读 /api/chat/room/mark-read
    const readRes = await markReadApi.handler(
      { body: { chatRoomId: roomId }, method: "POST" } as any,
      { userPayload: { schoolId: sId, userId: 807, role: 1 } } as any
    );
    expect(readRes.status).toBe(1);

    // 5. 撤回消息 /api/chat/message/withdraw
    const withRes = await withdrawApi.handler(
      { body: { messageId: sendRes.data.messageId }, method: "POST" } as any,
      { userPayload: { schoolId: sId, userId: 107, role: 0 } } as any
    );
    expect(withRes.status).toBe(1);

    // 6. 会话大盘 /api/chat/sessions
    const sessionsRes = await sessionsApi.handler(
      { method: "GET" } as any,
      { userPayload: { schoolId: sId, userId: 107, role: 0 } } as any
    );
    expect(sessionsRes.status).toBe(1);
    expect(sessionsRes.data.length).toBeGreaterThanOrEqual(1);
  });
});
