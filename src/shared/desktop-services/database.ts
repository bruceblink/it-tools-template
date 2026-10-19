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

export type DatabaseErrorCode =
  | 'invalid-request'
  | 'untrusted-renderer'
  | 'service-unavailable'
  | 'connection-failed'
  | 'too-many-sessions'
  | 'not-connected'
  | 'query-failed'
  | 'query-timeout';

export type DatabaseBridgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DatabaseErrorCode };

export interface PostgresSessionInfo {
  sessionId: string;
  serverVersion: string;
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

export interface PostgresStructureInfo {
  columns: PostgresColumnInfo[];
  columnsTruncated: boolean;
}

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
