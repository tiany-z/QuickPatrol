import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { returnError, returnSuccess, StandardResult } from "../flow/result.js";

export function parseCliEnvFile(): string | null {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg.startsWith("--env_file=")) {
      return arg.split("=")[1].trim();
    }
  }
  return null;
}

export function loadEnvFile(envFileName: string): StandardResult<Record<string, string>> {
  try {
    const fullPath = path.isAbsolute(envFileName)
      ? envFileName
      : path.resolve(process.cwd(), envFileName);

    if (!fs.existsSync(fullPath)) {
      return returnError(`环境变量配置文件未找到: ${fullPath}`);
    }

    const envConfig = dotenv.parse(fs.readFileSync(fullPath));
    for (const k in envConfig) {
      process.env[k] = envConfig[k];
    }

    return returnSuccess(envConfig);
  } catch (error) {
    return returnError(`读取环境变量文件失败: ${String(error)}`);
  }
}

export function validateRequiredEnvs(requiredKeys: string[]): StandardResult<boolean> {
  const missing: string[] = [];
  for (const key of requiredKeys) {
    if (!process.env[key] || process.env[key]!.trim() === "") {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    return returnError(`缺少必要的环境变量配置: ${missing.join(", ")}`);
  }
  return returnSuccess(true);
}
