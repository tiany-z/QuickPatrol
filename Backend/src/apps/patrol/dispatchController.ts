/**
 * M23: 智能网格派单与手工干预控制器
 * (Patrol Dispatch Controller)
 */

import { executeASTSelect, executeASTUpdate } from "../../shared/sql/index.js";
import { getMySQLPool } from "../../shared/db/mysql.js";
import { AuditLogger } from "../../shared/log/auditLogger.js";
import { RedisWsBridge } from "../../ws/redisWsBridge.js";
import { WeChatAuthService } from "../../services/auth/wechatAuthService.js";
import { PatrolService } from "./patrolService.js";
import { IManualDispatchRequest } from "./dispatchTypes.js";
import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";

export class DispatchController {
  /**
   * 管理员手动强制指定工单责任师傅
   * POST /api/patrol/dispatch/manual
   */
  public static async handleManualDispatch(
    ctx: { schoolId: number; userId: number; role?: number; ip?: string },
    body: IManualDispatchRequest
  ): Promise<StandardResult<any>> {
    try {
      if (!ctx.schoolId || !ctx.userId) {
        return returnError("未授权的租户请求或用户未登录");
      }

      // 权限门禁：仅班组主管 (role >= 2) 及以上有权手动干预改派
      const role = ctx.role !== undefined ? Number(ctx.role) : 0;
      if (role < 2) {
        return returnError("权限不足: 仅主管及以上管理员有权手动指定或改派责任人");
      }

      if (!body || !body.patrolId || !body.targetUserId) {
        return returnError("缺少必要的工单ID (patrolId) 或目标责任人ID (targetUserId)");
      }

      // 1. 验证目标人有效性
      let targetUser: any = null;
      if (getMySQLPool()) {
        const sql = `SELECT id, realName, isBan FROM users WHERE id = ? AND schoolId = ? AND isDeleted = 0 LIMIT 1`;
        const rows: any = await executeASTSelect(sql, [body.targetUserId, ctx.schoolId]);
        if (rows && rows.length > 0) {
          targetUser = rows[0];
        }
      } else {
        const u = WeChatAuthService.getMockUser(body.targetUserId);
        if (u && u.schoolId === ctx.schoolId) {
          targetUser = u;
        }
      }

      if (!targetUser || targetUser.isBan === 1) {
        return returnError("目标责任师傅不存在或处于停用/封禁状态");
      }

      // 2. 验证工单是否存在
      let patrol: any = PatrolService.getMockPatrol(body.patrolId);
      if (!patrol && getMySQLPool()) {
        const sql = `SELECT id, orderNo, title, location1, location2, deadline, priorityLevel FROM patrols WHERE id = ? AND schoolId = ? LIMIT 1`;
        const rows: any = await executeASTSelect(sql, [body.patrolId, ctx.schoolId]);
        if (rows && rows.length > 0) {
          patrol = rows[0];
        }
      }

      if (!patrol) {
        return returnError(`工单 [ID: ${body.patrolId}] 不存在`);
      }

      // 3. 更新工单责任人
      PatrolService.updateMockPatrol(body.patrolId, { currentHandlerId: body.targetUserId });

      if (getMySQLPool()) {
        const updateSql = `UPDATE patrols SET currentHandlerId = ?, updatedAt = NOW() WHERE id = ? AND schoolId = ?`;
        await executeASTUpdate(updateSql, [body.targetUserId, body.patrolId, ctx.schoolId]);
      }

      // 4. 记录安全与运维审计流水
      const clientIp = ctx.ip || "127.0.0.1";
      await AuditLogger.log(ctx.schoolId, ctx.userId, "DISPATCH_MANUAL_OVERRIDE", "Patrol", clientIp, {
        patrolId: body.patrolId,
        newHandlerId: body.targetUserId,
        newHandlerName: targetUser.realName,
        remark: body.assignRemark || ""
      });

      // 5. 单播推送至该责任师傅 WebSocket
      await RedisWsBridge.sendToUser(ctx.schoolId, body.targetUserId, {
        event: "WORK_ORDER_DISPATCHED",
        schoolId: ctx.schoolId,
        patrolId: body.patrolId,
        orderNo: patrol.orderNo || `LCU-${body.patrolId}`,
        title: patrol.title || "应急维保工单",
        campusName: "当前校区",
        location: `${patrol.location1 || ""} ${patrol.location2 || ""}`.trim(),
        categoryName: "人工指定派单",
        priorityLevel: patrol.priorityLevel ?? 1,
        deadline: patrol.deadline || "",
        dispatchType: "DIRECT",
        vibratePattern: patrol.priorityLevel === 2 ? "heavy" : "medium",
        soundAlert: true
      });

      return returnSuccess({
        patrolId: body.patrolId,
        assignedUserId: body.targetUserId,
        assignedUserName: targetUser.realName
      }, `工单已成功手动派发给 [${targetUser.realName}]`);
    } catch (err: any) {
      return returnError(err.message || "手动派单处理异常");
    }
  }
}
