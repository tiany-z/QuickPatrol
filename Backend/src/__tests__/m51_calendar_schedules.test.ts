/**
 * 高校后勤巡查e速办 v4.0 - M51 单元测试套件
 * 文件路径: src/__tests__/m51_calendar_schedules.test.ts
 * 验证目标:
 *   1. 42 单元格月网格自适应投影恒定性 (42-Cell Grid)
 *   2. 工单 SLA 动态时间衰减与健康度函数 (SLA Decay Function)
 *   3. 00:00~24:00 垂直时刻时间槽与贪心重叠排版 (Greedy Column Layout)
 *   4. 值班排班人员名牌提取与一键呼叫参数装配
 *   5. 结案工单 (status=4) 物理消解与零幽灵残留
 *   6. 跨校租户物理隔离与软删除
 *   7. /api/v1/schedules/month, /api/v1/schedules/day, /api/v1/schedules/create 网关路由集成
 */

import { describe, it, expect, beforeEach } from "vitest";
import { scheduleService, ScheduleService } from "../services/scheduleService.js";
import { scheduleController } from "../controllers/scheduleController.js";
import monthApi from "../api/v1/schedules/month/index.js";
import dayApi from "../api/v1/schedules/day/index.js";
import createApi from "../api/v1/schedules/create/index.js";

