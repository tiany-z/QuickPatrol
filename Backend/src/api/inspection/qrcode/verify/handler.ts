/**
 * M20: 现场扫码防伪与防作弊打卡核验端点处理器
 * POST /api/inspection/qrcode/verify
 */

import { QrcodeService } from "../../../../apps/inspection/qrcodeService.js";
import { IVerifyPointScanRequest } from "../../../../apps/inspection/qrcodeTypes.js";
import { returnError, returnSuccess, StandardResult } from "../../../../shared/flow/result.js";

export async function handleVerifyScan(
  ctx: { schoolId: number; userId: number; role: number; ip?: string },
  body: IVerifyPointScanRequest
): Promise<StandardResult<any>> {
  try {
    if (!body || typeof body !== "object") {
      return returnError("缺少核验请求体数据");
    }

    if (!body.scene) {
      return returnError("缺少二维码 Scene 参数");
    }

    if (typeof body.userLatitude !== "number" || typeof body.userLongitude !== "number") {
      return returnError("缺少手机 GPS 经纬度数据");
    }

    const result = await QrcodeService.verifyAndRecordScan(
      ctx.schoolId,
      ctx.userId,
      ctx.ip || "127.0.0.1",
      body
    );

    return returnSuccess(result);
  } catch (err: any) {
    return returnError(`打卡核验失败: ${err.message}`);
  }
}
