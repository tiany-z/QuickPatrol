/**
 * 高校后勤巡查e速办 v4.0 - M51 全景日历日程联动与值班排班表 (Calendar & SLA Shifts)
 * 文件路径: src/controllers/scheduleController.ts
 * 核心职责: 承接全景日历月视图、日时刻时间轴以及日程创建/删除请求，强制绑定租户隔离。
 */

import { scheduleService } from "../services/scheduleService.js";
import { ICreateScheduleDto } from "../contracts/calendarContract.js";

export class ScheduleController {
  /**
   * 拉取月度 42 单元格微圆点概览
   * GET /api/v1/schedules/month
   */
  public async handleGetMonth(
    req: any,
    res: any,
    query: any,
    userPayload?: any
  ): Promise<any> {
    const schoolId = Number(
      userPayload?.schoolId !== undefined
        ? userPayload.schoolId
        : (req?.headers as any)?.["x-school-id"] || query?.schoolId || 1
    );

    const userId = Number(userPayload?.userId || userPayload?.id || 0);

    const now = new Date();
    const year = Number(query?.year) || now.getFullYear();
    const month = Number(query?.month) || (now.getMonth() + 1);

    const data = await scheduleService.getMonthView(schoolId, userId, year, month);

    if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      if (typeof res.end === "function") {
        res.end(JSON.stringify({ code: 200, data, message: "月度全景日历数据加载成功" }));
      }
    }

    return { code: 200, data, message: "月度全景日历数据加载成功" };
  }

  /**
   * 拉取某天的垂直时刻时间槽与值班师傅名单
   * GET /api/v1/schedules/day
   */
  public async handleGetDay(
    req: any,
    res: any,
    query: any,
    userPayload?: any
  ): Promise<any> {
    const schoolId = Number(
      userPayload?.schoolId !== undefined
        ? userPayload.schoolId
        : (req?.headers as any)?.["x-school-id"] || query?.schoolId || 1
    );

    const userId = Number(userPayload?.userId || userPayload?.id || 0);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const dateStr = (query?.date as string) || `${year}-${month}-${day}`;

    const data = await scheduleService.getDayDetailView(schoolId, userId, dateStr);

    if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      if (typeof res.end === "function") {
        res.end(JSON.stringify({ code: 200, data, message: "日时刻时间轴拉取成功" }));
      }
    }

    return { code: 200, data, message: "日时刻时间轴拉取成功" };
  }

  /**
   * 创建日程或排班事件
   * POST /api/v1/schedules/create
   */
  public async handleCreateSchedule(
    req: any,
    res: any,
    body: ICreateScheduleDto,
    userPayload: any
  ): Promise<any> {
    const schoolId = Number(
      userPayload?.schoolId !== undefined
        ? userPayload.schoolId
        : (req?.headers as any)?.["x-school-id"] || 1
    );
    const userId = Number(userPayload?.userId || userPayload?.id || 0);

    if (!schoolId || isNaN(schoolId) || schoolId <= 0 || !userId || userId <= 0) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 401, message: "未授权：请先登录后再创建日程" }));
        }
      }
      return { code: 401, message: "未授权：请先登录后再创建日程" };
    }

    if (!body || !body.title || !body.startTime || !body.endTime) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 400, message: "参数错误：缺少日程标题或时间区间" }));
        }
      }
      return { code: 400, message: "参数错误：缺少日程标题或时间区间" };
    }

    try {
      const record = await scheduleService.createSchedule(schoolId, userId, body);

      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 200, data: record, message: "日程创建成功" }));
        }
      }

      return { code: 200, data: record, message: "日程创建成功" };
    } catch (err: any) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 400, message: err.message || "创建日程失败" }));
        }
      }
      return { code: 400, message: err.message || "创建日程失败" };
    }
  }

  /**
   * 删除日程事件
   * POST /api/v1/schedules/delete
   */
  public async handleDeleteSchedule(
    req: any,
    res: any,
    body: any,
    userPayload: any
  ): Promise<any> {
    const schoolId = Number(
      userPayload?.schoolId !== undefined
        ? userPayload.schoolId
        : (req?.headers as any)?.["x-school-id"] || 1
    );
    const userId = Number(userPayload?.userId || userPayload?.id || 0);

    if (!schoolId || isNaN(schoolId) || schoolId <= 0 || !userId || userId <= 0) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 401, message: "未授权：请先登录后再删除日程" }));
        }
      }
      return { code: 401, message: "未授权：请先登录后再删除日程" };
    }

    const scheduleId = Number(body?.id || body?.scheduleId || 0);
    if (!scheduleId || scheduleId <= 0) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 400, message: "参数错误：缺少日程主键标识" }));
        }
      }
      return { code: 400, message: "参数错误：缺少日程主键标识" };
    }

    await scheduleService.deleteSchedule(schoolId, scheduleId);

    if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      if (typeof res.end === "function") {
        res.end(JSON.stringify({ code: 200, data: { success: true }, message: "日程删除成功" }));
      }
    }

    return { code: 200, data: { success: true }, message: "日程删除成功" };
  }
}

export const scheduleController = new ScheduleController();
