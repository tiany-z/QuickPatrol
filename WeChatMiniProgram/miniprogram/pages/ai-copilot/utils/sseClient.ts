/**
 * 高校后勤巡查e速办 v4.0 - M47 小程序专属 AI 流式问答工作台
 * 文件路径: miniprogram/pages/ai-copilot/utils/sseClient.ts
 * 核心职责: 基于 wx.request({ enableChunked: true }) 重塑小程序移动端专属的
 *           EventSource SSE 规范总线，支持 ArrayBuffer 跨包 UTF-8 截断自愈。
 */

import { API_BASE } from "../../../config/env.js";

export type SSEEventListener = (data: any) => void;

/**
 * 算法 1: 计算合法的 UTF-8 前缀长度，探测末尾截断残片
 */
export function getValidUTF8PrefixLength(bytes: Uint8Array): number {
  const len = bytes.length;
  if (len === 0) return 0;

  for (let i = 1; i <= Math.min(len, 4); i++) {
    const byte = bytes[len - i];
    // 单字节 ASCII (0xxxxxxx)
    if ((byte & 0x80) === 0) {
      return len;
    }
    // 多字节起始字节 (11xxxxxx)
    if ((byte & 0xc0) === 0xc0) {
      let needed = 1;
      if ((byte & 0xe0) === 0xc0) needed = 2;
      else if ((byte & 0xf0) === 0xe0) needed = 3;
      else if ((byte & 0xf8) === 0xf0) needed = 4;

      const present = i;
      if (present < needed) {
        return len - present;
      }
      return len;
    }
  }
  return len;
}

/**
 * 拼接两个 Uint8Array 数组
 */
export function concatUint8Array(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

export class MiniProgramSSEClient {
  private requestTask: WechatMiniprogram.RequestTask | null = null;
  private listeners: Map<string, SSEEventListener[]> = new Map();
  private textBuffer: string = '';
  private remainderBytes: Uint8Array = new Uint8Array(0);

  /**
   * 注册事件监听
   */
  public on(event: string, listener: SSEEventListener): void {
    const arr = this.listeners.get(event) || [];
    arr.push(listener);
    this.listeners.set(event, arr);
  }

  /**
   * 派发事件
   */
  public emit(event: string, data: any): void {
    const arr = this.listeners.get(event) || [];
    for (const fn of arr) {
      fn(data);
    }
  }

  /**
   * 开启 SSE 长连接通道
   */
  public connect(url: string, payload: any, token: string): void {
    this.textBuffer = '';
    this.remainderBytes = new Uint8Array(0);

    const fullUrl = url.startsWith('http://') || url.startsWith('https://')
      ? url
      : `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;

    this.requestTask = wx.request({
      url: fullUrl,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        token: token,
        Authorization: `Bearer ${token}`
      },
      data: payload,
      enableChunked: true, // 开启小程序分块通信
      success: (res: any) => {
        if (res.statusCode !== 200) {
          this.emit('error', { message: `连接失败，HTTP 状态码: ${res.statusCode}` });
        }
      },
      fail: (err: any) => {
        if (err.errMsg?.includes('abort')) {
          this.emit('aborted', {});
        } else {
          this.emit('error', { message: `网络长连接建立失败: ${err.errMsg}` });
        }
      }
    } as any);

    // 核心：监听二进制数据包逐帧到达
    if (this.requestTask && typeof (this.requestTask as any).onChunkReceived === 'function') {
      (this.requestTask as any).onChunkReceived((res: { data: ArrayBuffer }) => {
        this.decodeAndParse(res.data);
      });
    }
  }

  /**
   * 跨分包 UTF-8 解码与 SSE 帧解析 (算法 1 实现)
   */
  public decodeAndParse(arrayBuffer: ArrayBuffer): void {
    const incomingBytes = new Uint8Array(arrayBuffer);
    const mergedBytes = concatUint8Array(this.remainderBytes, incomingBytes);

    const validLength = getValidUTF8PrefixLength(mergedBytes);
    const processableBytes = mergedBytes.subarray(0, validLength);
    this.remainderBytes = mergedBytes.subarray(validLength);

    let chunkText = '';
    try {
      const g = typeof globalThis !== 'undefined' ? (globalThis as any) : {};
      if (typeof g.TextDecoder !== 'undefined') {
        chunkText = new g.TextDecoder('utf-8').decode(processableBytes);
      } else {
        // 兼容降级
        chunkText = decodeURIComponent(escape(String.fromCharCode(...processableBytes)));
      }
    } catch {
      return;
    }

    this.textBuffer += chunkText;

    // 按照双换行分割出完整的 SSE 数据块
    const normalized = this.textBuffer.replace(/\r\n/g, '\n');
    const parts = normalized.split('\n\n');
    this.textBuffer = parts.pop() || '';

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      let eventName = 'message';
      let dataStr = '';

      const lines = trimmed.split('\n');
      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventName = line.replace(/^event:\s*/, '').trim();
        } else if (line.startsWith('data:')) {
          dataStr = line.replace(/^data:\s*/, '').trim();
        }
      }

      if (dataStr) {
        try {
          const parsedJson = JSON.parse(dataStr);
          this.emit(eventName, parsedJson);
        } catch {
          this.emit(eventName, { rawText: dataStr });
        }
      }
    }
  }

  /**
   * 主动中止连接 (Abort)
   */
  public abort(): void {
    if (this.requestTask) {
      this.requestTask.abort();
      this.requestTask = null;
    }
  }
}
