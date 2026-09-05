import {
  executeQuery,
  getRedisClient,
  returnError,
  returnSuccess,
  StandardResult,
  tryCatchErrorToString,
} from "../../../shared/index.js";

export const api = {
  routePath: "/api/system/health",
  authRequired: false,
  handler: async (): Promise<StandardResult<any>> => {
    try {
      // 1. 测试 MySQL 连通性
      const mysqlRes = await executeQuery<{ test: number }>("SELECT 1 + 1 AS test");
      const mysqlOk = mysqlRes.status === 1 && mysqlRes.data && mysqlRes.data[0]?.test === 2;

      // 2. 测试 Redis 连通性
      const redis = getRedisClient();
      let redisOk = false;
      if (redis) {
        const pingRes = await redis.ping();
        redisOk = pingRes === "PONG";
      }

      const allOk = mysqlOk && redisOk;

      return returnSuccess({
        status: allOk ? "UP" : "DEGRADED",
        nodeId: process.env.NODE_ID || "node",
        httpPort: process.env.HTTP_PORT || "8000",
        checks: {
          mysql: mysqlOk ? "UP" : `DOWN: ${mysqlRes.content}`,
          redis: redisOk ? "UP" : "DOWN",
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return returnError(`Healthcheck error: ${tryCatchErrorToString(error)}`);
    }
  },
};

export default api;
