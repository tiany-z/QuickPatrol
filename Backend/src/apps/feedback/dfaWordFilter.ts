/**
 * 高校后勤巡查e速办 v4.0 - M31: 基于 Trie 字典树的高性能 DFA 内容安全引擎
 * (DFA Content Sanitizer & Filter Engine)
 */

interface ITrieNode {
  children: Map<string, ITrieNode>;
  isEnd: boolean;
  level: 1 | 2; // 1: 轻度不文明(自动替换***), 2: 严重违规暴恐(触发阻断)
}

export interface IDfaScanResult {
  /** 是否完全洁净 */
  isClean: boolean;
  /** 是否包含严重违规致命词汇 (直接阻断建言落盘) */
  hasFatalWords: boolean;
  /** 脱敏清洗后的合规文本 */
  sanitizedText: string;
  /** 命中的违规词汇列表 */
  hitWords: string[];
}

export class DfaWordFilter {
  private static instance: DfaWordFilter;
  private root: ITrieNode = { children: new Map(), isEnd: false, level: 1 };

  private constructor() {
    this.initDefaultLexicon();
  }

  public static getInstance(): DfaWordFilter {
    if (!this.instance) {
      this.instance = new DfaWordFilter();
    }
    return this.instance;
  }

  /**
   * 初始化高校校园生活场景核心违规词库
   */
  private initDefaultLexicon(): void {
    // 严重违规词汇 (level 2: 直接拒绝提交)
    const fatalKeywords = [
      "投毒", "下药", "炸弹", "纵火", "砍人", "杀人", "跳楼",
      "反动", "暴乱", "反党", "邪教", "强奸", "枪支", "买卖假发票"
    ];

    // 轻度不文明与辱骂词汇 (level 1: 自动替换为 ***)
    const mildKeywords = [
      "傻逼", "脑残", "滚蛋", "混账", "草泥马", "去死", "狗官", "垃圾后勤"
    ];

    for (const word of fatalKeywords) {
      this.addWord(word, 2);
    }
    for (const word of mildKeywords) {
      this.addWord(word, 1);
    }
  }

  /**
   * 动态添加词条至 Trie 字典树
   */
  public addWord(word: string, level: 1 | 2 = 1): void {
    const trimmed = word.trim().toLowerCase();
    if (!trimmed) return;

    let curr = this.root;
    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (!curr.children.has(char)) {
        curr.children.set(char, { children: new Map(), isEnd: false, level: 1 });
      }
      curr = curr.children.get(char)!;
    }
    curr.isEnd = true;
    curr.level = level;
  }

  /**
   * 执行毫秒级 DFA 扫描与脱敏
   * 
   * @param text 输入待检测文本
   */
  public scanAndSanitize(text: string): IDfaScanResult {
    if (!text || text.trim() === "") {
      return { isClean: true, hasFatalWords: false, sanitizedText: "", hitWords: [] };
    }

    const chars = Array.from(text);
    const hitWords: string[] = [];
    let hasFatal = false;
    const cleanChars = [...chars];

    let i = 0;
    while (i < chars.length) {
      let curr = this.root;
      let matchLen = 0;
      let matchedLevel: 1 | 2 = 1;

      for (let j = i; j < chars.length; j++) {
        const char = chars[j].toLowerCase();

        // 过滤空字符与常见干扰字符 (如空格、制表符、特殊标点)
        if ([" ", "\t", "\r", "\n", "*", "#", "@", "-", "_"].includes(char) && matchLen > 0) {
          continue;
        }

        if (!curr.children.has(char)) {
          break;
        }

        curr = curr.children.get(char)!;
        if (curr.isEnd) {
          matchLen = j - i + 1;
          matchedLevel = curr.level;
        }
      }

      if (matchLen > 0) {
        const matchedWord = text.substring(i, i + matchLen);
        hitWords.push(matchedWord);
        if (matchedLevel === 2) {
          hasFatal = true;
        }
        // 对命中间隔执行星号替换
        for (let k = i; k < i + matchLen; k++) {
          cleanChars[k] = "*";
        }
        i += matchLen;
      } else {
        i++;
      }
    }

    return {
      isClean: hitWords.length === 0,
      hasFatalWords: hasFatal,
      sanitizedText: cleanChars.join(""),
      hitWords
    };
  }
}
