/**
 * M20: 紧凑 Base62 编解码工具箱
 * (Compact Base62 Encoder & Decoder)
 * 
 * 核心目标：
 * 将自增 ID 压缩为定长短字符串，确保在嵌入微信小程序码 32 字符 Scene 时留有充足的冗余空间
 * 字母表: 0-9, a-z, A-Z (共 62 个字符)
 */

const BASE62_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const BASE = BASE62_ALPHABET.length;

export class Base62Utils {
  /**
   * 将正整数编码为 Base62 字符串
   */
  public static encode(num: number): string {
    if (!Number.isInteger(num) || num < 0) {
      throw new Error(`Base62 编码仅支持非负整数: ${num}`);
    }
    if (num === 0) return BASE62_ALPHABET[0];

    let result = "";
    let current = num;

    while (current > 0) {
      const remainder = current % BASE;
      result = BASE62_ALPHABET[remainder] + result;
      current = Math.floor(current / BASE);
    }

    return result;
  }

  /**
   * 将 Base62 字符串解码为正整数
   */
  public static decode(str: string): number {
    if (!str || typeof str !== "string") {
      throw new Error(`无效的 Base62 字符串输入: ${str}`);
    }

    let result = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const index = BASE62_ALPHABET.indexOf(char);
      if (index === -1) {
        throw new Error(`Base62 包含非法字符: ${char} (输入: ${str})`);
      }
      result = result * BASE + index;
    }

    return result;
  }
}
