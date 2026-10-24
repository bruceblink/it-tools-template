import { createConnection, type Connection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import type {
  DatabaseAccessMode,
  DatabaseBatchMutationInput,
  DatabaseBatchMutationResult,
  DatabaseBridgeResult,
  DatabaseCellUpdateInput,
  DatabaseMutationKind,
  DatabaseQueryPage,
  DatabaseStatementResult,
  MySqlColumnInfo,
  MySqlConnectionInput,
  MySqlIndexInfo,
  MySqlSchemaInfo,
  MySqlSessionInfo,
  MySqlStructureInfo,
  MySqlTableInfo,
  PostgresDataPage,
  PostgresDataPageInput,
} from '../../src/shared/desktop-services/database';
import { areValidQueryFieldNames, createBoundedQuerySql, createDatabaseQueryPage, MAX_QUERY_COLUMNS, MAX_QUERY_OFFSET } from './query-results';
import { normalizeDatabaseStatement, normalizeReadOnlySelectQuery, parseEditableSelectTarget } from './sql-query';
import {
  isEditableDatabaseColumnType,
  isValidBatchMutationInput,
  isValidCellUpdateInput,
} from './cell-edit';
import { getPageFilters, getPageSort, isValidTablePageRequest as isValidGeneratedTablePageRequest } from './table-page-options';
import { buildTablePageFilterSql, buildTablePageSortSql } from './table-page-sql';

const MAX_MYSQL_SESSIONS = 4;
const MAX_SCHEMAS = 100;
const MAX_TABLES_PER_SCHEMA = 500;
const MAX_COLUMNS_PER_TABLE = 256;
const MAX_INDEXES_PER_TABLE = 64;
const MAX_INDEX_DEFINITION_CHARACTERS = 2_048;
const MAX_INDEX_GROUP_CONCAT_CHARACTERS = 8_192;
const CONNECTION_TIMEOUT_MILLISECONDS = 10_000;
const QUERY_TIMEOUT_MILLISECONDS = 10_000;
const LOCK_WAIT_TIMEOUT_SECONDS = 5;
const MAX_MUTATION_ROWS = 1_000;
const MAX_PREVIEW_ROWS = 25;
const MAX_CELL_CHARACTERS = 256;
const MAX_PAGE_OFFSET = 1_000_000;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SchemaRow = RowDataPacket & { name: string };
type TableRow = RowDataPacket & { name: string; table_type: 'BASE TABLE' | 'VIEW' };
type ColumnRow = RowDataPacket & {
  column_name: string;
  data_type: string;
  nullable: number | boolean;
  default_value: string | null;
  primary_key_position: number | null;
  ordinal_position: number;
};
type IndexRow = RowDataPacket & {
  index_name: string;
  is_unique: number | boolean;
  is_primary: number | boolean;
  method: string;
  definition: string;
  definition_truncated: number | boolean;
};

/** Runs only bounded metadata reads inside the isolated database utility process. */
export class MySqlDatabaseService {
  private readonly connections = new Map<string, Connection>();
  private readonly accessModes = new Map<string, DatabaseAccessMode>();
  private readonly defaultSchemas = new Map<string, string>();

  async connect(sessionId: string, input: MySqlConnectionInput): Promise<DatabaseBridgeResult<MySqlSessionInfo>> {
    if (!SESSION_ID_PATTERN.test(sessionId) || !isValidMySqlConnectionInput(input)) {
      return { ok: false, error: 'invalid-request' };
    }
    if (this.connections.has(sessionId)) {
      return { ok: false, error: 'invalid-request' };
    }
    if (this.connections.size >= MAX_MYSQL_SESSIONS) {
      return { ok: false, error: 'too-many-sessions' };
    }

    let connection: Connection | undefined;
    try {
      connection = await createConnection({
        host: input.host,
        port: input.port,
        user: input.username,
        password: input.password,
        database: input.database,
        connectTimeout: CONNECTION_TIMEOUT_MILLISECONDS,
        multipleStatements: false,
        charset: 'utf8mb4',
        ssl: input.tlsMode === 'verify' ? { rejectUnauthorized: true } : undefined,
      });
      const accessMode = input.accessMode ?? 'read-only';
      if (accessMode === 'read-only') {
        await connection.execute('SET SESSION TRANSACTION READ ONLY');
      }
      await connection.execute(`SET SESSION max_execution_time = ${QUERY_TIMEOUT_MILLISECONDS}`);
      await connection.execute(`SET SESSION lock_wait_timeout = ${LOCK_WAIT_TIMEOUT_SECONDS}`);
      await connection.execute(`SET SESSION group_concat_max_len = ${MAX_INDEX_GROUP_CONCAT_CHARACTERS}`);

      const [versionRows] = await connection.execute<(RowDataPacket & { server_version: string })[]>(
        'SELECT VERSION() AS server_version',
      );
      const serverVersion = versionRows[0]?.server_version;
      if (typeof serverVersion !== 'string' || serverVersion.length === 0 || serverVersion.length > 128) {
        await connection.end();
        return { ok: false, error: 'connection-failed' };
      }

      connection.on('error', () => this.removeConnection(sessionId, connection!));
      this.connections.set(sessionId, connection);
      this.accessModes.set(sessionId, accessMode);
      this.defaultSchemas.set(sessionId, input.database);
      return { ok: true, value: { sessionId, serverVersion, accessMode } };
    }
    catch {
      if (connection) {
        await connection.end().catch(() => undefined);
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
    this.removeConnection(sessionId, connection);
    try {
      await connection.end();
      return { ok: true, value: true };
    }
    catch {
      return { ok: false, error: 'query-failed' };
    }
  }

  async listSchemas(sessionId: string): Promise<DatabaseBridgeResult<MySqlSchemaInfo[]>> {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      return { ok: false, error: 'not-connected' };
    }

    try {
      const [rows] = await connection.execute<SchemaRow[]>(
        `SELECT SCHEMA_NAME AS name
         FROM information_schema.SCHEMATA
         WHERE SCHEMA_NAME NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
         ORDER BY SCHEMA_NAME
         LIMIT ?`,
        [MAX_SCHEMAS + 1],
      );
      return { ok: true, value: rows.slice(0, MAX_SCHEMAS).map(row => ({ name: row.name })) };
    }
    catch {
      return { ok: false, error: 'query-failed' };
    }
  }

  async listTables(sessionId: string, schema: string): Promise<DatabaseBridgeResult<MySqlTableInfo[]>> {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      return { ok: false, error: 'not-connected' };
    }
    if (!isValidMySqlIdentifier(schema)) {
      return { ok: false, error: 'invalid-request' };
    }

    try {
      const [rows] = await connection.execute<TableRow[]>(
        `SELECT TABLE_NAME AS name, TABLE_TYPE AS table_type
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
         ORDER BY TABLE_NAME
         LIMIT ?`,
        [schema, MAX_TABLES_PER_SCHEMA + 1],
      );
      return {
        ok: true,
        value: rows.slice(0, MAX_TABLES_PER_SCHEMA).map(row => ({
          name: row.name,
          kind: row.table_type === 'VIEW' ? 'view' : 'table',
        })),
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
  ): Promise<DatabaseBridgeResult<MySqlStructureInfo>> {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      return { ok: false, error: 'not-connected' };
    }
    if (!isValidMySqlIdentifier(schema) || !isValidMySqlIdentifier(table)) {
      return { ok: false, error: 'invalid-request' };
    }

    try {
      const [columnRows] = await connection.execute<ColumnRow[]>(
        `SELECT column_info.COLUMN_NAME AS column_name,
                LEFT(column_info.COLUMN_TYPE, 256) AS data_type,
                column_info.IS_NULLABLE = 'YES' AS nullable,
                LEFT(column_info.COLUMN_DEFAULT, 512) AS default_value,
                key_info.ORDINAL_POSITION AS primary_key_position,
                column_info.ORDINAL_POSITION AS ordinal_position
         FROM information_schema.COLUMNS AS column_info
         LEFT JOIN information_schema.KEY_COLUMN_USAGE AS key_info
           ON key_info.TABLE_SCHEMA = column_info.TABLE_SCHEMA
          AND key_info.TABLE_NAME = column_info.TABLE_NAME
          AND key_info.COLUMN_NAME = column_info.COLUMN_NAME
          AND key_info.CONSTRAINT_NAME = 'PRIMARY'
         WHERE column_info.TABLE_SCHEMA = ? AND column_info.TABLE_NAME = ?
         ORDER BY column_info.ORDINAL_POSITION
         LIMIT ?`,
        [schema, table, MAX_COLUMNS_PER_TABLE + 1],
      );
      const columns: MySqlColumnInfo[] = columnRows.slice(0, MAX_COLUMNS_PER_TABLE).map(row => ({
        name: row.column_name,
        dataType: row.data_type,
        nullable: row.nullable === true || row.nullable === 1,
        defaultValue: row.default_value,
        primaryKey: row.primary_key_position !== null,
        primaryKeyPosition: row.primary_key_position,
        ordinalPosition: row.ordinal_position,
      }));
      if (columns.length === 0) {
        return { ok: false, error: 'query-failed' };
      }

      const groupConcat = `GROUP_CONCAT(COALESCE(EXPRESSION, COLUMN_NAME) ORDER BY SEQ_IN_INDEX SEPARATOR ', ')`;
      const [indexRows] = await connection.execute<IndexRow[]>(
        `SELECT INDEX_NAME AS index_name,
                MIN(NON_UNIQUE) = 0 AS is_unique,
                INDEX_NAME = 'PRIMARY' AS is_primary,
                MAX(INDEX_TYPE) AS method,
                LEFT(${groupConcat}, ?) AS definition,
                CHAR_LENGTH(${groupConcat}) > ? AS definition_truncated
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         GROUP BY INDEX_NAME
         ORDER BY INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME
         LIMIT ?`,
        [MAX_INDEX_DEFINITION_CHARACTERS + 1, MAX_INDEX_DEFINITION_CHARACTERS, schema, table, MAX_INDEXES_PER_TABLE + 1],
      );
      const indexes: MySqlIndexInfo[] = indexRows.slice(0, MAX_INDEXES_PER_TABLE).map(row => ({
        name: row.index_name,
        unique: row.is_unique === true || row.is_unique === 1,
        primary: row.is_primary === true || row.is_primary === 1,
        method: row.method,
        valid: null,
        definition: row.definition.slice(0, MAX_INDEX_DEFINITION_CHARACTERS),
        definitionTruncated: row.definition_truncated === true || row.definition_truncated === 1,
      }));

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
    if (!isValidMySqlIdentifier(schema) || !isValidMySqlIdentifier(table) || !isValidTablePageRequest(page)) {
      return { ok: false, error: 'invalid-request' };
    }
    try {
      const [tableRows] = await connection.execute<(RowDataPacket & { table_type: string })[]>(
        'SELECT TABLE_TYPE AS table_type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [schema, table],
      );
      if (tableRows[0]?.table_type !== 'BASE TABLE' && tableRows[0]?.table_type !== 'VIEW') {
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
      const filters = getPageFilters(page);
      const sorts = getPageSort(page);
      const alias = '`preview_row`';
      const visibleSelects = columns.flatMap((column, index) => {
        const name = `${alias}.${quoteMySqlIdentifier(column.name)}`;
        const cast = `CAST(${name} AS CHAR)`;
        return [
          `LEFT(${cast}, ${MAX_CELL_CHARACTERS + 1}) AS ${quoteMySqlIdentifier(`cell_${index}`)}`,
          `CHAR_LENGTH(${cast}) > ${MAX_CELL_CHARACTERS} AS ${quoteMySqlIdentifier(`truncated_${index}`)}`,
        ];
      });
      const identityKeys = primaryKeys.length <= 32 ? primaryKeys : [];
      const identitySelects = identityKeys.map((key, index) =>
        `LEFT(CAST(${alias}.${quoteMySqlIdentifier(key.name)} AS CHAR), ${MAX_CELL_CHARACTERS + 1}) AS ${quoteMySqlIdentifier(`__primary_key_${index}`)}`,
      );
      const filterSql = buildTablePageFilterSql(
        filters,
        structure.value.columns,
        'mysql',
        alias,
        quoteMySqlIdentifier,
        1,
      );
      const sortSql = buildTablePageSortSql(sorts, structure.value.columns, 'mysql', alias, quoteMySqlIdentifier);
      if (!filterSql || sortSql === null) {
        return { ok: false, error: 'invalid-request' };
      }
      const whereSql = filterSql.clauses.length > 0 ? `WHERE ${filterSql.clauses.join(' AND ')}` : '';
      const requestedSortColumns = new Set(sorts.map(sort => sort.column.toLowerCase()));
      const tieBreakerExpressions = primaryKeys
        .filter(key => !requestedSortColumns.has(key.name.toLowerCase()))
        .map(key => `${alias}.${quoteMySqlIdentifier(key.name)}`);
      const orderExpressions = sortSql
        ? [sortSql, ...tieBreakerExpressions].join(', ')
        : primaryKeys.length > 0
          ? primaryKeys.map(key => `${alias}.${quoteMySqlIdentifier(key.name)}`).join(', ')
          : '';
      const orderBy = orderExpressions.length > 0 ? `ORDER BY ${orderExpressions}` : '';
      const sql = `SELECT ${[...visibleSelects, ...identitySelects].join(', ')}
                   FROM ${quoteMySqlIdentifier(schema)}.${quoteMySqlIdentifier(table)} AS ${alias}
                   ${whereSql}
                   ${orderBy}
                   LIMIT ? OFFSET ?`;
      const [rawRows] = await connection.execute<RowDataPacket[]>(sql, [...filterSql.values, MAX_PREVIEW_ROWS + 1, page.offset]);
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
                truncated: row[`truncated_${index}`] === true || row[`truncated_${index}`] === 1,
              })),
              primaryKeyValues: rawPrimaryKeyValues?.map(value => value.slice(0, MAX_CELL_CHARACTERS)) ?? null,
              primaryKeyValuesTruncated,
            };
          }),
          primaryKeyColumns: identityKeys.map(key => key.name),
          editable: (this.accessModes.get(sessionId) ?? 'read-only') === 'read-write'
            && identityKeys.length > 0
            && identityKeys.every(key => isEditableDatabaseColumnType('mysql', key.dataType)),
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

  /** Update a single cell with a transaction and an original-value conflict check. */
  async updateCell(sessionId: string, input: DatabaseCellUpdateInput): Promise<DatabaseBridgeResult<boolean>> {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      return { ok: false, error: 'not-connected' };
    }
    if (!isValidCellUpdateInput(input, 'mysql')) {
      return { ok: false, error: 'invalid-request' };
    }
    if ((this.accessModes.get(sessionId) ?? 'read-only') !== 'read-write') {
      return { ok: false, error: 'write-disabled' };
    }
    let tableRows: Array<RowDataPacket & { table_type: string }>;
    try {
      [tableRows] = await connection.execute<(RowDataPacket & { table_type: string })[]>(
        'SELECT TABLE_TYPE AS table_type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [input.schema, input.table],
      );
    }
    catch {
      return { ok: false, error: 'query-failed' };
    }
    if (tableRows[0]?.table_type !== 'BASE TABLE') {
      return { ok: false, error: 'invalid-request' };
    }
    const structure = await this.getStructure(sessionId, input.schema, input.table);
    if (!structure.ok) {
      return structure;
    }
    const primaryKeys = structure.value.columns
      .filter(column => column.primaryKey)
      .sort((left, right) => (left.primaryKeyPosition ?? 0) - (right.primaryKeyPosition ?? 0));
    const targetColumn = structure.value.columns.find(column => column.name.toLowerCase() === input.column.toLowerCase());
    if (!targetColumn
      || !isEditableDatabaseColumnType('mysql', targetColumn.dataType)
      || primaryKeys.length !== input.primaryKeys.length
      || primaryKeys.some((key, index) => key.name.toLowerCase() !== input.primaryKeys[index]?.column.toLowerCase())) {
      return { ok: false, error: 'invalid-request' };
    }
    let transactionStarted = false;
    let commitStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const whereKeys = primaryKeys.map((_key) => `${quoteMySqlIdentifier(_key.name)} = ?`);
      const keyValues = input.primaryKeys.map(key => key.value);
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE ${quoteMySqlIdentifier(input.schema)}.${quoteMySqlIdentifier(input.table)}
         SET ${quoteMySqlIdentifier(targetColumn.name)} = ?
         WHERE ${[...whereKeys, `${quoteMySqlIdentifier(targetColumn.name)} <=> ?`].join(' AND ')}`,
        [input.newValue, ...keyValues, input.originalValue],
      );
      if (result.affectedRows > 1) {
        await connection.rollback();
        transactionStarted = false;
        return { ok: false, error: 'query-failed' };
      }
      if (result.affectedRows === 0) {
        let matchedRows: RowDataPacket[] = [];
        if (input.originalValue === input.newValue) {
          [matchedRows] = await connection.execute<RowDataPacket[]>(
            `SELECT 1 AS matched FROM ${quoteMySqlIdentifier(input.schema)}.${quoteMySqlIdentifier(input.table)}
             WHERE ${[...whereKeys, `${quoteMySqlIdentifier(targetColumn.name)} <=> ?`].join(' AND ')} LIMIT 1`,
            [...keyValues, input.originalValue],
          );
        }
        if (matchedRows.length === 0) {
          await connection.rollback();
          transactionStarted = false;
          return { ok: false, error: 'write-conflict' };
        }
      }
      commitStarted = true;
      await connection.commit();
      transactionStarted = false;
      return { ok: true, value: true };
    }
    catch {
      if (transactionStarted) {
        await connection.rollback().catch(() => undefined);
      }
      return { ok: false, error: commitStarted ? 'write-result-unknown' : 'query-failed' };
    }
  }

  /** Apply bounded insert and conflict-checked delete drafts in one transaction. */
  async applyBatchMutation(
    sessionId: string,
    input: DatabaseBatchMutationInput,
  ): Promise<DatabaseBridgeResult<DatabaseBatchMutationResult>> {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      return { ok: false, error: 'not-connected' };
    }
    if (!isValidBatchMutationInput(input, 'mysql')) {
      return { ok: false, error: 'invalid-request' };
    }
    if ((this.accessModes.get(sessionId) ?? 'read-only') !== 'read-write') {
      return { ok: false, error: 'write-disabled' };
    }
    let tableRows: Array<RowDataPacket & { table_type: string }>;
    try {
      [tableRows] = await connection.execute<(RowDataPacket & { table_type: string })[]>(
        'SELECT TABLE_TYPE AS table_type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [input.schema, input.table],
      );
    }
    catch {
      return { ok: false, error: 'query-failed' };
    }
    if (tableRows[0]?.table_type !== 'BASE TABLE') {
      return { ok: false, error: 'invalid-request' };
    }
    const structure = await this.getStructure(sessionId, input.schema, input.table);
    if (!structure.ok) {
      return structure;
    }
    const columns = structure.value.columns;
    const primaryKeys = columns
      .filter(column => column.primaryKey)
      .sort((left, right) => (left.primaryKeyPosition ?? 0) - (right.primaryKeyPosition ?? 0));
    if (structure.value.columnsTruncated) {
      return { ok: false, error: 'invalid-request' };
    }
    if (input.deletes.length > 0 && primaryKeys.length === 0) {
      return { ok: false, error: 'invalid-request' };
    }
    const columnMap = new Map(columns.map(column => [column.name.toLowerCase(), column]));
    for (const row of input.inserts) {
      for (const value of row.values) {
        const column = columnMap.get(value.column.toLowerCase());
        if (!column || !isEditableDatabaseColumnType('mysql', column.dataType)) {
          return { ok: false, error: 'invalid-request' };
        }
      }
    }
    for (const row of input.deletes) {
      if (columns.some(column => !isEditableDatabaseColumnType('mysql', column.dataType))) {
        return { ok: false, error: 'invalid-request' };
      }
      if (row.primaryKeys.length !== primaryKeys.length
        || primaryKeys.some((key, index) => key.name.toLowerCase() !== row.primaryKeys[index]?.column.toLowerCase())
        || row.originalValues.length !== columns.length
        || columns.some((column, index) => column.name.toLowerCase() !== row.originalValues[index]?.column.toLowerCase())) {
        return { ok: false, error: 'invalid-request' };
      }
    }

    let transactionStarted = false;
    let commitStarted = false;
    const startedAt = Date.now();
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      let deletedRows = 0;
      for (const row of input.deletes) {
        const values: Array<string | null> = [];
        const predicates = primaryKeys.map((key, index) => {
          values.push(row.primaryKeys[index]!.value);
          return `${quoteMySqlIdentifier(key.name)} = ?`;
        });
        for (const original of row.originalValues) {
          values.push(original.value);
          predicates.push(`${quoteMySqlIdentifier(original.column)} <=> ?`);
        }
        const [result] = await connection.execute<ResultSetHeader>(
          `DELETE FROM ${quoteMySqlIdentifier(input.schema)}.${quoteMySqlIdentifier(input.table)}
           WHERE ${predicates.join(' AND ')}`,
          values,
        );
        if (result.affectedRows !== 1) {
          await connection.rollback();
          transactionStarted = false;
          return { ok: false, error: result.affectedRows === 0 ? 'write-conflict' : 'query-failed' };
        }
        deletedRows += 1;
      }

      let insertedRows = 0;
      for (const row of input.inserts) {
        const quotedTable = `${quoteMySqlIdentifier(input.schema)}.${quoteMySqlIdentifier(input.table)}`;
        let sql: string;
        let values: Array<string | null> = [];
        if (row.values.length === 0) {
          sql = `INSERT INTO ${quotedTable} () VALUES ()`;
        }
        else {
          sql = `INSERT INTO ${quotedTable} (${row.values.map(value => quoteMySqlIdentifier(value.column)).join(', ')}) VALUES (${row.values.map(() => '?').join(', ')})`;
          values = row.values.map(value => value.value);
        }
        const [result] = await connection.execute<ResultSetHeader>(sql, values);
        if (result.affectedRows !== 1) {
          await connection.rollback();
          transactionStarted = false;
          return { ok: false, error: 'query-failed' };
        }
        insertedRows += 1;
      }
      commitStarted = true;
      await connection.commit();
      transactionStarted = false;
      return { ok: true, value: { kind: 'batch-mutation', insertedRows, deletedRows, elapsedMilliseconds: Date.now() - startedAt } };
    }
    catch {
      if (transactionStarted) {
        await connection.rollback().catch(() => undefined);
      }
      return { ok: false, error: commitStarted ? 'write-result-unknown' : 'query-failed' };
    }
  }

  /** Execute one bounded SELECT or one confirmed DML statement in a transaction. */
  async executeStatement(
    sessionId: string,
    sql: string,
    offset: number,
    _queryRequestId?: string,
  ): Promise<DatabaseBridgeResult<DatabaseStatementResult>> {
    const connection = this.connections.get(sessionId);
    const statement = normalizeDatabaseStatement(sql, 'mysql');
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
    if ((this.accessModes.get(sessionId) ?? 'read-only') !== 'read-write') {
      return { ok: false, error: 'write-disabled' };
    }

    const startedAt = Date.now();
    let transactionStarted = false;
    let commitStarted = false;
    let timedOut = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const timeout = setTimeout(() => {
        timedOut = true;
        this.removeConnection(sessionId, connection);
        connection.destroy();
      }, QUERY_TIMEOUT_MILLISECONDS);
      let result: ResultSetHeader;
      try {
        [result] = await connection.execute<ResultSetHeader>(statement.sql);
      }
      finally {
        clearTimeout(timeout);
      }
      if (timedOut) {
        return { ok: false, error: 'query-timeout' };
      }
      if (!Number.isSafeInteger(result.affectedRows) || result.affectedRows < 0) {
        await connection.rollback();
        transactionStarted = false;
        return { ok: false, error: 'query-failed' };
      }
      if (result.affectedRows > MAX_MUTATION_ROWS) {
        await connection.rollback();
        transactionStarted = false;
        return { ok: false, error: 'write-limit-exceeded' };
      }

      commitStarted = true;
      await connection.commit();
      transactionStarted = false;
      return {
        ok: true,
        value: {
          kind: 'mutation',
          statement: statement.kind as DatabaseMutationKind,
          affectedRows: result.affectedRows,
          elapsedMilliseconds: Date.now() - startedAt,
        },
      };
    }
    catch {
      if (transactionStarted) {
        await connection.rollback().catch(() => undefined);
      }
      return { ok: false, error: commitStarted ? 'write-result-unknown' : timedOut ? 'query-timeout' : 'query-failed' };
    }
  }

  /** MySQL query cancellation is not exposed by this bounded adapter yet. */
  async cancelQuery(sessionId: string, _requestId: string): Promise<DatabaseBridgeResult<boolean>> {
    if (!this.connections.has(sessionId)) {
      return { ok: false, error: 'not-connected' };
    }
    return { ok: true, value: false };
  }

  /** Bound every returned SELECT value before it reaches mysql2. */
  async executeReadOnlyQuery(
    sessionId: string,
    sql: string,
    offset: number,
  ): Promise<DatabaseBridgeResult<DatabaseQueryPage>> {
    const connection = this.connections.get(sessionId);
    const query = normalizeReadOnlySelectQuery(sql, 'mysql');
    if (!connection) {
      return { ok: false, error: 'not-connected' };
    }
    if (!query || !Number.isInteger(offset) || offset < 0 || offset > MAX_QUERY_OFFSET) {
      return { ok: false, error: 'invalid-request' };
    }

    const startedAt = Date.now();
    try {
      const [, metadataFields] = await connection.query(`SELECT * FROM (\n${query}\n) AS \`__it_tools_metadata\` LIMIT 0`);
      const fieldNames = metadataFields.map(field => field.name);
      if (!areValidQueryFieldNames(fieldNames, 'mysql')) {
        return { ok: false, error: 'query-failed' };
      }

      const [resultRows] = await connection.query<RowDataPacket[]>(createBoundedQuerySql('mysql', query, fieldNames, offset));
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

  private removeConnection(sessionId: string, connection: Connection): void {
    if (this.connections.get(sessionId) === connection) {
      this.connections.delete(sessionId);
      this.accessModes.delete(sessionId);
      this.defaultSchemas.delete(sessionId);
    }
  }

  private async getEditableSelectTarget(
    sessionId: string,
    query: string,
    fieldNames: string[],
  ): Promise<NonNullable<DatabaseQueryPage['editableTarget']> | undefined> {
    if ((this.accessModes.get(sessionId) ?? 'read-only') !== 'read-write') {
      return undefined;
    }
    const hint = parseEditableSelectTarget(query, 'mysql');
    const connection = this.connections.get(sessionId);
    const schema = hint?.schema ?? this.defaultSchemas.get(sessionId);
    if (!hint || !connection || !schema) {
      return undefined;
    }
    const [tableRows] = await connection.execute<(RowDataPacket & { table_type: string })[]>(
      'SELECT TABLE_TYPE AS table_type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [schema, hint.table],
    );
    if (tableRows[0]?.table_type !== 'BASE TABLE') {
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
      && expectedColumns.every((name, index) => name.toLowerCase() === fieldNames[index]?.toLowerCase());
    const columns = structure.value.columns.filter(column => expectedColumns.some(name => name.toLowerCase() === column.name.toLowerCase()));
    if (!namesMatch || primaryKeys.length === 0 || primaryKeys.length > 32
      || primaryKeys.some(key => !expectedColumns.some(name => name.toLowerCase() === key.name.toLowerCase()))
      || primaryKeys.some(key => !isEditableDatabaseColumnType('mysql', key.dataType))) {
      return undefined;
    }
    return {
      schema,
      table: hint.table,
      primaryKeyColumns: primaryKeys.map(key => key.name),
      editableColumns: columns.filter(column => isEditableDatabaseColumnType('mysql', column.dataType)).map(column => column.name),
    };
  }
}

