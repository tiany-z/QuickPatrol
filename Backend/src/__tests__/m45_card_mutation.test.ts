/**
 * 高校后勤巡查e速办 v4.0 - M45: 卡片原地状态动态演进引擎 20 项专项单元测试套件
 * (M45 Card In-Place State Mutation Engine Test Suite)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TestHarness } from "./testHarness.js";
import { CardActionType, CardMorphismState } from "../hub/cardMutationTypes.js";
import { CardPayloadMorphismEngine } from "../hub/cardPayloadMorphismEngine.js";
import { CardMutationService } from "../hub/cardMutationService.js";
import { CardMutationController } from "../hub/cardMutationController.js";
import { CardInPlaceMutator } from "../hub/cardInPlaceMutator.js";
import { IStructuredCardPayload } from "../hub/appFeedTypes.js";
import { handleCardAction } from "../api/v4/notification/card-action/handler.js";
import cardActionApiEndpoint from "../api/v4/notification/card-action/index.js";

describe("[M45] 卡片原地状态动态演进引擎测试套件", () => {
  let mutationService: CardMutationService;
  let mutationController: CardMutationController;
  let mockDb: any;
  let mockRedis: any;
  let fakePatrol: any;
  let fakeMessage: any;
  let fakeUser: any;
  let publishedMessages: any[];

  beforeEach(() => {
    TestHarness.resetSandbox();
    publishedMessages = [];

    fakeUser = {
      id: 88,
      schoolId: 1,
      nickName: "张师傅"
    };

    fakePatrol = {
      id: 1001,
      schoolId: 1,
      status: 0, // 0: 待接单
      handlerId: 0
    };

    fakeMessage = {
      id: 9001,
      schoolId: 1,
      cardPayloadJson: JSON.stringify({
        header: {
          badgeTitle: "特急派单",
          statusPill: "待接单",
          statusColor: "volcano",
          timestamp: "刚刚"
        },
        fields: [
          { label: "隐患编号", value: "#LCU-2026-001" },
          { label: "隐患点位", value: "西校区12号楼302配电箱", highlight: true }
        ],
        thumbnailUrl: "https://oss.xcesb.cn/thumb_power.webp",
        rawImageUrl: "https://oss.xcesb.cn/raw_power.jpg",
        actions: [
          { actionId: "ACCEPT_ORDER", text: "⚡ 立即接单抢修", type: "primary" },
          { actionId: "CALL_PHONE", text: "拨打报修人", type: "default" }
        ],
        slaDeadlineAt: "2026-09-06T16:00:00.000Z"
      })
    };

    mockDb = {
      query: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes("FROM users")) {
          const userId = params[0];
          const schoolId = params[1];
          if (fakeUser.id === userId && fakeUser.schoolId === schoolId) {
            return [fakeUser];
          }
          return [];
        }
        if (sql.includes("FROM messages")) {
          const msgId = params[0];
          const schoolId = params[1];
          if (fakeMessage.id === msgId && fakeMessage.schoolId === schoolId) {
            return [fakeMessage];
          }
          return [];
        }
        if (sql.includes("FROM patrols") && sql.includes("FOR UPDATE")) {
          const patrolId = params[0];
          const schoolId = params[1];
          if (fakePatrol.id === patrolId && fakePatrol.schoolId === schoolId) {
            return [fakePatrol];
          }
          return [];
        }
        return [];
      }),
      execute: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes("UPDATE patrols SET status = 1")) {
          fakePatrol.status = 1;
          fakePatrol.handlerId = params[0];
          return { insertId: 0, affectedRows: 1 };
        }
        if (sql.includes("UPDATE patrols SET status = 3")) {
          fakePatrol.status = 3;
          return { insertId: 0, affectedRows: 1 };
        }
        if (sql.includes("UPDATE patrols SET status = 5")) {
          fakePatrol.status = 5;
          return { insertId: 0, affectedRows: 1 };
        }
        if (sql.includes("UPDATE messages SET cardPayloadJson")) {
          fakeMessage.cardPayloadJson = params[0];
          return { insertId: 0, affectedRows: 1 };
        }
        return { insertId: 0, affectedRows: 1 };
      })
    };

    mockRedis = {
      publish: vi.fn(async (channel: string, message: string) => {
        publishedMessages.push({ channel, data: JSON.parse(message) });
        return 1;
      }),
      eval: vi.fn(async (_script: string, _numkeys: number, _key: string, arg: string) => {
        publishedMessages.push({ channel: "ws_broadcast_bus", data: JSON.parse(arg) });
        return 1;
      })
    };

    mutationService = new CardMutationService(mockDb, mockRedis);
    mutationController = new CardMutationController(mutationService);

    // 亦配置全局沙箱以支持直接通过 Controller/Gateway 独立无参实例调用
    CardMutationService.setMockUser(fakeUser);
    CardMutationService.setMockPatrol(fakePatrol);
    CardMutationService.setMockMessage(fakeMessage);
  });

  // =========================================================================
  // 算法 1: 卡片 JSON 快照增量差异修补与结构重铸算法测试 (用例 01 ~ 06)
  // =========================================================================

  it("[M45-01] 算法 1 结构重铸: 师傅接单 ACCEPT_ORDER，状态胶囊演进为抢修中(blue)，追加责任师傅字段，动作按钮推演为现场交卷与申请延期", () => {
    const oldPayload: IStructuredCardPayload = JSON.parse(fakeMessage.cardPayloadJson);
    const morphed = CardPayloadMorphismEngine.morph(oldPayload, CardActionType.ACCEPT_ORDER, "张师傅");

    expect(morphed.header.statusPill).toBe("抢修中");
    expect(morphed.header.statusColor).toBe("blue");

    const handlerField = morphed.fields.find(f => f.label === "责任师傅");
    expect(handlerField).toBeDefined();
    expect(handlerField?.value).toBe("张师傅");
    expect(handlerField?.highlight).toBe(true);

    expect(morphed.actions).toBeDefined();
    expect(morphed.actions?.[0].actionId).toBe("FINISH_WORK");
    expect(morphed.actions?.[0].text).toBe("现场交卷");
    expect(morphed.actions?.[0].type).toBe("primary");
    expect(morphed.actions?.[1].actionId).toBe("APPLY_DELAY");
    expect(morphed.actions?.[1].text).toBe("申请延期");
  });

  it("[M45-02] 算法 1 结构重铸: 申请延期 APPLY_DELAY，状态胶囊演进为延期审批中(orange)，追加延期原因字段，按钮置灰等待", () => {
    const oldPayload: IStructuredCardPayload = JSON.parse(fakeMessage.cardPayloadJson);
    const morphed = CardPayloadMorphismEngine.morph(oldPayload, CardActionType.APPLY_DELAY, "张师傅", {
      delayReason: "缺少380V空开备件，已提请库房调拨"
    });

    expect(morphed.header.statusPill).toBe("延期审批中");
    expect(morphed.header.statusColor).toBe("orange");

    const delayField = morphed.fields.find(f => f.label === "延期申请");
    expect(delayField).toBeDefined();
    expect(delayField?.value).toContain("缺少380V空开备件");

    expect(morphed.actions?.[0].actionId).toBe("CHECK_DELAY");
    expect(morphed.actions?.[0].disabled).toBe(true);
  });

  it("[M45-03] 算法 1 结构重铸: 现场交卷 FINISH_WORK，状态胶囊演进为待复核(green)，追加施工存根，按钮变为等待网格长核验", () => {
    const oldPayload: IStructuredCardPayload = JSON.parse(fakeMessage.cardPayloadJson);
    const morphed = CardPayloadMorphismEngine.morph(oldPayload, CardActionType.FINISH_WORK, "张师傅", {
      workDesc: "配电箱空开更换完毕，现场已试通电恢复供电"
    });

    expect(morphed.header.statusPill).toBe("待复核");
    expect(morphed.header.statusColor).toBe("green");

    const stubField = morphed.fields.find(f => f.label === "施工存根");
    expect(stubField).toBeDefined();
    expect(stubField?.value).toContain("现场已试通电恢复供电");

    expect(morphed.actions?.[0].actionId).toBe("WAIT_REVIEW");
    expect(morphed.actions?.[0].disabled).toBe(true);
  });

  it("[M45-04] 算法 1 结构重铸: 质检合格归档 CLOSE_ORDER，状态胶囊演进为已办结(gray)，按钮置灰已归档", () => {
    const oldPayload: IStructuredCardPayload = JSON.parse(fakeMessage.cardPayloadJson);
    const morphed = CardPayloadMorphismEngine.morph(oldPayload, CardActionType.CLOSE_ORDER, "质检员", {
      reviewResult: "现场复核合格，接线规范，5星满意结案"
    });

    expect(morphed.header.statusPill).toBe("已办结");
    expect(morphed.header.statusColor).toBe("gray");

    const closeField = morphed.fields.find(f => f.label === "归档结论");
    expect(closeField).toBeDefined();
    expect(closeField?.value).toContain("5星满意结案");

    expect(morphed.actions?.[0].actionId).toBe("VIEW_ARCHIVE");
    expect(morphed.actions?.[0].disabled).toBe(true);
  });

  it("[M45-05] 算法 1 结构重铸: 质检不合格驳回 REJECT_REVIEW，状态胶囊变回抢修中(volcano)，按钮演进为重新交卷与申请延期", () => {
    const oldPayload: IStructuredCardPayload = JSON.parse(fakeMessage.cardPayloadJson);
    const morphed = CardPayloadMorphismEngine.morph(oldPayload, CardActionType.REJECT_REVIEW, "质检员", {
      rejectReason: "配电箱盖未紧固，存在安全隐患"
    });

    expect(morphed.header.statusPill).toBe("抢修中(已驳回)");
    expect(morphed.header.statusColor).toBe("volcano");

    const rejectField = morphed.fields.find(f => f.label === "驳回原因");
    expect(rejectField).toBeDefined();
    expect(rejectField?.value).toContain("配电箱盖未紧固");

    expect(morphed.actions?.[0].actionId).toBe("FINISH_WORK");
    expect(morphed.actions?.[0].text).toBe("重新交卷");
    expect(morphed.actions?.[1].actionId).toBe("APPLY_DELAY");
  });

  it("[M45-06] 算法 1 结构重铸: 原始卡片基础元数据(如现场损坏原图rawImageUrl、SLA截止时间slaDeadlineAt)在重铸中绝对保留", () => {
    const oldPayload: IStructuredCardPayload = JSON.parse(fakeMessage.cardPayloadJson);
    const morphed = CardPayloadMorphismEngine.morph(oldPayload, CardActionType.ACCEPT_ORDER, "张师傅");

    expect(morphed.rawImageUrl).toBe("https://oss.xcesb.cn/raw_power.jpg");
    expect(morphed.thumbnailUrl).toBe("https://oss.xcesb.cn/thumb_power.webp");
    expect(morphed.slaDeadlineAt).toBe("2026-09-06T16:00:00.000Z");
    expect(morphed.fields.find(f => f.label === "隐患编号")?.value).toBe("#LCU-2026-001");
  });

  // =========================================================================
  // 算法 2: 基于行锁的 CAS 原子抢单与原地快照覆写服务测试 (用例 07 ~ 14)
  // =========================================================================

  it("[M45-07] 算法 2 原子状态流转: 师傅点击立即接单，工单状态由 0 更新为 1，记录处理人 handlerId 与施工流水表 patrols_handle", async () => {
    const res = await mutationService.executeCardAction(1, 88, {
      messageId: 9001,
      patrolId: 1001,
      actionId: CardActionType.ACCEPT_ORDER
    });

    expect(res.code).toBe(200);
    expect(res.data.nextState).toBe(CardMorphismState.IN_PROGRESS);
    expect(fakePatrol.status).toBe(1);
    expect(fakePatrol.handlerId).toBe(88);
    expect(mockDb.execute).toHaveBeenCalled();
  });

  it("[M45-08] 算法 2 抢单并发冲突拦截: 当工单 status !== 0 (已被他人接单) 时，CAS 校验拦截并抛出手慢友好提示", async () => {
    fakePatrol.status = 1; // 已被接单
    fakePatrol.handlerId = 99;

    await expect(
      mutationService.executeCardAction(1, 88, {
        messageId: 9001,
        patrolId: 1001,
        actionId: CardActionType.ACCEPT_ORDER
      })
    ).rejects.toThrow("已被其他师傅认领");
  });

  it("[M45-09] 算法 2 原地覆盖重写: 变迁成功后物理表 messages.cardPayloadJson 被原地覆写，绝不增加任何新消息记录", async () => {
    const res = await mutationService.executeCardAction(1, 88, {
      messageId: 9001,
      patrolId: 1001,
      actionId: CardActionType.ACCEPT_ORDER
    });

    expect(res.code).toBe(200);
    const updatedPayload = JSON.parse(fakeMessage.cardPayloadJson);
    expect(updatedPayload.header.statusPill).toBe("抢修中");
    expect(fakeMessage.id).toBe(9001); // 物理主键严格不变
  });

  it("[M45-10] 算法 2 Redis Pub/Sub 全双工广播: 原地变迁成功后发布 CARD_MUTATED 广播信令至总线，载荷完整包含最新重铸快照", async () => {
    await mutationService.executeCardAction(1, 88, {
      messageId: 9001,
      patrolId: 1001,
      actionId: CardActionType.ACCEPT_ORDER
    });

    expect(publishedMessages.length).toBeGreaterThan(0);
    const broadcast = publishedMessages[0].data;
    expect(broadcast.event).toBe("CARD_MUTATED");
    expect(broadcast.schoolId).toBe(1);
    expect(broadcast.messageId).toBe(9001);
    expect(broadcast.patrolId).toBe(1001);
    expect(broadcast.operatorId).toBe(88);
    expect(broadcast.operatorName).toBe("张师傅");
    expect(broadcast.nextState).toBe(CardMorphismState.IN_PROGRESS);
    expect(broadcast.version).toBe(2);
    expect(broadcast.mutatedCardPayload.header.statusPill).toBe("抢修中");
  });

  it("[M45-11] 算法 2 多租户隔离防护: 当操作他人学校卡片(schoolId不匹配)时，严格阻断并抛出无权访问异常", async () => {
    await expect(
      mutationService.executeCardAction(2, 88, { // 租户传 2，但消息属于学校 1
        messageId: 9001,
        patrolId: 1001,
        actionId: CardActionType.ACCEPT_ORDER
      })
    ).rejects.toThrow("不存在或无权访问");
  });

  it("[M45-12] 算法 2 异常拦截: 目标卡片消息记录不存在时抛出 404 语义异常", async () => {
    await expect(
      mutationService.executeCardAction(1, 88, {
        messageId: 999999, // 不存在的消息 ID
        patrolId: 1001,
        actionId: CardActionType.ACCEPT_ORDER
      })
    ).rejects.toThrow("不存在或无权访问");
  });

  it("[M45-13] 算法 2 异常拦截: 目标工单不存在时抛出异常", async () => {
    await expect(
      mutationService.executeCardAction(1, 88, {
        messageId: 9001,
        patrolId: 888888, // 不存在的工单 ID
        actionId: CardActionType.ACCEPT_ORDER
      })
    ).rejects.toThrow("关联工单不存在或无权访问");
  });

  it("[M45-14] 算法 2 参数前置校验: 缺少 schoolId、userId 或必要动作字段时严格拒绝", async () => {
    await expect(
      mutationService.executeCardAction(0, 88, {
        messageId: 9001,
        patrolId: 1001,
        actionId: CardActionType.ACCEPT_ORDER
      })
    ).rejects.toThrow("缺少高校租户标识");

    await expect(
      mutationService.executeCardAction(1, 0, {
        messageId: 9001,
        patrolId: 1001,
        actionId: CardActionType.ACCEPT_ORDER
      })
    ).rejects.toThrow("无效操作人身份");
  });

  // =========================================================================
  // 算法 3 & 4: 端侧本地卡片就地突变与版本向量仲裁测试 (用例 15 ~ 16)
  // =========================================================================

  it("[M45-15] 算法 3 端侧原地突变引擎: CardInPlaceMutator 成功在本地卡片数组中就地覆写并激活 isMutatingAnim 动效标记", () => {
    const initialList = [
      { messageId: 9001, cardPayload: { header: { statusPill: "待接单" } }, version: 1 },
      { messageId: 9002, cardPayload: { header: { statusPill: "待接单" } }, version: 1 }
    ];

    const nextPayload = { header: { statusPill: "抢修中", statusColor: "blue" } };
    const { nextList, success, hitIndex } = CardInPlaceMutator.mutate(
      initialList,
      9001,
      nextPayload,
      2
    );

    expect(success).toBe(true);
    expect(hitIndex).toBe(0);
    expect(nextList.length).toBe(2);
    expect(nextList[0].cardPayload.header.statusPill).toBe("抢修中");
    expect(nextList[0].isMutatingAnim).toBe(true);
    expect(nextList[0].version).toBe(2);
    expect(nextList[1].cardPayload.header.statusPill).toBe("待接单"); // 项 2 不受影响
  });

  it("[M45-16] 算法 4 端侧版本向量仲裁: 当收到迟到的旧版本或同版本信令时，CardInPlaceMutator 丢弃废包避免状态回滚", () => {
    const initialList = [
      { messageId: 9001, cardPayload: { header: { statusPill: "待复核" } }, version: 4 }
    ];

    // 弱网延迟到达了版本 2 的旧包
    const stalePayload = { header: { statusPill: "抢修中" } };
    const { nextList, success, reason } = CardInPlaceMutator.mutate(
      initialList,
      9001,
      stalePayload,
      2
    );

    expect(success).toBe(false);
    expect(reason).toBe("OUTDATED_VERSION");
    expect(nextList[0].cardPayload.header.statusPill).toBe("待复核"); // 状态未倒退回滚
  });

  // =========================================================================
  // 控制器与网关路由端点测试 (用例 17 ~ 19)
  // =========================================================================

  it("[M45-17] Controller 层参数校验与租户上下文解析: 缺少必要参数时返回 400 状态码", async () => {
    const resMissing = await mutationController.handleCardAction({
      schoolId: 1,
      userId: 88,
      body: { messageId: 9001 } // 缺少 patrolId, actionId
    });
    expect(resMissing.code).toBe(400);
    expect(resMissing.message).toContain("缺少必要参数");

    const resInvalid = await mutationController.handleCardAction({
      schoolId: 1,
      userId: 88,
      body: { messageId: "abc", patrolId: 1001, actionId: "ACCEPT_ORDER" }
    });
    expect(resInvalid.code).toBe(400);
  });

  it("[M45-18] Controller 层 409 竞态拦截友好捕获: 捕获抢单失败并返回 409 与 fallbackState: LOST_RACE", async () => {
    fakePatrol.status = 1; // 已被抢

    const res = await mutationController.handleCardAction({
      schoolId: 1,
      userId: 88,
      body: {
        messageId: 9001,
        patrolId: 1001,
        actionId: CardActionType.ACCEPT_ORDER
      }
    });

    expect(res.code).toBe(409);
    expect(res.fallbackState).toBe("LOST_RACE");
    expect(res.message).toContain("已被其他师傅认领");
  });

  it("[M45-19] 网关路由端点 POST /api/v4/notification/card-action 身份未登录校验测试", async () => {
    const unauthRes = await cardActionApiEndpoint.handler(
      { body: { messageId: 9001, patrolId: 1001, actionId: "ACCEPT_ORDER" } } as any,
      { userPayload: null } as any
    );
    expect(unauthRes.status).toBe(0);
    expect(unauthRes.content).toBe("请先登录");

    const noSchoolRes = await cardActionApiEndpoint.handler(
      { body: { messageId: 9001, patrolId: 1001, actionId: "ACCEPT_ORDER" } } as any,
      { userPayload: { userId: 88, schoolId: 0 } } as any
    );
    expect(noSchoolRes.status).toBe(0);
    expect(noSchoolRes.content).toBe("缺少高校租户标识");
  });

  // =========================================================================
  // 全生命周期连续原地演进闭环测试 (用例 20)
  // =========================================================================

  it("[M45-20] 完整端到端生命周期演变流: 待接单 -> 抢修中 -> 延期申请 -> 现场交卷 -> 结案归档，单张卡片贯穿全程", async () => {
    // 节点 1: 师傅接单
    const r1 = await mutationService.executeCardAction(1, 88, {
      messageId: 9001,
      patrolId: 1001,
      actionId: CardActionType.ACCEPT_ORDER
    });
    expect(r1.code).toBe(200);
    expect(r1.data.mutatedCardPayload.header.statusPill).toBe("抢修中");
    expect(fakePatrol.status).toBe(1);

    // 节点 2: 缺少配件申请延期
    const r2 = await mutationService.executeCardAction(1, 88, {
      messageId: 9001,
      patrolId: 1001,
      actionId: CardActionType.APPLY_DELAY,
      actionPayload: { delayReason: "备件采购中" }
    });
    expect(r2.code).toBe(200);
    expect(r2.data.mutatedCardPayload.header.statusPill).toBe("延期审批中");

    // 节点 3: 施工完成现场交卷
    const r3 = await mutationService.executeCardAction(1, 88, {
      messageId: 9001,
      patrolId: 1001,
      actionId: CardActionType.FINISH_WORK,
      actionPayload: { workDesc: "已更换备件并通电测试完成" }
    });
    expect(r3.code).toBe(200);
    expect(r3.data.mutatedCardPayload.header.statusPill).toBe("待复核");
    expect(fakePatrol.status).toBe(3);

    // 节点 4: 网格长复核合格结案归档
    const r4 = await mutationService.executeCardAction(1, 88, {
      messageId: 9001,
      patrolId: 1001,
      actionId: CardActionType.CLOSE_ORDER,
      actionPayload: { reviewResult: "复核合格" }
    });
    expect(r4.code).toBe(200);
    expect(r4.data.mutatedCardPayload.header.statusPill).toBe("已办结");
    expect(fakePatrol.status).toBe(5);

    // 全生命周期仅有 1 张卡片，物理消息 ID 始终是 9001
    expect(fakeMessage.id).toBe(9001);
  });
});
