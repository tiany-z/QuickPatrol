# QuickPatrol 高校后勤巡查e速办

> **高并发 · 智能调度 · 契约驱动架构 · 前后端一体化运维解决方案**

`v4.0` | 核心理念：**单句自动提交 · 补偿回滚 · 零事务锁等待**

---

## 🎯 项目定位

**QuickPatrol（高校后勤巡查e速办）** 是一套面向高校后勤场景的全栈 Web 服务解决方案，覆盖 **微信小程序端（WeChatMiniProgram）**、**四节点横向扩容后端微服务群（Backend）**、**MySQL + Redis 双重持久化中间件** 以及 **极客级自动化运维工具箱（Tools）**。

v4.0 核心突破在于：

- **Http 自研调度引擎**：无需引入 Express 框架，直接基于 Node.js `http` 模块构建统一分发体系。
- **API 契约即代码**：通过目录结构自动扫描并预编译全部 API 路由，实现 0 路由注册的声明式开发。
- **SQL AST 动态查询引擎**：将 SQL 拆解为 `AST 配置对象`，运行时编译执行、自动参数化，杜绝拼接注入风险。
- **补偿式回滚引擎**：以请求维度的 `withdrawStack` 逆序执行 Undo 闭包，实现无 DB 全局事务的原子性保障。
- **四进程 WebSocket 横向集群**：基于 Redis Pub/Sub 实现跨进程用户定向推送与全局广播。

---

## 🏗️ 系统架构全景

```mermaid
graph TB
    subgraph 微信小程序端
        MP[WeChatMiniProgram<br/>TypeScript + 原生小程序]
        MP -->|HTTPS / JSON| GW
    end

    subgraph 后端服务群 "Backend 集群 × 4 Nodes"
        GW[Master Dispatcher<br/>统一请求分发器]
        GW --> SC[ApiScanner<br/>契约扫描器]
        SC --> ENC[API Endpoint 模块<br/>AST 解析 + Handler]
        
        subgraph shared 核心引擎
            AST[SQL AST Runner<br/>动态参数化查询]
            FLOW[Flow Result<br/>标准返回协议]
            CRYPTO[JWT / Bcrypt / UUID]
            LOCK[Row Lock Manager<br/>分布式行锁]
        end
        
        ENC -->|预编译 run 函数| AST
        ENC -->|撤销闭包| FLOW
        ENC -->|鉴权| CRYPTO
        ENC -->|锁管理| LOCK
    end

    subgraph 基础设施
        MYSQL[(MySQL 8.x<br/>连接池 + 协议日志)]
        REDIS[(Redis<br/>连接池 / 分布式锁 / 在线状态)]
        OSS[(阿里云 OSS<br/>文件对象存储)]
        WSGW[WebSocket 网关<br/>Redis 跨进程序通道]
    end

    GW -->|DML 查询| MYSQL
    GW -->|缓存 / 锁 / 心跳| REDIS
    ENC -->|签名| OSS
    WSGW --> REDIS
    
    subgraph Tools 工具链
        TOOLS[运维总控制台<br/>19 个自动化脚本]
        TESTS[Vitest 单元测试套件]
    end
    
    TOOLS --> BackendDir
    TESTS --> BackendDir
```

### 核心依赖选型

| 层级 | 组件 | 技术选型 | 说明 |
| :--- | :--- | :--- | :--- |
| 小程序端 | WeChat Mini Program | `原生 + TypeScript` | 一套代码双身份登录、双工单闭环 |
| 后端运行时 | Node.js + TypeScript 5.5 | `tsx` 即时编译启动 | 免构建直接运行 TS 源码 |
| 进程调度 | 自研 HTTP Master Dispatcher | `node:http` 原生模块 | 轻量高频、秒级启动 |
| 路由契约 | ApiScanner + AST 预编译 | `src/api` 目录描述 | 0 路由注册、运行前静态解析 |
| 数据库 | MySQL 8.x (`mysql2`) | 连接池 + 手工 SQL | 默认 `utf8mb4`, `dateStrings` |
| 缓存/分布式 | Redis (`ioredis`) | Pub/Sub + Set + 字符串 | 集群广播、活跃节点心跳 |
| WS 实时通讯 | `ws` v8 | 轻量级 WS 服务 | 同一 HTTP 端口升级复用 |
| 文件对象存储 | 阿里云 OSS (`ali-oss`) | 签名直传 | 支持小程序端直传白名单 |

---

## 📂 仓库目录规范

