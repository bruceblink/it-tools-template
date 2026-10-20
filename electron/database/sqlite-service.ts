import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { basename, isAbsolute } from 'node:path';
import type {
  DatabaseBridgeResult,
  DatabaseQueryPage,
  SQLiteColumnInfo,
  SQLiteIndexInfo,
  SQLiteSchemaInfo,
  SQLiteSessionInfo,
  SQLiteStructureInfo,
  SQLiteTableInfo,
} from '../../src/shared/desktop-services/database';
import { areValidQueryFieldNames, createBoundedQuerySql, createDatabaseQueryPage, MAX_QUERY_COLUMNS, MAX_QUERY_OFFSET } from './query-results';
import { normalizeReadOnlySelectQuery } from './sql-query';

const MAX_SQLITE_SESSIONS = 4;
const MAX_TABLES_PER_SCHEMA = 500;
const MAX_COLUMNS_PER_TABLE = 256;
const MAX_INDEXES_PER_TABLE = 64;
const MAX_IDENTIFIER_CHARACTERS = 256;
const MAX_TYPE_CHARACTERS = 256;
const MAX_DEFAULT_CHARACTERS = 512;
const MAX_INDEX_DEFINITION_CHARACTERS = 2_048;
const LOCK_WAIT_TIMEOUT_MILLISECONDS = 5_000;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SqliteConnection = {
  database: DatabaseSync;
  fileName: string;
};

type SqliteTableRow = {
  name: string;
  type: 'table' | 'view';
};

type SqliteColumnRow = {
  cid: number;
  name: string;
  data_type: string;
  not_null: number;
  default_value: string | null;
  primary_key_position: number;
};

type SqliteIndexRow = {
  name: string;
  is_unique: number;
  origin: string;
  partial: number;
};

/** Keeps SQLite reads inside the isolated utility process and opens user-selected files read-only. */
export class SQLiteDatabaseService {
  private readonly connections = new Map<string, SqliteConnection>();

