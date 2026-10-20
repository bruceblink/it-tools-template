import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { basename, isAbsolute } from 'node:path';
import type {
  DatabaseAccessMode,
  DatabaseBridgeResult,
  DatabaseCellUpdateInput,
  DatabaseMutationKind,
  DatabaseQueryPage,
  DatabaseStatementResult,
  SQLiteColumnInfo,
  SQLiteIndexInfo,
  SQLiteSchemaInfo,
  SQLiteSessionInfo,
  SQLiteStructureInfo,
  SQLiteTableInfo,
  PostgresDataPage,
  PostgresDataPageInput,
} from '../../src/shared/desktop-services/database';
import { areValidQueryFieldNames, createBoundedQuerySql, createDatabaseQueryPage, MAX_QUERY_COLUMNS, MAX_QUERY_OFFSET } from './query-results';
import { normalizeDatabaseStatement, normalizeReadOnlySelectQuery, parseEditableSelectTarget } from './sql-query';
import { isEditableDatabaseColumnType, isValidCellUpdateInput } from './cell-edit';

const MAX_SQLITE_SESSIONS = 4;
const MAX_TABLES_PER_SCHEMA = 500;
const MAX_COLUMNS_PER_TABLE = 256;
const MAX_INDEXES_PER_TABLE = 64;
const MAX_IDENTIFIER_CHARACTERS = 256;
const MAX_TYPE_CHARACTERS = 256;
const MAX_DEFAULT_CHARACTERS = 512;
const MAX_INDEX_DEFINITION_CHARACTERS = 2_048;
const LOCK_WAIT_TIMEOUT_MILLISECONDS = 5_000;
const MAX_MUTATION_ROWS = 1_000;
const MAX_PREVIEW_ROWS = 25;
const MAX_CELL_CHARACTERS = 256;
const MAX_PAGE_OFFSET = 1_000_000;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SqliteConnection = {
  database: DatabaseSync;
  fileName: string;
  accessMode: DatabaseAccessMode;
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

/** Keeps SQLite access inside the isolated utility process and applies the selected file access mode. */
export class SQLiteDatabaseService {
  private readonly connections = new Map<string, SqliteConnection>();

  async connect(
    sessionId: string,
    filePath: string,
    accessMode: DatabaseAccessMode = 'read-only',
  ): Promise<DatabaseBridgeResult<SQLiteSessionInfo>> {
    if (!SESSION_ID_PATTERN.test(sessionId) || !isValidSQLiteFilePath(filePath)
      || (accessMode !== 'read-only' && accessMode !== 'read-write')) {
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
        readOnly: accessMode === 'read-only',
        timeout: LOCK_WAIT_TIMEOUT_MILLISECONDS,
        allowExtension: false,
        enableDoubleQuotedStringLiterals: false,
      });
      database.exec(`PRAGMA trusted_schema = OFF; PRAGMA query_only = ${accessMode === 'read-only' ? 'ON' : 'OFF'}; PRAGMA busy_timeout = ${LOCK_WAIT_TIMEOUT_MILLISECONDS};`);
      const versionRow = database.prepare('SELECT sqlite_version() AS version').get() as { version?: SQLOutputValue } | undefined;
      if (typeof versionRow?.version !== 'string' || versionRow.version.length > 64) {
        database.close();
        return { ok: false, error: 'connection-failed' };
      }

      const fileName = basename(filePath).slice(0, MAX_IDENTIFIER_CHARACTERS);
      this.connections.set(sessionId, { database, fileName, accessMode });
      return { ok: true, value: { sessionId, serverVersion: versionRow.version, fileName, accessMode } };
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

  /** Return a bounded, editable table page with hidden primary-key identity values. */
  async getDataPage(
    sessionId: string,
    schema: string,
    table: string,
    page: PostgresDataPageInput,
  ): Promise<DatabaseBridgeResult<PostgresDataPage>> {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      return { ok: false, error: 'not-connected' };
    }
    if (schema !== 'main' || !isValidSQLiteIdentifier(table) || !isValidTablePageRequest(page)) {
      return { ok: false, error: 'invalid-request' };
    }
    try {
      const tableRow = connection.database.prepare(
        `SELECT type FROM main.sqlite_schema WHERE name = ? AND type IN ('table', 'view')`,
      ).get(table) as { type?: string } | undefined;
      if (tableRow?.type !== 'table' && tableRow?.type !== 'view') {
        return { ok: false, error: 'invalid-request' };
      }
      const structure = await this.getStructure(sessionId, schema, table);
      if (!structure.ok) {
        return structure;
      }
      const columns = structure.value.columns.slice(0, MAX_QUERY_COLUMNS);
      const primaryKeys = structure.value.columns
        .filter(column => column.primaryKey)
        .sort((left, right) => (left.primaryKeyPosition ?? 0) - (right.primaryKeyPosition ?? 0));
      const alias = 'preview_row';
      const visibleSelects = columns.flatMap((column, index) => {
        const name = `${alias}.${quoteSQLiteIdentifier(column.name)}`;
        return [
          `CASE WHEN typeof(${name}) = 'blob' THEN '0x' || hex(substr(${name}, 1, ${MAX_CELL_CHARACTERS / 2})) ELSE substr(CAST(${name} AS TEXT), 1, ${MAX_CELL_CHARACTERS + 1}) END AS ${quoteSQLiteIdentifier(`cell_${index}`)}`,
          `CASE WHEN ${name} IS NULL THEN 0 WHEN typeof(${name}) = 'blob' THEN length(${name}) > ${MAX_CELL_CHARACTERS / 2} ELSE length(CAST(${name} AS TEXT)) > ${MAX_CELL_CHARACTERS} END AS ${quoteSQLiteIdentifier(`truncated_${index}`)}`,
        ];
      });
      const identityKeys = primaryKeys.length <= 32 ? primaryKeys : [];
      const identitySelects = identityKeys.map((key, index) =>
        `CASE WHEN typeof(${alias}.${quoteSQLiteIdentifier(key.name)}) = 'blob' THEN printf('%0257d', 0) ELSE substr(CAST(${alias}.${quoteSQLiteIdentifier(key.name)} AS TEXT), 1, ${MAX_CELL_CHARACTERS + 1}) END AS ${quoteSQLiteIdentifier(`__primary_key_${index}`)}`,
      );
      const orderBy = primaryKeys.length > 0
        ? `ORDER BY ${primaryKeys.map(key => `${alias}.${quoteSQLiteIdentifier(key.name)}`).join(', ')}`
        : '';
      const sql = `SELECT ${[...visibleSelects, ...identitySelects].join(', ')}
                   FROM main.${quoteSQLiteIdentifier(table)} AS ${alias}
                   ${orderBy}
                   LIMIT ? OFFSET ?`;
      const rawRows = connection.database.prepare(sql).all(MAX_PREVIEW_ROWS + 1, page.offset) as Array<Record<string, SQLOutputValue>>;
      const pageRows = rawRows.slice(0, MAX_PREVIEW_ROWS);
      const hasMoreRows = rawRows.length > MAX_PREVIEW_ROWS;
      const nextOffset = hasMoreRows && page.offset + MAX_PREVIEW_ROWS <= MAX_PAGE_OFFSET
        ? page.offset + MAX_PREVIEW_ROWS
        : null;
      return {
        ok: true,
        value: {
          columns: columns.map(column => ({ name: column.name, dataType: column.dataType })),
          rows: pageRows.map(row => {
            const rawPrimaryKeyValues = identityKeys.length > 0
              ? identityKeys.map((_key, index) => String(row[`__primary_key_${index}`] ?? ''))
              : null;
            const primaryKeyValuesTruncated = rawPrimaryKeyValues?.some(value => value.length > MAX_CELL_CHARACTERS) ?? false;
            return {
              cells: columns.map((_column, index) => ({
                value: row[`cell_${index}`] === null ? null : String(row[`cell_${index}`] ?? '').slice(0, MAX_CELL_CHARACTERS),
                truncated: row[`truncated_${index}`] === 1,
              })),
              primaryKeyValues: rawPrimaryKeyValues?.map(value => value.slice(0, MAX_CELL_CHARACTERS)) ?? null,
              primaryKeyValuesTruncated,
            };
          }),
          primaryKeyColumns: identityKeys.map(key => key.name),
          editable: connection.accessMode === 'read-write'
            && identityKeys.length > 0
            && identityKeys.every(key => isEditableDatabaseColumnType('sqlite', key.dataType)),
          columnsTruncated: structure.value.columnsTruncated || structure.value.columns.length > MAX_QUERY_COLUMNS,
          pagingMode: 'offset',
          pagingNotice: primaryKeys.length > 0 ? 'offset-paging' : 'no-primary-key',
          hasNext: nextOffset !== null,
          nextCursor: null,
          nextOffset,
          limitReached: hasMoreRows && nextOffset === null,
        },
      };
    }
    catch {
      return { ok: false, error: 'query-failed' };
    }
  }

  /** Update one cell only when its full primary key and original value still match. */
  async updateCell(sessionId: string, input: DatabaseCellUpdateInput): Promise<DatabaseBridgeResult<boolean>> {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      return { ok: false, error: 'not-connected' };
    }
    if (!isValidCellUpdateInput(input, 'sqlite') || input.schema !== 'main') {
      return { ok: false, error: 'invalid-request' };
    }
    if (connection.accessMode !== 'read-write') {
      return { ok: false, error: 'write-disabled' };
    }
    let tableRow: { type?: string } | undefined;
    try {
      tableRow = connection.database.prepare(
        `SELECT type FROM main.sqlite_schema WHERE name = ? AND type = 'table'`,
      ).get(input.table) as { type?: string } | undefined;
    }
    catch {
      return { ok: false, error: 'query-failed' };
    }
    if (tableRow?.type !== 'table') {
      return { ok: false, error: 'invalid-request' };
    }
    const structure = await this.getStructure(sessionId, input.schema, input.table);
    if (!structure.ok) {
      return structure;
    }
    const primaryKeys = structure.value.columns
      .filter(column => column.primaryKey)
      .sort((left, right) => (left.primaryKeyPosition ?? 0) - (right.primaryKeyPosition ?? 0));
    const targetColumn = structure.value.columns.find(column => column.name === input.column);
    if (!targetColumn
      || !isEditableDatabaseColumnType('sqlite', targetColumn.dataType)
      || primaryKeys.length !== input.primaryKeys.length
      || primaryKeys.some((key, index) => key.name !== input.primaryKeys[index]?.column)) {
      return { ok: false, error: 'invalid-request' };
    }
    let transactionStarted = false;
    let commitStarted = false;
    try {
      connection.database.exec('BEGIN IMMEDIATE');
      transactionStarted = true;
      const whereKeys = primaryKeys.map(key => `${quoteSQLiteIdentifier(key.name)} IS ?`);
      const result = connection.database.prepare(
        `UPDATE main.${quoteSQLiteIdentifier(input.table)}
         SET ${quoteSQLiteIdentifier(targetColumn.name)} = ?
         WHERE ${[...whereKeys, `${quoteSQLiteIdentifier(targetColumn.name)} IS ?`].join(' AND ')}`,
      ).run(input.newValue, ...input.primaryKeys.map(key => key.value), input.originalValue);
      const changedRows = typeof result.changes === 'bigint' ? Number(result.changes) : result.changes;
      if (changedRows === 0) {
        connection.database.exec('ROLLBACK');
        transactionStarted = false;
        return { ok: false, error: 'write-conflict' };
      }
      if (changedRows !== 1) {
        connection.database.exec('ROLLBACK');
        transactionStarted = false;
        return { ok: false, error: 'query-failed' };
      }
      commitStarted = true;
      connection.database.exec('COMMIT');
      transactionStarted = false;
      return { ok: true, value: true };
    }
    catch {
      if (transactionStarted) {
        try {
          connection.database.exec('ROLLBACK');
        }
        catch {
          // The transaction may already have ended after an I/O failure.
        }
      }
      return { ok: false, error: commitStarted ? 'write-result-unknown' : 'query-failed' };
    }
  }

  /** Execute one bounded SELECT or one confirmed DML statement in a transaction. */
  async executeStatement(
    sessionId: string,
    sql: string,
    offset: number,
  ): Promise<DatabaseBridgeResult<DatabaseStatementResult>> {
    const connection = this.connections.get(sessionId);
    const statement = normalizeDatabaseStatement(sql, 'sqlite');
    if (!connection) {
      return { ok: false, error: 'not-connected' };
    }
    if (!statement || !Number.isInteger(offset) || offset < 0 || offset > MAX_QUERY_OFFSET
      || (statement.kind !== 'select' && offset !== 0)) {
      return { ok: false, error: 'invalid-request' };
    }

    if (statement.kind === 'select') {
      const result = await this.executeReadOnlyQuery(sessionId, statement.sql, offset);
      return result.ok ? { ok: true, value: { kind: 'query', page: result.value } } : result;
    }
    if (connection.accessMode !== 'read-write') {
      return { ok: false, error: 'write-disabled' };
    }

    const startedAt = Date.now();
    let transactionStarted = false;
    let commitStarted = false;
    try {
      connection.database.exec('BEGIN IMMEDIATE');
      transactionStarted = true;
      const result = connection.database.prepare(statement.sql).run();
      const affectedRows = typeof result.changes === 'bigint' ? Number(result.changes) : result.changes;
      if (!Number.isSafeInteger(affectedRows) || affectedRows < 0) {
        connection.database.exec('ROLLBACK');
        transactionStarted = false;
        return { ok: false, error: 'query-failed' };
      }
      if (affectedRows > MAX_MUTATION_ROWS) {
        connection.database.exec('ROLLBACK');
        transactionStarted = false;
        return { ok: false, error: 'write-limit-exceeded' };
      }

      commitStarted = true;
      connection.database.exec('COMMIT');
      transactionStarted = false;
      return {
        ok: true,
        value: {
          kind: 'mutation',
          statement: statement.kind as DatabaseMutationKind,
          affectedRows,
          elapsedMilliseconds: Date.now() - startedAt,
        },
      };
    }
    catch {
      if (transactionStarted) {
        try {
          connection.database.exec('ROLLBACK');
        }
        catch {
          // The transaction may already have ended after an I/O failure.
        }
      }
      return { ok: false, error: commitStarted ? 'write-result-unknown' : 'query-failed' };
    }
  }

  /** Project bounded SELECT values while the SQLite handle stays inside the isolated service process. */
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
      const page = createDatabaseQueryPage(fieldNames, rawRows, offset, startedAt);
      const editableTarget = await this.getEditableSelectTarget(sessionId, query, fieldNames);
      if (editableTarget) {
        page.editableTarget = editableTarget;
      }
      return {
        ok: true,
        value: page,
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

  private async getEditableSelectTarget(
    sessionId: string,
    query: string,
    fieldNames: string[],
  ): Promise<NonNullable<DatabaseQueryPage['editableTarget']> | undefined> {
    const connection = this.connections.get(sessionId);
    if (!connection || connection.accessMode !== 'read-write') {
      return undefined;
    }
    const hint = parseEditableSelectTarget(query, 'sqlite');
    const schema = hint?.schema ?? 'main';
    if (!hint || schema !== 'main') {
      return undefined;
    }
    const tableRow = connection.database.prepare(
      `SELECT type FROM main.sqlite_schema WHERE name = ? AND type = 'table'`,
    ).get(hint.table) as { type?: string } | undefined;
    if (tableRow?.type !== 'table') {
      return undefined;
    }
    const structure = await this.getStructure(sessionId, schema, hint.table);
    if (!structure.ok) {
      return undefined;
    }
    const primaryKeys = structure.value.columns
      .filter(column => column.primaryKey)
      .sort((left, right) => (left.primaryKeyPosition ?? 0) - (right.primaryKeyPosition ?? 0));
    const expectedColumns = hint.columns[0] === '*' ? fieldNames : hint.columns;
    const namesMatch = expectedColumns.length === fieldNames.length
      && expectedColumns.every((name, index) => name === fieldNames[index]);
    const columns = structure.value.columns.filter(column => expectedColumns.includes(column.name));
    if (!namesMatch || primaryKeys.length === 0 || primaryKeys.length > 32
      || primaryKeys.some(key => !expectedColumns.includes(key.name))
      || primaryKeys.some(key => !isEditableDatabaseColumnType('sqlite', key.dataType))) {
      return undefined;
    }
    return {
      schema,
      table: hint.table,
      primaryKeyColumns: primaryKeys.map(key => key.name),
      editableColumns: columns.filter(column => isEditableDatabaseColumnType('sqlite', column.dataType)).map(column => column.name),
    };
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

function quoteSQLiteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function isValidTablePageRequest(value: unknown): value is PostgresDataPageInput {
  return isRecord(value)
    && hasExactKeys(value, ['cursor', 'offset'])
    && value.cursor === null
    && Number.isInteger(value.offset)
    && (value.offset as number) >= 0
    && (value.offset as number) <= MAX_PAGE_OFFSET
    && (value.offset as number) % MAX_PREVIEW_ROWS === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
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