```
QuickPatrol/
├── Backend/                 # 四节点高并发后端微服务集群
│   ├── src/
│   │   ├── index.ts             # 启动引导主流程
│   │   ├── api/                 # 契约式路由目录（自动映射为 /api/*）
│   │   │   └── system/
│   │   │       ├── health/      # GET /health
│   │   │       └── ping/        # GET /ping
│   │   ├── dispatcher/          # HTTP 路由调度核心
│   │   │   ├── apiScanner.ts        # 目录路由自动扫描器
│   │   │   └── masterDispatcher.ts  # 主分发器 (含 Undo 补偿)
│   │   ├── heartbeat/           # Redis 活跃节点心跳上报
│   │   ├── ws/                  # WebSocket 网关（跨进程集群广播）
│   │   ├── shared/
│   │   │   ├── cache/           # Redis 客户端封装
│   │   │   ├── config/          # 环境变量加载与校验
│   │   │   ├── db/              # MySQL 连接池
│   │   │   ├── flow/            # 标准 Result 协议封装
│   │   │   ├── lock/            # 分布式行锁管理器
│   │   │   ├── sql/             # SQL AST Runner + 4 大 Builder
│   │   │   └── crypto/          # JWT / Bcrypt / UUID
│   │   └── utils/               # HTTP Helper
│   ├── 1.env...4.env            # 4 节点环境变量 (NODE_ID 区分)
│   ├── package.json
│   └── start_all_backends.js    # 一键并行启动 4 个后端进程
├── WeChatMiniProgram/       # 微信小程序 TypeScript 工程
│   ├── miniprogram/             # 小程序页面 + 自定义组件
│   ├── typings/                 # 类型声明
│   └── project.config.json
├── Tools/                   # 自动化运维工具箱（19 个工具脚本）
│   ├── TOOL_MENU.js             # 总控制台入口
│   ├── TOOL_RUN_ALL_TESTS.js    # 一键执行全量 Vitest
│   ├── TOOL_AUTO_COMMIT_WITH_AI.js
│   ├── TOOL_DEPLOY_BACKENDS.js
│   ├── ...
├── Docs/                    # 设计文档中心
│   ├── Backend/                 # 后端架构设计
│   ├── WeChat/                  # 小程序设计
│   ├── 数据库/                   # 数据库设计
│   └── 高校后勤巡查e速办v4.0全景系统重构与设计方案.md
├── tools_linux_macos.sh     # 工具箱快捷启动脚本 (Linux / macOS)
├── tools_windows.bat        # 工具箱快捷启动脚本 (Windows)
└── chat_sys_config.json     # 项目 AI 对话策略配置
```

---

## ⚡ 四大顶级核心技术揭秘

### 1. 微信小程序双身份工单闭环

小程序端采用 TypeScript 强类型工程结构，通过 `openId` 实现“教师 / 后勤监管”双身份自由切换。巡逻员在小程序提交巡查工单后，即可通过相同 `openId` 建立 **WebSocket 长连接**，由后端 `wsGateway` 负责实时下发工单审核结果、挂单提醒和超时预警；管理者与维修人员也均可即时收到整条线的工单广播，形成高时效的闭环通路。

### 2. 自研路由调度引擎（零 Express 依赖）

`masterDispatcher.ts` 是所有 HTTP 到达后的统一入口，使用 `URL` 解析对象识别请求路径，**兼容微信小程序对 404/500 一律返回 HTTP 200 + `{ status: 0 }` 的契约**。所有中间件逻辑统一以命令式代码执行：

```
请求进入 
   └> CORs 预检处理
   └> 路由查找 (ApiScanner getApiRoute)
   └> 缺少 Token -> 200+status:0
   └> JWT 解码失败 -> 200+status:0
   └> 解析 JSON Body
   └> 构建 RequestContext (requestId / withdrawStack / lockedRows)
   └> 执行 Endpoint.handler
        ├── Status 1 → releaseMemoryLocks(true) → 直接返回
        └── Status 0 → handleDispatchFailure
                ├── 逆序执行 withdrawStack 全部 Undo
                └── releaseMemoryLocks(false)
```

### 3. MySQL 8.x 原生异步连接池统一收敛

`shared/db/mysql.ts` 基于 `mysql2/promise.Pool` 构建：

- 默认 **连接池上限 20**，支持 `MYSQL_CONNECTION_LIMIT` 动态覆盖
- 启用 `waitForConnections` + `queueLimit: 0`，确保极端峰值请求不直接 503
- **极简四层封装**：改写了 `executeQuery()` 返回 `{status: 1, data}` 业务语义，同时保留 `insertId` 字段，方便 DML 后即时自增 ID 回读。

