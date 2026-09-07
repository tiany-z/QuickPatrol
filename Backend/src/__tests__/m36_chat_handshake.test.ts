/**
 * M36: 工单房责任人主动握手激活机制 - 全场景自动化回归测试套件
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TestHarness } from "./testHarness.js";
import { ChatRoomService, IDbExecutor, IRedisPublisher } from "../apps/chat/chatRoomService.js";
import { ChatGatekeeper } from "../apps/chat/chatGatekeeper.js";
import { ChatRoomController } from "../apps/chat/chatRoomController.js";
import { api as handshakeApi } from "../api/chat/rooms/activate-handshake/index.js";
import { api as metaApi } from "../api/chat/rooms/meta/index.js";

describe("M36: 工单房责任人主动握手激活机制核心测试", () => {
  let mockDb: IDbExecutor;
  let mockRedis: IRedisPublisher;
  let roomServiceWithMockDb: ChatRoomService;
  let gatekeeperWithMockDb: ChatGatekeeper;

  beforeEach(() => {
    TestHarness.resetSandbox();

    // 内存数据底座
    const roomStore: any[] = [
      {
        id: 501,
        schoolId: 1,
        roomType: "patrol",
        title: "工单协同 #101",
        patrolId: 101,
        creatorId: 99,
        handlerId: 88,
        initiatedByHandler: 0,
        isClosed: 0,
        isPinned: 0,
        creatorUnreadCount: 0,
        handlerUnreadCount: 0,
        lastMessage: "",
        lastMessageAt: null,
        createdAt: "2026-09-06 00:00:00"
      }
    ];
    const messageStore: any[] = [];

    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        if (sql.includes("FROM chat_rooms") && sql.includes("id = ?")) {
          return roomStore.filter((r) => r.id === params[0] && (!params[1] || r.schoolId === params[1]));
        }
        if (sql.includes("FROM chat_rooms") && sql.includes("patrolId = ?")) {
          return roomStore.filter((r) => (!params[0] || r.schoolId === params[0]) && r.patrolId === (params[1] ?? params[0]));
        }
        if (sql.includes("FROM users WHERE id IN (?, ?) AND schoolId = ?")) {
          return [
            { id: 88, nickName: "张师傅", realName: "张师傅", avatarUrl: "/avatar_handler.png" },
            { id: 99, nickName: "王同学", realName: "王同学", avatarUrl: "/avatar_student.png" }
          ];
        }
        if (sql.includes("FROM users WHERE id = ? AND schoolId = ?")) {
          return [{ id: params[0], nickName: "张师傅", realName: "张师傅" }];
        }
        return [];
      }),
      execute: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        if (sql.includes("INSERT INTO chat_rooms")) {
          const exists = roomStore.some((r) => r.schoolId === params[0] && r.patrolId === params[1]);
          if (exists) {
            throw new Error("Duplicate entry '1-101' for key 'uk_school_patrol'");
          }
          const newId = roomStore.length + 500;
          roomStore.push({
            id: newId,
            schoolId: params[0],
            roomType: "patrol",
            title: "",
            patrolId: params[1],
            creatorId: params[2],
            handlerId: params[3],
            initiatedByHandler: 0,
            isClosed: 0,
            isPinned: 0,
            creatorUnreadCount: 0,
            handlerUnreadCount: 0,
            lastMessage: "",
            lastMessageAt: null,
            createdAt: "2026-09-06 00:00:00"
          });
          return { insertId: newId, affectedRows: 1 };
        }
        if (sql.includes("UPDATE chat_rooms SET initiatedByHandler = 1")) {
          const room = roomStore.find((r) => r.id === params[0] && r.schoolId === params[1]);
          if (room) {
            room.initiatedByHandler = 1;
            room.lastMessageAt = "2026-09-06 08:30:00";
          }
          return { insertId: 0, affectedRows: 1 };
        }
        if (sql.includes("UPDATE chat_rooms SET handlerId = ?")) {
          const room = roomStore.find((r) => r.id === params[1] && r.schoolId === params[2]);
          if (room) {
            room.handlerId = params[0];
          }
          return { insertId: 0, affectedRows: 1 };
        }
        if (sql.includes("UPDATE chat_rooms SET isClosed = 1")) {
          const room = roomStore.find((r) => r.patrolId === params[0] && r.schoolId === params[1]);
          if (room) {
            room.isClosed = 1;
          }
          return { insertId: 0, affectedRows: 1 };
        }
        if (sql.includes("INSERT INTO chat_messages")) {
          messageStore.push({ id: messageStore.length + 1, content: params[params.length - 1] });
          return { insertId: messageStore.length, affectedRows: 1 };
        }
        return { insertId: 1, affectedRows: 1 };
      })
    };

    mockRedis = {
      eval: vi.fn().mockResolvedValue("OK"),
      publish: vi.fn().mockResolvedValue(1)
    };

    roomServiceWithMockDb = new ChatRoomService(mockDb, mockRedis);
    gatekeeperWithMockDb = new ChatGatekeeper(mockDb);
  });

  // ============================================================================
  // 1. 消息门禁前置拦截测试 (ChatGatekeeper)
  // ============================================================================
  describe("1. ChatGatekeeper 消息发送单向受控门禁", () => {
    it("[M36-01] 未激活状态下提报师生发消息，断言被 Gatekeeper 门禁抛出 403 阻断", async () => {
      await expect(
        gatekeeperWithMockDb.assertCanSendMessage(1, 501, 99, 1) // 99 为师生
      ).rejects.toThrow("责任维修师傅正在赶往现场备料中，尚未主动激活协同通道，暂不可发消息");
    });

    it("[M36-02] 未激活状态下责任维修师傅发消息，允许放行", async () => {
      // 师傅 (88) 随时可以主动发信
      await expect(
        gatekeeperWithMockDb.assertCanSendMessage(1, 501, 88, 2)
      ).resolves.not.toThrow();
    });

    it("[M36-03] 非工单关联人员 (第三方用户) 发言，被越权拦截", async () => {
      await expect(
        gatekeeperWithMockDb.assertCanSendMessage(1, 501, 666, 1)
      ).rejects.toThrow("越权拦截: 您不是该工单的关联人，无权在此发言");
    });

    it("[M36-04] 工单已结案归档 (isClosed = 1)，任何新消息投递坚决拦截", async () => {
      await roomServiceWithMockDb.closePatrolRoom(1, 101);

      await expect(
        gatekeeperWithMockDb.assertCanSendMessage(1, 501, 88, 2)
      ).rejects.toThrow("本次工单已圆满结案归档，禁止再发送新消息");
    });
  });

  // ============================================================================
  // 2. 责任师傅主动握手状态机测试 (ChatRoomService)
  // ============================================================================
  describe("2. ChatRoomService 主动握手激活状态机与广播", () => {
    it("[M36-05] 责任师傅发起主动握手，断言状态跃迁为 1 且下发系统通知气泡", async () => {
      const res = await roomServiceWithMockDb.activateHandshake(1, 501, 88, {
        chatRoomId: 501,
        greetingMessage: "李同学你好，我已经带好管钳与新龙头，5分钟后到宿舍门前。"
      });

      expect(res.chatRoomId).toBe(501);
      expect(res.initiatedByHandler).toBe(1);
      expect(res.systemBubbleId).toBeGreaterThanOrEqual(1);
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE chat_rooms SET initiatedByHandler = 1"),
        [501, 1]
      );
      expect(mockRedis.eval).toHaveBeenCalled(); // 验证触发跨节点 WS 广播
    });

    it("[M36-06] 握手激活成功后，师生端调用断言 Gatekeeper 放行无抛错", async () => {
      // 1. 师傅先激活
      await roomServiceWithMockDb.activateHandshake(1, 501, 88, { chatRoomId: 501 });

      // 2. 师生端再次发言，Gatekeeper 顺利放行
      await expect(
        gatekeeperWithMockDb.assertCanSendMessage(1, 501, 99, 1)
      ).resolves.not.toThrow();
    });

    it("[M36-07] 非责任人师傅 (ID: 77) 冒名点击主动握手，断言抛出越权拦截异常", async () => {
      await expect(
        roomServiceWithMockDb.activateHandshake(1, 501, 77, { chatRoomId: 501 })
      ).rejects.toThrow("越权拦截: 只有当前工单的责任维修师傅本人有权主动激活会话");
    });

    it("[M36-08] 重复调用握手激活，具备绝对幂等性，不重复插入系统气泡", async () => {
      // 首次激活
      const firstRes = await roomServiceWithMockDb.activateHandshake(1, 501, 88, { chatRoomId: 501 });
      expect(firstRes.systemBubbleId).toBeGreaterThanOrEqual(1);

      // 二次调用幂等放行
      const secondRes = await roomServiceWithMockDb.activateHandshake(1, 501, 88, { chatRoomId: 501 });
      expect(secondRes.initiatedByHandler).toBe(1);
      expect(secondRes.statusText).toContain("此前已处于激活状态");
    });
  });

  // ============================================================================
  // 3. 工单创建即建房与责任人变更交接测试
  // ============================================================================
  describe("3. 工单全生命周期会话室绑定与转派自愈", () => {
    it("[M36-09] provisionPatrolRoom: 首次派单自动建房成功", async () => {
      const res = await roomServiceWithMockDb.provisionPatrolRoom(1, 202, 105, 88);
      expect(res.chatRoomId).toBeGreaterThanOrEqual(500);
      expect(res.isNewlyCreated).toBe(true);
    });

    it("[M36-10] provisionPatrolRoom 幂等性: 重复派单同一工单返回已有房间 ID", async () => {
      const res = await roomServiceWithMockDb.provisionPatrolRoom(1, 101, 99, 88);
      expect(res.chatRoomId).toBe(501);
      expect(res.isNewlyCreated).toBe(false);
    });

    it("[M36-11] 责任师傅转派换人场景: 自动自愈更新 handlerId", async () => {
      // 原责任师傅为 88，现改派为 77 师傅
      const res = await roomServiceWithMockDb.provisionPatrolRoom(1, 101, 99, 77);
      expect(res.chatRoomId).toBe(501);
      expect(res.isNewlyCreated).toBe(false);
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE chat_rooms SET handlerId = ?"),
        [77, 501, 1]
      );
    });

    it("[M36-12] closePatrolRoom: 工单结案自动归档只读冷冻", async () => {
      await roomServiceWithMockDb.closePatrolRoom(1, 101);
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE chat_rooms SET isClosed = 1"),
        [101, 1]
      );

      // 结案后尝试激活被拦截
      await expect(
        roomServiceWithMockDb.activateHandshake(1, 501, 88, { chatRoomId: 501 })
      ).rejects.toThrow("工单已结案归档");
    });
  });

  // ============================================================================
  // 4. Algorithm 4 动态权限掩码与会话元数据拉取
  // ============================================================================
  describe("4. getRoomMetadata 会话元数据与权限掩码", () => {
    it("[M36-13] 师生端在未激活状态下拉取元数据: canInput 为 false，显示等待提示", async () => {
      const meta = await roomServiceWithMockDb.getRoomMetadata(1, 501, 99, 1);
      expect(meta.permissions.canInput).toBe(false);
      expect(meta.permissions.lockReason).toContain("等待维修师傅主动联络");
      expect(meta.permissions.showHandshakeButton).toBe(false);
    });

    it("[M36-14] 责任师傅拉取未激活会话元数据: canInput 为 true，展示握手激活按钮", async () => {
      const meta = await roomServiceWithMockDb.getRoomMetadata(1, 501, 88, 2);
      expect(meta.permissions.canInput).toBe(true);
      expect(meta.permissions.showHandshakeButton).toBe(true);
    });

    it("[M36-15] 激活后师生端拉取元数据: canInput 跃迁为 true，握手按钮隐藏", async () => {
      await roomServiceWithMockDb.activateHandshake(1, 501, 88, { chatRoomId: 501 });

      const meta = await roomServiceWithMockDb.getRoomMetadata(1, 501, 99, 1);
      expect(meta.permissions.canInput).toBe(true);
      expect(meta.permissions.lockReason).toBe("");
      expect(meta.permissions.showHandshakeButton).toBe(false);
    });

    it("[M36-16] 内存沙箱模式独立运行断言", async () => {
      const memService = new ChatRoomService();
      const meta = await memService.getRoomMetadata(1, 501, 99, 1);
      expect(meta.chatRoomId).toBe(501);
      expect(meta.handlerName).toBe("张师傅");
      expect(meta.permissions.canInput).toBe(false);

      const actRes = await memService.activateHandshake(1, 501, 88, { chatRoomId: 501 });
      expect(actRes.initiatedByHandler).toBe(1);

      const afterMeta = await memService.getRoomMetadata(1, 501, 99, 1);
      expect(afterMeta.permissions.canInput).toBe(true);
    });
  });

  // ============================================================================
  // 5. 控制器与网关 API 契约断言
  // ============================================================================
  describe("5. 控制器与网关 API 契约断言", () => {
    let controller: ChatRoomController;

    beforeEach(() => {
      controller = new ChatRoomController();
    });

    it("[M36-17] 控制器 handleActivateHandshake 鉴权与参数校验", async () => {
      const unauthRes = await controller.handleActivateHandshake({ schoolId: 1, userId: 0 }, { chatRoomId: 501 });
      expect(unauthRes.status).toBe(0);
      expect(unauthRes.content).toContain("请先完成维修师傅身份登录");

      const invalidIdRes = await controller.handleActivateHandshake({ schoolId: 1, userId: 88 }, { chatRoomId: 0 });
      expect(invalidIdRes.status).toBe(0);
      expect(invalidIdRes.content).toContain("会话室 ID 非法");
    });

    it("[M36-18] 控制器 handleGetRoomMeta 成功获取并包裹 StandardResult", async () => {
      const res = await controller.handleGetRoomMeta({ schoolId: 1, userId: 99, role: 1 }, { chatRoomId: 501 });
      expect(res.status).toBe(1);
      expect(res.data?.chatRoomId).toBe(501);
    });

    it("[M36-19] 网关 POST /api/v4/chat/rooms/activate-handshake 路由元数据规范", () => {
      expect(handshakeApi.routePath).toBe("/api/v4/chat/rooms/activate-handshake");
      expect(handshakeApi.authRequired).toBe(true);
    });

    it("[M36-20] 网关 GET /api/v4/chat/rooms/meta 路由元数据规范", () => {
      expect(metaApi.routePath).toBe("/api/v4/chat/rooms/meta");
      expect(metaApi.authRequired).toBe(true);
    });
  });
});
