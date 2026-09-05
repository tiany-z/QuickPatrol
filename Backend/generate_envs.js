import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOTAL_NODES = 4;
const BASE_HTTP_PORT = 8000;

console.log(`正在生成 ${TOTAL_NODES} 个 Backend 进程环境配置文件 (.env)...`);

for (let i = 1; i <= TOTAL_NODES; i++) {
  const nodeNum = String(i).padStart(2, "0");
  const envFileName = `${i}.env`;
  const envFilePath = path.join(__dirname, envFileName);
  const httpPort = BASE_HTTP_PORT + (i - 1);

  const content = `# 后勤巡查e速办 v4.0 - 实际运行环境变量 (节点 #${nodeNum})
NODE_ID=backend-node-${nodeNum}
HTTP_PORT=${httpPort}
LOG_LEVEL=INFO

# MySQL 8.x 数据库配置
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=root
MYSQL_DATABASE=xc
MYSQL_CONNECTION_LIMIT=20

# Redis 缓存与分布式锁配置
REDIS_HOST=192.168.1.8
REDIS_PORT=6379
REDIS_PASSWORD=root

# JWT 安全签名配置
JWT_SECRET=xcesb_super_secret_jwt_key_2026
JWT_EXPIRES_IN=7d

# 微信小程序官方配置
WX_APP_ID=wxc818fff9cc711a5e
WX_APP_SECRET=1366db5d7744f0cc8c969b4910e24a5d

# 阿里云 OSS 文件对象存储配置
ENABLE_OSS=true
OSS_REGION=oss-cn-beijing
OSS_ACCESS_KEY_ID=LTAI5tQLFXXYNaHYjvk78QE8
OSS_ACCESS_KEY_SECRET=I9eh0KKOfhLhnBxBvY7huLtz0nSeqF
OSS_BUCKET=ldhq-xcesb-wx-miniprogram
`;

  fs.writeFileSync(envFilePath, content, "utf-8");
  console.log(`[生成成功] ${envFileName} ➔ NODE_ID=backend-node-${nodeNum}, HTTP_PORT=${httpPort}`);
}

console.log(`\n已成功生成全部 ${TOTAL_NODES} 个 .env 配置文件 (1.env ~ ${TOTAL_NODES}.env)！`);
