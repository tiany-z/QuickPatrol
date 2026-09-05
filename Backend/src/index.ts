import http from "http";
import {
  closeMySQLPool,
  closeRedisClient,
  executeQuery,
  getRedisClient,
  initMySQLPool,
  initRedisClient,
  loadEnvFile,
  parseCliEnvFile,
  TerminalLogger,
  validateRequiredEnvs,
} from "./shared/index.js";
import { scanAndPrecompileApiRoutes } from "./dispatcher/apiScanner.js";
import { dispatchHttpRequest } from "./dispatcher/masterDispatcher.js";
import { initWsGateway } from "./ws/wsGateway.js";
import { HeartbeatManager } from "./heartbeat/heartbeatManager.js";

async function main() {
  // 1. 加载与校验环境变量 (支持 --env_file=1.env)
  const cliEnv = parseCliEnvFile();
  if (!cliEnv) {
    TerminalLogger.printError("BackendApp", "未指定启动环境文件！示例: npx tsx src/index.ts --env_file=1.env");
    process.exit(1);
  }

  const envRes = loadEnvFile(cliEnv);
  if (envRes.status === 0) {
    TerminalLogger.printError("BackendApp", envRes.content);
    process.exit(1);
  }

  const valRes = validateRequiredEnvs([
    "MYSQL_HOST",
    "MYSQL_PORT",
    "MYSQL_USER",
    "MYSQL_PASSWORD",
    "MYSQL_DATABASE",
    "REDIS_HOST",
    "REDIS_PORT",
  ]);
  if (valRes.status === 0) {
    TerminalLogger.printError("BackendApp", valRes.content);
    process.exit(1);
  }

  const nodeId = process.env.NODE_ID || "BackendNode-01";
  const httpPort = parseInt(process.env.HTTP_PORT || "8000", 10);

  TerminalLogger.info(`正在启动 ${nodeId} (端口: ${httpPort})...`, "Startup");

  // 2. 初始化 MySQL 数据库连接池并执行连通性探测
  TerminalLogger.info("正在初始化 MySQL 连接池并探测连通性...", "Startup");
  const mysqlPoolRes = initMySQLPool();
  if (mysqlPoolRes.status === 0) {
    TerminalLogger.printError("BackendApp", `MySQL 连接池初始化失败: ${mysqlPoolRes.content}`);
    process.exit(1);
  }

  const mysqlPingRes = await executeQuery("SELECT 1 AS ping;");
  if (mysqlPingRes.status === 0) {
    TerminalLogger.printError(
      "BackendApp",
      `无法连通至 MySQL 数据库 [${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT}/${process.env.MYSQL_DATABASE}]: ${mysqlPingRes.content}`
    );
    process.exit(1);
  }
  TerminalLogger.info("✅ MySQL 数据库连通性探测通过", "Startup");

  // 3. 初始化 Redis 客户端并执行连通性探测
  TerminalLogger.info("正在初始化 Redis 客户端并探测连通性...", "Startup");
  const redisRes = initRedisClient();
  if (redisRes.status === 0) {
    TerminalLogger.printError("BackendApp", `Redis 客户端初始化失败: ${redisRes.content}`);
    process.exit(1);
  }

  try {
    const redis = getRedisClient();
    if (!redis) throw new Error("Redis client is null");
    await redis.ping();
    TerminalLogger.info("✅ Redis 缓存服务器连通性探测通过", "Startup");
  } catch (redisErr: any) {
    TerminalLogger.printError(
      "BackendApp",
      `无法连通至 Redis 服务 [${process.env.REDIS_HOST}:${process.env.REDIS_PORT}]: ${redisErr.message || redisErr}`
    );
    process.exit(1);
  }

  // 4. 扫描并预编译 src/api 目录树契约路由
  TerminalLogger.info("正在扫描并预编译 src/api 契约路由...", "Startup");
  const scanRes = await scanAndPrecompileApiRoutes();
  if (scanRes.status === 0) {
    TerminalLogger.printError("BackendApp", `扫描 API 契约失败: ${scanRes.content}`);
    process.exit(1);
  }

  // 5. 创建 HTTP 服务器与集成 WebSocket 网关
  const httpServer = http.createServer(async (req, res) => {
    await dispatchHttpRequest(req, res);
  });

  initWsGateway(httpServer);

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(httpPort, () => resolve());
    httpServer.on("error", (err) => reject(err));
  });

  // 6. 启动 Redis 活跃节点集群心跳上报
  HeartbeatManager.startHeartbeat();

  // 7. 打印启动成功信息
  TerminalLogger.printBanner(
    nodeId,
    httpPort,
    `${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT}/${process.env.MYSQL_DATABASE}`,
    `${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
  );

  // 8. 优雅关机
  const shutdown = async (signal: string) => {
    TerminalLogger.info(`收到 ${signal} 信号，正在优雅停机...`, "Shutdown");
    await HeartbeatManager.stopHeartbeat();
    httpServer.close();
    await closeMySQLPool();
    await closeRedisClient();
    TerminalLogger.info("进程已安全退出", "Shutdown");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  TerminalLogger.printError("BackendApp", `启动出现未捕获异常: ${err.message || String(err)}`);
  process.exit(1);
});
