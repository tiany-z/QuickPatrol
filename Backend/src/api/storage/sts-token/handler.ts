/**
 * M22: 获取云存储直传临时授权处理器
 * GET /api/storage/sts-token
 */

import { OssController } from "../../../apps/storage/ossController.js";
import { IStsTokenResponseDto } from "../../../apps/storage/ossTypes.js";
import { StandardResult } from "../../../shared/flow/result.js";

export async function handleGetStsToken(
  ctx: { schoolId: number; userId: number; ip?: string },
  query: { scene?: string }
): Promise<StandardResult<IStsTokenResponseDto>> {
  return OssController.getStsToken(ctx, query);
}
