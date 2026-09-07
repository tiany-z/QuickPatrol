/**
 * 高校后勤巡查e速办 v4.0 - M52 师傅现场考勤打卡与人脸识别真实性核验控制器
 * 文件路径: src/controllers/attendanceController.ts
 * 核心职责: 接收考勤打卡、补卡申诉、申诉审批与月报查询请求，实施多租户鉴权与参数清洗。
 */

import { attendanceService } from "../services/attendanceService.js";
import {
  IPunchInRequestDto,
  ICreateAppealDto,
  IApproveAppealDto
} from "../contracts/attendanceContract.js";

export class AttendanceController {
  /**
   * 1. 师傅现场打卡
   * POST /api/v1/attendance/punch-in
   */
  public async handlePunchIn(
    req: any,
    res: any,
    body: IPunchInRequestDto,
    userPayload?: any
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
          res.end(JSON.stringify({ code: 401, message: "未登录或登录身份凭证已失效" }));
        }
      }
      return { code: 401, message: "未登录或登录身份凭证已失效" };
    }

    const clientIp = req?.ip || (req?.socket as any)?.remoteAddress || "127.0.0.1";

    try {
      const data = await attendanceService.processPunchIn(schoolId, userId, body, clientIp);

      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 200, data, message: data.message }));
        }
      }

      return { code: 200, data, message: data.message };
    } catch (err: any) {
      const isFenceError = err.message && err.message.includes("超出允许打卡范围");
      const statusCode = isFenceError ? 403 : 400;

      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: statusCode, message: err.message || "打卡失败" }));
        }
      }

      return { code: statusCode, message: err.message || "打卡失败" };
    }
  }

  /**
   * 2. 获取今日打卡状态与活体 Nonce
   * GET /api/v1/attendance/today-status
   */
  public async handleGetTodayStatus(
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

    if (!schoolId || isNaN(schoolId) || schoolId <= 0 || !userId || userId <= 0) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 401, message: "未登录或身份凭证无效" }));
        }
      }
      return { code: 401, message: "未登录或身份凭证无效" };
    }

    try {
      const data = await attendanceService.getTodayStatus(schoolId, userId, query?.date);

      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 200, data, message: "今日考勤状态拉取成功" }));
        }
      }

      return { code: 200, data, message: "今日考勤状态拉取成功" };
    } catch (err: any) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 500, message: err.message || "获取考勤状态异常" }));
        }
      }
      return { code: 500, message: err.message || "获取考勤状态异常" };
    }
  }

  /**
   * 3. 发起补卡申诉
   * POST /api/v1/attendance/appeal/create
   */
  public async handleCreateAppeal(
    req: any,
    res: any,
    body: ICreateAppealDto,
    userPayload?: any
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
          res.end(JSON.stringify({ code: 401, message: "请先登录后再提交申诉" }));
        }
      }
      return { code: 401, message: "请先登录后再提交申诉" };
    }

    try {
      const data = await attendanceService.createAppeal(schoolId, userId, body);

      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 200, data, message: "补卡申诉提交成功，已推送主管审批" }));
        }
      }

      return { code: 200, data, message: "补卡申诉提交成功，已推送主管审批" };
    } catch (err: any) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 400, message: err.message || "提交申诉失败" }));
        }
      }
      return { code: 400, message: err.message || "提交申诉失败" };
    }
  }

  /**
   * 4. 主管审批补卡申诉
   * POST /api/v1/attendance/appeal/approve
   */
  public async handleApproveAppeal(
    req: any,
    res: any,
    body: IApproveAppealDto,
    userPayload?: any
  ): Promise<any> {
    const schoolId = Number(
      userPayload?.schoolId !== undefined
        ? userPayload.schoolId
        : (req?.headers as any)?.["x-school-id"] || 1
    );
    const approverId = Number(userPayload?.userId || userPayload?.id || 0);

    if (!schoolId || isNaN(schoolId) || schoolId <= 0 || !approverId || approverId <= 0) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 401, message: "无审批权限或登录已过期" }));
        }
      }
      return { code: 401, message: "无审批权限或登录已过期" };
    }

    try {
      await attendanceService.approveAppeal(schoolId, approverId, body);

      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 200, message: "申诉审批处理完成，考勤账本已自愈冲正" }));
        }
      }

      return { code: 200, message: "申诉审批处理完成，考勤账本已自愈冲正" };
    } catch (err: any) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 400, message: err.message || "审批处理失败" }));
        }
      }
      return { code: 400, message: err.message || "审批处理失败" };
    }
  }

  /**
   * 5. 查询个人月度考勤明细报表
   * GET /api/v1/attendance/monthly-report
   */
  public async handleGetMonthlyReport(
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

    if (!schoolId || isNaN(schoolId) || schoolId <= 0 || !userId || userId <= 0) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 401, message: "请先登录查看考勤报表" }));
        }
      }
      return { code: 401, message: "请先登录查看考勤报表" };
    }

    try {
      const data = await attendanceService.getMonthlyReport(schoolId, userId, query?.month);

      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 200, data, message: "月度考勤报表拉取成功" }));
        }
      }

      return { code: 200, data, message: "月度考勤报表拉取成功" };
    } catch (err: any) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 500, message: err.message || "获取月度考勤异常" }));
        }
      }
      return { code: 500, message: err.message || "获取月度考勤异常" };
    }
  }
}

export const attendanceController = new AttendanceController();
