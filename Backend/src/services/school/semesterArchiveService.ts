/**
 * M11: 高校自然学期历史工单分层归档流水线服务 (Semester Data Archive Pipeline Service)
 * 
 * 核心职责：
 * 1. 自动计算自然学期（春季学期/秋季学期）起止时间跨度
 * 2. 调度执行分批分片冷数据迁移 (executeChunkedArchiving)，防止长事务锁表
 * 3. 归档完成后清退该学校在 Redis 中的历史旧缓存 (purgeTenantCache)，释放内存
 */

import { StandardResult, returnSuccess, returnError, tryCatchErrorToString } from "../../shared/flow/result.js";
import { TerminalLogger } from "../../shared/log/terminalLogger.js";
import { purgeTenantCache } from "../../shared/cache/redis.js";
import { executeChunkedArchiving, resolveAcademicSemester } from "../../dispatcher/quotaRules.js";

export class SemesterArchiveService {
  /**
   * 调度执行特定学期的已结案工单全量归档
   */
  public static async archiveSemesterData(
    schoolId: number,
    targetSemester?: string
  ): Promise<StandardResult<{ migratedCount: number; semester: string }>> {
    if (!schoolId || schoolId <= 0) {
      return returnError("缺少有效的 schoolId 参数");
    }

    const semesterInfo = resolveAcademicSemester();
    const semester = targetSemester || semesterInfo.semesterCode;

    TerminalLogger.info(
      `[M11 学期归档] 开始对高校 [${schoolId}] 执行学期 [${semester}] 数据归档...`,
      "ArchiveWorker"
    );
    const startTime = Date.now();

    try {
      // 1. 分批将历史已办结工单归档入 patrols_archive
      const migratedCount = await executeChunkedArchiving(
        schoolId,
        semesterInfo.startDate,
        semesterInfo.endDate
      );

      // 2. 清退该学校历史旧缓存，释放 Redis 内存
      try {
        await purgeTenantCache(schoolId);
      } catch {
        // 缓存清退容错
      }

      TerminalLogger.info(
        `[M11 学期归档] 归档圆满完成! 成功归档 ${migratedCount} 条结案工单 (耗时 ${Date.now() - startTime}ms)`,
        "ArchiveWorker"
      );

      return returnSuccess({
        migratedCount,
        semester
      });
    } catch (err: any) {
      const errMsg = tryCatchErrorToString(err);
      TerminalLogger.error(`[M11 学期归档] 归档异常中断: ${errMsg}`, "ArchiveWorker");
      return returnError(`学期归档失败: ${errMsg}`);
    }
  }
}
