import { WebSocket } from "ws";
import { WsSessionContext } from "./wsTypes.js";
import { TerminalLogger } from "../shared/log/terminalLogger.js";
import { RedisWsBridge } from "./redisWsBridge.js";

/**
 * M06: ConnectionBufferManager 1000ms 宽限闪断缓冲队列与会话保持器
 * 在移动巡查场景下，客户端遭遇弱网瞬断（< 1000ms）时保持会话状态并缓冲积压消息，重连成功后 100% 顺序冲刷补发。
 */
export class ConnectionBufferManager {
  public static readonly GRACE_TIMEOUT_MS = 1000;
  public static readonly MAX_BUFFER_CAPACITY = 100;

  // 活跃已认证会话: sessionId -> WsSessionContext
  private static activeSessions = new Map<string, WsSessionContext>();
  // 闪断等待重连会话: sessionId -> WsSessionContext
  private static waitingSessions = new Map<string, WsSessionContext>();
  // 闪断宽限自愈倒计时器: sessionId -> NodeJS.Timeout
  private static graceTimers = new Map<string, NodeJS.Timeout>();
  // 多租户用户索引: `${schoolId}:${userId}` -> Set<sessionId>
  private static userSessionIndex = new Map<string, Set<string>>();
  // 已销毁会话墓碑记录 (容量上限 500，供状态机审计与单测状态断言)
  private static destroyedSessions = new Map<string, WsSessionContext>();

  /**
   * 注册全新上线的长连接会话
   */
  public static registerSession(session: WsSessionContext): void {
    this.activeSessions.set(session.sessionId, session);
    const indexKey = `${session.schoolId}:${session.userId}`;
    if (!this.userSessionIndex.has(indexKey)) {
      this.userSessionIndex.set(indexKey, new Set());
    }
    this.userSessionIndex.get(indexKey)!.add(session.sessionId);

    TerminalLogger.info(
      `[M06] 会话上线: ${session.sessionId} (用户: ${session.userId}, 学校: ${session.schoolId})`,
      "WebSocket"
    );
  }

  /**
   * 套接字物理断开事件处理 (进入 1000ms 宽限暂存态)
   */
  public static handleSocketDisconnect(socket: WebSocket): WsSessionContext | null {
    let targetSession: WsSessionContext | null = null;
    for (const session of this.activeSessions.values()) {
      if (session.socket === socket) {
        targetSession = session;
        break;
      }
    }

    if (!targetSession) {
      return null;
    }

    const { sessionId } = targetSession;
    targetSession.state = "WAITING_RECONNECT";
    targetSession.socket = null; // 解除底层套接字强引用，防半开悬挂与内存泄露

    this.activeSessions.delete(sessionId);
    this.waitingSessions.set(sessionId, targetSession);

    // 清理可能遗留的前置定时器
    if (this.graceTimers.has(sessionId)) {
      clearTimeout(this.graceTimers.get(sessionId)!);
      this.graceTimers.delete(sessionId);
    }

    TerminalLogger.warn(
      `[M06] 连接物理闪断，进入 1000ms 宽限缓冲态: ${sessionId}`,
      "WebSocket"
    );

    // 启动 1000ms 宽限期销毁倒计时
    const timer = setTimeout(() => {
      this.destroySessionPermanently(sessionId);
    }, this.GRACE_TIMEOUT_MS);

    this.graceTimers.set(sessionId, timer);
    return targetSession;
  }

  /**
   * 尝试热重连恢复会话 (携带 lastSessionId)
   */
  public static tryResumeSession(
    lastSessionId: string,
    schoolId: number,
    userId: number,
    newSocket: WebSocket
  ): { resumed: boolean; session?: WsSessionContext; flushedCount: number } {
    const waiting = this.waitingSessions.get(lastSessionId);
    if (!waiting) {
      return { resumed: false, flushedCount: 0 };
    }

    // 租户与用户双重防越权严格校验
    if (waiting.schoolId !== schoolId || waiting.userId !== userId) {
      TerminalLogger.warn(
        `[M06 越权拦截] 尝试恢复会话租户/用户不匹配: ${lastSessionId} | Expect: (${waiting.schoolId}, ${waiting.userId}) | Got: (${schoolId}, ${userId})`,
        "WebSocket"
      );
      return { resumed: false, flushedCount: 0 };
    }

    // 命中热重连！立即注销 1000ms 销毁倒计时
    const timer = this.graceTimers.get(lastSessionId);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(lastSessionId);
    }

    this.waitingSessions.delete(lastSessionId);
    waiting.socket = newSocket;
    waiting.state = "CONNECTED";
    waiting.lastActiveAt = Date.now();
    this.activeSessions.set(lastSessionId, waiting);

