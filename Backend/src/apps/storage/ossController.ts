/**
 * M22: 云存储凭证控制器端点
 * (OSS/COS Storage Controller)
 */

import { OssService } from "./ossService.js";
import { IStsTokenResponseDto } from "./ossTypes.js";
import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";

export class OssController {
  /**
   * 获取多租户隔离的上传临时授权
   * GET /api/storage/sts-token
   */
  public static async getStsToken(
    ctx: { schoolId: number; userId: number; ip?: string },
    query: { scene?: string }
  ): Promise<StandardResult<IStsTokenResponseDto>> {
    try {
      if (!ctx.schoolId || !ctx.userId) {
        return returnError("未授权的租户请求或用户未登录");
      }

      const scene = (query?.scene as string) || "patrol";
      if (!["patrol", "handle", "review"].includes(scene)) {
        return returnError("非法的上传场景，仅支持 patrol/handle/review");
      }

      const tokenDto = await OssService.generateTenantStsToken(
        ctx.schoolId,
        ctx.userId,
        ctx.ip || "127.0.0.1",
        { scene: scene as any }
      );

      return returnSuccess(tokenDto);
    } catch (err: any) {
      return returnError(err.message || "获取存储凭证异常");
    }
  }
}
