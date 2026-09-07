/**
 * 高校后勤巡查e速办 v4.0 - M51 全景日历日程联动与值班排班表 (Calendar & SLA Shifts)
 * 文件路径: src/services/scheduleService.ts
 * 核心职责: 物理日程检索、巡查工单 SLA 履约倒计时动态投影、四路数据流内存归并、
 *           42 单元格月网格构建与日视图时间槽列布局。
 */

import { executeQuery } from "../shared/db/mysql.js";
import {
  ScheduleType,
  SchedulePriority,
  IScheduleEntity,
  ICalendarMonthViewResponseDto,
  ICalendarDayViewResponseDto,
  ICalendarDayCellDto,
  IScheduleTimelineItemDto,
  ICreateScheduleDto,
  IUpdateScheduleDto
} from "../contracts/calendarContract.js";

export class ScheduleService {
  /**
   * 内存隔离测试沙箱
   */
  public static mockSchedules: IScheduleEntity[] = [];
  public static mockPatrols: any[] = [];

  public static resetMock(): void {
    ScheduleService.mockSchedules = [];
    ScheduleService.mockPatrols = [];
  }

  /**
   * 1. 获取全景月视图聚合大盘 (包含 42 单元格与彩色小圆点)
   */
  public async getMonthView(
    schoolId: number,
    userId: number,
    year: number,
    month: number
  ): Promise<ICalendarMonthViewResponseDto> {
    const targetYear = Number(year) || new Date().getFullYear();
    const targetMonth = Number(month) || (new Date().getMonth() + 1);

    // 1. 生成 42 单元格基准日期矩阵 (算法 1)
    const cells = this.generate42GridCells(targetYear, targetMonth);
    const rangeStart = `${cells[0].dateStr} 00:00:00`;
    const rangeEnd = `${cells[41].dateStr} 23:59:59`;

    // 2. 并行拉取物理日程表 与 未结案工单数据集
    let schedulesRows: IScheduleEntity[] = [];
    let patrolsRows: any[] = [];

    try {
      const schedSql = `
        SELECT * FROM schedules 
        WHERE schoolId = ? AND (userId = ? OR userId = 0) AND isDeleted = 0
          AND startTime BETWEEN ? AND ?
        ORDER BY startTime ASC
      `;
      const schedRes = await executeQuery(schedSql, [schoolId, userId, rangeStart, rangeEnd]);
      if (schedRes.status === 1 && Array.isArray(schedRes.data)) {
        schedulesRows = schedRes.data;
      }

      const patrolSql = `
        SELECT id, patrolSn, title, deadline, urgencyLevel, status, createdAt
        FROM patrols 
        WHERE schoolId = ? AND status IN (0, 1, 2, 3) AND deadline BETWEEN ? AND ?
        ORDER BY deadline ASC
      `;
      const patrolRes = await executeQuery(patrolSql, [schoolId, rangeStart, rangeEnd]);
      if (patrolRes.status === 1 && Array.isArray(patrolRes.data)) {
        patrolsRows = patrolRes.data;
      }
    } catch {
      // 降级使用沙箱
    }

    // 叠加沙箱数据
    const sandboxSchedules = ScheduleService.mockSchedules.filter((s) => {
      const inSchool = s.schoolId === schoolId;
      const inUser = s.userId === userId || s.userId === 0;
      const notDeleted = !s.isDeleted;
      const inRange = s.startTime >= rangeStart && s.startTime <= rangeEnd;
      return inSchool && inUser && notDeleted && inRange;
    });
    for (const s of sandboxSchedules) {
      if (!schedulesRows.some((r) => r.id === s.id)) {
        schedulesRows.push(s);
      }
    }

    const sandboxPatrols = ScheduleService.mockPatrols.filter((p) => {
      const inSchool = p.schoolId === schoolId;
      const notClosed = [0, 1, 2, 3].includes(p.status);
      const inRange = p.deadline >= rangeStart && p.deadline <= rangeEnd;
      return inSchool && notClosed && inRange;
    });
    for (const p of sandboxPatrols) {
      if (!patrolsRows.some((r) => r.id === p.id)) {
        patrolsRows.push(p);
      }
    }

    // 3. 构建按日期索引的事件聚合字典
    const dateMap = new Map<string, { sla: number; duty: number; maint: number; custom: number }>();
    for (const cell of cells) {
      dateMap.set(cell.dateStr, { sla: 0, duty: 0, maint: 0, custom: 0 });
    }

    // 归并物理日程
    for (const row of schedulesRows) {
      const dStr = this.formatDateOnly(new Date(row.startTime));
      const entry = dateMap.get(dStr);
      if (entry) {
        if (row.type === "duty") entry.duty++;
        else if (row.type === "maintenance") entry.maint++;
        else entry.custom++;
      }
    }

    // 归并工单 SLA 动态投影
    let totalSlaAlerts = 0;
    for (const p of patrolsRows) {
      const dStr = this.formatDateOnly(new Date(p.deadline));
      const entry = dateMap.get(dStr);
      if (entry) {
        entry.sla++;
        totalSlaAlerts++;
      }
    }

    // 4. 回填 42 单元格微圆点
    for (const cell of cells) {
      const counts = dateMap.get(cell.dateStr);
      if (counts) {
        cell.dots = {
          hasSlaWarning: counts.sla > 0,
          hasDutyShift: counts.duty > 0,
          hasMaintenance: counts.maint > 0,
          hasCustomTodo: counts.custom > 0
        };
        cell.totalCount = counts.sla + counts.duty + counts.maint + counts.custom;
      }
    }

    return {
      schoolId,
      year: targetYear,
      month: targetMonth,
      cells,
      summary: {
        totalSlaAlerts,
        totalShifts: schedulesRows.filter((r) => r.type === "duty").length,
        totalMaintenanceEvents: schedulesRows.filter((r) => r.type === "maintenance").length,
        totalCustomTodos: schedulesRows.filter((r) => r.type === "custom").length
      }
    };
  }