describe("M51: 全景日历日程联动与值班排班表测试套件", () => {
  beforeEach(() => {
    ScheduleService.resetMock();
  });

  it("[M51-01] 42 单元格月网格恒定性: 平年2月与大月31天生成的单元格数组长度恒定为 42", () => {
    // 平年 2 月 (2026年2月)
    const febCells = scheduleService.generate42GridCells(2026, 2);
    expect(febCells.length).toBe(42);

    // 大月 31 天 (2026年9月)
    const sepCells = scheduleService.generate42GridCells(2026, 9);
    expect(sepCells.length).toBe(42);

    // 闰年 2 月 (2028年2月)
    const leapFebCells = scheduleService.generate42GridCells(2028, 2);
    expect(leapFebCells.length).toBe(42);
  });

  it("[M51-02] 跨月份单元格边界与 isCurrentMonth 准确性: 当月天数统计无误", () => {
    const sepCells = scheduleService.generate42GridCells(2026, 9);
    const currentMonthDays = sepCells.filter((c) => c.isCurrentMonth);
    expect(currentMonthDays.length).toBe(30); // 9月共30天

    const prevMonthDays = sepCells.filter((c, idx) => !c.isCurrentMonth && idx < 10);
    const nextMonthDays = sepCells.filter((c, idx) => !c.isCurrentMonth && idx >= 30);
    expect(prevMonthDays.length + currentMonthDays.length + nextMonthDays.length).toBe(42);
  });

  it("[M51-03] 当日 isToday 状态自适应高亮标记: 仅今天对应的单元格标记为 true", () => {
    const now = new Date();
    const cells = scheduleService.generate42GridCells(now.getFullYear(), now.getMonth() + 1);
    const todayCells = cells.filter((c) => c.isToday);
    expect(todayCells.length).toBe(1);
    expect(todayCells[0].dayNumber).toBe(now.getDate());
  });

  it("[M51-04] 工单 SLA 动态时间衰减与健康度函数: 剩余时效按比例映射色标", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    const createdAt = new Date("2026-09-03T00:00:00Z"); // 总时效 24h

    // 1. 剩余 18h: lambda = 18/24 = 0.75 >= 0.5 -> green
    const greenDeadline = new Date("2026-09-04T06:00:00Z");
    expect(scheduleService.calculateSLABadgeColor(greenDeadline, createdAt, now)).toBe("green");

    // 2. 剩余 6h: lambda = 6/24 = 0.25 (0.15 <= lambda < 0.5) -> orange
    const orangeDeadline = new Date("2026-09-03T18:00:00Z");
    expect(scheduleService.calculateSLABadgeColor(orangeDeadline, createdAt, now)).toBe("orange");

    // 3. 剩余 2h: lambda = 2/24 = 0.083 < 0.15 -> red
    const redDeadline = new Date("2026-09-03T14:00:00Z");
    expect(scheduleService.calculateSLABadgeColor(redDeadline, createdAt, now)).toBe("red");
  });

  it("[M51-05] 工单超时违约色标判定: 截止时间早于当前时间返回 red", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    const createdAt = new Date("2026-09-02T00:00:00Z");
    const expiredDeadline = new Date("2026-09-03T10:00:00Z"); // 已超时 2 小时

    expect(scheduleService.calculateSLABadgeColor(expiredDeadline, createdAt, now)).toBe("red");
  });

  it("[M51-06] 贪心重叠列布局算法: 同一时段两事件重叠分配不同列", () => {
    const events = [
      {
        start: new Date("2026-09-03T09:00:00"),
        end: new Date("2026-09-03T11:00:00"),
        payload: { id: "1", title: "事件A" } as any
      },
      {
        start: new Date("2026-09-03T10:00:00"),
        end: new Date("2026-09-03T12:00:00"),
        payload: { id: "2", title: "事件B" } as any
      }
    ];

    const result = scheduleService.applyGreedyColumnLayout(events);
    expect(result.length).toBe(2);
    expect(result[0].columnIndex).toBe(0);
    expect(result[1].columnIndex).toBe(1);
    expect(result[0].totalColumns).toBe(2);
    expect(result[1].totalColumns).toBe(2);
  });

  it("[M51-07] 串行非重叠事件列复用: 后一事件晚于前一事件结束时间时复用第 0 列", () => {
    const events = [
      {
        start: new Date("2026-09-03T08:00:00"),
        end: new Date("2026-09-03T09:00:00"),
        payload: { id: "1", title: "早间检修" } as any
      },
      {
        start: new Date("2026-09-03T09:30:00"),
        end: new Date("2026-09-03T11:00:00"),
        payload: { id: "2", title: "上午巡查" } as any
      }
    ];

    const result = scheduleService.applyGreedyColumnLayout(events);
    expect(result.length).toBe(2);
    expect(result[0].columnIndex).toBe(0);
    expect(result[1].columnIndex).toBe(0);
    expect(result[0].totalColumns).toBe(1);
    expect(result[1].totalColumns).toBe(1);
  });

  it("[M51-08] 三事件部分重叠贪心列分配: 正确计算列索引与最大列数", () => {
    const events = [
      {
        start: new Date("2026-09-03T09:00:00"),
        end: new Date("2026-09-03T11:00:00"),
        payload: { id: "1", title: "A" } as any
      },
      {
        start: new Date("2026-09-03T10:00:00"),
        end: new Date("2026-09-03T12:00:00"),
        payload: { id: "2", title: "B" } as any
      },
      {
        start: new Date("2026-09-03T11:30:00"),
        end: new Date("2026-09-03T13:00:00"),
        payload: { id: "3", title: "C" } as any // A在11:00结束，C在11:30开始，C可复用A的第0列
      }
    ];

    const result = scheduleService.applyGreedyColumnLayout(events);
    expect(result[0].columnIndex).toBe(0);
    expect(result[1].columnIndex).toBe(1);
    expect(result[2].columnIndex).toBe(0); // 复用第 0 列
    expect(result[0].totalColumns).toBe(2);
  });

  it("[M51-09] 月视图多源数据流融合: 聚合工单SLA红点、排班蓝点、维保绿点", async () => {
    const targetDate = "2026-09-15";

    // 1. 注入排班
    ScheduleService.mockSchedules.push({
      id: 1,
      schoolId: 1,
      userId: 101,
      title: "电工组值班",
      type: "duty",
      relatedAppCode: "app-calendar",
      relatedEntityId: 0,
      startTime: `${targetDate} 08:30:00`,
      endTime: `${targetDate} 17:30:00`,
      priority: "medium",
      status: 0,
      dutyPhone: "13800000001",
      location: "配电室",
      remark: null,
      createdAt: "2026-09-01 00:00:00",
      updatedAt: "2026-09-01 00:00:00",
      isDeleted: 0
    });

    // 2. 注入重大维保
    ScheduleService.mockSchedules.push({
      id: 2,
      schoolId: 1,
      userId: 0,
      title: "水箱冲洗全校停水",
      type: "maintenance",
      relatedAppCode: "",
      relatedEntityId: 0,
      startTime: `${targetDate} 13:00:00`,
      endTime: `${targetDate} 16:00:00`,
      priority: "high",
      status: 0,
      dutyPhone: "",
      location: "供水总站",
      remark: null,
      createdAt: "2026-09-01 00:00:00",
      updatedAt: "2026-09-01 00:00:00",
      isDeleted: 0
    });

    // 3. 注入工单 SLA 截止
    ScheduleService.mockPatrols.push({
      id: 1001,
      schoolId: 1,
      patrolSn: "#LCU-2026-0091",
      title: "水管破裂抢修",
      deadline: `${targetDate} 18:00:00`,
      urgencyLevel: 3,
      status: 1, // 抢修中
      createdAt: `${targetDate} 08:00:00`
    });

    const monthView = await scheduleService.getMonthView(1, 101, 2026, 9);
    const targetCell = monthView.cells.find((c) => c.dateStr === targetDate);

    expect(targetCell).toBeDefined();
    expect(targetCell?.dots.hasDutyShift).toBe(true);
    expect(targetCell?.dots.hasMaintenance).toBe(true);
    expect(targetCell?.dots.hasSlaWarning).toBe(true);
    expect(targetCell?.totalCount).toBe(3);
    expect(monthView.summary.totalSlaAlerts).toBe(1);
    expect(monthView.summary.totalShifts).toBe(1);
    expect(monthView.summary.totalMaintenanceEvents).toBe(1);
  });

  it("[M51-10] 结案工单 (status=4) 物理消解: 已办结工单不进入日历，零幽灵残留", async () => {
    const targetDate = "2026-09-18";

    // 注入已办结的工单 (status=4)
    ScheduleService.mockPatrols.push({
      id: 1002,
      schoolId: 1,
      patrolSn: "#PATROL-9999",
      title: "已完成的报修单",
      deadline: `${targetDate} 12:00:00`,
      urgencyLevel: 1,
      status: 4, // 已办结
      createdAt: `${targetDate} 08:00:00`
    });

    const monthView = await scheduleService.getMonthView(1, 101, 2026, 9);
    const targetCell = monthView.cells.find((c) => c.dateStr === targetDate);
    expect(targetCell?.dots.hasSlaWarning).toBe(false);

    const dayView = await scheduleService.getDayDetailView(1, 101, targetDate);
    const item = dayView.timelineItems.find((t) => t.id === "patrol_sla_1002");
    expect(item).toBeUndefined();
  });

  it("[M51-11] 日视图垂直时刻垂直时间槽 top 与 height 百分比计算准确性", async () => {
    const targetDate = "2026-09-20";

    // 06:00 ~ 08:00 (360分钟开始，持续120分钟)
    ScheduleService.mockSchedules.push({
      id: 10,
      schoolId: 1,
      userId: 101,
      title: "清晨巡查",
      type: "custom",
      relatedAppCode: "",
      relatedEntityId: 0,
      startTime: `${targetDate} 06:00:00`,
      endTime: `${targetDate} 08:00:00`,
      priority: "medium",
      status: 0,
      dutyPhone: "",
      location: "南区",
      remark: null,
      createdAt: "2026-09-01 00:00:00",
      updatedAt: "2026-09-01 00:00:00",
      isDeleted: 0
    });

    const dayView = await scheduleService.getDayDetailView(1, 101, targetDate);
    const item = dayView.timelineItems.find((t) => t.id === "sched_10");

    expect(item).toBeDefined();
    // 360 / 1440 * 100 = 25%
    expect(item?.topPercentage).toBe(25);
    // 120 / 1440 * 100 = 8.33%
    expect(item?.heightPercentage).toBe(8.33);
  });

  it("[M51-12] 值班排班人员名单提取与名牌数据装配", async () => {
    const targetDate = "2026-09-22";

    ScheduleService.mockSchedules.push({
      id: 20,
      schoolId: 1,
      userId: 2002,
      title: "张三师傅全天值班",
      type: "duty",
      relatedAppCode: "app-calendar",
      relatedEntityId: 0,
      startTime: `${targetDate} 08:30:00`,
      endTime: `${targetDate} 17:30:00`,
      priority: "high",
      status: 0,
      dutyPhone: "13912345678",
      location: "西区动力站102",
      remark: "应急主管",
      createdAt: "2026-09-01 00:00:00",
      updatedAt: "2026-09-01 00:00:00",
      isDeleted: 0
    });

    const dayView = await scheduleService.getDayDetailView(1, 2002, targetDate);
    expect(dayView.dutyStaffList.length).toBe(1);

    const staff = dayView.dutyStaffList[0];
    expect(staff.userId).toBe(2002);
    expect(staff.dutyPhone).toBe("13912345678");
    expect(staff.location).toBe("西区动力站102");
    expect(staff.shiftTimeText).toContain("08:30");
  });

  it("[M51-13] 跨校租户物理隔离: schoolId 隔离严禁读取他校排班", async () => {
    const targetDate = "2026-09-25";

    // 他校排班 (schoolId = 2)
    ScheduleService.mockSchedules.push({
      id: 99,
      schoolId: 2,
      userId: 901,
      title: "隔壁大学抢修排班",
      type: "duty",
      relatedAppCode: "",
      relatedEntityId: 0,
      startTime: `${targetDate} 09:00:00`,
      endTime: `${targetDate} 18:00:00`,
      priority: "medium",
      status: 0,
      dutyPhone: "13300000000",
      location: "隔壁配电室",
      remark: null,
      createdAt: "2026-09-01 00:00:00",
      updatedAt: "2026-09-01 00:00:00",
      isDeleted: 0
    });

    const dayView = await scheduleService.getDayDetailView(1, 101, targetDate);
    expect(dayView.dutyStaffList.length).toBe(0);
    expect(dayView.timelineItems.length).toBe(0);
  });

  it("[M51-14] 创建自定义日程与合法性校验: 参数非法时拒绝", async () => {
    // 缺少标题
    await expect(
      scheduleService.createSchedule(1, 101, {
        title: "",
        type: "custom",
        startTime: "2026-09-01 09:00:00",
        endTime: "2026-09-01 10:00:00"
      })
    ).rejects.toThrow("日程标题不能为空");

    // 开始时间晚于结束时间
    await expect(
      scheduleService.createSchedule(1, 101, {
        title: "非法区间",
        type: "custom",
        startTime: "2026-09-01 12:00:00",
        endTime: "2026-09-01 10:00:00"
      })
    ).rejects.toThrow("日程时间区间非法");

    // 正常创建
    const created = await scheduleService.createSchedule(1, 101, {
      title: "合规待办",
      type: "custom",
      startTime: "2026-09-01 09:00:00",
      endTime: "2026-09-01 10:00:00",
      location: "图书馆"
    });

    expect(created.id).toBeDefined();
    expect(created.title).toBe("合规待办");
  });

  it("[M51-15] 软删除日程事件: isDeleted=1 立即在视图中剔除", async () => {
    const targetDate = "2026-09-28";
    const created = await scheduleService.createSchedule(1, 101, {
      title: "待删除的日程",
      type: "custom",
      startTime: `${targetDate} 10:00:00`,
      endTime: `${targetDate} 11:00:00`
    });

    let dayView = await scheduleService.getDayDetailView(1, 101, targetDate);
    expect(dayView.timelineItems.some((t) => t.title === "待删除的日程")).toBe(true);

    await scheduleService.deleteSchedule(1, created.id);

    dayView = await scheduleService.getDayDetailView(1, 101, targetDate);
    expect(dayView.timelineItems.some((t) => t.title === "待删除的日程")).toBe(false);
  });

  it("[M51-16] 轮值排班循环周期推导 (Shift Rotation): 正确计算轮转师傅", () => {
    const staffList = [
      { userId: 1, name: "张师傅" },
      { userId: 2, name: "李师傅" },
      { userId: 3, name: "王师傅" }
    ];

    const anchorDate = "2026-09-01"; // 锚点为张师傅 (idx 0)
    expect(scheduleService.calcShiftDutyRotation(anchorDate, "2026-09-01", staffList).name).toBe("张师傅");
    expect(scheduleService.calcShiftDutyRotation(anchorDate, "2026-09-02", staffList).name).toBe("李师傅");
    expect(scheduleService.calcShiftDutyRotation(anchorDate, "2026-09-03", staffList).name).toBe("王师傅");
    expect(scheduleService.calcShiftDutyRotation(anchorDate, "2026-09-04", staffList).name).toBe("张师傅");
  });

  it("[M51-17] 控制器月视图接口参数默认值处理: 缺省参数时正常返回 200", async () => {
    const res = await scheduleController.handleGetMonth({}, null, {});
    expect(res.code).toBe(200);
    expect(res.data.cells.length).toBe(42);
  });

  it("[M51-18] 控制器日视图接口参数处理: 缺省参数时默认返回今日 200", async () => {
    const res = await scheduleController.handleGetDay({}, null, {});
    expect(res.code).toBe(200);
    expect(res.data.timelineItems).toBeDefined();
  });

  it("[M51-19] 网关端点 /api/v1/schedules/month 路由集成测试: 成功拉取月大盘", async () => {
    const result = await monthApi.handler(
      {
        req: {} as any,
        res: {} as any,
        query: { year: "2026", month: "9" },
        body: {}
      } as any,
      { userPayload: { schoolId: 1, userId: 101 } } as any
    );

    expect(result.status).toBe(1);
    expect(result.data).toBeDefined();
    expect(result.data.cells.length).toBe(42);
    expect(result.data.summary).toBeDefined();
  });

  it("[M51-20] 网关端点 /api/v1/schedules/day 与 create 路由集成测试: 鉴权与业务闭环", async () => {
    // 1. 日视图免密调用
    const dayResult = await dayApi.handler(
      {
        req: {} as any,
        res: {} as any,
        query: { date: "2026-09-10" },
        body: {}
      } as any,
      { userPayload: null } as any
    );
    expect(dayResult.status).toBe(1);
    expect(dayResult.data.dateStr).toBe("2026-09-10");

    // 2. create 未登录拦截
    const unauthCreate = await createApi.handler(
      {
        req: {} as any,
        res: {} as any,
        query: {},
        body: { title: "新待办", startTime: "2026-09-10 09:00:00", endTime: "2026-09-10 10:00:00" }
      } as any,
      { userPayload: null } as any
    );
    expect(unauthCreate.status).toBe(0);
    expect(unauthCreate.content).toContain("请先登录");

    // 3. create 登录后成功创建
    const authCreate = await createApi.handler(
      {
        req: {} as any,
        res: {} as any,
        query: {},
        body: {
          title: "测试日程",
          type: "custom",
          startTime: "2026-09-10 09:00:00",
          endTime: "2026-09-10 10:00:00"
        }
      } as any,
      { userPayload: { schoolId: 1, userId: 101 } } as any
    );
    expect(authCreate.status).toBe(1);
    expect(authCreate.data.title).toBe("测试日程");
  });
});
