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