  /**
   * 2. 获取某天的垂直时刻时间轴视图 (00:00 ~ 24:00)
   */
  public async getDayDetailView(
    schoolId: number,
    userId: number,
    dateStr: string
  ): Promise<ICalendarDayViewResponseDto> {
    const dayStart = `${dateStr} 00:00:00`;
    const dayEnd = `${dateStr} 23:59:59`;

    // 1. 查询当天物理日程
    let schedRows: any[] = [];
    try {
      const schedSql = `
        SELECT s.*, u.name AS userName 
        FROM schedules s
        LEFT JOIN users u ON s.userId = u.id
        WHERE s.schoolId = ? AND (s.userId = ? OR s.userId = 0) AND s.isDeleted = 0
          AND s.startTime BETWEEN ? AND ?
        ORDER BY s.startTime ASC
      `;
      const res = await executeQuery(schedSql, [schoolId, userId, dayStart, dayEnd]);
      if (res.status === 1 && Array.isArray(res.data)) {
        schedRows = res.data;
      }
    } catch {
      // 降级使用沙箱
    }

    // 叠加沙箱日程
    const sandboxSchedules = ScheduleService.mockSchedules.filter((s) => {
      const inSchool = s.schoolId === schoolId;
      const inUser = s.userId === userId || s.userId === 0;
      const notDeleted = !s.isDeleted;
      const inDay = s.startTime >= dayStart && s.startTime <= dayEnd;
      return inSchool && inUser && notDeleted && inDay;
    });
    for (const s of sandboxSchedules) {
      if (!schedRows.some((r) => r.id === s.id)) {
        schedRows.push({ ...s, userName: s.title });
      }
    }

    // 2. 查询当天到期的未结案工单 (SLA 动态投影)
    let patrolRows: any[] = [];
    try {
      const patrolSql = `
        SELECT p.*, u.name as handlerName
        FROM patrols p
        LEFT JOIN users u ON p.handlerUserId = u.id
        WHERE p.schoolId = ? AND p.status IN (0, 1, 2, 3)
          AND p.deadline BETWEEN ? AND ?
        ORDER BY p.deadline ASC
      `;
      const res = await executeQuery(patrolSql, [schoolId, dayStart, dayEnd]);
      if (res.status === 1 && Array.isArray(res.data)) {
        patrolRows = res.data;
      }
    } catch {
      // 降级使用沙箱
    }

    // 叠加沙箱工单
    const sandboxPatrols = ScheduleService.mockPatrols.filter((p) => {
      const inSchool = p.schoolId === schoolId;
      const notClosed = [0, 1, 2, 3].includes(p.status);
      const inDay = p.deadline >= dayStart && p.deadline <= dayEnd;
      return inSchool && notClosed && inDay;
    });
    for (const p of sandboxPatrols) {
      if (!patrolRows.some((r) => r.id === p.id)) {
        patrolRows.push(p);
      }
    }

    // 3. 提取今日值班人员名单 (置顶名牌展示)
    const dutyStaffList: any[] = [];
    for (const r of schedRows) {
      if (r.type === "duty") {
        dutyStaffList.push({
          userId: r.userId,
          name: r.userName || r.title || "值班师傅",
          departmentName: "后勤综合运维班组",
          dutyPhone: r.dutyPhone || "0535-6677889",
          location: r.location || "总控值班室",
          shiftTimeText: `${this.formatTimeOnly(new Date(r.startTime))} ~ ${this.formatTimeOnly(new Date(r.endTime))}`
        });
      }
    }

    // 4. 组装日历垂直时间轴事件流
    const rawEvents: Array<{ start: Date; end: Date; payload: IScheduleTimelineItemDto }> = [];

    // 转换物理日程
    for (const r of schedRows) {
      const s = new Date(r.startTime);
      const e = new Date(r.endTime);
      rawEvents.push({
        start: s,
        end: e,
        payload: {
          id: `sched_${r.id}`,
          type: r.type as ScheduleType,
          title: r.title,
          startTimeText: this.formatTimeOnly(s),
          endTimeText: this.formatTimeOnly(e),
          topPercentage: this.calcTopPercent(s),
          heightPercentage: this.calcHeightPercent(s, e),
          columnIndex: 0,
          totalColumns: 1,
          priority: r.priority as SchedulePriority,
          badgeColor: r.type === "duty" ? "blue" : r.type === "maintenance" ? "green" : "gray",
          location: r.location || "现场",
          dutyPersonName: r.userName,
          dutyPhone: r.dutyPhone
        }
      });
    }

    // 转换工单 SLA 投影 (默认提前 1 小时展示时间跨度)
    for (const p of patrolRows) {
      const deadline = new Date(p.deadline);
      const start = new Date(deadline.getTime() - 60 * 60 * 1000); // 前置1小时
      const badgeColor = this.calculateSLABadgeColor(p.deadline, p.createdAt || new Date(deadline.getTime() - 24 * 3600 * 1000));

      rawEvents.push({
        start,
        end: deadline,
        payload: {
          id: `patrol_sla_${p.id}`,
          type: "sla_deadline",
          title: `[SLA截止] ${p.title}`,
          startTimeText: this.formatTimeOnly(start),
          endTimeText: this.formatTimeOnly(deadline),
          topPercentage: this.calcTopPercent(start),
          heightPercentage: this.calcHeightPercent(start, deadline),
          columnIndex: 0,
          totalColumns: 1,
          priority: "urgent",
          badgeColor,
          location: p.locationName || "抢修现场",
          patrolSn: p.patrolSn,
          detailUrl: `/packages/apps/app-patrol/pages/detail/index?id=${p.id}&sn=${encodeURIComponent(p.patrolSn || "")}`
        }
      });
    }

    // 5. 应用贪心列布局算法 (算法 3)，处理重叠日程
    const timelineItems = this.applyGreedyColumnLayout(rawEvents);

    const weekDays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    const currentDayOfWeek = weekDays[new Date(dateStr).getDay()];

    return {
      schoolId,
      dateStr,
      dayOfWeekText: currentDayOfWeek,
      timelineItems,
      dutyStaffList
    };
  }

