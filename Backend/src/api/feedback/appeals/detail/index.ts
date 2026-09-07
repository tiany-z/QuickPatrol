import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleGetAppealDetail } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/feedback/appeals/detail",
  authRequired: false, // 允许匿名或游客免密查阅官方答复公函详情
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(
      ctx.userPayload?.schoolId ||
      (ctx as any).schoolId ||
      data.req?.headers?.["x-school-id"] ||
      1
    );
    const userId = Number(ctx.userPayload?.userId || 0);

    const appealId = Number(data.query?.appealId || data.query?.id || data.body?.appealId);
    const clientETag = (data.req?.headers?.["if-none-match"] as string) || (data.query?.etag as string);
    const vaultToken = (data.req?.headers?.["x-vault-token"] as string) || (data.query?.vaultToken as string);

    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少高校租户标识");
    }

    return handleGetAppealDetail(
      { schoolId, userId },
      { appealId, clientETag, vaultToken }
    );
  }
};

export default api;