    // 执行冲刷流水线 (Flush Pipeline)
    const flushedCount = this.flushBuffer(waiting);

    TerminalLogger.info(
      `[M06] 会话闪断自愈成功! 已补发 ${flushedCount} 条暂存消息 | Session: ${lastSessionId}`,
      "WebSocket"
    );
    return { resumed: true, session: waiting, flushedCount };
  }

  /**
   * 向指定租户用户发送消息，若断线处于宽限期则暂存至 GraceBuffer
   */
  public static sendOrBuffer(schoolId: number, userId: number, message: any): boolean {
    const indexKey = `${schoolId}:${userId}`;
    const sessionIds = this.userSessionIndex.get(indexKey);
    if (!sessionIds || sessionIds.size === 0) {
      return false;
    }

    let delivered = false;
    for (const sid of sessionIds) {
      const active = this.activeSessions.get(sid);
      if (active && active.socket && active.socket.readyState === WebSocket.OPEN) {
        try {
          active.socket.send(JSON.stringify(message));
          delivered = true;
        } catch (err) {
          TerminalLogger.error(`[M06] 发送消息异常: ${err}`, "WebSocket");
        }
      } else {
        // 在等待重连表中，写入 GraceBuffer 有界环形队列
        const waiting = this.waitingSessions.get(sid);
        if (waiting) {
          if (waiting.graceBuffer.length >= this.MAX_BUFFER_CAPACITY) {
            waiting.graceBuffer.shift(); // 淘汰最老一条，杜绝 OOM
          }
          waiting.graceBuffer.push({
            data: message,
            timestamp: Date.now(),
            seq: waiting.graceBuffer.length + 1,
          });
          delivered = true;
        }
      }
    }
    return delivered;
  }

  /**
   * 冲刷缓冲池中的积压消息
   */
  public static flushBuffer(session: WsSessionContext): number {
    if (!session.socket || session.socket.readyState !== WebSocket.OPEN) {
      return 0;
    }

    let count = 0;
    while (session.graceBuffer.length > 0) {
      const item = session.graceBuffer.shift()!;
      try {
        session.socket.send(
          JSON.stringify({
            ...item.data,
            _buffered: true,
            _bufferedTime: item.timestamp,
            seq: item.seq,
          })
        );
        count++;
      } catch (err) {
        TerminalLogger.error(`[M06] 冲刷缓冲包异常: ${err}`, "WebSocket");
      }
    }
    return count;
  }

  /**
   * 超过 1000ms 宽限期未重连，彻底物理销毁会话
   */
  public static destroySessionPermanently(sessionId: string): void {
    const session = this.waitingSessions.get(sessionId);
    if (!session) {
      return;
    }

    this.waitingSessions.delete(sessionId);
    this.graceTimers.delete(sessionId);

    const indexKey = `${session.schoolId}:${session.userId}`;
    const userSids = this.userSessionIndex.get(indexKey);
    if (userSids) {
      userSids.delete(sessionId);
      if (userSids.size === 0) {
        this.userSessionIndex.delete(indexKey);
      }
    }

    session.state = "DESTROYED";
    session.graceBuffer = []; // 彻底释放堆内存
    this.destroyedSessions.set(sessionId, session);
    if (this.destroyedSessions.size > 500) {
      const firstKey = this.destroyedSessions.keys().next().value;
      if (firstKey) this.destroyedSessions.delete(firstKey);
    }

    TerminalLogger.info(
      `[M06] 超过 1000ms 宽限期，彻底销毁会话: ${sessionId}`,
      "WebSocket"
    );

    // 跨集群广播离线通知 (通知 M43 切换至离线兜底通道)
    RedisWsBridge.broadcast("cluster:tenant:force_logout", session.schoolId, {
      userId: session.userId,
      destroyedSessionId: sessionId,
      action: "USER_OFFLINE",
      time: Date.now(),
    }).catch(() => {});
  }

  /**
   * 查找任意状态的会话对象 (包含活跃、等待重连与墓碑销毁态)
   */
  public static getSession(sessionId: string): WsSessionContext | undefined {
    return (
      this.activeSessions.get(sessionId) ||
      this.waitingSessions.get(sessionId) ||
      this.destroyedSessions.get(sessionId)
    );
  }

  public static getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  public static getWaitingSessionCount(): number {
    return this.waitingSessions.size;
  }

  /**
   * 清理全部会话与定时器 (单元测试环境重置使用)
   */
  public static clearAll(): void {
    for (const timer of this.graceTimers.values()) {
      clearTimeout(timer);
    }
    this.graceTimers.clear();
    this.activeSessions.clear();
    this.waitingSessions.clear();
    this.userSessionIndex.clear();
    this.destroyedSessions.clear();
  }
}
