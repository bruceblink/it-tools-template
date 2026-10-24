import { Client, type ClientConfig } from 'pg';
import type {
  DatabaseBatchMutationInput,
  DatabaseBatchMutationResult,
  DatabaseBridgeResult,
  DatabaseAccessMode,
  DatabaseCellUpdateInput,
  DatabaseMutationKind,
  DatabaseQueryPage,
  DatabaseStatementResult,
  PostgresColumnInfo,
  PostgresConnectionInput,
  PostgresDataPage,
  PostgresDataPageInput,
  PostgresSchemaInfo,
  PostgresSessionInfo,
  PostgresStructureInfo,
  PostgresTableInfo,
} from '../../src/shared/desktop-services/database';
import { areValidQueryFieldNames, createBoundedQuerySql, createDatabaseQueryPage, MAX_QUERY_OFFSET } from './query-results';
import { normalizeDatabaseStatement, normalizeReadOnlySelectQuery, parseEditableSelectTarget } from './sql-query';
import {
  isEditableDatabaseColumnType,
  isValidBatchMutationInput,
  isValidCellUpdateInput,
} from './cell-edit';
import { getPageFilters, getPageSort, isValidTablePageRequest as isValidGeneratedTablePageRequest } from './table-page-options';
import { buildTablePageFilterSql, buildTablePageSortSql } from './table-page-sql';

const MAX_POSTGRES_SESSIONS = 4;
const MAX_SCHEMAS = 100;
const MAX_TABLES_PER_SCHEMA = 500;
const MAX_COLUMNS_PER_TABLE = 256;
const MAX_INDEXES_PER_TABLE = 64;
const MAX_INDEX_DEFINITION_CHARACTERS = 2_048;
const MAX_PREVIEW_COLUMNS = 16;
const MAX_PREVIEW_ROWS = 25;
const MAX_CELL_CHARACTERS = 256;
const MAX_MUTATION_ROWS = 1_000;
const MAX_PAGE_OFFSET = 1_000_000;
const MAX_CURSOR_CHARACTERS = 4_096;
const MAX_PRIMARY_KEY_COLUMNS = 32;
const KEYSET_PRIMARY_KEY_TYPES = new Set([
  'smallint',
  'integer',
  'bigint',
  'uuid',
  'boolean',
  'date',
  'time without time zone',
  'time with time zone',
  'timestamp without time zone',
  'timestamp with time zone',
]);
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = SESSION_ID_PATTERN;

interface ActivePostgresPageRequest {
  requestId: string;
  client: Client | null;
  cancelRequested: boolean;
  closeAfterOperation: boolean;
  cancelPromise: Promise<DatabaseBridgeResult<boolean>> | null;
}

/** Owns only PostgreSQL clients and metadata queries inside the isolated database utility process. */
export class PostgresDatabaseService {
  private readonly clients = new Map<string, Client>();
  private readonly clientConfigs = new Map<string, ClientConfig>();
  private readonly backendProcessIds = new Map<string, number>();
  private readonly accessModes = new Map<string, DatabaseAccessMode>();
  private readonly activePageRequests = new Map<string, ActivePostgresPageRequest>();
  private readonly activeQueryRequests = new Map<string, ActivePostgresPageRequest>();

  async connect(sessionId: string, input: PostgresConnectionInput): Promise<DatabaseBridgeResult<PostgresSessionInfo>> {
    if (!SESSION_ID_PATTERN.test(sessionId) || !isValidPostgresConnectionInput(input)) {
      return { ok: false, error: 'invalid-request' };
    }
    if (this.clients.has(sessionId)) {
      return { ok: false, error: 'invalid-request' };
    }
    if (this.clients.size >= MAX_POSTGRES_SESSIONS) {
      return { ok: false, error: 'too-many-sessions' };
    }

    const clientConfig = createClientConfig(input);
    const client = new Client(clientConfig);
    try {
      await client.connect();
      const accessMode = input.accessMode ?? 'read-only';
      await client.query(`SET default_transaction_read_only = ${accessMode === 'read-only' ? 'on' : 'off'}`);
      await client.query("SET statement_timeout = '15000ms'");
      await client.query("SET lock_timeout = '5000ms'");
      await client.query("SET idle_in_transaction_session_timeout = '10000ms'");
      const version = await client.query<{ server_version: string; backend_pid: number }>(
        'SELECT current_setting(\'server_version\') AS server_version, pg_backend_pid()::integer AS backend_pid',
      );
      const serverVersion = version.rows[0]?.server_version;
      const backendPid = version.rows[0]?.backend_pid;
      if (!serverVersion || !Number.isInteger(backendPid) || backendPid <= 0) {
        await client.end();
        return { ok: false, error: 'connection-failed' };
      }

      client.on('error', () => this.removeSessionClient(sessionId, client));
      this.clients.set(sessionId, client);
      this.clientConfigs.set(sessionId, clientConfig);
      this.backendProcessIds.set(sessionId, backendPid);
      this.accessModes.set(sessionId, accessMode);
      return { ok: true, value: { sessionId, serverVersion, accessMode } };
    }
    catch (error) {
      await client.end().catch(() => undefined);
      return { ok: false, error: classifyPostgresError(error, 'connection-failed') };
    }
  }

