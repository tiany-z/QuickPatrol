import {
  ColumnNode,
  CustomValueNode,
  NonEmptyString,
  TableNode,
  WhereCompareNode,
  WhereConditionNode,
  WhereGroupNode,
  WhereLogicalLinkNode,
} from "../type.js";
import {
  isGlobalTable,
  isValidTenantContext,
  TenantContext,
} from "./tenantTypes.js";
import { returnError, returnSuccess, StandardResult } from "../../flow/result.js";

export class TenantASTInjector {
  /**
   * 针对 SELECT / UPDATE 强化 WHERE 条件树
   * 自动包裹原条件防止 OR 运算符短路，并注入 schoolId 与 isDeleted 约束
   * 
   * @param primaryTableOrTables 主表或所有参与查询的物理表列表
   * @param rawWhere 原始业务 WHERE 条件数组
   * @param context 租户上下文
   * @param options 配置项（如 includeDeleted 包含已删除记录）
   */
  public static augmentWhere(
    primaryTableOrTables: TableNode | TableNode[],
    rawWhere?: WhereConditionNode[],
    context?: TenantContext,
    options?: { includeDeleted?: boolean }
  ): StandardResult<WhereConditionNode[]> {
    const tables = Array.isArray(primaryTableOrTables)
      ? primaryTableOrTables
      : [primaryTableOrTables];

    if (tables.length === 0) {
      return returnSuccess(rawWhere ? [...rawWhere] : []);
    }

    // 过滤出需要注入租户/软删除的业务物理表
    const businessTables = tables.filter((t) => !isGlobalTable(t.table));

    // 全量涉及表均为全局表（如 schools, __schema_migrations），直接放行
    if (businessTables.length === 0) {
      return returnSuccess(rawWhere ? [...rawWhere] : []);
    }

    const firstBusinessTableName = businessTables[0].table;

    // 校验租户上下文
    if (!isValidTenantContext(context)) {
      return returnError(
        `[M02 租户引擎致命拒绝] 访问业务数据表 [${firstBusinessTableName}] 必须提供合法的 schoolId 租户上下文！`
      );
    }

    const isSuperAdminBypass =
      context?.role === 9 && context?.bypassTenantFilter === true;

    // 构造防穿透约束条件列表
    const constraintNodes: WhereConditionNode[] = [];
    const andLink: WhereLogicalLinkNode = {
      _type: "whereLogicalLinkNode",
      operator: "AND",
    };

    for (const tableNode of businessTables) {
      // 1. 注入 schoolId (超管 bypassTenantFilter 豁免)
      if (!isSuperAdminBypass && context?.schoolId !== undefined) {
        const tenantCompareNode: WhereCompareNode = {
          _type: "whereCompareNode",
          column: {
            _type: "column",
            tableNode,
            column: "schoolId" as NonEmptyString,
          },
          operator: "=",
          compareColumn: {
            _type: "customValue",
            string: `-!!value!!-${context.schoolId}-!!value!!-`,
          },
        };

        if (constraintNodes.length > 0) {
          constraintNodes.push(andLink);
        }
        constraintNodes.push(tenantCompareNode);
      }

      // 2. 注入 isDeleted = 0 软删除约束 (除非显式声明 includeDeleted)
      if (!options?.includeDeleted) {
        const isDeletedCompareNode: WhereCompareNode = {
          _type: "whereCompareNode",
          column: {
            _type: "column",
            tableNode,
            column: "isDeleted" as NonEmptyString,
          },
          operator: "=",
          compareColumn: {
            _type: "customValue",
            string: "-!!value!!-0-!!value!!-",
          },
        };

        if (constraintNodes.length > 0) {
          constraintNodes.push(andLink);
        }
        constraintNodes.push(isDeletedCompareNode);
      }
    }

    // 若无任何注入约束生成（例如超管且 includeDeleted），直接返回原条件
    if (constraintNodes.length === 0) {
      return returnSuccess(rawWhere ? [...rawWhere] : []);
    }

    // 3. 合并原有业务条件与注入约束
    const finalWhere: WhereConditionNode[] = [];

    if (!rawWhere || rawWhere.length === 0) {
      finalWhere.push(...constraintNodes);
    } else {
      // 核心安全防线：强制将原条件整体封装为 WhereGroupNode，防止 OR 逻辑短路越权穿透
      const wrappedRawGroup: WhereGroupNode = {
        _type: "whereGroupNode",
        children: [...rawWhere],
      };

      finalWhere.push(wrappedRawGroup, andLink, ...constraintNodes);
    }

    return returnSuccess(finalWhere);
  }

