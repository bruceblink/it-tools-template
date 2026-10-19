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