  async disconnect(sessionId: string): Promise<DatabaseBridgeResult<boolean>> {
    const activePage = this.activePageRequests.get(sessionId);
    if (activePage) {
      await this.cancelDataPage(sessionId, activePage.requestId);
    }
    const activeQuery = this.activeQueryRequests.get(sessionId);
    if (activeQuery) {
      await this.cancelQuery(sessionId, activeQuery.requestId);
    }
    const client = this.clients.get(sessionId);
    if (!client) {
      return { ok: true, value: false };
    }

    this.removeSessionClient(sessionId, client);
    try {
      await client.end();
      return { ok: true, value: true };
    }
    catch {
      return { ok: false, error: 'query-failed' };
    }
  }

  /** Cancel only the page request that owns this session and preserve its connection on success. */
  async cancelDataPage(
    sessionId: string,
    requestId: string,
  ): Promise<DatabaseBridgeResult<boolean>> {
    if (!SESSION_ID_PATTERN.test(sessionId) || !REQUEST_ID_PATTERN.test(requestId)) {
      return { ok: false, error: 'invalid-request' };
    }
    const activePage = this.activePageRequests.get(sessionId);
    if (!activePage || activePage.requestId !== requestId) {
      return { ok: true, value: false };
    }

    activePage.cancelRequested = true;
    if (!activePage.client) {
      return { ok: true, value: true };
    }
    if (!activePage.cancelPromise) {
      activePage.cancelPromise = this.sendPageCancellation(sessionId, activePage);
    }
    return activePage.cancelPromise;
  }

  /** Cancel one SQL request and preserve the connection when PostgreSQL confirms it. */
  async cancelQuery(sessionId: string, requestId: string): Promise<DatabaseBridgeResult<boolean>> {
    if (!SESSION_ID_PATTERN.test(sessionId) || !REQUEST_ID_PATTERN.test(requestId)) {
      return { ok: false, error: 'invalid-request' };
    }
    const activeQuery = this.activeQueryRequests.get(sessionId);
    if (!activeQuery || activeQuery.requestId !== requestId) {
      return { ok: true, value: false };
    }

    activeQuery.cancelRequested = true;
    if (!activeQuery.client) {
      return { ok: true, value: true };
    }
    if (!activeQuery.cancelPromise) {
      activeQuery.cancelPromise = this.sendPageCancellation(sessionId, activeQuery);
    }
    return activeQuery.cancelPromise;
  }

  async listSchemas(sessionId: string): Promise<DatabaseBridgeResult<PostgresSchemaInfo[]>> {
    const client = this.clients.get(sessionId);
    if (!client) {
      return { ok: false, error: 'not-connected' };
    }

    try {
      const result = await client.query<{ schema_name: string }>(
        `SELECT schema_name
         FROM information_schema.schemata
         WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
           AND schema_name NOT LIKE 'pg_toast%'
         ORDER BY schema_name
         LIMIT $1`,
        [MAX_SCHEMAS + 1],
      );
      return {
        ok: true,
        value: result.rows.slice(0, MAX_SCHEMAS).map(row => ({ name: row.schema_name })),
      };
    }
    catch (error) {
      return { ok: false, error: classifyPostgresError(error, 'query-failed') };
    }
  }

  async listTables(sessionId: string, schema: string): Promise<DatabaseBridgeResult<PostgresTableInfo[]>> {
    const client = this.clients.get(sessionId);
    if (!client) {
      return { ok: false, error: 'not-connected' };
    }
    if (!isValidDatabaseIdentifier(schema)) {
      return { ok: false, error: 'invalid-request' };
    }

    try {
      const result = await client.query<{ table_name: string; table_type: 'BASE TABLE' | 'VIEW' }>(
        `SELECT table_name, table_type
         FROM information_schema.tables
         WHERE table_schema = $1 AND table_type IN ('BASE TABLE', 'VIEW')
         ORDER BY table_name
         LIMIT $2`,
        [schema, MAX_TABLES_PER_SCHEMA + 1],
      );
      return {
        ok: true,
        value: result.rows.slice(0, MAX_TABLES_PER_SCHEMA).map(row => ({
          name: row.table_name,
          kind: row.table_type === 'VIEW' ? 'view' : 'table',
        })),
      };
    }
    catch (error) {
      return { ok: false, error: classifyPostgresError(error, 'query-failed') };
    }
  }

