import { WeChatAuthService } from "../../../services/auth/wechatAuthService.js";
import { IWeChatLoginRequest } from "../../../apps/auth/authTypes.js";
import { returnSuccess, returnError, StandardResult } from "../../../shared/flow/result.js";

/**
 * 微信静默授权登录 HTTP 端点
 * POST /api/auth/login
 */
export async function handleWeChatLogin(body: IWeChatLoginRequest): Promise<StandardResult<any>> {
  try {
    if (!body || typeof body !== "object") {
      return returnError("请求体不能为空");
    }

    if (!body.schoolId || typeof body.schoolId !== "number" || body.schoolId <= 0) {
      return returnError("缺少合法所属学校参数 (schoolId)");
    }

    if (!body.code || typeof body.code !== "string" || body.code.trim() === "") {
      return returnError("缺少微信授权凭证 (code)");
    }

    const authResult = await WeChatAuthService.loginByCode(body.schoolId, body.code, {
      nickName: body.nickName,
      avatarUrl: body.avatarUrl,
      preferredActiveType: body.preferredActiveType
    });

    return returnSuccess(authResult);
  } catch (err: any) {
    return returnError(`登录认证失败: ${err.message}`);
  }
}