### 4. 单句自动提交 · 补偿回滚引擎（LLM 友好的事务替换方案）

系统在 `dispatcher` 与 `shared/flow/result.ts` 中内置一套**非阻塞版事务**机制，替代容易引起死锁与连接池耗尽的 `BEGIN/COMMIT` 长事务。

当 API 在执行多个 SQL 写入步骤时，每个 `run()` 都会向 `ctx.withdrawStack` 压入一条 `async () => {}` 的 Undo 闭包；任何一步执行失败后，Master Dispatcher 会 **捕获并逆序 (LIFO) 执行** 这些闭包，自动完成“已插入记录删除、已更新状态还原、Redis 已发布缓存回退”。

这种设计同时解决了传统分布式事务中“挂起连接过多”“部分节点投票阻塞”等痛点，配合 行级 RowLock 预占，可以保证低碰撞场景的安全性。

### 5. AST 动态查询预编译引擎（核心亮点）

`apiScanner.ts` 中会读取各 API 模块导出的 `astConfig` 对象，调用 `compileAstRunFunction(endpoint.astConfig)` 基于 SQL AST 动态生成 `run(params, ctx)` 闭包函数。

SQL 层拆分成 4 大 Builder：

```
shared/sql/builders/
├── insertBuilder.ts        # INSERT INTO 表 (字段) VALUES(?)
├── selectBuilder.ts        # WHERE 动态拼接 + 防注入 + LIMIT
├── updateBuilder.ts        # SET ? 双阶段绑定
└── deleteBuilder.ts        # 软删除隔离 (deleted_at 非空)
```

AST Runner 在编译期就把所有 SQL 的**占位符与用户在配置中声明的参数 key 绑定**，预编译成纯 JavaScript 闭包，请求进入后无需再做任何字符串拼接，在性能与安全性上可兼得。

### 6. WebSocket 实时告警广播（四节点集群感知）

```typescript
// 典型用法
sendWsMessage(openId, "order:timeout", { orderId: 1001 });
broadcastWsMessage("system:maintenance", { message: "02:00 数据库优化" });
```

- 单节点内：**Map<openId, Set<WebSocket>>** 维护长连接会话
- 跨节点路由：所有消息同时发布进 Redis Channel `ws:cluster:message` / `ws:cluster:broadcast`
- 订阅进程会校验 `sourceNode`，自动丢弃源头节点消息，杜绝环形风暴
- 握手协议以 `{key: "openId", value: "用户标识"}` 作为注册包，快速可靠

---

## 🚀 快速启动指南

### 环境准备

| 依赖组件 | 版本要求 | 说明 |
| :--- | :--- | :--- |
| Node.js | ≥ 20.x | 建议使用 LTS 版本 |
| MySQL | 8.x | `utf8mb4` 字符集、远程可连接 |
| Redis | ≥ 5.x | 需开启 Pub/Sub 功能 |
| 微信开发者工具 | 最新稳定版 | 用于编译预览小程序 |

### 1. 启动 4 节点后端集群

```bash
cd Backend

# ① 安装全部依赖
npm install

# ② 一键并行启动 4 个后端节点（读取 1.env / 2.env / 3.env / 4.env）
npm run start:all

# 若习惯手动启动单节点:
npx tsx src/index.ts --env_file=1.env       # Node-01
npx tsx src/index.ts --env_file=2.env       # Node-02
npx tsx src/index.ts --env_file=3.env       # Node-03
npx tsx src/index.ts --env_file=4.env       # Node-04
```

> 单节点启动时，若需要查看四色融合终端效果，推荐直接运行 `npm run start:all`。

### 2. 微信开发者工具启动

1. 打开微信开发者工具导入目录：`WeChatMiniProgram/`
2. 配置测试 AppID 或使用 `project.config.json` 中内置的项目 AppID
3. 点击编译即可；如果后端地址有调整，仅需同步修改环境配置

### 3. 运行全量自动化测试

```bash
cd Backend
npm test

# 输出四个核心测试分组：
#  √ flowAndCrypto.test.ts
#  √ dispatcherAndRouter.test.ts
#  √ sqlAstAndBuilders.test.ts
#  √ clusterAndWs.test.ts
```

---

## 🔌 服务端口与环境变量对照表

### 后端服务集群（`Backend/`）

| 环境文件 | NODE_ID 节点标识 | HTTP 端口 | 默认描述 |
| :--- | :--- | :--- | :--- |
| `1.env` | `backend-node-01` | **8000** | 首节点主服务 |
| `2.env` | `backend-node-02` | **8001** | 横向扩展节点 |
| `3.env` | `backend-node-03` | **8002** | 横向扩展节点 |
| `4.env` | `backend-node-04` | **8003** | 横向扩展节点 |

