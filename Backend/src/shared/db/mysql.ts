import mysql from "mysql2/promise";
import type { Pool, PoolOptions, PoolConnection } from "mysql2/promise";
import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../flow/result.js";

let pool: Pool | null = null;

export function initMySQLPool(config?: PoolOptions): StandardResult<Pool> {
  try {
    if (pool) {
      return returnSuccess(pool);
    }

    const host = process.env.MYSQL_HOST || "127.0.0.1";
    const port = parseInt(process.env.MYSQL_PORT || "3306", 10);
    const user = process.env.MYSQL_USER || "root";
    const password = process.env.MYSQL_PASSWORD || "root";
    const database = process.env.MYSQL_DATABASE || "xc";
    const connectionLimit = parseInt(process.env.MYSQL_CONNECTION_LIMIT || "20", 10);

    pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit,
      queueLimit: 0,
      charset: "utf8mb4",
      dateStrings: true,
      ...config,
    });

    return returnSuccess(pool);
  } catch (error) {
    return returnError(`Init MySQL Pool failed: ${tryCatchErrorToString(error)}`);
  }
}

export function getMySQLPool(): Pool | null {
  return pool;
}

export async function executeQuery<T = any>(
  sql: string,
  params: any[] = [],
  conn?: PoolConnection
): Promise<StandardResult<T[]>> {
  try {
    if (!pool && !conn) {
      return returnError("数据库连接池未初始化");
    }

    let rows: any;
    if (conn) {
      [rows] = await conn.query(sql, params);
    } else {
      [rows] = await pool!.query(sql, params);
    }

    if (Array.isArray(rows)) {
      return returnSuccess(rows as T[]);
    } else {
      const header = rows as any;
      const resultObj = {
        ...header,
        id: header?.insertId ? header.insertId : undefined,
      };
      return returnSuccess([resultObj as unknown as T]);
    }
  } catch (error) {
    return returnError(`Execute SQL Query failed: ${tryCatchErrorToString(error)} | SQL: ${sql}`);
  }
}

export async function closeMySQLPool(): Promise<StandardResult<boolean>> {
  try {
    if (pool) {
      await pool.end();
      pool = null;
    }
    return returnSuccess(true);
  } catch (error) {
    return returnError(`Close MySQL Pool failed: ${tryCatchErrorToString(error)}`);
  }
}
