import {
  returnError,
  returnSuccess,
  StandardResult,
  tryCatchErrorToString,
} from "../../flow/result.js";
import type {
  ColumnNode,
  LimitNode,
  NeedInputValue,
  NonEmptyString,
  OrderByNode,
  ParseColumnsResult,
  ParseLimitResult,
  ParseOrderByResult,
  ParseWhereResult,
  TableNode,
  WhereConditionNode,
} from "../type.js";

export function getTableName(
  tableNode: TableNode,
  forceOriginName: boolean = false
): NonEmptyString {
  if (!tableNode || !tableNode.table) {
    return "" as NonEmptyString;
  }
  if (tableNode.as === undefined || forceOriginName) {
    return `\`${tableNode.table}\`` as NonEmptyString;
  }
  return `\`${tableNode.as}\`` as NonEmptyString;
}

export function getColumnName(
  columnNode: ColumnNode,
  forceOriginName: boolean = false
): NonEmptyString {
  const tablePart = getTableName(columnNode.tableNode, forceOriginName);
  const colPart = `\`${columnNode.column}\``;
  const originName = tablePart ? `${tablePart}.${colPart}` : colPart;
  const asName = columnNode.as;
  if (asName === undefined || forceOriginName) {
    return originName as NonEmptyString;
  }
  return `\`${asName}\`` as NonEmptyString;
}

export function containsDangerousKeyword(sqlFragment: string): StandardResult<{
  hasKeyword: boolean;
  keyword?: string;
}> {
  try {
    const dangerousKeywords = [
      "DROP",
      "DELETE",
      "INSERT",
      "UPDATE",
      "TRUNCATE",
      "ALTER",
      "CREATE",
      "EXEC",
      "EXECUTE",
      "GRANT",
      "REVOKE",
      "UNION",
      "INFORMATION_SCHEMA",
      "MYSQL",
    ];

    const upperFragment = sqlFragment.toUpperCase();
    for (const keyword of dangerousKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, "i");
      if (regex.test(upperFragment)) {
        return returnSuccess({
          hasKeyword: true,
          keyword,
        });
      }
    }

    return returnSuccess({ hasKeyword: false });
  } catch (error) {
    return returnError(tryCatchErrorToString(error));
  }
}

export function validateSQLFragment(fragment: string): StandardResult<{ isValid: boolean }> {
  try {
    if (!fragment || fragment.trim() === "") {
      return returnError("SQL片段不能为空");
    }

    const trimmed = fragment.trim();

    // 剔除 -!!value!!- 模板占位符后，再进行严格的 SQL 注入与注释特征检测
    const sanitizedWithoutPlaceholders = trimmed.replace(
      /-!!value!!-[\s\S]*?-!!value!!-|-!!value!!-/g,
      ""
    );

    if (
      sanitizedWithoutPlaceholders.includes("--") ||
      sanitizedWithoutPlaceholders.includes("/*") ||
      sanitizedWithoutPlaceholders.includes("*/")
    ) {
      return returnError("检测到SQL注释标记，已拦截");
    }

    if (trimmed.includes(";")) {
      return returnError("检测到多语句注入标记(;)，已拦截");
    }

    const upperStr = trimmed.toUpperCase();
    if (
      upperStr.includes("OR 1=1") ||
      upperStr.includes("AND 1=1") ||
      upperStr.includes("OR 1 = 1") ||
      upperStr.includes("AND 1 = 1")
    ) {
      return returnError("检测到恒真注入模式(OR 1=1)，已拦截");
    }

    if (upperStr.includes("SLEEP(") || upperStr.includes("BENCHMARK(")) {
      return returnError("检测到盲注函数(SLEEP)，已拦截");
    }

    const dangerousKeywordResult = containsDangerousKeyword(sanitizedWithoutPlaceholders);
    if (dangerousKeywordResult.status === 0) {
      return returnError(dangerousKeywordResult.content);
    }
    const keywordData = dangerousKeywordResult.data;
    if (keywordData?.hasKeyword) {
      return returnError(`检测到危险SQL关键字，已拦截: ${keywordData.keyword}`);
    }

    if (trimmed.length > 2000) {
      return returnError("SQL片段超出最大长度限制");
    }

    return returnSuccess({ isValid: true });
  } catch (error) {
    return returnError(tryCatchErrorToString(error));
  }
}

export function parseColumns(
  ...columns: Array<ColumnNode>
): StandardResult<ParseColumnsResult> {
  return parseColumnsInternal(columns, false);
}

export function parseColumnsInternal(
  columns: Array<ColumnNode>,
  allowMultiTable: boolean = false
): StandardResult<ParseColumnsResult> {
  try {
    const tableNames: Array<NonEmptyString> = [];
    const sqlParts = columns.map((item) => {
      const tableNode = item.tableNode;
      const alias = item.as;
      const wrapper = item.functionWrapper;

      // 在多表/有别名场景下，列名前缀应优先使用表的别名 (如 `p`.`id`)
      let columnPart = getColumnName(item, false);
      if (tableNode && tableNode.table) {
        tableNames.push(
          `${getTableName(tableNode, true)}${tableNode.as === undefined ? "" : ` AS \`${tableNode.as}\``}` as NonEmptyString
        );
      }

      if (wrapper !== undefined) {
        columnPart = wrapper.replace("?", columnPart) as NonEmptyString;
      }

      if (alias !== undefined) {
        columnPart += ` AS \`${alias}\``;
      }

      return columnPart;
    });

    const uniqueTables = [...new Set(tableNames)];
    if (!allowMultiTable && uniqueTables.length > 1) {
      return returnError("为保证高并发与缓存击穿防护性能，只能进行单表查询");
    }

    return returnSuccess<ParseColumnsResult>({
      columnsSQL: sqlParts.join(", "),
      tablesSQL: uniqueTables.join(", "),
    });
  } catch (error) {
    return returnError<ParseColumnsResult>(tryCatchErrorToString(error));
  }
}

