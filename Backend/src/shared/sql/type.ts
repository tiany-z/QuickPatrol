export type NonEmptyString = string & `${string & {}}`;

export type valueType =
  | "Auto"
  | "number"
  | "string"
  | "boolean"
  | "date"
  | "null";

export type operator =
  | "="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "LIKE"
  | "NOT LIKE"
  | "IN"
  | "NOT IN"
  | "BETWEEN"
  | "NOT BETWEEN"
  | "IS NULL"
  | "IS NOT NULL"
  | "IS"
  | "IS NOT";

export type whereLogicalOperator = "AND" | "OR" | "NOT";
export type functionWrapper = `${string}?${string}`;

export interface ColumnNode {
  _type: "column";
  tableNode: TableNode;
  column: NonEmptyString;
  as?: NonEmptyString;
  functionWrapper?: functionWrapper;
}

export interface TableNode {
  _type: "table";
  table: NonEmptyString;
  as?: NonEmptyString;
}

export interface CustomValueNode {
  _type: "customValue";
  string: string;
}

export interface WhereCompareNode {
  _type: "whereCompareNode";
  column: ColumnNode | CustomValueNode;
  operator: operator;
  compareColumn?: ColumnNode | CustomValueNode;
}

export interface WhereLogicalLinkNode {
  _type: "whereLogicalLinkNode";
  operator: whereLogicalOperator;
}

export interface WhereGroupNode {
  _type: "whereGroupNode";
  children: Array<WhereCompareNode | WhereLogicalLinkNode | WhereGroupNode>;
}

export type WhereConditionNode =
  | WhereCompareNode
  | WhereLogicalLinkNode
  | WhereGroupNode;

export interface OrderByNode {
  _type: "orderBy";
  column: ColumnNode;
  direction: "ASC" | "DESC";
}

export type LimitSubType = "indexSize" | "pageSize";

export interface LimitNode {
  _type: "limit";
  _limitType: LimitSubType;
  startIndex?: number;
  size: number;
  page?: number;
}

export interface NeedInputValue {
  currentSQL: NonEmptyString;
}

export interface ParseColumnsResult {
  columnsSQL: string;
  tablesSQL: string;
}

export interface ParseOrderByResult {
  orderBySQL: string;
}

export interface ParseLimitResult {
  limitSQL: string;
}

export interface ParseWhereResult {
  whereSQL: string;
  needInputValues: Array<NeedInputValue>;
}

export interface SelectCompose {
  allColumns?: boolean;
  columns: Array<ColumnNode>;
  where?: Array<WhereConditionNode>;
  orderBy?: Array<OrderByNode>;
  limit?: LimitNode;
  distinct?: boolean;
  includeDeleted?: boolean;
}

export interface SelectBuildResult {
  tableName: string;
  sql: string;
  sqlOnlyId: string;
  needInputValues: Array<NeedInputValue>;
}

export interface UndoOperation {
  undoSql: string;
  undoParams: any[];
}

export interface InsertCompose {
  columns: Array<ColumnNode>;
}

export interface InsertBuildResult {
  tableName: string;
  sql: string;
  needInputValues: Array<{ columnName: string }>;
  createUndoFn: (insertedId: string | number) => UndoOperation;
}

export interface UpdateCompose {
  table: TableNode;
  targetId: string | number;
  updateData: Record<string, any>;
}

export interface UpdateBuildResult {
  tableName: string;
  targetId: string | number;
  lockSql: string;
  updateSql: string;
  updateParams: any[];
  createUndoFn: (oldRowSnapshot: Record<string, any>) => UndoOperation;
}

export interface DeleteCompose {
  table: TableNode;
  targetId: string | number;
}

export interface DeleteBuildResult {
  tableName: string;
  targetId: string | number;
  lockSql: string;
  deleteSql: string;
  deleteParams: any[];
  createUndoFn: (deletedRowSnapshot: Record<string, any>) => UndoOperation;
}