### 核心环境变量配置释义

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `NODE_ID` | `backend-node-01` | Redis 心跳去重、WS 广播源节点识别 |
| `HTTP_PORT` | 8000 | 当前节点 HTTP + WebSocket 共用端口 |
| `MYSQL_HOST` | - | 数据库服务器 IP |
| `MYSQL_PORT` | 3306 | MySQL 端口 |
| `MYSQL_DATABASE` | `xc` | 数据库名 |
| `MYSQL_CONNECTION_LIMIT` | 20 | mysql2 Pool 连接上限 |
| `REDIS_HOST` | - | Redis 服务器地址 |
| `REDIS_PORT` | 6379 | Redis 端口 |
| `JWT_SECRET` | - | 七天内测签名密钥 |
| `JWT_EXPIRES_IN` | 7d | 小程序用户登录态失效时长 |
| `WX_APP_ID` | - | 微信小程序开放平台凭据 |
| `OSS_REGION` | `oss-cn-beijing` | 阿里云 OSS 地域 |
| `LOG_LEVEL` | INFO | 控制台输出日志阈值 |

---

## 🛠️ 运维与测试工具箱（Tools）

`Tools/` 目录提供 19 个开箱即用自动化运维脚本。运行根目录快捷脚本即可进入 AI 控制台：

```bash
# Linux / macOS:
./tools_linux_macos.sh

# Windows:
tools_windows.bat
```

### 常用工具箱清单

| 脚本 | 说明 |
| :--- | :--- |
| `TOOL_MENU.js` | 运维总控菜单一体化入口 |
| `TOOL_RUN_ALL_TESTS.js` | 自动定位 Backend 目录并一键全量 Vitest 单测 |
| `TOOL_API_CONFIG.js` | 管理 API 配置清单 |
| `TOOL_AUTO_COMMIT_WITH_AI.js` | AI 辅助语义化 Commit |
| `TOOL_FIX_GIT_HISTORY.js` | 修复提交历史中的异常记录 |
| `TOOL_COUNT_CODE_LINES.js` | 仓库代码行数统计 |
| `TOOL_UPDATE_README_WITH_AI.js` | 本项目 README 的 AI 增强入口 |
| `TOOL_GENERATE_WORK_REPORT.js` | 生成工作周报/日报 |
| `TOOL_INITIALIZE_PROJECT.js` | 新环境初始化脚手架 |
| `TOOL_REINSTALL_DEPENDENCIES.js` | 批量强制重装 node_modules |

### 测试覆盖范围

| 测试文件 | 覆盖子模块 |
| :--- | :--- |
| `flowAndCrypto.test.ts` | 标准 result 流封装、JWT 签发与校验、密码哈希 |
| `dispatcherAndRouter.test.ts` | 主分发器、路由扫描、参数解析、Undo 补偿触发逻辑 |
| `sqlAstAndBuilders.test.ts` | 4 大 SQL Builder、AST 参数化与校验规则 |
| `clusterAndWs.test.ts` | Redis 心跳、集群 WebSocket 编解码、离线队列 |

> 每个测试分组均跟随集群、WS、事务补偿与 SQL AST 等核心逻辑的**正向路由 + 回滚路径全链路模拟**，保证系统重构与二次开发时的绝对安全。

---

## 📘 文档架构索引

完整系统设计蓝图与历史设计方案聚合于 `Docs/`：

```
Docs/
├── 高校后勤巡查e速办v4.0全景系统重构与设计方案.md   # 系统性全景重生架构蓝图
├── Backend/                                          # 后端模块细分设计
│   └── ...dispatcher... / ...sql-ast... / ...ws-gateway...
├── WeChat/                                           # 小程序角色闭环与交互设计
└── 数据库/                                            # 工单表、审核表、资源表 DDL 说明
```

同时，仓库根目录的 `chat_sys_config.json` 中预置了与 AI 对话协同维护本项目的角色约定与上下文策略，方便开发者与 AI 结对编程。

---

## 📄 License

本项目基于开源许可证发布，详见仓库根目录 `LICENSE` 文件。项目中涉及数据源账号、微信 Secret 与阿里云 OSS 密钥仅限内网本地开发调试使用，发布时请务必移除并设置环境变量注入。

---

> **QuickPatrol v4.0** —— 以高校后勤为起点，以全栈工程化为杠杆，让巡逻线上每一条工单都有迹可循、毫秒直达。