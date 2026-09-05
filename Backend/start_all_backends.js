import { spawn } from "child_process";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOTAL_NODES = 4;
const children = [];

const COLORS = [
  "\x1b[36m", // 青色
  "\x1b[33m", // 黄色
  "\x1b[32m", // 绿色
  "\x1b[35m", // 洋红
];
const RESET = "\x1b[0m";

console.log(`\x1b[1m\x1b[32m========================================================================`);
console.log(`🚀 后勤巡查e速办 v4.0 - 正在在一个终端中并行启动 ${TOTAL_NODES} 个 Backend 进程...`);
console.log(`========================================================================\x1b[0m\n`);

const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

for (let i = 1; i <= TOTAL_NODES; i++) {
  const envFile = `${i}.env`;
  const color = COLORS[(i - 1) % COLORS.length];
  const tag = `[Node-${String(i).padStart(2, "0")}]`;
  const prefix = `${color}${tag}${RESET}`;

  const child = spawn(npxCmd, ["tsx", "src/index.ts", `--env_file=${envFile}`], {
    cwd: __dirname,
    shell: true,
    env: process.env,
  });

  children.push(child);

  if (child.stdout) {
    const rlStdout = readline.createInterface({ input: child.stdout });
    rlStdout.on("line", (line) => {
      console.log(`${prefix} ${line}`);
    });
  }

  if (child.stderr) {
    const rlStderr = readline.createInterface({ input: child.stderr });
    rlStderr.on("line", (line) => {
      console.error(`${prefix} \x1b[31m[STDERR]\x1b[0m ${line}`);
    });
  }

  child.on("error", (err) => {
    console.error(`${prefix} \x1b[31m[Process Error]\x1b[0m ${err.message}`);
  });

  child.on("close", (code) => {
    console.log(`${prefix} 进程退出，退出码: ${code}`);
  });
}

function cleanup() {
  console.log("\n\x1b[1m\x1b[33m正在停止所有 Backend 子进程...\x1b[0m");
  for (const child of children) {
    if (child && !child.killed) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", child.pid, "/f", "/t"]);
      } else {
        child.kill("SIGINT");
      }
    }
  }
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
