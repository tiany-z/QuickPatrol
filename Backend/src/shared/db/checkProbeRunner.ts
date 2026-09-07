import { executeQuery } from "./mysql.js";
import { returnError, returnSuccess, StandardResult } from "../flow/result.js";
import { TerminalLogger } from "../log/terminalLogger.js";
import { CheckProbeDefinition, ProbeVerificationReport } from "./ddlTypes.js";

export const DEFAULT_CHECK_PROBES: CheckProbeDefinition[] = [
  {
    probeId: "P01",
    tableName: "schools",
    testColumn: "status",
    invalidPayload: { code: "probe_chk_1", name: "探针学校1", planExpireAt: "2099-01-01 00:00:00", status: 99 },
    expectedConstraintName: "chk_school_status"
  },
  {
    probeId: "P02",
    tableName: "schools",
    testColumn: "planLevel",
    invalidPayload: { code: "probe_chk_2", name: "探针学校2", planExpireAt: "2099-01-01 00:00:00", planLevel: 5 },
    expectedConstraintName: "chk_school_plan"
  },
  {
    probeId: "P03",
    tableName: "users",
    testColumn: "role",
    invalidPayload: { schoolId: 1, openId: "probe_chk_user_1", realName: "探针用户", role: 88 },
    expectedConstraintName: "chk_user_role"
  },
  {
    probeId: "P04",
    tableName: "patrols",
    testColumn: "status",
    invalidPayload: { schoolId: 1, campusId: 1, categoryId: 1, orderNo: "PROBE-CHK-001", status: 9 },
    expectedConstraintName: "chk_patrol_status"
  },
  {
    probeId: "P05",
    tableName: "feedbacks",
    testColumn: "score",
    invalidPayload: { schoolId: 1, patrolId: 99999, score: 10 },
    expectedConstraintName: "chk_feedback_score"
  },
  {
    probeId: "P06",
    tableName: "chat_rooms",
    testColumn: "roomType",
    invalidPayload: { schoolId: 1, patrolId: 99999, roomType: "invalid_room_type" },
    expectedConstraintName: "chk_room_type"
  },
  {
    probeId: "P07",
    tableName: "ai_agent_messages",
    testColumn: "role",
    invalidPayload: { schoolId: 1, sessionId: 99999, role: "hacker" },
    expectedConstraintName: "chk_ai_role"
  }
];

/**
 * 执行 MySQL 8.x 原生 CHECK 约束探针
 * 核心逻辑：向各个目标表注入非法枚举/范围数据，断言 MySQL 8.x 引擎必须抛出 Check constraint 违背异常 (errno 3819)
 */
export async function runCheckConstraintProbes(
  probes: CheckProbeDefinition[] = DEFAULT_CHECK_PROBES
): Promise<StandardResult<ProbeVerificationReport>> {
  const details: Array<{ probeId: string; targetConstraint: string; passed: boolean; actualError?: string }> = [];
  let passedCount = 0;

  for (const probe of probes) {
    const cols = Object.keys(probe.invalidPayload).map(k => `\`${k}\``).join(", ");
    const placeholders = Object.keys(probe.invalidPayload).map(() => "?").join(", ");
    const values = Object.values(probe.invalidPayload);
    const sql = `INSERT INTO \`${probe.tableName}\` (${cols}) VALUES (${placeholders});`;

    const res = await executeQuery(sql, values);

    // 必须执行失败，且错误提示明确包含 Check constraint 或错误码 3819
    const isConstraintViolated =
      res.status === 0 &&
      (res.content.includes("Check constraint") ||
        res.content.includes("3819") ||
        res.content.includes(probe.expectedConstraintName));

    if (isConstraintViolated) {
      passedCount++;
      details.push({
        probeId: probe.probeId,
        targetConstraint: probe.expectedConstraintName,
        passed: true
      });
    } else {
      // 若成功插入，说明 CHECK 约束未生效！必须回滚删除脏数据
      if (res.status === 1) {
        try {
          const deleteKey = Object.keys(probe.invalidPayload)[0];
          const deleteVal = probe.invalidPayload[deleteKey];
          await executeQuery(`DELETE FROM \`${probe.tableName}\` WHERE \`${deleteKey}\` = ?;`, [deleteVal]);
        } catch {
          // ignore cleanup error
        }
      }

      details.push({
        probeId: probe.probeId,
        targetConstraint: probe.expectedConstraintName,
        passed: false,
        actualError: res.status === 1 ? "非法数据居然插入成功！CHECK 约束未被底层引擎执行！" : res.content
      });
    }
  }

  const report: ProbeVerificationReport = {
    totalProbes: probes.length,
    passedProbes: passedCount,
    failedProbes: probes.length - passedCount,
    details
  };

  if (report.failedProbes > 0) {
    TerminalLogger.printError(
      "CHECKProbe",
      `原生约束探针检测未通过：${report.failedProbes}/${report.totalProbes} 个约束失效！请检查 MySQL 版本是否 >= 8.0.16`
    );
    return returnError(
      `[M01 致命质量阻断] 原生 CHECK 约束探针失败 (${report.passedProbes}/${report.totalProbes} 通过)`
    );
  }

  TerminalLogger.info(
    `[M01] 全部 ${passedCount}/${probes.length} 个 MySQL 8.x 原生 CHECK 约束探针校验 100% 通过`,
    "CHECKProbe"
  );
  return returnSuccess(report);
}
