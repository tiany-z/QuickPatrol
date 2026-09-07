import { MultiTenantJwtService } from "../../../apps/auth/jwtService.js";
import { ISwitchIdentityRequest } from "../../../apps/auth/authTypes.js";
import { returnSuccess, returnError, StandardResult } from "../../../shared/flow/result.js";
import { WeChatAuthService } from "../../../services/auth/wechatAuthService.js";

/**
 * 双身份一键无缝热切换 HTTP 端点业务处理器
 * POST /api/auth/switch-identity
 */
export async function handleSwitchIdentity(
  reqContext: { schoolId: number; userId: number; token: string },
  body: ISwitchIdentityRequest
): Promise<StandardResult<any>> {
  try {
    if (!body || typeof body !== "object") {
      return returnError("请求体不能为空");
    }

    const targetType = body.targetActiveType;
    if (targetType !== 1 && targetType !== 2) {
      return returnError("非法的目标工作视角标识 (必须为 1 或 2)");
    }

    // 1. 验证当前 Token
    if (!reqContext || !reqContext.token) {
      return returnError("缺少当前会话 Token");
    }
    const currentPayload = MultiTenantJwtService.verify(reqContext.token);

    // 2. 回查权威用户数据确认实时角色 (防止管理员刚刚下调或封禁)
    const user = await WeChatAuthService.getUserById(reqContext.schoolId, reqContext.userId);
    if (!user) {
      return returnError("用户不存在或已被注销");
    }

    if (user.isBan === 1) {
      return returnError("账号已被封禁");
    }

    // 3. 越权降级防线：普通师生 (role < 2) 严禁切换至师傅端
    if (targetType === 2 && user.role < 2) {
      return returnError("越权访问: 您当前暂无后勤维保人员权限，无法切换至师傅施工端");
    }

    // 4. 重签新 Token，活动工作视角安全更新为 targetType
    const newToken = MultiTenantJwtService.reSignWithActiveType(currentPayload, targetType);

    return returnSuccess({
      token: newToken,
      activeType: targetType,
      role: user.role
    });
  } catch (err: any) {
    return returnError(`切换身份失败: ${err.message}`);
  }
}