  async connect(sessionId: string, filePath: string): Promise<DatabaseBridgeResult<SQLiteSessionInfo>> {
    if (!SESSION_ID_PATTERN.test(sessionId) || !isValidSQLiteFilePath(filePath)) {
      return { ok: false, error: 'invalid-request' };
    }
    if (this.connections.has(sessionId)) {
      return { ok: false, error: 'invalid-request' };
    }
    if (this.connections.size >= MAX_SQLITE_SESSIONS) {
      return { ok: false, error: 'too-many-sessions' };
    }

    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(filePath, {
        readOnly: true,
        timeout: LOCK_WAIT_TIMEOUT_MILLISECONDS,
        allowExtension: false,
        enableDoubleQuotedStringLiterals: false,
      });
      database.exec(`PRAGMA trusted_schema = OFF; PRAGMA query_only = ON; PRAGMA busy_timeout = ${LOCK_WAIT_TIMEOUT_MILLISECONDS};`);
      const versionRow = database.prepare('SELECT sqlite_version() AS version').get() as { version?: SQLOutputValue } | undefined;
      if (typeof versionRow?.version !== 'string' || versionRow.version.length > 64) {
        database.close();
        return { ok: false, error: 'connection-failed' };
      }

      const fileName = basename(filePath).slice(0, MAX_IDENTIFIER_CHARACTERS);
      this.connections.set(sessionId, { database, fileName });
      return { ok: true, value: { sessionId, serverVersion: versionRow.version, fileName } };
    }
    catch {
      try {
        database?.close();
      }
      catch {
        // A failed open may already have closed the native database handle.
      }
      return { ok: false, error: 'connection-failed' };
    }
  }

  async disconnect(sessionId: string): Promise<DatabaseBridgeResult<boolean>> {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      return { ok: false, error: 'invalid-request' };
    }
    const connection = this.connections.get(sessionId);
    if (!connection) {
      return { ok: true, value: false };
    }
    this.connections.delete(sessionId);
    try {
      connection.database.close();
      return { ok: true, value: true };
    }
    catch {
      return { ok: false, error: 'query-failed' };
    }
  }

  async listSchemas(sessionId: string): Promise<DatabaseBridgeResult<SQLiteSchemaInfo[]>> {
    if (!this.connections.has(sessionId)) {
      return { ok: false, error: 'not-connected' };
    }
    return { ok: true, value: [{ name: 'main' }] };
  }

  async listTables(sessionId: string, schema: string): Promise<DatabaseBridgeResult<SQLiteTableInfo[]>> {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      return { ok: false, error: 'not-connected' };
    }
    if (schema !== 'main') {
      return { ok: false, error: 'invalid-request' };
    }

    try {
      const rows = connection.database.prepare(
        `SELECT substr(name, 1, ${MAX_IDENTIFIER_CHARACTERS}) AS name, type
         FROM main.sqlite_schema
         WHERE type IN ('table', 'view')
           AND substr(name, 1, 7) <> 'sqlite_'
           AND length(name) <= ${MAX_IDENTIFIER_CHARACTERS}
         ORDER BY name
         LIMIT ?`,
      ).all(MAX_TABLES_PER_SCHEMA + 1) as SqliteTableRow[];
      return {
        ok: true,
        value: rows.slice(0, MAX_TABLES_PER_SCHEMA).map(row => ({ name: row.name, kind: row.type })),
      };
    }
    catch {
      return { ok: false, error: 'query-failed' };
    }
  }

  async getStructure(
    sessionId: string,
    schema: string,
    table: string,
  ): Promise<DatabaseBridgeResult<SQLiteStructureInfo>> {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      return { ok: false, error: 'not-connected' };
    }
    if (schema !== 'main' || !isValidSQLiteIdentifier(table)) {
      return { ok: false, error: 'invalid-request' };
    }

    try {
      const columnRows = connection.database.prepare(
        `SELECT cid,
                substr(name, 1, ${MAX_IDENTIFIER_CHARACTERS}) AS name,
                substr(type, 1, ${MAX_TYPE_CHARACTERS}) AS data_type,
                "notnull" AS not_null,
                substr(dflt_value, 1, ${MAX_DEFAULT_CHARACTERS}) AS default_value,
                pk AS primary_key_position
         FROM pragma_table_info(?)
         WHERE length(name) <= ${MAX_IDENTIFIER_CHARACTERS}
         ORDER BY cid
         LIMIT ?`,
      ).all(table, MAX_COLUMNS_PER_TABLE + 1) as SqliteColumnRow[];
      if (columnRows.length === 0) {
        return { ok: false, error: 'query-failed' };
      }
      const columns: SQLiteColumnInfo[] = columnRows.slice(0, MAX_COLUMNS_PER_TABLE).map(row => ({
        name: row.name,
        dataType: row.data_type,
        nullable: row.not_null === 0,
        defaultValue: row.default_value,
        primaryKey: row.primary_key_position > 0,
        primaryKeyPosition: row.primary_key_position > 0 ? row.primary_key_position : null,
        ordinalPosition: row.cid + 1,
      }));

      const indexRows = connection.database.prepare(
        `SELECT substr(name, 1, ${MAX_IDENTIFIER_CHARACTERS}) AS name,
                "unique" AS is_unique,
                origin,
                partial
         FROM pragma_index_list(?)
         WHERE length(name) <= ${MAX_IDENTIFIER_CHARACTERS}
         ORDER BY seq
         LIMIT ?`,
      ).all(table, MAX_INDEXES_PER_TABLE + 1) as SqliteIndexRow[];
      const indexes = indexRows.slice(0, MAX_INDEXES_PER_TABLE).map(row => this.readIndex(connection.database, row));
      return {
        ok: true,
        value: {
          columns,
          columnsTruncated: columnRows.length > MAX_COLUMNS_PER_TABLE,
          indexes,
          indexesTruncated: indexRows.length > MAX_INDEXES_PER_TABLE,
        },
      };
    }
    catch {
      return { ok: false, error: 'query-failed' };
    }
  }

  /** Run only one validated SELECT and project bounded values while the read-only handle stays isolated. */
  async executeReadOnlyQuery(
    sessionId: string,
    sql: string,
    offset: number,
  ): Promise<DatabaseBridgeResult<DatabaseQueryPage>> {
    const connection = this.connections.get(sessionId);
    const query = normalizeReadOnlySelectQuery(sql, 'sqlite');
    if (!connection) {
      return { ok: false, error: 'not-connected' };
    }
    if (!query || !Number.isInteger(offset) || offset < 0 || offset > MAX_QUERY_OFFSET) {
      return { ok: false, error: 'invalid-request' };
    }

    const startedAt = Date.now();
    try {
      const metadataStatement = connection.database.prepare(
        `SELECT * FROM (\n${query}\n) AS "__it_tools_metadata" LIMIT 0`,
      );
      const fieldNames = metadataStatement.columns().map(column => column.name);
      if (!areValidQueryFieldNames(fieldNames, 'sqlite')) {
        return { ok: false, error: 'query-failed' };
      }

      const resultStatement = connection.database.prepare(
        createBoundedQuerySql('sqlite', query, fieldNames, offset),
      );
      const resultRows = resultStatement.all() as Array<Record<string, SQLOutputValue>>;
      const rawRows = resultRows.map(row => Array.from({ length: Math.min(fieldNames.length, MAX_QUERY_COLUMNS) }, (_, index) => [
        row[`__it_value_${index}`],
        row[`__it_truncated_${index}`],
      ]).flat());
      return {
        ok: true,
        value: createDatabaseQueryPage(fieldNames, rawRows, offset, startedAt),
      };
    }
    catch {
      return { ok: false, error: 'query-failed' };
    }
  }

  async closeAll(): Promise<void> {
    const sessionIds = [...this.connections.keys()];
    await Promise.all(sessionIds.map(sessionId => this.disconnect(sessionId)));
  }

  private readIndex(database: DatabaseSync, row: SqliteIndexRow): SQLiteIndexInfo {
    const definitionRow = database.prepare(
      `SELECT substr(sql, 1, ${MAX_INDEX_DEFINITION_CHARACTERS + 1}) AS definition,
              length(sql) > ${MAX_INDEX_DEFINITION_CHARACTERS} AS definition_truncated
       FROM main.sqlite_schema
       WHERE type = 'index' AND name = ?`,
    ).get(row.name) as { definition?: SQLOutputValue; definition_truncated?: number } | undefined;
    const sourceDefinition = typeof definitionRow?.definition === 'string' ? definitionRow.definition : null;
    let definition = sourceDefinition ?? this.describeAutomaticIndex(database, row.name, row.origin, row.partial);
    const definitionTruncated = definitionRow?.definition_truncated === 1
      || definition.length > MAX_INDEX_DEFINITION_CHARACTERS;
    if (definition.length > MAX_INDEX_DEFINITION_CHARACTERS) {
      definition = definition.slice(0, MAX_INDEX_DEFINITION_CHARACTERS);
    }
    return {
      name: row.name,
      unique: row.is_unique === 1,
      primary: row.origin === 'pk',
      method: 'btree',
      valid: true,
      definition,
      definitionTruncated,
    };
  }

  private describeAutomaticIndex(database: DatabaseSync, name: string, origin: string, partial: number): string {
    const columns = database.prepare(
      `SELECT substr(name, 1, ${MAX_IDENTIFIER_CHARACTERS}) AS name
       FROM pragma_index_info(?)
       ORDER BY seqno
       LIMIT ?`,
    ).all(name, MAX_COLUMNS_PER_TABLE + 1) as Array<{ name: string | null }>;
    const names = columns.map(column => column.name ?? '(expression)').join(', ');
    const label = origin === 'pk' ? 'PRIMARY KEY' : 'AUTOMATIC INDEX';
    return `${label} (${names})${partial === 1 ? ' WHERE …' : ''}`;
  }
}

/** Validate a path that originated from the native file picker before it crosses the worker boundary. */
export function isValidSQLiteFilePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 32_768
    && !value.includes('\u0000')
    && isAbsolute(value);
}

export function isValidSQLiteIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_CHARACTERS
    && !value.includes('\u0000');
}