export function parseWhereGroup(
  whereGroup: Array<WhereConditionNode>,
  isHaving: boolean = false,
  recordNeedInputValues: Array<NeedInputValue> = []
): StandardResult<string> {
  try {
    for (let i = 0; i < whereGroup.length; i++) {
      const currentItem = whereGroup[i];
      if (
        i % 2 === 0 &&
        currentItem._type !== "whereCompareNode" &&
        currentItem._type !== "whereGroupNode"
      ) {
        return returnError("whereGroup 中的比较运算符(组)位置错误");
      }
      if (i % 2 === 1 && currentItem._type !== "whereLogicalLinkNode") {
        return returnError("whereGroup 中的逻辑运算符位置错误");
      }
    }

    const sqlParts: Array<string> = [];

    for (let i = 0; i < whereGroup.length; i++) {
      const currentItem = whereGroup[i];
      const isEvenIndex = i % 2 === 0;

      if (isEvenIndex) {
        if (currentItem?._type === "whereGroupNode") {
          const groupResult = parseWhereGroup(
            currentItem.children,
            isHaving,
            recordNeedInputValues
          );
          if (groupResult.status === 0) return groupResult;
          sqlParts.push(`(${groupResult.data})`);
        } else if (currentItem?._type === "whereCompareNode") {
          if (
            currentItem.column?._type === "customValue" &&
            !validateSQLFragment(currentItem.column.string).status
          ) {
            return returnError(
              "whereGroup 中的比较运算符(组)中的自定义值包含危险字符"
            );
          }
          if (
            currentItem.compareColumn?._type === "customValue" &&
            !validateSQLFragment(currentItem.compareColumn.string).status
          ) {
            return returnError(
              "whereGroup 中的比较运算符(组)中的自定义值包含危险字符"
            );
          }
          const comparePartLeft = (() => {
            if (currentItem.column === undefined) return "";
            if (currentItem.column._type === "customValue")
              return currentItem.column.string;
            // 优先使用表别名
            const originName = getColumnName(currentItem.column, false);
            if (isHaving && currentItem.column.functionWrapper !== undefined) {
              return currentItem.column.functionWrapper.replace(
                "?",
                originName
              ) as NonEmptyString;
            }
            return originName;
          })();
          const comparePartRight = (() => {
            if (currentItem.compareColumn === undefined) return "-!!value!!-";
            if (currentItem.compareColumn._type === "customValue")
              return currentItem.compareColumn.string;
            // 优先使用表别名
            const originName = getColumnName(currentItem.compareColumn, false);
            if (
              isHaving &&
              currentItem.compareColumn.functionWrapper !== undefined
            ) {
              return currentItem.compareColumn.functionWrapper.replace(
                "?",
                originName
              ) as NonEmptyString;
            }
            return originName;
          })();
          const isSetOperator =
            currentItem.operator === "IN" || currentItem.operator === "NOT IN";
          const formattedRight =
            isSetOperator && !comparePartRight.trim().startsWith("(")
              ? `(${comparePartRight})`
              : comparePartRight;

          const comparePart = `${comparePartLeft} ${currentItem.operator} ${formattedRight}`;
          sqlParts.push(comparePart);
          if (currentItem.compareColumn === undefined) {
            recordNeedInputValues.push({
              currentSQL: comparePart as NonEmptyString,
            });
          }
        }
      } else {
        if (currentItem?._type === "whereLogicalLinkNode") {
          sqlParts.push(` ${currentItem.operator} `);
        }
      }
    }

    return returnSuccess(sqlParts.join(""));
  } catch (error) {
    return returnError(tryCatchErrorToString(error));
  }
}

export function parseWhere(
  ...whereConditions: Array<WhereConditionNode>
): StandardResult<ParseWhereResult> {
  try {
    const needInputValues: Array<NeedInputValue> = [];
    const parseResult = parseWhereGroup(whereConditions, false, needInputValues);
    if (parseResult.status === 0) return returnError(parseResult.content);

    return returnSuccess<ParseWhereResult>({
      whereSQL: parseResult.data as string,
      needInputValues,
    });
  } catch (error) {
    return returnError(tryCatchErrorToString(error));
  }
}

export function parseOrderBy(
  ...orderByNodes: Array<OrderByNode>
): StandardResult<ParseOrderByResult> {
  try {
    const sqlParts: Array<string> = [];
    for (const item of orderByNodes) {
      sqlParts.push(`${getColumnName(item.column, false)} ${item.direction}`);
    }
    return returnSuccess({
      orderBySQL: sqlParts.join(", "),
    });
  } catch (error) {
    return returnError(tryCatchErrorToString(error));
  }
}

export function parseLimit(
  limitNode: LimitNode
): StandardResult<ParseLimitResult> {
  try {
    if (limitNode._limitType === "indexSize") {
      return returnSuccess({
        limitSQL: `${limitNode.size}${limitNode.startIndex ? ` OFFSET ${limitNode.startIndex}` : ""}`,
      });
    }
    if (limitNode._limitType === "pageSize") {
      return returnSuccess({
        limitSQL: `${limitNode.size}${limitNode.page ? ` OFFSET ${(limitNode.page - 1) * limitNode.size}` : ""}`,
      });
    }
    return returnError("limitNode 类型错误");
  } catch (error) {
    return returnError(tryCatchErrorToString(error));
  }
}
