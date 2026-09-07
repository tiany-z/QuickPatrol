import {
  returnError,
  returnSuccess,
  StandardResult,
  tryCatchErrorToString,
} from "../../flow/result.js";

export interface ParameterizeResult {
  parameterizedSql: string;
  params: any[];
}

/**
 * 递归/顺序解析 SQL 中的参数占位符
 * 支持两种占位符格式：
 * 1. 嵌入式值占位符: `-!!value!!-${val}-!!value!!-` -> 解析嵌入的值并推入 params，替换为 ?
 * 2. 纯占位符: `-!!value!!-` -> 从 values 数组中按序取值并推入 params，替换为 ?
 */
export function parameterizeSql(
  rawSql: string,
  values: any[] = []
): StandardResult<ParameterizeResult> {
  try {
    let paramIndex = 0;
    const params: any[] = [];

    // 精准正则：包含嵌入值的占位符中间不能包含空白或感叹号，避免跨占位符贪婪匹配
    const placeholderRegex = /-!!value!!-([^!\s]+)-!!value!!-|-!!value!!-/g;

    const parameterizedSql = rawSql.replace(
      placeholderRegex,
      (_match, embeddedVal) => {
        // 如果匹配到非空嵌入值
        if (embeddedVal !== undefined && embeddedVal !== "") {
          let parsedVal: any = embeddedVal;
          if (/^-?\d+$/.test(embeddedVal)) {
            parsedVal = parseInt(embeddedVal, 10);
          } else if (/^-?\d+\.\d+$/.test(embeddedVal)) {
            parsedVal = parseFloat(embeddedVal);
          } else if (embeddedVal === "true") {
            parsedVal = true;
          } else if (embeddedVal === "false") {
            parsedVal = false;
          } else if (embeddedVal === "null") {
            parsedVal = null;
          }
          params.push(parsedVal);
          return "?";
        }

        // 纯占位符：从外部 values 序列提取
        const currentVal =
          values.length > paramIndex ? values[paramIndex] : undefined;
        params.push(currentVal);
        paramIndex++;
        return "?";
      }
    );

    return returnSuccess({
      parameterizedSql,
      params,
    });
  } catch (error) {
    return returnError(tryCatchErrorToString(error));
  }
}
