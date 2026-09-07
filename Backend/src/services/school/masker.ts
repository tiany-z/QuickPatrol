/**
 * M12: 敏感凭据前后缀自适应安全动态脱敏引擎 (Dynamic Key Masker)
 * 
 * 遵照金融与工业安全规范：
 * 1. 长度 <= 6: 全隐藏 "******"
 * 2. 7 <= 长度 <= 12: 保留前 2 位与后 2 位，如 "sk****78"
 * 3. 长度 > 12: 保留前 4 位与后 4 位，如 "sk-p****3456"
 */

export function maskSensitiveValue(value: string): string {
  if (!value) return "";
  const len = value.length;

  if (len <= 6) {
    return "******";
  }

  if (len <= 12) {
    return `${value.slice(0, 2)}****${value.slice(-2)}`;
  }

  // 大于 12 字符的标准 Key (如 sk-proj-1234567890abcdef)
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
