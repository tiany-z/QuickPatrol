/**
 * 高校后勤巡查e速办 v4.0 - M40: 视口停留已读瞬间消除与工单置顶排序大盘单元测试
 * (M40 Read Receipts & Sticky Pinning Dashboard Tests)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { DwellTimeEvaluator } from "../apps/chat/dwellTimeEvaluator.js";
import { StickyPriorityWeightedSorter } from "../apps/chat/stickyPriorityWeightedSorter.js";
import { GlobalUnreadBadgeDeltaSynchronizer } from "../apps/chat/globalUnreadBadgeDeltaSynchronizer.js";
import { ChatSessionService } from "../apps/chat/chatSessionService.js";
import { ChatSessionController } from "../apps/chat/chatSessionController.js";
import { ChatRoomService } from "../apps/chat/chatRoomService.js";

describe("M40: 视口停留已读瞬间消除与工单置顶排序大盘", () => {
  const schoolId = 1;
  const creatorId = 101; // 师生
  const handlerId = 201; // 师傅
  const bystanderId = 999; // 局外人
  let sessionService: ChatSessionService;
  let sessionController: ChatSessionController;

  beforeEach(() => {
    TestHarness.resetSandbox();
    sessionService = new ChatSessionService();
    sessionController = new ChatSessionController(sessionService);

    // 预置两个协同会话室
    // 房间 501: 较早消息，师傅有 2 条未读
    ChatRoomService.seedMockRoom({
      id: 501,
      schoolId,
      patrolId: 1001,
      creatorId,
      handlerId,
      initiatedByHandler: 1,
      isClosed: 0,
      isPinned: 0,
      creatorUnreadCount: 0,
      handlerUnreadCount: 2,
      lastMessage: "电箱已检查完成",
      lastMessageAt: "2026-09-05T10:00:00.000Z"
    });

    // 房间 502: 较新消息，师傅有 1 条未读
    ChatRoomService.seedMockRoom({
      id: 502,
      schoolId,
      patrolId: 1002,
      creatorId,
      handlerId,
      initiatedByHandler: 1,
      isClosed: 0,
      isPinned: 0,
      creatorUnreadCount: 0,
      handlerUnreadCount: 1,
      lastMessage: "水龙头已换新配件",
      lastMessageAt: "2026-09-05T11:00:00.000Z"
    });
  });

  describe("1. 算法 1：视口停留判定状态机 (DwellTimeEvaluator)", () => {
    it("未满 300ms 离开视口，不应触发已读回调，且 wasValidRead 为 false", async () => {
      const evaluator = new DwellTimeEvaluator();
      let triggered = false;

      evaluator.startDwellTimer(() => {
        triggered = true;
      });

      // 模拟在 100ms 内瞬间离开
      await new Promise((resolve) => setTimeout(resolve, 100));
      const leaveResult = evaluator.handleLeave();

      expect(triggered).toBe(false);
      expect(leaveResult.wasValidRead).toBe(false);
      expect(evaluator.hasTriggered()).toBe(false);

      // 再等待超过 300ms，确认定时器已被销毁不再触发
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(triggered).toBe(false);
    });

    it("视口停留满 300ms，应准时触发已读回调，且 wasValidRead 为 true", async () => {
      const evaluator = new DwellTimeEvaluator();
      let triggered = false;

      evaluator.startDwellTimer(() => {
        triggered = true;
      });

      // 停留 350ms
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(triggered).toBe(true);
      expect(evaluator.hasTriggered()).toBe(true);

      const leaveResult = evaluator.handleLeave();
      expect(leaveResult.wasValidRead).toBe(true);
    });
  });

  describe("2. 算法 2：多租户会话大盘双因子加权排序 (StickyPriorityWeightedSorter)", () => {
    it("未置顶状态下，严格按最后消息时间倒序排列", () => {
      const sessions = [
        { chatRoomId: 1, isPinned: false, lastMessageAt: "2026-09-05T09:00:00.000Z" },
        { chatRoomId: 2, isPinned: false, lastMessageAt: "2026-09-05T11:00:00.000Z" },
        { chatRoomId: 3, isPinned: false, lastMessageAt: "2026-09-05T10:00:00.000Z" }
      ];

      const sorted = StickyPriorityWeightedSorter.sort(sessions);
      expect(sorted.map((s) => s.chatRoomId)).toEqual([2, 3, 1]);
    });

    it("双因子加权：被置顶的会话即便发信时间更早，也必须绝对优先排在首位", () => {
      const sessions = [
        { chatRoomId: 1, isPinned: false, lastMessageAt: "2026-09-05T12:00:00.000Z" }, // 最新，但未置顶
        { chatRoomId: 2, isPinned: true, lastMessageAt: "2026-09-05T08:00:00.000Z" }  // 最早，但置顶
      ];

      const sorted = StickyPriorityWeightedSorter.sort(sessions);
      expect(sorted[0].chatRoomId).toBe(2);
      expect(sorted[1].chatRoomId).toBe(1);
    });

    it("多个置顶会话之间，依然按时间倒序排列", () => {
      const sessions = [
        { chatRoomId: 1, isPinned: true, lastMessageAt: "2026-09-05T08:00:00.000Z" },
        { chatRoomId: 2, isPinned: false, lastMessageAt: "2026-09-05T12:00:00.000Z" },
        { chatRoomId: 3, isPinned: true, lastMessageAt: "2026-09-05T10:00:00.000Z" }
      ];

      const sorted = StickyPriorityWeightedSorter.sort(sessions);
      expect(sorted.map((s) => s.chatRoomId)).toEqual([3, 1, 2]);
    });

    it("边界输入容错：空数组或单元素数组平稳返回", () => {
      expect(StickyPriorityWeightedSorter.sort([])).toEqual([]);
      const single = [{ chatRoomId: 9, isPinned: true, lastMessageAt: null }];
      expect(StickyPriorityWeightedSorter.sort(single)).toEqual(single);
    });
  });

  describe("3. 算法 3：全局未读红点原子累加与差量同步 (GlobalUnreadBadgeDeltaSynchronizer)", () => {
    it("calculateAfterClear 与 calculateAfterIncrement 差量计算断言", () => {
      // 原来未读 5，清除了 2 -> 剩余 3
      expect(GlobalUnreadBadgeDeltaSynchronizer.calculateAfterClear(5, 2)).toBe(3);
      // 清除数大于总数时下限截断为 0
      expect(GlobalUnreadBadgeDeltaSynchronizer.calculateAfterClear(2, 5)).toBe(0);

      // 新增 1 条未读
      expect(GlobalUnreadBadgeDeltaSynchronizer.calculateAfterIncrement(3, 1)).toBe(4);
    });

    it("formatBadgeText 红点文本格式化断言", () => {
      expect(GlobalUnreadBadgeDeltaSynchronizer.formatBadgeText(0)).toBeNull();
      expect(GlobalUnreadBadgeDeltaSynchronizer.formatBadgeText(-5)).toBeNull();
      expect(GlobalUnreadBadgeDeltaSynchronizer.formatBadgeText(1)).toBe("1");
      expect(GlobalUnreadBadgeDeltaSynchronizer.formatBadgeText(99)).toBe("99");
      expect(GlobalUnreadBadgeDeltaSynchronizer.formatBadgeText(100)).toBe("99+");
      expect(GlobalUnreadBadgeDeltaSynchronizer.formatBadgeText(999)).toBe("99+");
    });
  });

  describe("4. 会话置顶与大盘联动", () => {
    it("toggleSessionPin 应成功置顶并在大盘中跃升至首位", async () => {
      // 默认排序: 502 (11:00) 排在 501 (10:00) 之前
      let list = await sessionService.getUserSessions(schoolId, handlerId, 1);
      expect(list[0].chatRoomId).toBe(502);

      // 师傅将 501 置顶
      const pinRes = await sessionService.toggleSessionPin(schoolId, handlerId, 501, true);
      expect(pinRes.code).toBe(200);
      expect(pinRes.data.isPinned).toBe(true);

      // 再次获取大盘: 501 跃升至第一位
      list = await sessionService.getUserSessions(schoolId, handlerId, 1);
      expect(list[0].chatRoomId).toBe(501);
      expect(list[0].isPinned).toBe(true);
      expect(list[1].chatRoomId).toBe(502);
      expect(list[1].isPinned).toBe(false);

      // 取消置顶 501
      const unpinRes = await sessionService.toggleSessionPin(schoolId, handlerId, 501, false);
      expect(unpinRes.code).toBe(200);
      expect(unpinRes.data.isPinned).toBe(false);

      // 回退至默认时序
      list = await sessionService.getUserSessions(schoolId, handlerId, 1);
      expect(list[0].chatRoomId).toBe(502);
      expect(list[0].isPinned).toBe(false);
    });
  });

  describe("5. 视口已读消除与全局红点清障 (ackRoomRead)", () => {
    it("师傅进入房间消除未读，未读数清零，剩余总未读正确计算", async () => {
      // 初始师傅总未读: 501(2) + 502(1) = 3
      let total = await sessionService.calculateUserTotalUnread(schoolId, handlerId);
      expect(total).toBe(3);

      // 师傅进入 501 消除未读
      const ackRes = await sessionService.ackRoomRead(schoolId, 501, handlerId);
      expect(ackRes.code).toBe(200);
      expect(ackRes.data.clearedCount).toBe(2);
      expect(ackRes.data.remainingTotalUnread).toBe(1);

      // 再次查询总未读与会话大盘
      total = await sessionService.calculateUserTotalUnread(schoolId, handlerId);
      expect(total).toBe(1);

      const list = await sessionService.getUserSessions(schoolId, handlerId, 1);
      const session501 = list.find((s) => s.chatRoomId === 501);
      expect(session501?.unreadCount).toBe(0);
    });

    it("学生进入房间消除未读", async () => {
      // 模拟学生在 502 有 4 条未读
      const r502 = ChatRoomService.getMockRoom(502);
      if (r502) r502.creatorUnreadCount = 4;

      const ackRes = await sessionService.ackRoomRead(schoolId, 502, creatorId);
      expect(ackRes.code).toBe(200);
      expect(ackRes.data.clearedCount).toBe(4);
      expect(r502?.creatorUnreadCount).toBe(0);
    });
  });

  describe("6. 边界与越权防护", () => {
    it("局外人尝试标记他人房间已读应被越权阻断", async () => {
      await expect(
        sessionService.ackRoomRead(schoolId, 501, bystanderId)
      ).rejects.toThrow("越权阻断: 您并非该工单会话的参与人");
    });

    it("标记不存在的房间已读应报错", async () => {
      await expect(
        sessionService.ackRoomRead(schoolId, 99999, handlerId)
      ).rejects.toThrow("指定会话不存在或已被归档");
    });
  });

  describe("7. HTTP 控制器端点集成检验", () => {
    it("ChatSessionController.getSessions 成功返回会话列表与总未读", async () => {
      const ctx: any = {
        schoolId,
        userId: handlerId,
        userRole: 1
      };

      const res = await sessionController.handleGetSessions(ctx);
      expect(res.status).toBe(1);
      expect(res.data.totalUnread).toBe(3);
      expect(res.data.sessions.length).toBe(2);
    });

    it("ChatSessionController.ackRead 成功消除已读", async () => {
      const ctx: any = {
        schoolId,
        userId: handlerId,
        userRole: 1,
        body: { chatRoomId: 501 }
      };

      const res = await sessionController.handleAckRead(ctx);
      expect(res.status).toBe(1);
      expect(res.data.clearedCount).toBe(2);
      expect(res.data.remainingTotalUnread).toBe(1);
    });

    it("ChatSessionController.togglePin 切换置顶状态", async () => {
      const ctx: any = {
        schoolId,
        userId: handlerId,
        userRole: 1,
        body: { chatRoomId: 501, pin: true }
      };

      const res = await sessionController.handleTogglePin(ctx);
      expect(res.status).toBe(1);
      expect(res.data.isPinned).toBe(true);
    });

    it("ChatSessionController 参数校验拒绝无效请求", async () => {
      const ctx: any = {
        schoolId,
        userId: handlerId,
        userRole: 1,
        body: { chatRoomId: 0 } // 无效 ID
      };

      const res = await sessionController.handleAckRead(ctx);
      expect(res.status).toBe(0);
      expect(res.content).toContain("无效的会话 ID");
    });
  });
});
