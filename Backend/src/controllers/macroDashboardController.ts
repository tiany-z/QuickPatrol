/**
 * 高校后勤巡查e速办 v4.0 - M53 全校后勤宏观运维决策大盘控制器
 * 文件路径: src/controllers/macroDashboardController.ts
 * 核心职责: 接收宏观决策大盘基准快照、增量差分触发、工单Excel导出与特大险情警报请求，多租户鉴权隔离。
 */

import { macroDashboardService } from "../services/macroDashboardService.js";
import { patrolExcelExportService } from "../services/patrolExcelExportService.js";
import {
  IPatrolExcelExportOptionsDto,
  IEmergencyAlertBroadcastDto
} from "../contracts/dashboardContract.js";

export class MacroDashboardController {
  /**
   * 1. 获取全校宏观决策大盘基准快照
   * GET /api/v1/dashboard/overview
   */
  public async handleGetOverview(
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

    try {
      const data = await macroDashboardService.getDashboardOverview(schoolId);

      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 200, data, message: "宏观决策大盘数据拉取成功" }));
        }
      }

      return { code: 200, data, message: "宏观决策大盘数据拉取成功" };
    } catch (err: any) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 500, message: err.message || "大盘数据汇聚异常" }));
        }
      }
      return { code: 500, message: err.message || "大盘数据汇聚异常" };
    }
  }

  /**
   * 2. 触发增量差分计算与广播
   * POST /api/v1/dashboard/trigger-sync
   */
  public async handleTriggerSync(
    req: any,
    res: any,
    body: any,
    userPayload?: any
  ): Promise<any> {
    const schoolId = Number(
      userPayload?.schoolId !== undefined
        ? userPayload.schoolId
        : (req?.headers as any)?.["x-school-id"] || body?.schoolId || 1
    );

    try {
      const deltaEvent = await macroDashboardService.computeAndBroadcastDelta(schoolId);

      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({
            code: 200,
            data: deltaEvent,
            message: deltaEvent ? "大盘增量差分广播已分发" : "大盘无状态变动，跳过差分广播"
          }));
        }
      }

      return {
        code: 200,
        data: deltaEvent,
        message: deltaEvent ? "大盘增量差分广播已分发" : "大盘无状态变动，跳过差分广播"
      };
    } catch (err: any) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 500, message: err.message || "差分同步异常" }));
        }
      }
      return { code: 500, message: err.message || "差分同步异常" };
    }
  }

  /**
   * 3. 导出月度工单 Excel 台账 (含高德地图导航)
   * POST /api/v1/dashboard/export-excel
   */
  public async handleExportExcel(
    req: any,
    res: any,
    body: IPatrolExcelExportOptionsDto,
    userPayload?: any
  ): Promise<any> {
    const schoolId = Number(
      userPayload?.schoolId !== undefined
        ? userPayload.schoolId
        : (req?.headers as any)?.["x-school-id"] || body?.schoolId || 1
    );

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const startDate = body?.startDate || `${year}-${month}-01`;
    const endDate = body?.endDate || `${year}-${month}-30`;

    try {
      const result = await patrolExcelExportService.exportPatrolsWithMapQr({
        schoolId,
        startDate,
        endDate,
        campusId: body?.campusId,
        categoryId: body?.categoryId,
        status: body?.status,
        includeMapQr: body?.includeMapQr !== false
      });

      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(200, {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${result.fileName}"`
        });
        if (typeof res.end === "function") {
          res.end(result.buffer);
        }
      }

      return {
        code: 200,
        data: {
          fileName: result.fileName,
          fileSizeBytes: result.buffer.length,
          totalCount: result.totalCount
        },
        message: "工单Excel台账生成成功"
      };
    } catch (err: any) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 500, message: err.message || "导出生成失败" }));
        }
      }
      return { code: 500, message: err.message || "导出生成失败" };
    }
  }

  /**
   * 4. 发布特大管网险情全屏警报
   * POST /api/v1/dashboard/emergency-alert
   */
  public async handleEmergencyAlert(
    req: any,
    res: any,
    body: IEmergencyAlertBroadcastDto,
    userPayload?: any
  ): Promise<any> {
    const schoolId = Number(
      userPayload?.schoolId !== undefined
        ? userPayload.schoolId
        : (req?.headers as any)?.["x-school-id"] || body?.schoolId || 1
    );

    try {
      const result = await macroDashboardService.triggerEmergencyAlert({
        ...body,
        schoolId
      });

      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 200, data: result, message: "特大险情全屏警报已广播" }));
        }
      }

      return { code: 200, data: result, message: "特大险情全屏警报已广播" };
    } catch (err: any) {
      if (res && typeof res.writeHead === "function" && !res.headersSent && !res.writableEnded) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        if (typeof res.end === "function") {
          res.end(JSON.stringify({ code: 400, message: err.message || "警报广播失败" }));
        }
      }
      return { code: 400, message: err.message || "警报广播失败" };
    }
  }
}

export const macroDashboardController = new MacroDashboardController();
