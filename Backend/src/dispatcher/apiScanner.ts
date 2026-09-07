import fs from "fs";
import path from "path";
import {
  compileAstRunFunction,
  TerminalLogger,
  returnError,
  returnSuccess,
  StandardResult,
  tryCatchErrorToString,
} from "../shared/index.js";
import { ApiEndpointModule } from "./gatewayTypes.js";
import { normalizeUrlPath } from "../utils/httpHelper.js";

export { ApiEndpointModule } from "./gatewayTypes.js";

const routeRegistry: Map<string, ApiEndpointModule> = new Map();

/**
 * 遍历扫描物理 API 目录树，自动契约装配并预编译 SQL AST (算法 2)
 * 物理目录结构即逻辑 API 路径：src/api/system/ping/index.ts -> /api/system/ping
 */
export async function scanAndPrecompileApiRoutes(apiDir?: string): Promise<StandardResult<number>> {
  try {
    const targetDir = apiDir || path.resolve(process.cwd(), "src", "api");
    if (!fs.existsSync(targetDir)) {
      return returnSuccess(0);
    }

    const files = getIndexFiles(targetDir);
    let count = 0;

    for (const filePath of files) {
      const fileUrl = `file:///${filePath.replace(/\\/g, "/")}`;
      const mod = await import(fileUrl);
      const endpoint: ApiEndpointModule = mod.api || mod.default;

      if (endpoint && typeof endpoint.handler === "function") {
        // 计算标准相对路径 (如 /api/system/ping)
        const relative = path.relative(targetDir, path.dirname(filePath)).replace(/\\/g, "/");
        const routePath = normalizeUrlPath(`/api/${relative}`);
        const customRoute = endpoint.routePath ? normalizeUrlPath(endpoint.routePath) : null;
        endpoint.routePath = routePath;

        // 启动期预编译 SQL AST 并注入 run 函数，消除运行时高并发编译开销
        if (endpoint.astConfig && !endpoint.run) {
          endpoint.run = compileAstRunFunction(endpoint.astConfig);
        }

        routeRegistry.set(routePath, endpoint);
        if (customRoute && customRoute !== routePath) {
          routeRegistry.set(customRoute, endpoint);
        }
        count++;
      }
    }

    TerminalLogger.info(`[M04] 成功装载并预编译 ${count} 个微应用 API 路由端点`, "ApiScanner");
    return returnSuccess(count);
  } catch (error) {
    return returnError(`扫描并预编译 API 路由失败: ${tryCatchErrorToString(error)}`);
  }
}

/**
 * 检索 API 路由契约对象 (支持精确匹配与前缀通配)
 */
export function getApiRoute(rawPath: string): ApiEndpointModule | null {
  if (!rawPath) return null;
  const cleanPath = normalizeUrlPath(rawPath);

  // 1. O(1) 常数级哈希查找
  if (routeRegistry.has(cleanPath)) {
    return routeRegistry.get(cleanPath)!;
  }

  // 2. 通配前缀扫描 (支持 /api/oss/file/* 与 /_wildcard)
  for (const [registeredPath, endpoint] of routeRegistry.entries()) {
    if (registeredPath.endsWith("/*") || registeredPath.endsWith("/_wildcard")) {
      const prefix = registeredPath.replace(/\/\*$/, "").replace(/\/_wildcard$/, "");
      if (cleanPath.startsWith(prefix)) {
        return endpoint;
      }
    }
  }

  return null;
}

/**
 * 动态注册路由端点 (支持测试桩点与微前端热插拔)
 */
export function registerRoute(routePath: string, endpoint: ApiEndpointModule): void {
  const cleanPath = normalizeUrlPath(routePath);
  endpoint.routePath = cleanPath;
  if (endpoint.astConfig && !endpoint.run) {
    endpoint.run = compileAstRunFunction(endpoint.astConfig);
  }
  routeRegistry.set(cleanPath, endpoint);
}

/**
 * 获取当前全局注册表中已登记的全部 API 路径
 */
export function getAllRoutes(): string[] {
  return Array.from(routeRegistry.keys());
}

/**
 * 清空路由注册表
 */
export function clearRoutes(): void {
  routeRegistry.clear();
}

function getIndexFiles(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getIndexFiles(fullPath));
    } else if (file === "index.ts" || file === "index.js") {
      results.push(fullPath);
    }
  }
  return results;
}
