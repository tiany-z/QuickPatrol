/**
 * M30: 工单全景大宽表详情端点处理器
 * GET /api/patrol/panoramic-detail
 */

import { StandardResult } from "../../../shared/flow/result.js";
import {
  PatrolDetailController,
  IPatrolDetailOperatorContext
} from "../../../apps/patrol/patrolDetailController.js";
import { IPatrolPanoramicDetailDto } from "../../../apps/patrol/patrolDetailTypes.js";

export async function handleGetPanoramicDetail(
  ctx: IPatrolDetailOperatorContext,
  query: Record<string, any>
): Promise<StandardResult<IPatrolPanoramicDetailDto>> {
  return PatrolDetailController.handleGetPanoramicDetail(ctx, query);
}
