/**
 * 高校后勤巡查e速办 v4.0 - M41: 科室工作群与突发险情应急抢险群聊专项单元测试套件
 * (Chat Group & Incident Coordination Test Suite)
 * 
 * 核心测试矩阵：
 * 1. 算法 1: 群聊已读游标与差量未读计算器 (GroupReadCursorCalculator)
 * 2. 算法 2: 突发险情职能标签智能推荐匹配 (IncidentTagMemberMatcher)
 * 3. 算法 3: 群聊九宫格头像动态合成拓扑 (NineGridAvatarCompositor)
 * 4. 算法 4: 混合推流总线与 @所有人 强穿透 (HybridGroupFanOutOptimizer)
 * 5. ChatGroupService 核心业务与权限阶梯断言 (创建、确权、拉人、公告、踢人防孤儿)
 * 6. ChatGroupController HTTP 控制器与 401/403 门禁拦截
 * 7. 会话大盘协同融合测试 (群聊自动进入会话大盘列表)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { GroupMemberRole } from "../apps/chat/chatGroupTypes.js";
import { GroupReadCursorCalculator } from "../apps/chat/groupReadCursorCalculator.js";
import { IncidentTagMemberMatcher } from "../apps/chat/incidentTagMemberMatcher.js";
import { NineGridAvatarCompositor } from "../apps/chat/nineGridAvatarCompositor.js";
import { HybridGroupFanOutOptimizer } from "../apps/chat/hybridGroupFanOutOptimizer.js";
import { ChatGroupService } from "../apps/chat/chatGroupService.js";
import { ChatGroupController } from "../apps/chat/chatGroupController.js";
import { ChatSessionService } from "../apps/chat/chatSessionService.js";
import { WeChatAuthService } from "../services/auth/wechatAuthService.js";

describe("M41: 科室工作群与突发险情应急抢险群聊 (Group Chat & Incident Coordination)", () => {
  let groupService: ChatGroupService;
  let groupController: ChatGroupController;

  beforeEach(() => {
    TestHarness.resetSandbox();
    groupService = new ChatGroupService();
    groupController = new ChatGroupController(groupService);
  });

  // =========================================================================
  // 1. 算法 1: 群聊已读游标与差量未读计算器
  // =========================================================================
  describe("1. 算法 1: GroupReadCursorCalculator 已读游标与未读差量计算", () => {
    it("M41-01: 未读数基础计算 - 最新消息大于游标时准确计算差量", () => {
      const unread = GroupReadCursorCalculator.calculateUnread(100, 115);
      expect(unread).toBe(15);
    });

    it("M41-02: 游标大于等于最新消息时未读数必须严格为 0", () => {
      expect(GroupReadCursorCalculator.calculateUnread(100, 100)).toBe(0);
      expect(GroupReadCursorCalculator.calculateUnread(105, 100)).toBe(0);
    });

    it("M41-03: 撤回消息脱敏扣减 - 自动过滤区间内的已撤回消息", () => {
      // 范围 (100, 110]，共 10 条消息，其中 103 与 107 已被撤回
      const withdrawnIds = [95, 103, 107, 115];
      const unread = GroupReadCursorCalculator.calculateUnread(100, 110, withdrawnIds);
      expect(unread).toBe(8); // 10 - 2 = 8
    });

    it("M41-04: 游标单调递增性 - advanceCursor 杜绝时空倒流", () => {
      expect(GroupReadCursorCalculator.advanceCursor(100, 150)).toBe(150);
      expect(GroupReadCursorCalculator.advanceCursor(150, 120)).toBe(150); // 乱序旧回执忽略
    });
  });

  // =========================================================================
  // 2. 算法 2: 突发险情职能标签智能推荐
  // =========================================================================
  describe("2. 算法 2: IncidentTagMemberMatcher 险情标签人员匹配", () => {
    it("M41-05: 电气火险类目推荐强电班组、安全生产监督员与责任人", () => {
      const schoolId = 1;
      const candidates = [
        { id: 101, schoolId: 1, role: 1, realName: "强电张师傅" },
        { id: 102, schoolId: 1, role: 1, realName: "绿化李师傅" },
        { id: 103, schoolId: 1, role: 1, realName: "安全员王老师" },
        { id: 104, schoolId: 2, role: 1, realName: "外校电工" }, // 外部学校
        { id: 801, schoolId: 1, role: 1, realName: "工单责任人" }
      ];

      const tagMap = new Map<number, string[]>([
        [101, ["强电班组", "高压电工证"]],
        [102, ["绿化苗木班"]],
        [103, ["安全生产监督员"]],
        [104, ["强电班组"]],
        [801, ["通用维修"]]
      ]);

      const matched = IncidentTagMemberMatcher.matchRecommendedMembers(
        {
          schoolId,
          categoryName: "配电房火警隐患",
          patrolHandlerId: 801,
          dutyLeaderIds: [103]
        },
        candidates,
        tagMap
      );

      // 应当包含 101 (强电), 103 (安全员/领导), 801 (责任人)
      expect(matched).toContain(101);
      expect(matched).toContain(103);
      expect(matched).toContain(801);
      // 绝不可包含外校人员 104 或无关人员 102
      expect(matched).not.toContain(104);
      expect(matched).not.toContain(102);
    });
  });

  // =========================================================================
  // 3. 算法 3: 群聊九宫格头像动态合成拓扑
  // =========================================================================
  describe("3. 算法 3: NineGridAvatarCompositor 九宫格拓扑与 SVG 生成", () => {
    it("M41-06: 数量对应网格坐标计算验证 (1~9个)", () => {
      expect(NineGridAvatarCompositor.calculateGridLayout(1).length).toBe(1);
      expect(NineGridAvatarCompositor.calculateGridLayout(2).length).toBe(2);
      expect(NineGridAvatarCompositor.calculateGridLayout(3).length).toBe(3);
      expect(NineGridAvatarCompositor.calculateGridLayout(4).length).toBe(4);
      expect(NineGridAvatarCompositor.calculateGridLayout(6).length).toBe(6);
      expect(NineGridAvatarCompositor.calculateGridLayout(9).length).toBe(9);
    });

    it("M41-07: 生成标准内联 SVG DataURL 格式", () => {
      const svgUrl = NineGridAvatarCompositor.generateNineGridSvg([
        "https://example.com/a1.png",
        "https://example.com/a2.png",
        "https://example.com/a3.png"
      ]);
      expect(svgUrl).toContain("data:image/svg+xml;utf8,");
      expect(svgUrl).toContain("%3Csvg");
    });
  });

  // =========================================================================
  // 4. 算法 4: 混合推流总线与 @所有人 强穿透
  // =========================================================================
  describe("4. 算法 4: HybridGroupFanOutOptimizer @所有人 强穿透评估", () => {
    it("M41-08: 检测消息是否包含 @所有人 指令", () => {
      expect(HybridGroupFanOutOptimizer.detectIsAtAll("@所有人 抢修进场！")).toBe(true);
      expect(HybridGroupFanOutOptimizer.detectIsAtAll("紧急通知 @all 请注意")).toBe(true);
      expect(HybridGroupFanOutOptimizer.detectIsAtAll("普通工单沟通")).toBe(false);
    });

    it("M41-09: 强穿透判定 - 开启免打扰的用户在 @所有人 时依然触发强提醒", () => {
      const policy = HybridGroupFanOutOptimizer.evaluateNotificationPolicy(
        true,  // isAtAll
        true,  // isUserMuted
        false  // isSender
      );
      expect(policy.shouldNotifyUser).toBe(true);
      expect(policy.vibrationType).toBe("heavy");
      expect(policy.highlightTag).toBe("【有人@我】");
    });

    it("M41-10: 免打扰普通消息不予震动提醒", () => {
      const policy = HybridGroupFanOutOptimizer.evaluateNotificationPolicy(
        false, // isAtAll
        true,  // isUserMuted
        false  // isSender
      );
      expect(policy.shouldNotifyUser).toBe(false);
      expect(policy.vibrationType).toBe("none");
    });
  });

  // =========================================================================
  // 5. ChatGroupService 核心业务与三级权限阶梯
  // =========================================================================
  describe("5. ChatGroupService 核心业务全链路", () => {
    const schoolId = 1;
    const creatorId = 88; // 师傅兼群主

    it("M41-11: 创建群聊自动确权群主(role=2)并批量装填初始成员", async () => {
      // 注册模拟用户
      WeChatAuthService.mockRegisterUser({ id: 88, schoolId, openId: "wx_88", realName: "群主王师傅" });
      WeChatAuthService.mockRegisterUser({ id: 101, schoolId, openId: "wx_101", realName: "成员李师傅" });
      WeChatAuthService.mockRegisterUser({ id: 102, schoolId, openId: "wx_102", realName: "成员张师傅" });

      const res = await groupService.createGroup(schoolId, creatorId, {
        title: "西校区配电房应急抢修群",
        patrolId: 9001,
        memberUserIds: [101, 102],
        initialNotice: "注意现场带电防护，切断分路总闸！"
      });

      expect(res.chatRoomId).toBeGreaterThan(0);
      expect(res.title).toBe("西校区配电房应急抢修群");
      expect(res.memberCount).toBe(3);

      // 核验证群主角色
      const ownerRole = await groupService.getUserGroupRole(schoolId, res.chatRoomId, creatorId);
      expect(ownerRole).toBe(GroupMemberRole.OWNER);

      // 核验普通成员角色
      const memberRole = await groupService.getUserGroupRole(schoolId, res.chatRoomId, 101);
      expect(memberRole).toBe(GroupMemberRole.MEMBER);
    });

    it("M41-12: 发布群公告三级权限断言 - 仅限群主与管理员，普通成员 403 拦截", async () => {
      const groupRes = await groupService.createGroup(schoolId, creatorId, {
        title: "科室日常业务群",
        memberUserIds: [101]
      });
      const roomId = groupRes.chatRoomId;

      // 1. 群主 (role=2) 发布公告成功
      const ownerNotice = await groupService.publishNotice(schoolId, creatorId, {
        chatRoomId: roomId,
        content: "周五下午安全生产培训准时参加",
        isPinned: true
      });
      expect(ownerNotice.content).toBe("周五下午安全生产培训准时参加");
      expect(ownerNotice.isPinned).toBe(true);

      // 2. 普通成员 (role=0) 发布公告必须抛出权限不足 403 异常
      await expect(
        groupService.publishNotice(schoolId, 101, {
          chatRoomId: roomId,
          content: "普通成员违规公告",
          isPinned: true
        })
      ).rejects.toThrow("权限不足");
    });

    it("M41-13: 滑动更新已读游标与非成员拦截", async () => {
      const groupRes = await groupService.createGroup(schoolId, creatorId, {
        title: "抢修协同群",
        memberUserIds: [101]
      });
      const roomId = groupRes.chatRoomId;

      // 成员同步游标成功
      const ackRes = await groupService.updateReadCursor(schoolId, roomId, 101, 2050);
      expect(ackRes.lastReadMessageId).toBe(2050);
      expect(ackRes.effectiveUnreadCount).toBe(0);

      // 非成员同步被阻断
      await expect(
        groupService.updateReadCursor(schoolId, roomId, 999, 2050)
      ).rejects.toThrow("并非该群聊成员");
    });

    it("M41-14: 群主退出群聊防孤儿熔断保护 - 多于1人时必须先转让群主", async () => {
      const groupRes = await groupService.createGroup(schoolId, creatorId, {
        title: "防孤儿测试群",
        memberUserIds: [101]
      });
      const roomId = groupRes.chatRoomId;

      // 群内有其他人，群主直接退群应被强制拦截
      await expect(
        groupService.removeMember(schoolId, creatorId, roomId, creatorId)
      ).rejects.toThrow("请先转让群主身份");
    });

    it("M41-15: 普通成员被管理员移出与群主只剩一人自愈解散", async () => {
      const groupRes = await groupService.createGroup(schoolId, creatorId, {
        title: "解散测试群",
        memberUserIds: [101]
      });
      const roomId = groupRes.chatRoomId;

      // 群主踢出成员 101
      const kickRes = await groupService.removeMember(schoolId, creatorId, roomId, 101);
      expect(kickRes.success).toBe(true);
      expect(kickRes.isDisbanded).toBe(false);

      // 群内只剩群主一人，群主退群直接解散
      const disbandRes = await groupService.removeMember(schoolId, creatorId, roomId, creatorId);
      expect(disbandRes.success).toBe(true);
      expect(disbandRes.isDisbanded).toBe(true);
    });

    it("M41-16: 免打扰模式切换", async () => {
      const groupRes = await groupService.createGroup(schoolId, creatorId, {
        title: "免打扰测试群",
        memberUserIds: [101]
      });
      const roomId = groupRes.chatRoomId;

      const muteRes = await groupService.toggleMute(schoolId, 101, roomId, true);
      expect(muteRes.isMuted).toBe(true);

      const detail = await groupService.getGroupDetail(schoolId, roomId, 101);
      expect(detail.isMuted).toBe(true);
    });
  });

  // =========================================================================
  // 6. ChatGroupController HTTP 控制器调度与鉴权
  // =========================================================================
  describe("6. ChatGroupController HTTP 控制器鉴权与错误包裹", () => {
    const schoolId = 1;
    const userId = 88;

    it("M41-17: createGroup 参数缺失拦截", async () => {
      const res = await groupController.createGroup({
        schoolId,
        userId,
        body: { title: "" } // 空名称
      });
      expect(res.status).toBe(0);
      expect(res.content).toContain("必须为非空字符串");
    });

    it("M41-18: publishNotice 越权 403 包裹", async () => {
      const group = await groupService.createGroup(schoolId, userId, {
        title: "控制器测试群",
        memberUserIds: [101]
      });

      // 普通成员 101 发公告
      const res = await groupController.publishNotice({
        schoolId,
        userId: 101,
        body: { chatRoomId: group.chatRoomId, content: "违规通知" }
      });
      expect(res.status).toBe(0);
      expect(res.content).toContain("权限不足");
    });

    it("M41-19: getGroupDetail 成功获取并包含九宫格数据", async () => {
      const group = await groupService.createGroup(schoolId, userId, {
        title: "水电维修突发协同",
        patrolId: 10086,
        memberUserIds: [101, 102]
      });

      const res = await groupController.getGroupDetail({
        schoolId,
        userId,
        query: { chatRoomId: group.chatRoomId }
      });
      expect(res.status).toBe(1);
      expect(res.data.title).toBe("水电维修突发协同");
      expect(res.data.memberCount).toBe(3);
      expect(res.data.isOwnerOrAdmin).toBe(true);
    });
  });

  // =========================================================================
  // 7. 会话大盘协同融合测试 (M40 + M41 融合)
  // =========================================================================
  describe("7. 会话大盘与群聊融合", () => {
    it("M41-20: 用户会话列表自动包含加入的群聊并展示九宫格与抢险群标识", async () => {
      const schoolId = 1;
      const userId = 88;

      await groupService.createGroup(schoolId, userId, {
        title: "突发汛情防汛总指挥群",
        patrolId: 2026,
        memberUserIds: [101]
      });

      const sessionService = new ChatSessionService();
      const sessions = await sessionService.getUserSessions(schoolId, userId, 1);

      const groupSession = sessions.find((s) => s.targetPeerName.includes("防汛"));
      expect(groupSession).toBeDefined();
      expect(groupSession?.targetPeerRoleTag).toBe("抢险群");
      expect(groupSession?.patrolOrderNo).toBe("QX2026");
      expect(groupSession?.targetPeerAvatar).toContain("data:image/svg+xml");
    });
  });
});
