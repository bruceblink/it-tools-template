export type DatabaseTlsMode = 'verify' | 'disable';
export type DatabaseAccessMode = 'read-only' | 'read-write';

/** Credentials cross into the database service only for the lifetime of a connection request. */
export interface PostgresConnectionInput {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  tlsMode: DatabaseTlsMode;
  accessMode?: DatabaseAccessMode;
}

/** MySQL credentials cross into the desktop utility process only for the connection request. */
export interface MySqlConnectionInput {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  tlsMode: DatabaseTlsMode;
  accessMode?: DatabaseAccessMode;
}

/** SQLite file paths are selected by the main-process file picker, never by renderer input. */
export interface SQLiteConnectionInput {
  filePath: string;
  accessMode: DatabaseAccessMode;
}

/** A saved profile contains connection metadata only. It never contains a password. */
export interface PostgresConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  tlsMode: DatabaseTlsMode;
}

/** Renderer input for creating or updating a password-free connection profile. */
export interface PostgresConnectionProfileInput {
  id?: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  tlsMode: DatabaseTlsMode;
}

export type DatabaseErrorCode =
  | 'invalid-request'
  | 'untrusted-renderer'
  | 'service-unavailable'
  | 'connection-failed'
  | 'too-many-sessions'
  | 'not-connected'
  | 'query-failed'
  | 'query-timeout'
  | 'write-disabled'
  | 'write-limit-exceeded'
  | 'write-result-unknown'
  | 'write-conflict'
  | 'profile-storage-failed'
  | 'profile-limit-reached';

export type DatabaseBridgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DatabaseErrorCode };

export interface PostgresSessionInfo {
  sessionId: string;
  serverVersion: string;
  accessMode?: DatabaseAccessMode;
}

export interface MySqlSessionInfo {
  sessionId: string;
  serverVersion: string;
  accessMode?: DatabaseAccessMode;
}

export interface SQLiteSessionInfo {
  sessionId: string;
  serverVersion: string;
  fileName: string;
  accessMode?: DatabaseAccessMode;
}

export interface PostgresSchemaInfo {
  name: string;
}

export interface PostgresTableInfo {
  name: string;
  kind: 'table' | 'view';
}

export interface PostgresColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
  primaryKeyPosition: number | null;
  ordinalPosition: number;
}

export interface PostgresIndexInfo {
  name: string;
  unique: boolean;
  primary: boolean;
  method: string;
  valid: boolean;
  definition: string;
  definitionTruncated: boolean;
}

export interface PostgresStructureInfo {
  columns: PostgresColumnInfo[];
  columnsTruncated: boolean;
  indexes: PostgresIndexInfo[];
  indexesTruncated: boolean;
}

export interface MySqlSchemaInfo {
  name: string;
}

export interface MySqlTableInfo {
  name: string;
  kind: 'table' | 'view';
}

export interface MySqlColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
  primaryKeyPosition: number | null;
  ordinalPosition: number;
}

/** MySQL does not expose the same index validity state as PostgreSQL, so valid is null. */
export interface MySqlIndexInfo {
  name: string;
  unique: boolean;
  primary: boolean;
  method: string;
  valid: null;
  definition: string;
  definitionTruncated: boolean;
}

export interface MySqlStructureInfo {
  columns: MySqlColumnInfo[];
  columnsTruncated: boolean;
  indexes: MySqlIndexInfo[];
  indexesTruncated: boolean;
}

export interface SQLiteSchemaInfo {
  name: 'main';
}

export interface SQLiteTableInfo {
  name: string;
  kind: 'table' | 'view';
}

export interface SQLiteColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
  primaryKeyPosition: number | null;
  ordinalPosition: number;
}

export interface SQLiteIndexInfo {
  name: string;
  unique: boolean;
  primary: boolean;
  method: 'btree';
  valid: true;
  definition: string;
  definitionTruncated: boolean;
}

export interface SQLiteStructureInfo {
  columns: SQLiteColumnInfo[];
  columnsTruncated: boolean;
  indexes: SQLiteIndexInfo[];
  indexesTruncated: boolean;
}