  async getStructure(
    sessionId: string,
    schema: string,
    table: string,
  ): Promise<DatabaseBridgeResult<PostgresStructureInfo>> {
    const client = this.clients.get(sessionId);
    if (!client) {
      return { ok: false, error: 'not-connected' };
    }
    if (!isValidDatabaseIdentifier(schema) || !isValidDatabaseIdentifier(table)) {
      return { ok: false, error: 'invalid-request' };
    }

    try {
      const result = await client.query<{
        column_name: string;
        data_type: string;
        nullable: boolean;
        default_value: string | null;
        primary_key_position: number | null;
        ordinal_position: number;
      }>(
        `SELECT column_info.column_name,
                column_info.data_type,
                column_info.is_nullable = 'YES' AS nullable,
                left(column_info.column_default, 512) AS default_value,
                column_info.ordinal_position::integer AS ordinal_position,
                (
                  SELECT key_column.ordinal_position::integer
                  FROM information_schema.table_constraints AS constraint_info
                  JOIN information_schema.key_column_usage AS key_column
                    ON key_column.constraint_catalog = constraint_info.constraint_catalog
                   AND key_column.constraint_schema = constraint_info.constraint_schema
                   AND key_column.constraint_name = constraint_info.constraint_name
                   AND key_column.table_schema = constraint_info.table_schema
                   AND key_column.table_name = constraint_info.table_name
                  WHERE constraint_info.constraint_type = 'PRIMARY KEY'
                    AND constraint_info.table_schema = column_info.table_schema
                    AND constraint_info.table_name = column_info.table_name
                    AND key_column.column_name = column_info.column_name
                  ORDER BY key_column.ordinal_position
                  LIMIT 1
                ) AS primary_key_position
         FROM information_schema.columns AS column_info
         WHERE column_info.table_schema = $1 AND column_info.table_name = $2
         ORDER BY column_info.ordinal_position
         LIMIT $3`,
        [schema, table, MAX_COLUMNS_PER_TABLE + 1],
      );
      const columns: PostgresColumnInfo[] = result.rows.slice(0, MAX_COLUMNS_PER_TABLE).map(row => ({
        name: row.column_name,
        dataType: row.data_type,
        nullable: row.nullable,
        defaultValue: row.default_value,
        primaryKey: row.primary_key_position !== null,
        primaryKeyPosition: row.primary_key_position,
        ordinalPosition: row.ordinal_position,
      }));
      if (columns.length === 0) {
        return { ok: false, error: 'query-failed' };
      }

      const indexResult = await client.query<{
        index_name: string;
        is_unique: boolean;
        is_primary: boolean;
        method: string;
        is_valid: boolean;
        definition: string;
        definition_truncated: boolean;
      }>(
        `SELECT index_class.relname AS index_name,
                index_info.indisunique AS is_unique,
                index_info.indisprimary AS is_primary,
                access_method.amname AS method,
                index_info.indisvalid AS is_valid,
                left(index_text.definition, $4::integer) AS definition,
                char_length(index_text.definition) > $4::integer AS definition_truncated
         FROM pg_catalog.pg_index AS index_info
         JOIN pg_catalog.pg_class AS table_class
           ON table_class.oid = index_info.indrelid
         JOIN pg_catalog.pg_namespace AS table_namespace
           ON table_namespace.oid = table_class.relnamespace
         JOIN pg_catalog.pg_class AS index_class
           ON index_class.oid = index_info.indexrelid
         JOIN pg_catalog.pg_am AS access_method
           ON access_method.oid = index_class.relam
         CROSS JOIN LATERAL (
           SELECT pg_catalog.pg_get_indexdef(index_info.indexrelid) AS definition
         ) AS index_text
         WHERE table_namespace.nspname = $1
           AND table_class.relname = $2
           AND index_info.indislive
         ORDER BY index_info.indisprimary DESC, index_class.relname
         LIMIT $3::integer`,
        [schema, table, MAX_INDEXES_PER_TABLE + 1, MAX_INDEX_DEFINITION_CHARACTERS],
      );
      const indexes = indexResult.rows.slice(0, MAX_INDEXES_PER_TABLE).map(row => ({
        name: row.index_name,
        unique: row.is_unique,
        primary: row.is_primary,
        method: row.method,
        valid: row.is_valid,
        definition: row.definition,
        definitionTruncated: row.definition_truncated,
      }));

      return {
        ok: true,
        value: {
          columns,
          columnsTruncated: result.rows.length > MAX_COLUMNS_PER_TABLE,
          indexes,
          indexesTruncated: indexResult.rows.length > MAX_INDEXES_PER_TABLE,
        },
      };
    }
    catch (error) {
      return { ok: false, error: classifyPostgresError(error, 'query-failed') };
    }
  }

