import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleSubmitReply } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/feedback/appeals/official-reply",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId || (ctx as any).schoolId);
    const userId = Number(ctx.userPayload?.userId || (ctx as any).userId);
    const role = Number(ctx.userPayload?.role ?? (ctx as any).role ?? 0);
    const departmentId = Number((ctx.userPayload as any)?.departmentId || (ctx as any).departmentId || 1);

    if (!schoolId || !userId) {
      return returnError("未授权的用户身份或租户标识丢失");
    }

    return handleSubmitReply(
      { schoolId, userId, role, departmentId },
      data.body || {}
    );
  }
};

export default api;
