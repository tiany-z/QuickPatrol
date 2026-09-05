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

export interface ApiEndpointModule {
  routePath: string;
  authRequired?: boolean;
  astConfig?: any;
  run?: ((params: any, ctx?: any) => Promise<StandardResult<any>>) | null;
  handler: (req: any, ctx: any) => Promise<StandardResult<any>>;
}

const registry: Map<string, ApiEndpointModule> = new Map();

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
        // 计算路由路径 (如 /api/system/ping)
        const relative = path.relative(targetDir, path.dirname(filePath)).replace(/\\/g, "/");
        const routePath = `/api/${relative}`;
        endpoint.routePath = routePath;

        // 预编译 SQL AST 并注入 run 函数
        if (endpoint.astConfig) {
          endpoint.run = compileAstRunFunction(endpoint.astConfig);
        }

        registry.set(routePath, endpoint);
        count++;
      }
    }

    TerminalLogger.info(`成功装载并预编译 ${count} 个 API 路由契约接口`, "ApiScanner");
    return returnSuccess(count);
  } catch (error) {
    return returnError(`扫描并预编译 API 路由失败: ${tryCatchErrorToString(error)}`);
  }
}

export function getApiRoute(routePath: string): ApiEndpointModule | null {
  if (!routePath) return null;
  // 规范化处理：剥除末尾冗余斜杠（如 /api/system/ping/ -> /api/system/ping）
  const cleanPath = routePath.length > 1 ? routePath.replace(/\/+$/, "") : routePath;

  if (registry.has(cleanPath)) {
    return registry.get(cleanPath)!;
  }
  // 支持通配路径匹配 (例如 /api/oss/file/*)
  for (const [registeredPath, endpoint] of registry.entries()) {
    if (registeredPath.endsWith("/*") || registeredPath.endsWith("/_wildcard")) {
      const prefix = registeredPath.replace(/\/\*$/, "").replace(/\/_wildcard$/, "");
      if (cleanPath.startsWith(prefix)) {
        return endpoint;
      }
    }
  }
  return null;
}

export function getAllRoutes(): string[] {
  return Array.from(registry.keys());
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