  /** Return a read-only preview with bounded columns, rows and text per cell. */
  async getDataPage(
    sessionId: string,
    schema: string,
    table: string,
    page: PostgresDataPageInput,
    requestId: string,
  ): Promise<DatabaseBridgeResult<PostgresDataPage>> {
    const client = this.clients.get(sessionId);
    if (!client) {
      return { ok: false, error: 'not-connected' };
    }
    if (!isValidDatabaseIdentifier(schema)
      || !isValidDatabaseIdentifier(table)
      || !isValidPostgresPageRequest(page)
      || !REQUEST_ID_PATTERN.test(requestId)
      || this.activePageRequests.has(sessionId)) {
      return { ok: false, error: 'invalid-request' };
    }

    const activePage: ActivePostgresPageRequest = {
      requestId,
      client,
      cancelRequested: false,
      closeAfterOperation: false,
      cancelPromise: null,
    };
    this.activePageRequests.set(sessionId, activePage);
    try {
      if (activePage.cancelRequested) {
        return { ok: false, error: 'query-timeout' };
      }
      const columnResult = await client.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position
         LIMIT $3`,
        [schema, table, MAX_PREVIEW_COLUMNS + 1],
      );
      if (activePage.cancelRequested) {
        return { ok: false, error: 'query-timeout' };
      }
      const primaryKeyResult = await client.query<{ column_name: string; data_type: string; key_position: number }>(
        `SELECT column_info.column_name,
                column_info.data_type,
                key_column.ordinal_position::integer AS key_position
         FROM information_schema.table_constraints AS constraint_info
         JOIN information_schema.key_column_usage AS key_column
           ON key_column.constraint_catalog = constraint_info.constraint_catalog
          AND key_column.constraint_schema = constraint_info.constraint_schema
          AND key_column.constraint_name = constraint_info.constraint_name
          AND key_column.table_schema = constraint_info.table_schema
          AND key_column.table_name = constraint_info.table_name
         JOIN information_schema.columns AS column_info
           ON column_info.table_schema = key_column.table_schema
          AND column_info.table_name = key_column.table_name
          AND column_info.column_name = key_column.column_name
         WHERE constraint_info.constraint_type = 'PRIMARY KEY'
           AND constraint_info.table_schema = $1
           AND constraint_info.table_name = $2
         ORDER BY key_column.ordinal_position
         LIMIT $3`,
        [schema, table, MAX_PRIMARY_KEY_COLUMNS + 1],
      );
      if (activePage.cancelRequested) {
        return { ok: false, error: 'query-timeout' };
      }
      const columns = columnResult.rows.slice(0, MAX_PREVIEW_COLUMNS);
      if (columns.length === 0) {
        return { ok: false, error: 'query-failed' };
      }

      const primaryKeys = primaryKeyResult.rows;
      const filters = getPageFilters(page);
      const sorts = getPageSort(page);
      const hasCustomPageOptions = filters.length > 0 || sorts.length > 0;
      const pagingMode: PostgresDataPage['pagingMode'] = !hasCustomPageOptions && isKeysetSupported(primaryKeys) ? 'keyset' : 'offset';
      const pagingNotice: PostgresDataPage['pagingNotice'] = primaryKeys.length === 0
        ? 'no-primary-key'
        : hasCustomPageOptions
          ? 'offset-paging'
          : pagingMode === 'offset' ? 'unsupported-primary-key' : null;
      if ((pagingMode === 'keyset' && (page.offset !== 0
        || (page.cursor !== null && !isValidKeysetCursor(page.cursor, primaryKeys.map(key => key.column_name)))))
        || (pagingMode === 'offset' && page.cursor !== null)) {
        return { ok: false, error: 'invalid-request' };
      }

      const quotedRelation = `${quotePostgresIdentifier(schema)}.${quotePostgresIdentifier(table)}`;
      const rowAlias = 'preview_row';
      const selectedCells = columns.map((column, index) =>
        `left(${rowAlias}.${quotePostgresIdentifier(column.column_name)}::text, ${MAX_CELL_CHARACTERS + 1}) AS ${quotePostgresIdentifier(`cell_${index}`)}`,
      );
      const identityKeys = primaryKeys.length <= MAX_PRIMARY_KEY_COLUMNS ? primaryKeys : [];
      const hiddenIdentity = identityKeys.map((key, index) =>
        `left(${rowAlias}.${quotePostgresIdentifier(key.column_name)}::text, ${MAX_CELL_CHARACTERS + 1}) AS ${quotePostgresIdentifier(`__primary_key_${index}`)}`,
      );
      const primaryKeyExpressions = primaryKeys.map(key => `${rowAlias}.${quotePostgresIdentifier(key.column_name)}`);
      const pageColumns = columnResult.rows.map(column => ({ name: column.column_name, dataType: column.data_type }));
      const filterSql = buildTablePageFilterSql(
        filters,
        pageColumns,
        'postgres',
        rowAlias,
        quotePostgresIdentifier,
        1,
      );
      const sortSql = buildTablePageSortSql(sorts, pageColumns, 'postgres', rowAlias, quotePostgresIdentifier);
      if (!filterSql || sortSql === null) {
        return { ok: false, error: 'invalid-request' };
      }
      const keysetSelect = pagingMode === 'keyset'
        ? `, json_build_object(${primaryKeys.map((key, index) => `${quotePostgresString(key.column_name)}, ${primaryKeyExpressions[index]}`).join(', ')})::text AS "__cursor"`
        : '';
      const keysetJoin = page.cursor === null
        ? ''
        : `CROSS JOIN LATERAL json_populate_record(NULL::${quotedRelation}, $1::json) AS cursor_row`;
      const whereClauses = [...filterSql.clauses];
      if (page.cursor !== null) {
        whereClauses.push(`ROW(${primaryKeyExpressions.join(', ')}) > ROW(${primaryKeys.map(key => `cursor_row.${quotePostgresIdentifier(key.column_name)}`).join(', ')})`);
      }
      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const requestedSortColumns = new Set(sorts.map(sort => sort.column));
      const tieBreakerExpressions = primaryKeys
        .filter(key => !requestedSortColumns.has(key.column_name))
        .map(key => `${rowAlias}.${quotePostgresIdentifier(key.column_name)}`);
      const orderExpressions = sortSql
        ? [sortSql, ...tieBreakerExpressions].join(', ')
        : primaryKeys.length > 0 ? primaryKeyExpressions.join(', ') : '';
      const orderBy = orderExpressions.length > 0 ? `ORDER BY ${orderExpressions}` : '';
      const limitParameter = page.cursor === null ? '$1' : '$2';
      const pagination = pagingMode === 'keyset'
        ? `LIMIT ${limitParameter}`
        : `LIMIT $${filterSql.values.length + 1} OFFSET $${filterSql.values.length + 2}`;
      const hiddenSelects = [...(keysetSelect ? [keysetSelect.slice(2)] : []), ...hiddenIdentity];
      const sql = `SELECT ${selectedCells.join(', ')}${hiddenSelects.length > 0 ? `, ${hiddenSelects.join(', ')}` : ''}
                   FROM ${quotedRelation} AS ${rowAlias}
                   ${keysetJoin}
                   ${whereSql}
                   ${orderBy}
                   ${pagination}`;
      const parameters = pagingMode === 'keyset'
        ? page.cursor === null ? [MAX_PREVIEW_ROWS + 1] : [page.cursor, MAX_PREVIEW_ROWS + 1]
        : [...filterSql.values, MAX_PREVIEW_ROWS + 1, page.offset];
      const result = await client.query<Record<string, unknown>>(sql, parameters);
      if (activePage.cancelRequested) {
        return { ok: false, error: 'query-timeout' };
      }
      const pageRows = result.rows.slice(0, MAX_PREVIEW_ROWS);
      const hasMoreRows = result.rows.length > MAX_PREVIEW_ROWS;
      const nextOffset = pagingMode === 'offset' && hasMoreRows && page.offset + MAX_PREVIEW_ROWS <= MAX_PAGE_OFFSET
        ? page.offset + MAX_PREVIEW_ROWS
        : null;
      const limitReached = pagingMode === 'offset' && hasMoreRows && nextOffset === null;
      const hasNext = pagingMode === 'keyset' ? hasMoreRows : nextOffset !== null;
      const cursorValue = pageRows.at(-1)?.__cursor;
      const nextCursor = pagingMode === 'keyset' && hasNext && typeof cursorValue === 'string' ? cursorValue : null;
      if (pagingMode === 'keyset' && hasNext && (!nextCursor || !isValidKeysetCursor(nextCursor, primaryKeys.map(key => key.column_name)))) {
        return { ok: false, error: 'query-failed' };
      }

      return {
        ok: true,
        value: {
          columns: columns.map(({ column_name, data_type }) => ({ name: column_name, dataType: data_type })),
          rows: pageRows.map((row) => {
            const rawPrimaryKeyValues = identityKeys.length > 0
              ? identityKeys.map((_key, index) => typeof row[`__primary_key_${index}`] === 'string' ? row[`__primary_key_${index}`] as string : '')
              : null;
            const primaryKeyValuesTruncated = rawPrimaryKeyValues?.some(value => Array.from(value).length > MAX_CELL_CHARACTERS) ?? false;
            return {
              cells: columns.map((_column, index) => toBoundedCell(row[`cell_${index}`])),
              primaryKeyValues: rawPrimaryKeyValues?.map(value => Array.from(value).slice(0, MAX_CELL_CHARACTERS).join('')) ?? null,
              primaryKeyValuesTruncated,
            };
          }),
          primaryKeyColumns: identityKeys.map(key => key.column_name),
          editable: (this.accessModes.get(sessionId) ?? 'read-only') === 'read-write'
            && identityKeys.length > 0
            && identityKeys.every(key => isEditableDatabaseColumnType('postgres', key.data_type)),
          columnsTruncated: columnResult.rows.length > MAX_PREVIEW_COLUMNS,
          pagingMode,
          pagingNotice,
          hasNext,
          nextCursor,
          nextOffset,
          limitReached,
        },
      };
    }
    catch (error) {
      if (activePage.closeAfterOperation) {
        return { ok: false, error: 'service-unavailable' };
      }
      return { ok: false, error: classifyPostgresError(error, 'query-failed') };
    }
    finally {
      if (activePage.cancelPromise) {
        await activePage.cancelPromise;
      }
      if (this.activePageRequests.get(sessionId) === activePage) {
        this.activePageRequests.delete(sessionId);
      }
    }
  }

  /** Update one cell only when its full primary key and original value still match. */
  async updateCell(
    sessionId: string,
    input: DatabaseCellUpdateInput,
  ): Promise<DatabaseBridgeResult<boolean>> {
    const client = this.clients.get(sessionId);
    if (!client) {
      return { ok: false, error: 'not-connected' };
    }
    if (!isValidCellUpdateInput(input, 'postgres')) {
      return { ok: false, error: 'invalid-request' };
    }
    if ((this.accessModes.get(sessionId) ?? 'read-only') !== 'read-write') {
      return { ok: false, error: 'write-disabled' };
    }

    const tableType = await client.query<{ table_type: string }>(
      'SELECT table_type FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
      [input.schema, input.table],
    ).catch(() => null);
    if (tableType?.rows[0]?.table_type !== 'BASE TABLE') {
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
      || !isEditableDatabaseColumnType('postgres', targetColumn.dataType)
      || primaryKeys.length !== input.primaryKeys.length
      || primaryKeys.some((key, index) => key.name !== input.primaryKeys[index]?.column)) {
      return { ok: false, error: 'invalid-request' };
    }

    let transactionStarted = false;
    let commitStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;
      const values: Array<string | null> = [input.newValue];
      const keyPredicates = primaryKeys.map((key, index) => {
        values.push(input.primaryKeys[index]!.value);
        return `${quotePostgresIdentifier(key.name)} IS NOT DISTINCT FROM $${values.length}`;
      });
      values.push(input.originalValue);
      const result = await client.query(
        `UPDATE ${quotePostgresIdentifier(input.schema)}.${quotePostgresIdentifier(input.table)}
         SET ${quotePostgresIdentifier(input.column)} = $1
         WHERE ${keyPredicates.join(' AND ')}
           AND ${quotePostgresIdentifier(input.column)} IS NOT DISTINCT FROM $${values.length}`,
        values,
      );
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return { ok: false, error: 'write-conflict' };
      }
      if (result.rowCount !== 1) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return { ok: false, error: 'query-failed' };
      }
      commitStarted = true;
      await client.query('COMMIT');
      transactionStarted = false;
      return { ok: true, value: true };
    }
    catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      return { ok: false, error: commitStarted ? 'write-result-unknown' : classifyPostgresError(error, 'query-failed') };
    }
  }

  /** Apply bounded insert and conflict-checked delete drafts in one transaction. */
  async applyBatchMutation(
    sessionId: string,
    input: DatabaseBatchMutationInput,
  ): Promise<DatabaseBridgeResult<DatabaseBatchMutationResult>> {
    const client = this.clients.get(sessionId);
    if (!client) {
      return { ok: false, error: 'not-connected' };
    }
    if (!isValidBatchMutationInput(input, 'postgres')) {
      return { ok: false, error: 'invalid-request' };
    }
    if ((this.accessModes.get(sessionId) ?? 'read-only') !== 'read-write') {
      return { ok: false, error: 'write-disabled' };
    }
    const tableType = await client.query<{ table_type: string }>(
      'SELECT table_type FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
      [input.schema, input.table],
    ).catch(() => null);
    if (tableType?.rows[0]?.table_type !== 'BASE TABLE') {
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
    if (structure.value.columnsTruncated || columns.some(column => !isEditableDatabaseColumnType('postgres', column.dataType))) {
      return { ok: false, error: 'invalid-request' };
    }
    if (input.deletes.length > 0 && primaryKeys.length === 0) {
      return { ok: false, error: 'invalid-request' };
    }
    const columnMap = new Map(columns.map(column => [column.name, column]));
    for (const row of input.inserts) {
      for (const value of row.values) {
        const column = columnMap.get(value.column);
        if (!column || !isEditableDatabaseColumnType('postgres', column.dataType)) {
          return { ok: false, error: 'invalid-request' };
        }
      }
    }
    for (const row of input.deletes) {
      if (row.primaryKeys.length !== primaryKeys.length
        || primaryKeys.some((key, index) => key.name !== row.primaryKeys[index]?.column)
        || row.originalValues.length !== columns.length
        || columns.some((column, index) => row.originalValues[index]?.column !== column.name)) {
        return { ok: false, error: 'invalid-request' };
      }
    }

    let transactionStarted = false;
    let commitStarted = false;
    const startedAt = Date.now();
    try {
      await client.query('BEGIN');
      transactionStarted = true;
      let deletedRows = 0;
      for (const row of input.deletes) {
        const values: Array<string | null> = [];
        const predicates = primaryKeys.map((key, index) => {
          values.push(row.primaryKeys[index]!.value);
          return `${quotePostgresIdentifier(key.name)} IS NOT DISTINCT FROM $${values.length}`;
        });
        for (const original of row.originalValues) {
          values.push(original.value);
          predicates.push(`${quotePostgresIdentifier(original.column)} IS NOT DISTINCT FROM $${values.length}`);
        }
        const result = await client.query(
          `DELETE FROM ${quotePostgresIdentifier(input.schema)}.${quotePostgresIdentifier(input.table)}
           WHERE ${predicates.join(' AND ')}`,
          values,
        );
        if (result.rowCount !== 1) {
          await client.query('ROLLBACK');
          transactionStarted = false;
          return { ok: false, error: result.rowCount === 0 ? 'write-conflict' : 'query-failed' };
        }
        deletedRows += 1;
      }

      let insertedRows = 0;
      for (const row of input.inserts) {
        const quotedTable = `${quotePostgresIdentifier(input.schema)}.${quotePostgresIdentifier(input.table)}`;
        let text: string;
        let values: Array<string | null> = [];
        if (row.values.length === 0) {
          text = `INSERT INTO ${quotedTable} DEFAULT VALUES`;
        }
        else {
          const quotedColumns = row.values.map(value => quotePostgresIdentifier(value.column)).join(', ');
          values = row.values.map(value => value.value);
          text = `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${values.map((_value, index) => `$${index + 1}`).join(', ')})`;
        }
        const result = await client.query(text, values);
        if (result.rowCount !== 1) {
          await client.query('ROLLBACK');
          transactionStarted = false;
          return { ok: false, error: 'query-failed' };
        }
        insertedRows += 1;
      }
      commitStarted = true;
      await client.query('COMMIT');
      transactionStarted = false;
      return { ok: true, value: { kind: 'batch-mutation', insertedRows, deletedRows, elapsedMilliseconds: Date.now() - startedAt } };
    }
    catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      return { ok: false, error: commitStarted ? 'write-result-unknown' : classifyPostgresError(error, 'query-failed') };
    }
  }

  /** Execute one bounded SELECT or one confirmed DML statement in a transaction. */
  async executeStatement(
    sessionId: string,
    sql: string,
    offset: number,
    queryRequestId?: string,
  ): Promise<DatabaseBridgeResult<DatabaseStatementResult>> {
    const client = this.clients.get(sessionId);
    const statement = normalizeDatabaseStatement(sql, 'postgres');
    if (!client) {
      return { ok: false, error: 'not-connected' };
    }
    if ((queryRequestId !== undefined && !REQUEST_ID_PATTERN.test(queryRequestId))
      || !statement || !Number.isInteger(offset) || offset < 0 || offset > MAX_QUERY_OFFSET
      || (statement.kind !== 'select' && offset !== 0)) {
      return { ok: false, error: 'invalid-request' };
    }

    if (statement.kind === 'select') {
      const result = await this.executeReadOnlyQuery(sessionId, statement.sql, offset, queryRequestId);
      return result.ok ? { ok: true, value: { kind: 'query', page: result.value } } : result;
    }
    if ((this.accessModes.get(sessionId) ?? 'read-only') !== 'read-write') {
      return { ok: false, error: 'write-disabled' };
    }

    const activeQuery = queryRequestId ? this.startQueryRequest(sessionId, queryRequestId, client) : null;
    if (queryRequestId && !activeQuery) {
      return { ok: false, error: 'query-failed' };
    }
    const startedAt = Date.now();
    let transactionStarted = false;
    let commitStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;
      const result = await client.query(statement.sql);
      const affectedRows = result.rowCount;
      if (!Number.isSafeInteger(affectedRows) || affectedRows! < 0) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return { ok: false, error: 'query-failed' };
      }
      if (affectedRows! > MAX_MUTATION_ROWS) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return { ok: false, error: 'write-limit-exceeded' };
      }

      commitStarted = true;
      await client.query('COMMIT');
      transactionStarted = false;
      return {
        ok: true,
        value: {
          kind: 'mutation',
          statement: statement.kind as DatabaseMutationKind,
          affectedRows: affectedRows!,
          elapsedMilliseconds: Date.now() - startedAt,
        },
      };
    }
    catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      if (activeQuery?.closeAfterOperation) {
        return { ok: false, error: 'service-unavailable' };
      }
      return { ok: false, error: commitStarted ? 'write-result-unknown' : classifyPostgresError(error, 'query-failed') };
    }
    finally {
      if (activeQuery?.cancelPromise) {
        await activeQuery.cancelPromise;
      }
      if (activeQuery && this.activeQueryRequests.get(sessionId) === activeQuery) {
        this.activeQueryRequests.delete(sessionId);
      }
    }
  }

  /** Execute one read query and bound returned columns, rows, and cells in SQL. */
  async executeReadOnlyQuery(
    sessionId: string,
    sql: string,
    offset: number,
    queryRequestId?: string,
  ): Promise<DatabaseBridgeResult<DatabaseQueryPage>> {
    const client = this.clients.get(sessionId);
    const query = normalizeReadOnlySelectQuery(sql, 'postgres');
    if (!client) {
      return { ok: false, error: 'not-connected' };
    }
    if ((queryRequestId !== undefined && !REQUEST_ID_PATTERN.test(queryRequestId))
      || !query || !Number.isInteger(offset) || offset < 0 || offset > MAX_QUERY_OFFSET) {
      return { ok: false, error: 'invalid-request' };
    }

    const activeQuery = queryRequestId ? this.startQueryRequest(sessionId, queryRequestId, client) : null;
    if (queryRequestId && !activeQuery) {
      return { ok: false, error: 'query-failed' };
    }

    const startedAt = Date.now();
    try {
      const metadata = await client.query({
        text: `SELECT * FROM (\n${query}\n) AS "__it_tools_metadata" LIMIT 0`,
      });
      const fieldNames = metadata.fields.map(field => field.name);
      if (!areValidQueryFieldNames(fieldNames, 'postgres')) {
        return { ok: false, error: 'query-failed' };
      }

      const result = await client.query<unknown[]>({
        text: createBoundedQuerySql('postgres', query, fieldNames, offset),
        rowMode: 'array',
      });
      const page = createDatabaseQueryPage(fieldNames, result.rows, offset, startedAt);
      const editableTarget = await this.getEditableSelectTarget(sessionId, query, fieldNames);
      if (editableTarget) {
        page.editableTarget = editableTarget;
      }
      return {
        ok: true,
        value: page,
      };
    }
    catch (error) {
      if (activeQuery?.closeAfterOperation) {
        return { ok: false, error: 'service-unavailable' };
      }
      return { ok: false, error: classifyPostgresError(error, 'query-failed') };
    }
    finally {
      if (activeQuery?.cancelPromise) {
        await activeQuery.cancelPromise;
      }
      if (activeQuery && this.activeQueryRequests.get(sessionId) === activeQuery) {
        this.activeQueryRequests.delete(sessionId);
      }
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
    const hint = parseEditableSelectTarget(query, 'postgres');
    if (!hint) {
      return undefined;
    }
    const client = this.clients.get(sessionId);
    if (!client) {
      return undefined;
    }
    const schema = hint.schema ?? (await client.query<{ schema_name: string }>('SELECT current_schema() AS schema_name'))
      .rows[0]?.schema_name;
    if (!schema) {
      return undefined;
    }
    const tableType = await client.query<{ table_type: string }>(
      'SELECT table_type FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
      [schema, hint.table],
    );
    if (tableType.rows[0]?.table_type !== 'BASE TABLE') {
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
    if (!namesMatch || primaryKeys.length === 0 || primaryKeys.length > MAX_PRIMARY_KEY_COLUMNS
      || primaryKeys.some(key => !expectedColumns.includes(key.name))
      || primaryKeys.some(key => !isEditableDatabaseColumnType('postgres', key.dataType))) {
      return undefined;
    }
    return {
      schema,
      table: hint.table,
      primaryKeyColumns: primaryKeys.map(key => key.name),
      editableColumns: columns.filter(column => isEditableDatabaseColumnType('postgres', column.dataType)).map(column => column.name),
    };
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.clients.keys()];
    await Promise.all(sessions.map(sessionId => this.disconnect(sessionId)));
  }

  private async sendPageCancellation(
    sessionId: string,
    activePage: ActivePostgresPageRequest,
  ): Promise<DatabaseBridgeResult<boolean>> {
    const client = activePage.client;
    const clientConfig = this.clientConfigs.get(sessionId);
    const backendPid = this.backendProcessIds.get(sessionId);
    if (!client || !clientConfig || backendPid === undefined) {
      activePage.closeAfterOperation = true;
      if (client) {
        this.removeSessionClient(sessionId, client);
        void client.end().catch(() => undefined);
      }
      return { ok: false, error: 'service-unavailable' };
    }

    const cancelClient = new Client({
      ...clientConfig,
      application_name: 'IT Tools Desktop Cancel',
      connectionTimeoutMillis: 2_000,
      query_timeout: 2_000,
      statement_timeout: 2_000,
      lock_timeout: 1_000,
    });
    try {
      await cancelClient.connect();
      const result = await cancelClient.query<{ cancelled: boolean }>(
        'SELECT pg_cancel_backend($1::integer) AS cancelled',
        [backendPid],
      );
      if (result.rows[0]?.cancelled !== true) {
        activePage.closeAfterOperation = true;
        this.removeSessionClient(sessionId, client);
        void client.end().catch(() => undefined);
        return { ok: false, error: 'service-unavailable' };
      }
      return { ok: true, value: true };
    }
    catch {
      activePage.closeAfterOperation = true;
      this.removeSessionClient(sessionId, client);
      void client.end().catch(() => undefined);
      return { ok: false, error: 'service-unavailable' };
    }
    finally {
      await cancelClient.end().catch(() => undefined);
    }
  }

  private startQueryRequest(sessionId: string, requestId: string, client: Client): ActivePostgresPageRequest | null {
    if (this.activeQueryRequests.has(sessionId)) {
      return null;
    }
    const activeQuery: ActivePostgresPageRequest = {
      requestId,
      client,
      cancelRequested: false,
      closeAfterOperation: false,
      cancelPromise: null,
    };
    this.activeQueryRequests.set(sessionId, activeQuery);
    return activeQuery;
  }

  private removeSessionClient(sessionId: string, client: Client): void {
    if (this.clients.get(sessionId) !== client) {
      return;
    }
    this.clients.delete(sessionId);
    this.clientConfigs.delete(sessionId);
    this.backendProcessIds.delete(sessionId);
    this.accessModes.delete(sessionId);
  }
}

function createClientConfig(input: PostgresConnectionInput): ClientConfig {
  return {
    host: input.host,
    port: input.port,
    database: input.database,
    user: input.username,
    password: input.password,
    ssl: input.tlsMode === 'verify' ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
    statement_timeout: 15_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 10_000,
    application_name: 'IT Tools Desktop',
  };
}

export function isValidPostgresConnectionInput(value: unknown): value is PostgresConnectionInput {
  if (!isRecord(value)
    || !hasExactKeys(value, ['host', 'port', 'database', 'username', 'password', 'tlsMode'])
      && !hasExactKeys(value, ['host', 'port', 'database', 'username', 'password', 'tlsMode', 'accessMode'])) {
    return false;
  }

  return typeof value.host === 'string'
    && value.host.trim().length > 0
    && value.host === value.host.trim()
    && value.host.length <= 253
    && typeof value.port === 'number'
    && Number.isInteger(value.port)
    && value.port >= 1
    && value.port <= 65_535
    && typeof value.database === 'string'
    && value.database.length > 0
    && value.database.length <= 63
    && typeof value.username === 'string'
    && value.username.length > 0
    && value.username.length <= 128
    && typeof value.password === 'string'
    && value.password.length <= 4096
    && (value.tlsMode === 'verify' || value.tlsMode === 'disable')
    && (value.accessMode === undefined || value.accessMode === 'read-only' || value.accessMode === 'read-write');
}

export function isValidDatabaseIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 63 && !value.includes('\u0000');
}

/** Reject oversized offsets and malformed cursors before they reach the database driver. */
export function isValidPostgresPageRequest(value: unknown): value is PostgresDataPageInput {
  if (!isValidGeneratedTablePageRequest(value, isValidDatabaseIdentifier, true)) {
    return false;
  }
  const filters = getPageFilters(value);
  const sort = getPageSort(value);
  if (filters.length > 0 || sort.length > 0) {
    return value.cursor === null;
  }
  if (value.cursor === null) {
    return true;
  }
  return value.offset === 0 && typeof value.cursor === 'string' && isValidKeysetCursor(value.cursor);
}

/** Quote catalog identifiers as SQL names; row values remain bound parameters. */
export function quotePostgresIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quotePostgresString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function classifyPostgresError(error: unknown, fallback: 'connection-failed' | 'query-failed') {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === '57014' || error.code === 'ETIMEDOUT') {
      return 'query-timeout' as const;
    }
  }
  return fallback;
}

function isValidKeysetCursor(cursor: string, expectedKeyNames?: readonly string[]): boolean {
  if (cursor.length === 0 || cursor.length > MAX_CURSOR_CHARACTERS) {
    return false;
  }
  try {
    const value: unknown = JSON.parse(cursor);
    if (!isRecord(value)) {
      return false;
    }
    const keys = Object.keys(value);
    if (keys.length === 0 || keys.length > MAX_PRIMARY_KEY_COLUMNS
      || (expectedKeyNames !== undefined && keys.length !== expectedKeyNames.length)) {
      return false;
    }
    return keys.every((key, index) => {
      const item = value[key];
      return isValidDatabaseIdentifier(key)
        && (expectedKeyNames === undefined || key === expectedKeyNames[index])
        && item !== null
        && (typeof item === 'string' ? item.length <= 128 : typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)));
    });
  }
  catch {
    return false;
  }
}

function isKeysetSupported(primaryKeys: readonly { data_type: string }[]): boolean {
  return primaryKeys.length > 0
    && primaryKeys.length <= MAX_PRIMARY_KEY_COLUMNS
    && primaryKeys.every(key => KEYSET_PRIMARY_KEY_TYPES.has(key.data_type));
}

function toBoundedCell(value: unknown): { value: string | null; truncated: boolean } {
  if (value === null || value === undefined) {
    return { value: null, truncated: false };
  }
  if (typeof value !== 'string') {
    throw new TypeError('The PostgreSQL preview returned a non-text cell.');
  }
  const characters = Array.from(value);
  return {
    value: characters.slice(0, MAX_CELL_CHARACTERS).join(''),
    truncated: characters.length > MAX_CELL_CHARACTERS,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}
