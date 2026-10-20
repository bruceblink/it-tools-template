export type DatabaseTlsMode = 'verify' | 'disable';

/** Credentials cross into the database service only for the lifetime of a connection request. */
export interface PostgresConnectionInput {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  tlsMode: DatabaseTlsMode;
}

/** MySQL credentials cross into the desktop utility process only for the connection request. */
export interface MySqlConnectionInput {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  tlsMode: DatabaseTlsMode;
}

/** SQLite file paths are selected by the main-process file picker, never by renderer input. */
export interface SQLiteConnectionInput {
  filePath: string;
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
  | 'profile-storage-failed'
  | 'profile-limit-reached';

export type DatabaseBridgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DatabaseErrorCode };

export interface PostgresSessionInfo {
  sessionId: string;
  serverVersion: string;
}

export interface MySqlSessionInfo {
  sessionId: string;
  serverVersion: string;
}

export interface SQLiteSessionInfo {
  sessionId: string;
  serverVersion: string;
  fileName: string;
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

export interface PostgresDataPageInput {
  cursor: string | null;
  offset: number;
}

export interface PostgresDataCell {
  value: string | null;
  truncated: boolean;
}

export interface PostgresDataPage {
  columns: Array<{ name: string; dataType: string }>;
  rows: Array<{ cells: PostgresDataCell[] }>;
  columnsTruncated: boolean;
  pagingMode: 'keyset' | 'offset';
  pagingNotice: 'no-primary-key' | 'unsupported-primary-key' | null;
  hasNext: boolean;
  nextCursor: string | null;
  nextOffset: number | null;
  limitReached: boolean;
}

export interface DatabaseQueryPage {
  columns: Array<{ name: string; dataType: string }>;
  rows: Array<{ cells: PostgresDataCell[] }>;
  columnsTruncated: boolean;
  hasNext: boolean;
  nextOffset: number | null;
  limitReached: boolean;
  elapsedMilliseconds: number;
}