  /**
   * 3. 创建日程或排班事件
   */
  public async createSchedule(
    schoolId: number,
    userId: number,
    dto: ICreateScheduleDto
  ): Promise<IScheduleEntity> {
    if (!schoolId || schoolId <= 0) {
      throw new Error("缺少高校租户标识");
    }

    if (!dto.title || typeof dto.title !== "string" || dto.title.trim() === "") {
      throw new Error("日程标题不能为空");
    }

    if (!dto.startTime || !dto.endTime) {
      throw new Error("日程开始与结束时间不能为空");
    }

    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start.getTime() > end.getTime()) {
      throw new Error("日程时间区间非法");
    }

    const assignedUserId = dto.assignedUserId !== undefined ? Number(dto.assignedUserId) : userId;
    const type = dto.type || "custom";
    const priority = dto.priority || "medium";
    const status = 0;
    const dutyPhone = dto.dutyPhone || "";
    const location = dto.location || "";
    const remark = dto.remark || null;
    const relatedAppCode = dto.relatedAppCode || "";
    const relatedEntityId = dto.relatedEntityId || 0;

    let newId = Date.now();

    try {
      const sql = `
        INSERT INTO schedules 
        (schoolId, userId, title, type, relatedAppCode, relatedEntityId, startTime, endTime, priority, status, dutyPhone, location, remark, createdAt, updatedAt, isDeleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), 0)
      `;
      const res = await executeQuery(sql, [
        schoolId,
        assignedUserId,
        dto.title.trim(),
        type,
        relatedAppCode,
        relatedEntityId,
        dto.startTime,
        dto.endTime,
        priority,
        status,
        dutyPhone,
        location,
        remark
      ]);
      if (res.status === 1 && (res.data as any)?.insertId) {
        newId = (res.data as any).insertId;
      }
    } catch {
      // 降级使用沙箱
    }