export type DatabaseEngine = 'postgres' | 'mysql' | 'sqlite';
export type DatabaseSessionInfo = PostgresSessionInfo | MySqlSessionInfo | SQLiteSessionInfo;
export type DatabaseSchemaInfo = PostgresSchemaInfo | MySqlSchemaInfo | SQLiteSchemaInfo;
export type DatabaseTableInfo = PostgresTableInfo | MySqlTableInfo | SQLiteTableInfo;
export type DatabaseColumnInfo = PostgresColumnInfo | MySqlColumnInfo | SQLiteColumnInfo;
export type DatabaseIndexInfo = PostgresIndexInfo | MySqlIndexInfo | SQLiteIndexInfo;
export type DatabaseStructureInfo = PostgresStructureInfo | MySqlStructureInfo | SQLiteStructureInfo;

/** Operators accepted by generated table filters; values never contain SQL fragments. */
export type DatabaseDataFilterOperator =
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'starts-with'
  | 'ends-with'
  | 'is-null'
  | 'is-not-null';

export interface DatabaseDataFilter {
  column: string;
  operator: DatabaseDataFilterOperator;
  value: string | null;
}

export interface DatabaseDataSort {
  column: string;
  direction: 'asc' | 'desc';
}

export interface PostgresDataPageInput {
  cursor: string | null;
  offset: number;
  filters?: DatabaseDataFilter[];
  sort?: DatabaseDataSort[];
}

export interface PostgresDataCell {
  value: string | null;
  truncated: boolean;
}

export interface PostgresDataPage {
  columns: Array<{ name: string; dataType: string }>;
  rows: Array<{
    cells: PostgresDataCell[];
    primaryKeyValues: string[] | null;
    primaryKeyValuesTruncated: boolean;
  }>;
  primaryKeyColumns: string[];
  editable: boolean;
  columnsTruncated: boolean;
  pagingMode: 'keyset' | 'offset';
  pagingNotice: 'no-primary-key' | 'unsupported-primary-key' | 'offset-paging' | null;
  hasNext: boolean;
  nextCursor: string | null;
  nextOffset: number | null;
  limitReached: boolean;
}

/** A validated, optimistic-concurrency-protected update to one table cell. */
export interface DatabaseCellUpdateInput {
  schema: string;
  table: string;
  column: string;
  primaryKeys: Array<{ column: string; value: string }>;
  originalValue: string | null;
  newValue: string | null;
}

/** A bounded value set for one row in a table batch draft. An empty set uses column defaults. */
export interface DatabaseBatchRowValues {
  values: Array<{ column: string; value: string | null }>;
}

/** A delete draft carries the complete loaded row for optimistic conflict checking. */
export interface DatabaseBatchDeleteRow {
  primaryKeys: Array<{ column: string; value: string }>;
  originalValues: Array<{ column: string; value: string | null }>;
}

export interface DatabaseBatchMutationInput {
  schema: string;
  table: string;
  inserts: DatabaseBatchRowValues[];
  deletes: DatabaseBatchDeleteRow[];
}

export interface DatabaseQueryPage {
  columns: Array<{ name: string; dataType: string }>;
  rows: Array<{ cells: PostgresDataCell[] }>;
  columnsTruncated: boolean;
  hasNext: boolean;
  nextOffset: number | null;
  limitReached: boolean;
  elapsedMilliseconds: number;
  editableTarget?: {
    schema: string;
    table: string;
    primaryKeyColumns: string[];
    editableColumns: string[];
  };
}

export type DatabaseMutationKind = 'insert' | 'update' | 'delete';

export interface DatabaseBatchMutationResult {
  kind: 'batch-mutation';
  insertedRows: number;
  deletedRows: number;
  elapsedMilliseconds: number;
}

export type DatabaseBatchMutationResponse =
  | DatabaseBatchMutationResult
  | { kind: 'cancelled' };

export type DatabaseStatementResult =
  | { kind: 'query'; page: DatabaseQueryPage }
  | { kind: 'cancelled' }
  | {
      kind: 'mutation';
      statement: DatabaseMutationKind;
      affectedRows: number;
      elapsedMilliseconds: number;
    }
  | DatabaseBatchMutationResult;