function quoteMySqlIdentifier(value: string): string {
  return `\`${value.replaceAll('`', '``')}\``;
}

function isValidTablePageRequest(value: unknown): value is PostgresDataPageInput {
  return isValidGeneratedTablePageRequest(value, isValidMySqlIdentifier, false);
}

/** Validate the complete credential record before handing it to the MySQL driver. */
export function isValidMySqlConnectionInput(value: unknown): value is MySqlConnectionInput {
  return isRecord(value)
    && (hasExactKeys(value, ['host', 'port', 'database', 'username', 'password', 'tlsMode'])
      || hasExactKeys(value, ['host', 'port', 'database', 'username', 'password', 'tlsMode', 'accessMode']))
    && typeof value.host === 'string'
    && value.host.trim().length > 0
    && value.host.length <= 253
    && Number.isInteger(value.port)
    && typeof value.port === 'number'
    && value.port >= 1
    && value.port <= 65_535
    && isValidMySqlIdentifier(value.database)
    && typeof value.username === 'string'
    && value.username.length > 0
    && value.username.length <= 128
    && typeof value.password === 'string'
    && value.password.length <= 4_096
    && (value.tlsMode === 'verify' || value.tlsMode === 'disable')
    && (value.accessMode === undefined || value.accessMode === 'read-only' || value.accessMode === 'read-write');
}

export function isValidMySqlIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && !value.includes('\u0000');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}