  /**
   * 针对 INSERT 强力劫持与归属校验
   * 自动补全当前上下文的 schoolId，并拦截跨校伪造恶意写入
   * 
   * @param primaryTable 主表节点
   * @param columns 待插入列节点列表
   * @param values 待插入值节点列表（可选）
   * @param context 租户上下文
   * @param dataPayload 原始插入对象（可选）
   */
  public static injectTenantToInsertColumns(
    primaryTable: TableNode,
    columns: ColumnNode[],
    values?: CustomValueNode[],
    context?: TenantContext,
    dataPayload?: Record<string, any>
  ): StandardResult<{
    columns: ColumnNode[];
    values?: CustomValueNode[];
    dataPayload?: Record<string, any>;
  }> {
    const tableName = primaryTable.table;

    // 1. 全局表白名单放行
    if (isGlobalTable(tableName)) {
      return returnSuccess({ columns, values, dataPayload });
    }

    // 2. 校验租户上下文
    if (!isValidTenantContext(context) || !context?.schoolId) {
      return returnError(
        `[M02 租户引擎致命拒绝] 插入业务表 [${tableName}] 必须提供合法的 schoolId 租户上下文！`
      );
    }

    const currentSchoolId = context.schoolId;

    // 3. 如果提供了对象字典形式的数据负载 (dataPayload)
    if (dataPayload) {
      if ("schoolId" in dataPayload) {
        const passedSchoolId = Number(dataPayload.schoolId);
        if (passedSchoolId !== currentSchoolId) {
          return returnError(
            `[M02 越权写入阻断] 试图向学校 [${dataPayload.schoolId}] 插入数据，但当前登录会话隶属于学校 [${currentSchoolId}]！`
          );
        }
      } else {
        dataPayload.schoolId = currentSchoolId;
      }
    }

    // 4. 检查 columns 数组中是否已声明 schoolId 列
    const outColumns = [...columns];
    const outValues = values ? [...values] : undefined;
    const schoolIdIndex = outColumns.findIndex(
      (c) => c.column.toLowerCase() === "schoolid"
    );

    if (schoolIdIndex >= 0) {
      // 显式声明了 schoolId 列，检查对应值是否一致
      if (outValues && outValues[schoolIdIndex]) {
        const valStr = outValues[schoolIdIndex].string;
        const expectedPattern = `-!!value!!-${currentSchoolId}-!!value!!-`;
        if (valStr !== expectedPattern && valStr !== String(currentSchoolId)) {
          return returnError(
            `[M02 越权写入阻断] 试图向学校 [${valStr}] 插入数据，但当前登录会话隶属于学校 [${currentSchoolId}]！`
          );
        }
      }
    } else {
      // 缺失 schoolId 列，自动强力劫持注入
      const injectedCol: ColumnNode = {
        _type: "column",
        tableNode: primaryTable,
        column: "schoolId" as NonEmptyString,
      };
      outColumns.push(injectedCol);

      if (outValues) {
        const injectedVal: CustomValueNode = {
          _type: "customValue",
          string: `-!!value!!-${currentSchoolId}-!!value!!-`,
        };
        outValues.push(injectedVal);
      }
    }

    return returnSuccess({
      columns: outColumns,
      values: outValues,
      dataPayload,
    });
  }
}
