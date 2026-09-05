import os from "os";
import {
  getRedisClient,
  TerminalLogger,
  returnError,
  returnSuccess,
  StandardResult,
  tryCatchErrorToString,
} from "../shared/index.js";

export interface HeartbeatPayload {
  nodeId: string;
  httpPort: number;
  activeWsConnections: number;
  cpuUsagePct?: number;
  memoryUsageBytes?: number;
  timestamp: number;
}

class HeartbeatManagerImpl {
  private timer: NodeJS.Timeout | null = null;
  private nodeId: string = process.env.NODE_ID || "backend-node-01";
  private httpPort: number = parseInt(process.env.HTTP_PORT || "8000", 10);
  private activeWsConnectionsCount: number = 0;

  public setConnectionCount(count: number) {
    this.activeWsConnectionsCount = count;
  }

  public incrementConnection() {
    this.activeWsConnectionsCount++;
  }

  public decrementConnection() {
    this.activeWsConnectionsCount = Math.max(0, this.activeWsConnectionsCount - 1);
  }

  public startHeartbeat(): StandardResult<boolean> {
    try {
      if (this.timer) return returnSuccess(true);

      this.timer = setInterval(async () => {
        await this.pulse();
      }, 2000);

      TerminalLogger.info(`心跳上报服务已就绪 (Node: ${this.nodeId})`, "HeartbeatManager");
      return returnSuccess(true);
    } catch (error) {
      return returnError(`启动心跳失败: ${tryCatchErrorToString(error)}`);
    }
  }

  public async stopHeartbeat(): Promise<StandardResult<boolean>> {
    try {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }

      const redis = getRedisClient();
      if (redis) {
        const key = `backend:heartbeat:${this.nodeId}`;
        await redis.del(key);
        await redis.srem("backend:active_nodes", this.nodeId);
      }

      TerminalLogger.info("心跳已停止，节点已从 Redis 活跃节点集移除", "HeartbeatManager");
      return returnSuccess(true);
    } catch (error) {
      return returnError(`停止心跳失败: ${tryCatchErrorToString(error)}`);
    }
  }

  private async pulse() {
    try {
      const redis = getRedisClient();
      if (!redis) return;

      const freeMem = os.freemem();
      const totalMem = os.totalmem();
      const memUsage = totalMem - freeMem;

      const payload: HeartbeatPayload = {
        nodeId: this.nodeId,
        httpPort: this.httpPort,
        activeWsConnections: this.activeWsConnectionsCount,
        memoryUsageBytes: memUsage,
        timestamp: Date.now(),
      };

      const key = `backend:heartbeat:${this.nodeId}`;
      await redis.set(key, JSON.stringify(payload), "EX", 6);
      await redis.sadd("backend:active_nodes", this.nodeId);
    } catch (err) {
      TerminalLogger.debug(`[HeartbeatPulse Error] ${String(err)}`, "HeartbeatManager");
    }
  }
}

export const HeartbeatManager = new HeartbeatManagerImpl();
