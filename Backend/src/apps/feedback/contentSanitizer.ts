/**
 * 高校后勤巡查e速办 v4.0 - M29: 评语 DFA 敏感词与人身攻击脱敏过滤器
 */

export class ContentSanitizer {
  private static rootNode: Map<string, any> = new Map();
  private static initialized: boolean = false;

  private static defaultKeywords: string[] = [
    "傻逼", "弱智", "废物", "操你", "草泥马", "他妈的", "滚蛋", "狗日的", "死全家", "垃圾师傅"
  ];

  /**
   * 初始化敏感词字典树
   */
  public static init(keywords: string[] = this.defaultKeywords): void {
    this.rootNode.clear();
    for (const word of keywords) {
      let current = this.rootNode;
      for (const char of word) {
        if (!current.has(char)) {
          current.set(char, new Map());
        }
        current = current.get(char);
      }
      current.set("isEnd", true);
    }
    this.initialized = true;
  }

  /**
   * 脱敏过滤：将辱骂敏感词替换为等长星号 *
   */
  public static filterText(text: string): { cleanText: string; hasVulgar: boolean } {
    if (!this.initialized) {
      this.init();
    }

    if (!text || typeof text !== "string") {
      return { cleanText: "", hasVulgar: false };
    }

    let clean = "";
    let hasVulgar = false;
    let i = 0;

    while (i < text.length) {
      let matchLen = 0;
      let temp = this.rootNode;

      for (let j = i; j < text.length; j++) {
        const c = text[j];
        if (temp.has(c)) {
          temp = temp.get(c);
          if (temp.get("isEnd")) {
            matchLen = j - i + 1;
            break;
          }
        } else {
          break;
        }
      }

      if (matchLen > 0) {
        hasVulgar = true;
        clean += "*".repeat(matchLen);
        i += matchLen;
      } else {
        clean += text[i];
        i++;
      }
    }

    return { cleanText: clean, hasVulgar };
  }
}
