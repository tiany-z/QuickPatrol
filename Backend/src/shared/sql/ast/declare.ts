import type {
  ColumnNode,
  CustomValueNode,
  functionWrapper,
  LimitNode,
  NonEmptyString,
  operator,
  OrderByNode,
  TableNode,
  WhereCompareNode,
  WhereConditionNode,
  WhereGroupNode,
  WhereLogicalLinkNode,
  whereLogicalOperator,
} from "../type.js";

export const declare = {
  table(
    table: NonEmptyString,
    as?: NonEmptyString
  ): TableNode {
    return {
      _type: "table",
      table,
      as,
    };
  },

  column(
    tableNode: TableNode,
    column: NonEmptyString,
    as?: NonEmptyString,
    wrapper?: functionWrapper
  ): ColumnNode {
    return {
      _type: "column",
      tableNode,
      column,
      as,
      functionWrapper: wrapper,
    };
  },

  customValue(str: string): CustomValueNode {
    return {
      _type: "customValue",
      string: str,
    };
  },

  where: {
    compare(
      column: ColumnNode | CustomValueNode,
      op: operator,
      compareColumn?: ColumnNode | CustomValueNode
    ): WhereCompareNode {
      return {
        _type: "whereCompareNode",
        column,
        operator: op,
        compareColumn,
      };
    },

    logicalLink(op: whereLogicalOperator): WhereLogicalLinkNode {
      return {
        _type: "whereLogicalLinkNode",
        operator: op,
      };
    },

    group(...children: Array<WhereConditionNode>): WhereGroupNode {
      return {
        _type: "whereGroupNode",
        children,
      };
    },
  },

  orderBy: {
    ASC(column: ColumnNode): OrderByNode {
      return {
        _type: "orderBy",
        column,
        direction: "ASC",
      };
    },
    DESC(column: ColumnNode): OrderByNode {
      return {
        _type: "orderBy",
        column,
        direction: "DESC",
      };
    },
  },

  limit: {
    indexSize(startIndex: number, size: number): LimitNode {
      return {
        _type: "limit",
        _limitType: "indexSize",
        startIndex,
        size,
      };
    },
    pageSize(page: number, size: number): LimitNode {
      return {
        _type: "limit",
        _limitType: "pageSize",
        page,
        size,
      };
    },
  },
};

// ==========================================
// 语义化快捷 AST 表达式辅助函数 (DSL 语法糖)
// ==========================================

export function table(name: string, as?: string): TableNode {
  return declare.table(name as NonEmptyString, as as NonEmptyString);
}

export function col(
  tableOrCol: string | TableNode,
  colName?: string,
  as?: string
): ColumnNode {
  if (typeof tableOrCol === "string" && colName !== undefined) {
    return declare.column(
      declare.table(tableOrCol as NonEmptyString),
      colName as NonEmptyString,
      as as NonEmptyString
    );
  }

  if (typeof tableOrCol === "object" && colName !== undefined) {
    return declare.column(
      tableOrCol,
      colName as NonEmptyString,
      as as NonEmptyString
    );
  }

  // 单字段名情况 (隐式无表限定)
  const singleCol = typeof tableOrCol === "string" ? tableOrCol : colName || "";
  return declare.column(
    declare.table("" as NonEmptyString),
    singleCol as NonEmptyString,
    as as NonEmptyString
  );
}

function normalizeCompareLeft(
  column: ColumnNode | string
): ColumnNode | CustomValueNode {
  if (typeof column === "string") {
    return col(column);
  }
  return column;
}

function normalizeCompareRight(
  value: any
): ColumnNode | CustomValueNode {
  if (value && typeof value === "object" && (value._type === "column" || value._type === "customValue")) {
    return value;
  }
  if (value === undefined) {
    return declare.customValue("-!!value!!-");
  }
  return declare.customValue(`-!!value!!-${value}-!!value!!-`);
}

export function eq(column: ColumnNode | string, value: any): WhereCompareNode {
  return declare.where.compare(
    normalizeCompareLeft(column),
    "=",
    normalizeCompareRight(value)
  );
}

export function ne(column: ColumnNode | string, value: any): WhereCompareNode {
  return declare.where.compare(
    normalizeCompareLeft(column),
    "!=",
    normalizeCompareRight(value)
  );
}

export function gt(column: ColumnNode | string, value: any): WhereCompareNode {
  return declare.where.compare(
    normalizeCompareLeft(column),
    ">",
    normalizeCompareRight(value)
  );
}

export function gte(column: ColumnNode | string, value: any): WhereCompareNode {
  return declare.where.compare(
    normalizeCompareLeft(column),
    ">=",
    normalizeCompareRight(value)
  );
}

export function lt(column: ColumnNode | string, value: any): WhereCompareNode {
  return declare.where.compare(
    normalizeCompareLeft(column),
    "<",
    normalizeCompareRight(value)
  );
}

export function lte(column: ColumnNode | string, value: any): WhereCompareNode {
  return declare.where.compare(
    normalizeCompareLeft(column),
    "<=",
    normalizeCompareRight(value)
  );
}

export function like(column: ColumnNode | string, pattern: string): WhereCompareNode {
  return declare.where.compare(
    normalizeCompareLeft(column),
    "LIKE",
    normalizeCompareRight(pattern)
  );
}

export function inList(column: ColumnNode | string, values: any[] | string): WhereCompareNode {
  const rightVal = Array.isArray(values)
    ? declare.customValue(`(${values.map((v) => (typeof v === "string" ? `'${v}'` : v)).join(", ")})`)
    : typeof values === "string"
    ? declare.customValue(values)
    : normalizeCompareRight(values);

  return declare.where.compare(normalizeCompareLeft(column), "IN", rightVal);
}

export function and(): WhereLogicalLinkNode {
  return declare.where.logicalLink("AND");
}

export function or(): WhereLogicalLinkNode {
  return declare.where.logicalLink("OR");
}

export function group(...children: WhereConditionNode[]): WhereGroupNode {
  return declare.where.group(...children);
}
