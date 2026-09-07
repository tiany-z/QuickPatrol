/**
 * M20: 创建固定资产二维码端点处理器
 * POST /api/inspection/qrcode/create
 */

import { QrcodeService } from "../../../../apps/inspection/qrcodeService.js";
import { ICreatePointRequest } from "../../../../apps/inspection/qrcodeTypes.js";
import { returnError, returnSuccess, StandardResult } from "../../../../shared/flow/result.js";

export async function handleCreatePoint(
  ctx: { schoolId: number; userId: number; role: number },
  body: ICreatePointRequest
): Promise<StandardResult<any>> {
  try {
    if (ctx.role < 2) {
      return returnError("权限不足: 仅限维保管理人员及以上角色创建资产二维码点位");
    }

    if (!body || typeof body !== "object") {
      return returnError("缺少请求体参数");
    }

    const result = await QrcodeService.createPoint(ctx.schoolId, body);
    return returnSuccess(result);
  } catch (err: any) {
    return returnError(`创建资产二维码失败: ${err.message}`);
  }
}
