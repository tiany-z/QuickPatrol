import { returnSuccess, StandardResult } from "../../../shared/index.js";

export const api = {
  routePath: "/api/system/ping",
  authRequired: false,
  handler: async (reqCtx: any, ctx: any): Promise<StandardResult<any>> => {
    return returnSuccess({
      message: "pong",
      nodeId: process.env.NODE_ID || "BackendNode-Unknown",
      httpPort: process.env.HTTP_PORT || "8000",
      timestamp: Date.now(),
      requestId: ctx?.requestId,
    });
  },
};

export default api;
