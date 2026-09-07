/**
 * 高校后勤巡查e速办 v4.0 - M51 全景日历日程联动与值班排班表 (Calendar & SLA Shifts)
 * 文件路径: miniprogram/packages/apps/calendar/contracts/calendarTypes.ts
 * 小程序端数据模型契约
 */

export type ScheduleType = "custom" | "sla_deadline" | "duty" | "maintenance";

export type SchedulePriority = "low" | "medium" | "high" | "urgent";

export interface ICalendarDayCellDto {
  dateStr: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  dots: {
    hasSlaWarning: boolean;
    hasDutyShift: boolean;
    hasMaintenance: boolean;
    hasCustomTodo: boolean;
  };
  totalCount: number;
}

export interface ICalendarMonthViewResponseDto {
  schoolId: number;
  year: number;
  month: number;
  cells: ICalendarDayCellDto[];
  summary: {
    totalSlaAlerts: number;
    totalShifts: number;
    totalMaintenanceEvents: number;
    totalCustomTodos: number;
  };
}

export interface IScheduleTimelineItemDto {
  id: string;
  type: ScheduleType;
  title: string;
  startTimeText: string;
  endTimeText: string;
  topPercentage: number;
  heightPercentage: number;
  columnIndex: number;
  totalColumns: number;
  priority: SchedulePriority;
  badgeColor: "green" | "orange" | "red" | "blue" | "gray";
  location: string;
  dutyPersonName?: string;
  dutyPhone?: string;
  patrolSn?: string;
  detailUrl?: string;
}

export interface ICalendarDayViewResponseDto {
  schoolId: number;
  dateStr: string;
  dayOfWeekText: string;
  timelineItems: IScheduleTimelineItemDto[];
  dutyStaffList: Array<{
    userId: number;
    name: string;
    departmentName: string;
    dutyPhone: string;
    location: string;
    shiftTimeText: string;
  }>;
}

export interface IShiftDutyCardModel {
  dutyRecordId: number;
  staffName: string;
  deptName: string;
  dutyPhone: string;
  roomLocation: string;
  shiftPeriodText: string;
}

export interface ICreateScheduleDto {
  title: string;
  type: ScheduleType;
  startTime: string;
  endTime: string;
  priority?: SchedulePriority;
  assignedUserId?: number;
  dutyPhone?: string;
  location?: string;
  remark?: string;
}
