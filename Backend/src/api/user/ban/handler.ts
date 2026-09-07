/**
 * M17: 停用/封禁后勤人员端点业务逻辑 (强制挂载 Flow Lock 守卫)
 * POST /api/user/ban
 */

import { FlowLockInterceptor } from "../../../dispatcher/flowLockInterceptor.js";
import { executeASTSelect, executeASTUpdate } from "../../../shared/sql/index.js";
import { StandardResult } from "../../../shared/flow/result.js";
import { BusinessLockException } from "../../../apps/org/orgException.js";
import { getMySQLPool } from "../../../shared/db/mysql.js";
import { WeChatAuthService } from "../../../services/auth/wechatAuthService.js";

export interface IBanUserDto {
  targetUserId: number;
  reason?: string;
}

export type BanUserResult = StandardResult<any> & {
  success: boolean;
  code?: number;
  errorCode?: string;
  message?: string;
};

/**
 * 停用/封禁后勤人员端点 (强制挂载 M17 Flow Lock 守卫)
 */
export async function handleBanUser(
  ctx: { schoolId: number; role: number },
  body: IBanUserDto
): Promise<BanUserResult> {
  try {
    if (ctx.role < 4) {
      return {
        success: false,
        status: 0,
        code: 403,
        content: "权限不足: 仅限学校管理员 (role >= 4) 执行账号封禁与停用",
        message: "权限不足: 仅限学校管理员 (role >= 4) 执行账号封禁与停用"
      };
    }

    if (!body || !body.targetUserId) {
      return {
        success: false,
        status: 0,
        code: 400,
        content: "参数缺失: 必须指定 targetUserId",
        message: "参数缺失: 必须指定 targetUserId"
      };
    }

    // 1. 查询目标人员真实姓名
    let userName = "员工";
    if (getMySQLPool()) {
      const userSql = `SELECT realName, nickName, isBan FROM users WHERE schoolId = ? AND id = ? AND isDeleted = 0 LIMIT 1`;
      const rows: any = await executeASTSelect(userSql, [ctx.schoolId, body.targetUserId]);
      if (!rows || rows.length === 0) {
        return {
          success: false,
          status: 0,
          code: 404,
          content: "指定的用户不存在",
          message: "指定的用户不存在"
        };
      }
      userName = rows[0].realName || rows[0].nickName || "员工";
    } else {
      const user = WeChatAuthService.getMockUser(body.targetUserId);
      if (!user) {
        return {
          success: false,
          status: 0,
          code: 404,
          content: "指定的用户不存在",
          message: "指定的用户不存在"
        };
      }
      userName = user.realName || user.nickName || "员工";
    }

    // 2. 核心防线: 触发 Flow Lock 熔断探针 (发现在办工单直接抛出 409)
    await FlowLockInterceptor.interceptUserDestruction(ctx.schoolId, body.targetUserId, userName);

    // 3. 探针通过，安全执行停用
    if (getMySQLPool()) {
      const banSql = `UPDATE users SET isBan = 1, updatedAt = NOW() WHERE schoolId = ? AND id = ?`;
      await executeASTUpdate(banSql, [ctx.schoolId, body.targetUserId]);
    } else {
      WeChatAuthService.updateMockUser(body.targetUserId, { isBan: 1 as any });
    }

    const payload = {
      targetUserId: body.targetUserId,
      userName,
      isBan: 1,
      message: "该员工已安全停用，业务连续性无任何破坏"
    };

    return {
      success: true,
      status: 1,
      code: 200,
      data: payload,
      content: "success",
      message: "success"
    };
  } catch (err: any) {
    if (err instanceof BusinessLockException) {
      // 捕获到 Flow Lock 业务连续性异常，组装标准 409 结构返回
      return {
        success: false,
        status: 0,
        code: 409,
        errorCode: err.code,
        message: err.message,
        content: err.message,
        data: err.detail
      };
    }
    return {
      success: false,
      status: 0,
      code: 500,
      content: `操作失败: ${err.message}`,
      message: `操作失败: ${err.message}`
    };
  }
}
