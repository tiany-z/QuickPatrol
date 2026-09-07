/**
 * 高校后勤巡查e速办 v4.0 - M47 小程序专属 AI 流式问答工作台 (SSE Copilot UI)
 * 核心算法同构基座 (Isomorphic Algorithms Substrate)
 * 包含：
 *   算法 1: 二进制分块流 UTF-8 解码与残片截断自愈算法
 *   算法 2: 基于动态阻尼因子的打字机流式平滑插值算法
 *   算法 3: 视口触底锁定与反向滑动惯性探测算法
 *   算法 4: Thinking 耗时秒表与脉冲动效计算
 */

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
 * 算法 1: 拼接两个 Uint8Array 数组
 */
export function concatUint8Array(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

/**
 * 算法 1: 二进制分块流解码器与 SSE 帧解析器 (Isomorphic Stream Decoder)
 */
export class IsomorphicStreamDecoder {
  private remainderBytes: Uint8Array = new Uint8Array(0);
  private textBuffer: string = "";

  public decodeAndExtractFrames(
    arrayBuffer: ArrayBuffer
  ): Array<{ event: string; data: any }> {
    const incomingBytes = new Uint8Array(arrayBuffer);
    const mergedBytes = concatUint8Array(this.remainderBytes, incomingBytes);

    const validLength = getValidUTF8PrefixLength(mergedBytes);
    const processableBytes = mergedBytes.subarray(0, validLength);
    this.remainderBytes = mergedBytes.subarray(validLength);

    let chunkText = "";
    try {
      chunkText = new TextDecoder("utf-8").decode(processableBytes);
    } catch {
      return [];
    }

    this.textBuffer += chunkText;

    const normalized = this.textBuffer.replace(/\r\n/g, "\n");
    const parts = normalized.split("\n\n");
    this.textBuffer = parts.pop() || "";

    const frames: Array<{ event: string; data: any }> = [];

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      let eventName = "message";
      let dataStr = "";

      const lines = trimmed.split("\n");
      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.replace(/^event:\s*/, "").trim();
        } else if (line.startsWith("data:")) {
          dataStr = line.replace(/^data:\s*/, "").trim();
        }
      }

      if (dataStr) {
        try {
          const parsed = JSON.parse(dataStr);
          frames.push({ event: eventName, data: parsed });
        } catch {
          frames.push({ event: eventName, data: { rawText: dataStr } });
        }
      }
    }

    return frames;
  }

  public getRemainderBytes(): Uint8Array {
    return this.remainderBytes;
  }
}

/**
 * 算法 2: 基于动态阻尼因子的打字机流式平滑插值步长计算
 * S(t) = clamp(floor(Q(t) / 8) + 1, 1, 6)
 */
export function calculateTypewriterStep(queueLength: number): number {
  if (queueLength <= 0) return 0;
  return Math.min(Math.max(Math.floor(queueLength / 8) + 1, 1), 6);
}

/**
 * 算法 3: 视口触底锁定与反向滑动探测
 */
export function evaluateViewportLock(
  distanceToBottom: number,
  threshold: number = 40
): { isLocked: boolean; showBtn: boolean } {
  if (distanceToBottom > threshold) {
    return { isLocked: false, showBtn: true };
  }
  return { isLocked: true, showBtn: false };
}

/**
 * 算法 4: 思考耗时秒表高精度格式化
 */
export function formatElapsedSeconds(startTimeMs: number, nowMs: number = Date.now()): string {
  const diffSec = Math.max((nowMs - startTimeMs) / 1000, 0);
  return `${diffSec.toFixed(1)}s`;
}
