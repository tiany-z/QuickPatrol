/**
 * 高校后勤巡查e速办 v4.0 - /api/school/settings/llm 路由 Handler
 * (School LLM Settings Query & Save Handler)
 */

import { schoolLLMConfigController, ISchoolLlmHttpCtx } from "../../../../controllers/schoolLlmConfigController.js";

export async function handleGetLlmConfig(
  userCtx: { schoolId: number; userId: number; userRole?: number },
  query?: any
): Promise<any> {
  const ctx: ISchoolLlmHttpCtx = {
    schoolId: userCtx.schoolId,
    userId: userCtx.userId,
    userRole: userCtx.userRole,
    query
  };
  return schoolLLMConfigController.getConfig(ctx);
}

export async function handleSaveLlmConfig(
  userCtx: { schoolId: number; userId: number; userRole?: number },
  body?: any
): Promise<any> {
  const ctx: ISchoolLlmHttpCtx = {
    schoolId: userCtx.schoolId,
    userId: userCtx.userId,
    userRole: userCtx.userRole,
    body
  };
  return schoolLLMConfigController.saveConfig(ctx);
}