    const createdRecord: IScheduleEntity = {
      id: newId,
      schoolId,
      userId: assignedUserId,
      title: dto.title.trim(),
      type,
      relatedAppCode,
      relatedEntityId,
      startTime: dto.startTime,
      endTime: dto.endTime,
      priority,
      status,
      dutyPhone,
      location,
      remark,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: 0
    };

    ScheduleService.mockSchedules.push(createdRecord);
    return createdRecord;
  }

  /**
   * 4. 更新日程事件
   */
  public async updateSchedule(
    schoolId: number,
    scheduleId: number,
    dto: IUpdateScheduleDto
  ): Promise<boolean> {
    try {
      const updates: string[] = [];
      const values: any[] = [];

      if (dto.title !== undefined) {
        updates.push("title = ?");
        values.push(dto.title);
      }
      if (dto.startTime !== undefined) {
        updates.push("startTime = ?");
        values.push(dto.startTime);
      }
      if (dto.endTime !== undefined) {
        updates.push("endTime = ?");
        values.push(dto.endTime);
      }
      if (dto.priority !== undefined) {
        updates.push("priority = ?");
        values.push(dto.priority);
      }
      if (dto.dutyPhone !== undefined) {
        updates.push("dutyPhone = ?");
        values.push(dto.dutyPhone);
      }
      if (dto.location !== undefined) {
        updates.push("location = ?");
        values.push(dto.location);
      }

      if (updates.length > 0) {
        values.push(schoolId, scheduleId);
        await executeQuery(`UPDATE schedules SET ${updates.join(", ")}, updatedAt = NOW() WHERE schoolId = ? AND id = ?`, values);
      }
    } catch {
      // 降级使用沙箱
    }

    const idx = ScheduleService.mockSchedules.findIndex((s) => s.schoolId === schoolId && s.id === scheduleId);
    if (idx !== -1) {
      ScheduleService.mockSchedules[idx] = {
        ...ScheduleService.mockSchedules[idx],
        ...dto,
        updatedAt: new Date().toISOString()
      };
    }

    return true;
  }

  /**
   * 5. 软删除日程事件
   */
  public async deleteSchedule(schoolId: number, scheduleId: number): Promise<boolean> {
    try {
      await executeQuery("UPDATE schedules SET isDeleted = 1, updatedAt = NOW() WHERE schoolId = ? AND id = ?", [
        schoolId,
        scheduleId
      ]);
    } catch {
      // 降级使用沙箱
    }

    const idx = ScheduleService.mockSchedules.findIndex((s) => s.schoolId === schoolId && s.id === scheduleId);
    if (idx !== -1) {
      ScheduleService.mockSchedules[idx].isDeleted = 1;
    }

    return true;
  }

  /**
   * 算法 1: 生成 42 单元格月网格自适应矩阵 (恒定 42 单元格)
   */
  public generate42GridCells(year: number, month: number): ICalendarDayCellDto[] {
    const firstDay = new Date(Date.UTC(year, month - 1, 1));
    const dayOfWeek = firstDay.getUTCDay(); // 0 is Sunday
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const daysInPrevMonth = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();

    const cells: ICalendarDayCellDto[] = [];
    const todayStr = this.formatDateOnly(new Date());

    // 1. 补齐上月末尾日期 (前置空白)
    for (let i = dayOfWeek - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevM = month === 1 ? 12 : month - 1;
      const prevY = month === 1 ? year - 1 : year;
      const dateStr = `${prevY}-${String(prevM).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        dots: { hasSlaWarning: false, hasDutyShift: false, hasMaintenance: false, hasCustomTodo: false },
        totalCount: 0
      });
    }

    // 2. 填充当月真实日期
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: true,
        isToday: dateStr === todayStr,
        dots: { hasSlaWarning: false, hasDutyShift: false, hasMaintenance: false, hasCustomTodo: false },
        totalCount: 0
      });
    }

    // 3. 补齐下月起始日期 (保持总数 42)
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const nextM = month === 12 ? 1 : month + 1;
      const nextY = month === 12 ? year + 1 : year;
      const dateStr = `${nextY}-${String(nextM).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        dots: { hasSlaWarning: false, hasDutyShift: false, hasMaintenance: false, hasCustomTodo: false },
        totalCount: 0
      });
    }

    return cells;
  }

  /**
   * 算法 2: 工单 SLA 动态时间衰减函数与风险色标判定
   * lambda(t) = (t_deadline - t) / T_total
   */
  public calculateSLABadgeColor(
    deadlineStr: string | Date,
    createdAtStr: string | Date,
    now: Date = new Date()
  ): "green" | "orange" | "red" {
    const deadline = new Date(deadlineStr).getTime();
    const createdAt = new Date(createdAtStr).getTime();
    const nowTime = now.getTime();

    const totalDuration = Math.max(deadline - createdAt, 1);
    const remainingTime = deadline - nowTime;

    const lambda = remainingTime / totalDuration;

    if (lambda >= 0.5) {
      return "green";
    }
    if (lambda >= 0.15) {
      return "orange";
    }
    return "red";
  }

  /**
   * 算法 3: 区间图贪心列布局算法 (处理同一垂直时间槽重叠的多事件)
   */
  public applyGreedyColumnLayout(
    events: Array<{ start: Date; end: Date; payload: IScheduleTimelineItemDto }>
  ): IScheduleTimelineItemDto[] {
    if (events.length === 0) return [];

    // 按起始时间升序排列，起始时间相同按结束时间降序
    events.sort((a, b) => {
      const diff = a.start.getTime() - b.start.getTime();
      if (diff !== 0) return diff;
      return b.end.getTime() - a.end.getTime();
    });

    const columns: Array<{ end: Date }> = [];
    for (const ev of events) {
      let placed = false;
      for (let i = 0; i < columns.length; i++) {
        if (columns[i].end.getTime() <= ev.start.getTime()) {
          columns[i].end = ev.end;
          ev.payload.columnIndex = i;
          placed = true;
          break;
        }
      }
      if (!placed) {
        ev.payload.columnIndex = columns.length;
        columns.push({ end: ev.end });
      }
    }

    const totalCols = Math.max(columns.length, 1);
    return events.map((ev) => {
      ev.payload.totalColumns = totalCols;
      return ev.payload;
    });
  }

  /**
   * 算法 4: 轮值排班循环周期推导算法
   */
  public calcShiftDutyRotation(
    anchorDateStr: string,
    targetDateStr: string,
    staffList: any[]
  ): any {
    if (!staffList || staffList.length === 0) return null;

    const anchorTime = new Date(anchorDateStr).getTime();
    const targetTime = new Date(targetDateStr).getTime();

    const diffDays = Math.floor((targetTime - anchorTime) / (1000 * 60 * 60 * 24));
    const normalizedDays = ((diffDays % staffList.length) + staffList.length) % staffList.length;

    return staffList[normalizedDays];
  }

  private calcTopPercent(time: Date): number {
    const totalMinutes = time.getHours() * 60 + time.getMinutes();
    return Number(((totalMinutes / 1440) * 100).toFixed(2));
  }

  private calcHeightPercent(start: Date, end: Date): number {
    const diffMinutes = Math.max((end.getTime() - start.getTime()) / 60000, 30); // 最小 30 分钟高度
    return Number(((diffMinutes / 1440) * 100).toFixed(2));
  }

  private formatDateOnly(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private formatTimeOnly(d: Date): string {
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
}

export const scheduleService = new ScheduleService();
