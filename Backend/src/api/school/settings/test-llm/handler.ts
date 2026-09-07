/**
 * 高校后勤巡查e速办 v4.0 - POST /api/school/settings/test-llm 路由 Handler
 * (School LLM Ping Probe Handler)
 */

import { schoolLLMConfigController, ISchoolLlmHttpCtx } from "../../../../controllers/schoolLlmConfigController.js";

export async function handleTestLlmConnectivity(
  userCtx: { schoolId: number; userId: number; userRole?: number },
  body?: any
): Promise<any> {
  const ctx: ISchoolLlmHttpCtx = {
    schoolId: userCtx.schoolId,
    userId: userCtx.userId,
    userRole: userCtx.userRole,
    body
  };
  return schoolLLMConfigController.testConnectivity(ctx);
}
