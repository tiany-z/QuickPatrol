import { executeQuery } from "./mysql.js";

/**
 * 初始化系统迁移版本元数据表 __schema_migrations
 */
export async function initMigrationTable(): Promise<void> {
  const ddl = `
    CREATE TABLE IF NOT EXISTS \`__schema_migrations\` (
      \`id\` INT NOT NULL AUTO_INCREMENT,
      \`version\` VARCHAR(64) NOT NULL,
      \`scriptName\` VARCHAR(256) NOT NULL,
      \`checksum\` VARCHAR(64) NOT NULL COMMENT 'SHA-256 哈希特征码',
      \`tablesCount\` INT NOT NULL DEFAULT 0,
      \`viewsCount\` INT NOT NULL DEFAULT 0,
      \`executionTimeMs\` INT NOT NULL DEFAULT 0,
      \`appliedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uk_version\` (\`version\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='DDL 迁移存根追踪表';
  `;
  await executeQuery(ddl);
}

/**
 * 检查当前数据库 Schema 存根是否与文件特征码完全一致且已最新
 */
export async function isMigrationUpToDate(checksum: string): Promise<boolean> {
  await initMigrationTable();
  const res = await executeQuery<{ checksum: string }>(
    "SELECT `checksum` FROM `__schema_migrations` ORDER BY `id` DESC LIMIT 1;"
  );
  if (res.status === 1 && res.data && res.data.length > 0) {
    return res.data[0].checksum === checksum;
  }
  return false;
}

/**
 * 记录或更新迁移执行存根
 */
export async function recordMigrationStub(
  version: string,
  scriptName: string,
  checksum: string,
  tablesCount: number,
  viewsCount: number,
  executionTimeMs: number
): Promise<void> {
  await initMigrationTable();
  const insertSql = `
    INSERT INTO \`__schema_migrations\` 
      (\`version\`, \`scriptName\`, \`checksum\`, \`tablesCount\`, \`viewsCount\`, \`executionTimeMs\`)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      \`checksum\` = VALUES(\`checksum\`),
      \`tablesCount\` = VALUES(\`tablesCount\`),
      \`viewsCount\` = VALUES(\`viewsCount\`),
      \`executionTimeMs\` = VALUES(\`executionTimeMs\`),
      \`appliedAt\` = NOW();
  `;
  await executeQuery(insertSql, [version, scriptName, checksum, tablesCount, viewsCount, executionTimeMs]);
}
