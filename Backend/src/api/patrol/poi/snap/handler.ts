/**
 * M21: 校内建筑 POI 吸附端点处理器
 * POST /api/patrol/poi/snap
 */

import { PatrolController } from "../../../../apps/patrol/patrolController.js";
import { StandardResult } from "../../../../shared/flow/result.js";

export async function handleSnapPoi(
  ctx: { schoolId: number; userId?: number },
  body: { campusId: number; latitude: number; longitude: number }
): Promise<StandardResult<any>> {
  return PatrolController.snapPoi(ctx, body);
}
