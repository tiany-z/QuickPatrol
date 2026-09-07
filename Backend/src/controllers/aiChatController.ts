/**
 * 高校后勤巡查e速办 v4.0 - M47 小程序专属 AI 流式问答工作台 (SSE Copilot UI)
 * 文件路径: src/controllers/aiChatController.ts
 * 核心职责: 承接小程序 wx.request(enableChunked) 的 POST 对话请求，建立符合
 *           SSE 协议标准的持久长连接，强行关闭 Nginx 代理缓冲，调度服务分发。
 */

import http from "http";
import { aiChatService } from "../services/aiChatService.js";
import { ICopilotChatRequestDto } from "../contracts/copilotContract.js";

export class AIChatController {
  /**
   * 建立 SSE 长连接流式问答对话
   */
  public async handleStreamChat(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: ICopilotChatRequestDto,
    userPayload?: any
  ): Promise<void> {
    const schoolId = Number(
      userPayload?.schoolId !== undefined
        ? userPayload.schoolId
        : (req.headers as any)?.["x-school-id"] || 1
    );

    const userId = Number(userPayload?.userId || userPayload?.id || 0);

    if (!schoolId || isNaN(schoolId) || schoolId <= 0 || !userId || userId <= 0) {
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ code: 401, message: "未授权：缺少高校租户与用户登录身份" }));
      }
      return;
    }

    const { prompt, history, contextParam, sessionUuid } = (body || {}) as any;
    if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ code: 400, message: "提问内容 prompt 不能为空" }));
      }
      return;
    }

    // 1. 设置 SSE 与 Nginx 零缓冲响应头
    if (!res.headersSent) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // 强制指示 Nginx 禁用反向代理缓冲区！
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, token"
      });
      if (typeof (res as any).flushHeaders === "function") {
        (res as any).flushHeaders();
      }
    }

    // 2. 构造安全受控的 SSE 帧发射器 (Emitter)
    const sseEmitter = {
      sendEvent: (eventName: string, dataObj: Record<string, unknown>) => {
        if (res.writableEnded) return;
        const payload = `event: ${eventName}\ndata: ${JSON.stringify(dataObj)}\n\n`;
        res.write(payload);
      },
      close: () => {
        if (!res.writableEnded) {
          res.end();
        }
      }
    };

    // 3. 监听客户端异常断开 (如小程序切后台、用户主动点击中断)
    const abortController = new AbortController();
    req.on("close", () => {
      abortController.abort();
    });

    try {
      // 4. 调用下游业务服务流式处理
      await aiChatService.processCopilotChatStream({
        schoolId,
        userId,
        prompt: prompt.trim(),
        history: history || [],
        contextParam,
        sessionUuid,
        sseEmitter,
        abortSignal: abortController.signal
      });
    } catch (err: any) {
      if (!abortController.signal.aborted && !res.writableEnded) {
        sseEmitter.sendEvent("error", {
          code: "STREAM_EXECUTION_ERROR",
          message: err.message || "AI 智能计算服务发生异常"
        });
      }
    } finally {
      sseEmitter.close();
    }
  }
}

export const aiChatController = new AIChatController();
