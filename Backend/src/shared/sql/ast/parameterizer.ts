import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../../flow/result.js";

export interface ParameterizeResult {
  parameterizedSql: string;
  params: any[];
}

export function parameterizeSql(
  rawSql: string,
  values: any[] = []
): StandardResult<ParameterizeResult> {
  try {
    let paramIndex = 0;
    const params: any[] = [];

    const parameterizedSql = rawSql.replace(/-!!value!!-/g, () => {
      const currentVal = values.length > paramIndex ? values[paramIndex] : undefined;
      params.push(currentVal);
      paramIndex++;
      return "?";
    });

    return returnSuccess({
      parameterizedSql,
      params,
    });
  } catch (error) {
    return returnError(tryCatchErrorToString(error));
  }
}
