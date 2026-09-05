export class TerminalLogger {
  private static COLORS = {
    DEBUG: "\x1b[35m",   // 洋红
    INFO: "\x1b[32m",    // 绿色
    WARN: "\x1b[33m",    // 黄色
    ERROR: "\x1b[31m",   // 红色
    ACCESS: "\x1b[36m",  // 青色
    GRAY: "\x1b[90m",    // 浅灰
    BOLD: "\x1b[1m",
    RESET: "\x1b[0m",
  };

  private static NODE_COLORS: Record<string, string> = {
    "backend-node-01": "\x1b[36m", // 青色
    "backend-node-02": "\x1b[33m", // 黄色
    "backend-node-03": "\x1b[32m", // 绿色
    "backend-node-04": "\x1b[35m", // 洋红
  };

  private static getNodeTag(): string {
    const nodeId = process.env.NODE_ID || "backend-node-01";
    const color = this.NODE_COLORS[nodeId] || "\x1b[34m";
    return `${color}[${nodeId}]${this.COLORS.RESET}`;
  }

  private static getTimeStr(): string {
    return new Date().toLocaleTimeString();
  }

  public static info(message: string, meta?: any, module: string = "Server") {
    console.log(
      `${this.COLORS.GRAY}[${this.getTimeStr()}]${this.COLORS.RESET} ${this.getNodeTag()} ${this.COLORS.INFO}[INFO]${this.COLORS.RESET} [${module}] ${message}`,
      meta !== undefined ? meta : ""
    );
  }

  public static debug(message: string, meta?: any, module: string = "Debug") {
    if (process.env.LOG_LEVEL !== "DEBUG") return;
    console.log(
      `${this.COLORS.GRAY}[${this.getTimeStr()}]${this.COLORS.RESET} ${this.getNodeTag()} ${this.COLORS.DEBUG}[DEBUG]${this.COLORS.RESET} [${module}] ${message}`,
      meta !== undefined ? meta : ""
    );
  }

  public static warn(message: string, meta?: any, module: string = "Warn") {
    console.warn(
      `${this.COLORS.GRAY}[${this.getTimeStr()}]${this.COLORS.RESET} ${this.getNodeTag()} ${this.COLORS.WARN}[WARN]${this.COLORS.RESET} [${module}] ${message}`,
      meta !== undefined ? meta : ""
    );
  }

  public static error(message: string, meta?: any, module: string = "Error") {
    console.error(
      `${this.COLORS.GRAY}[${this.getTimeStr()}]${this.COLORS.RESET} ${this.getNodeTag()} ${this.COLORS.ERROR}[ERROR]${this.COLORS.RESET} [${module}] ${message}`,
      meta !== undefined ? meta : ""
    );
  }

  public static access(
    method: string,
    pathname: string,
    statusCode: number,
    ip: string,
    durationMs: number,
    userId?: string | number | null
  ) {
    const durationColor =
      durationMs > 1000 ? this.COLORS.ERROR : durationMs > 500 ? this.COLORS.WARN : this.COLORS.GRAY;

    const statusColor = statusCode >= 400 ? this.COLORS.ERROR : this.COLORS.INFO;

    console.log(
      `${this.COLORS.GRAY}[${this.getTimeStr()}]${this.COLORS.RESET} ${this.getNodeTag()} ${this.COLORS.ACCESS}[ACCESS]${this.COLORS.RESET} ${method} ${pathname} | ${statusColor}${statusCode}${this.COLORS.RESET} | ${durationColor}${durationMs}ms${this.COLORS.RESET} | IP: ${ip} | User: ${userId || "guest"}`
    );
  }

  public static logAccess = TerminalLogger.access;

  public static printBanner(appName: string, portOrDetails: number | string, mysqlTarget?: string, redisTarget?: string) {
    if (typeof portOrDetails === "number") {
      printStartupSuccess(appName, [
        `端口服务: http://0.0.0.0:${portOrDetails}/`,
        `MySQL:     ${mysqlTarget || "configured"}`,
        `Redis:     ${redisTarget || "configured"}`,
      ]);
    } else {
      printStartupSuccess(appName, [portOrDetails]);
    }
  }

  public static printError(appName: string, error: string) {
    printStartupError(appName, error);
  }
}

export function printStartupSuccess(appName: string, details: string[]) {
  const nodeId = process.env.NODE_ID || "backend-node-01";
  console.log(`\n\x1b[1m\x1b[32m========================================================================\x1b[0m`);
  console.log(`\x1b[1m\x1b[32m✔ [${appName}] 服务启动成功！(${nodeId})\x1b[0m`);
  console.log(`\x1b[1m\x1b[32m========================================================================\x1b[0m`);
  for (const line of details) {
    console.log(`  ➔ ${line}`);
  }
  console.log(`\x1b[1m\x1b[32m========================================================================\x1b[0m\n`);
}

export function printStartupError(appName: string, error: string) {
  const nodeId = process.env.NODE_ID || "backend-node-01";
  console.error(`\n\x1b[1m\x1b[31m========================================================================\x1b[0m`);
  console.error(`\x1b[1m\x1b[31m✖ [${appName}] (${nodeId}) 启动异常失败:\x1b[0m`);
  console.error(`  ${error}`);
  console.error(`\x1b[1m\x1b[31m========================================================================\x1b[0m\n`);
}
