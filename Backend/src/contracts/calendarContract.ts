/**
 * 高校后勤巡查e速办 v4.0 - M51 全景日历日程联动与值班排班表 (Calendar & SLA Shifts)
 * 文件路径: src/contracts/calendarContract.ts
 * 核心职责: 定义日程类型、优先级、物理表映射模型及月/日视图强类型传输对象 (DTO)
 */

/**
 * 四大异构日程类型枚举
 * custom: 个人自定义备忘待办
 * sla_deadline: 巡查工单 SLA 履约到期动态投影
 * duty: 科室/网格轮值排班事件
 * maintenance: 全校重大设备维保公共大事件 (停水停电、水箱消毒等)
 */
export type ScheduleType = "custom" | "sla_deadline" | "duty" | "maintenance";

/**
 * 优先级枚举
 */
export type SchedulePriority = "low" | "medium" | "high" | "urgent";

/**
 * schedules 物理表 27 实体映射模型
 */
export interface IScheduleEntity {
  id: number;
  schoolId: number;
  userId: number; // 0 表示全校广播公共事件
  title: string;
  type: ScheduleType;
  relatedAppCode: string; // 如 app-patrol, app-feedback
  relatedEntityId: number; // 如 patrols.id
  startTime: string; // YYYY-MM-DD HH:mm:ss
  endTime: string;
  priority: SchedulePriority;
  status: number; // 0待办/进行中, 1已完成, 2已取消
  dutyPhone: string; // 值班/联络电话 (支持一键拨号呼叫)
  location: string;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  isDeleted: number;
}

/**
 * 月网格单个日期单元格模型 (42 单元格固定矩阵)
 */
export interface ICalendarDayCellDto {
  dateStr: string; // "2026-09-03"
  dayNumber: number; // 3
  isCurrentMonth: boolean;
  isToday: boolean;
  /** 当天聚合的各色微状态圆点 */
  dots: {
    hasSlaWarning: boolean; // 🔴 红色：工单 SLA 到期预警
    hasDutyShift: boolean; // 🔵 蓝色：科室值班轮排
    hasMaintenance: boolean; // 🟢 绿色：重大设备维保
    hasCustomTodo: boolean; // ⚪ 灰色：个人待办备忘
  };
  /** 当天日程总条数 */
  totalCount: number;
}

/**
 * 月视图全屏数据响应 DTO
 */
export interface ICalendarMonthViewResponseDto {
  schoolId: number;
  year: number;
  month: number;
  /** 长度恒定为 42 的网格单元 */
  cells: ICalendarDayCellDto[];
  /** 当月日程分类概要汇总 */
  summary: {
    totalSlaAlerts: number;
    totalShifts: number;
    totalMaintenanceEvents: number;
    totalCustomTodos: number;
  };
}

/**
 * 日视图垂直时刻时间槽事件模型 (00:00 ~ 24:00)
 */
export interface IScheduleTimelineItemDto {
  id: string; // 唯一标识 (如 "sched_27" 或 "patrol_sla_1001")
  type: ScheduleType;
  title: string;
  startTimeText: string; // "09:00"
  endTimeText: string; // "11:30"
  /** 垂直时间轴在 00:00~24:00 之间的百分比定位 */
  topPercentage: number;
  heightPercentage: number;
  /** 重叠事件并排列索引与总列数 (用于贪心列排版无遮挡计算) */
  columnIndex: number;
  totalColumns: number;
  priority: SchedulePriority;
  badgeColor: "green" | "orange" | "red" | "blue" | "gray";
  location: string;
  dutyPersonName?: string;
  dutyPhone?: string;
  /** 若为工单 SLA 关联项，附带工单号与详情直达路径 */
  patrolSn?: string;
  detailUrl?: string;
}

/**
 * 日视图响应 DTO
 */
export interface ICalendarDayViewResponseDto {
  schoolId: number;
  dateStr: string; // "2026-09-03"
  dayOfWeekText: string; // "星期四"
  timelineItems: IScheduleTimelineItemDto[];
  /** 当天处于值班岗位的师傅实名名牌列表 */
  dutyStaffList: Array<{
    userId: number;
    name: string;
    departmentName: string;
    dutyPhone: string;
    location: string;
    shiftTimeText: string;
  }>;
}

/**
 * 值班名牌组件数据模型
 */
export interface IShiftDutyCardModel {
  dutyRecordId: number;
  staffName: string;
  deptName: string;
  dutyPhone: string;
  roomLocation: string;
  shiftPeriodText: string;
}

/**
 * 新建排班或日程请求载荷
 */
export interface ICreateScheduleDto {
  title: string;
  type: ScheduleType;
  startTime: string; // YYYY-MM-DD HH:mm:ss 或 ISO8601
  endTime: string;
  priority?: SchedulePriority;
  assignedUserId?: number; // 0 表示全校公共广播
  dutyPhone?: string;
  location?: string;
  remark?: string;
  relatedAppCode?: string;
  relatedEntityId?: number;
}

/**
 * 更新排班或日程请求载荷
 */
export type IUpdateScheduleDto = Partial<ICreateScheduleDto>;
