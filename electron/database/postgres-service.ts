import { Client, type ClientConfig } from 'pg';
import type {
  DatabaseBridgeResult,
  PostgresColumnInfo,
  PostgresConnectionInput,
  PostgresDataPage,
  PostgresDataPageInput,
  PostgresSchemaInfo,
  PostgresSessionInfo,
  PostgresStructureInfo,
  PostgresTableInfo,
} from '../../src/shared/desktop-services/database';

const MAX_POSTGRES_SESSIONS = 4;
const MAX_SCHEMAS = 100;
const MAX_TABLES_PER_SCHEMA = 500;
const MAX_COLUMNS_PER_TABLE = 256;
const MAX_INDEXES_PER_TABLE = 64;
const MAX_INDEX_DEFINITION_CHARACTERS = 2_048;
const MAX_PREVIEW_COLUMNS = 16;
const MAX_PREVIEW_ROWS = 25;
const MAX_CELL_CHARACTERS = 256;
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
  private readonly activePageRequests = new Map<string, ActivePostgresPageRequest>();

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
      await client.query('SET default_transaction_read_only = on');
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
      return { ok: true, value: { sessionId, serverVersion } };
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
      const pagingMode: PostgresDataPage['pagingMode'] = isKeysetSupported(primaryKeys) ? 'keyset' : 'offset';
      const pagingNotice: PostgresDataPage['pagingNotice'] = primaryKeys.length === 0
        ? 'no-primary-key'
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
      const primaryKeyExpressions = primaryKeys.map(key => `${rowAlias}.${quotePostgresIdentifier(key.column_name)}`);
      const keysetSelect = pagingMode === 'keyset'
        ? `, json_build_object(${primaryKeys.map((key, index) => `${quotePostgresString(key.column_name)}, ${primaryKeyExpressions[index]}`).join(', ')})::text AS "__cursor"`
        : '';
      const keysetJoin = page.cursor === null
        ? ''
        : `CROSS JOIN LATERAL json_populate_record(NULL::${quotedRelation}, $1::json) AS cursor_row`;
      const keysetWhere = page.cursor === null
        ? ''
        : `WHERE ROW(${primaryKeyExpressions.join(', ')}) > ROW(${primaryKeys.map(key => `cursor_row.${quotePostgresIdentifier(key.column_name)}`).join(', ')})`;
      const orderBy = pagingMode === 'keyset'
        ? `ORDER BY ${primaryKeyExpressions.join(', ')}`
        : '';
      const limitParameter = page.cursor === null ? '$1' : '$2';
      const pagination = pagingMode === 'keyset'
        ? `LIMIT ${limitParameter}`
        : 'LIMIT $2 OFFSET $1';
      const sql = `SELECT ${selectedCells.join(', ')}${keysetSelect}
                   FROM ${quotedRelation} AS ${rowAlias}
                   ${keysetJoin}
                   ${keysetWhere}
                   ${orderBy}
                   ${pagination}`;
      const parameters = pagingMode === 'keyset'
        ? page.cursor === null ? [MAX_PREVIEW_ROWS + 1] : [page.cursor, MAX_PREVIEW_ROWS + 1]
        : [page.offset, MAX_PREVIEW_ROWS + 1];
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
          rows: pageRows.map(row => ({
            cells: columns.map((_column, index) => toBoundedCell(row[`cell_${index}`])),
          })),
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

  private removeSessionClient(sessionId: string, client: Client): void {
    if (this.clients.get(sessionId) !== client) {
      return;
    }
    this.clients.delete(sessionId);
    this.clientConfigs.delete(sessionId);
    this.backendProcessIds.delete(sessionId);
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
  if (!isRecord(value) || !hasExactKeys(value, ['host', 'port', 'database', 'username', 'password', 'tlsMode'])) {
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
    && (value.tlsMode === 'verify' || value.tlsMode === 'disable');
}

export function isValidDatabaseIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 63 && !value.includes('\u0000');
}

/** Reject oversized offsets and malformed cursors before they reach the database driver. */
export function isValidPostgresPageRequest(value: unknown): value is PostgresDataPageInput {
  if (!isRecord(value)
    || !hasExactKeys(value, ['cursor', 'offset'])
    || !Number.isInteger(value.offset)
    || (value.offset as number) < 0
    || (value.offset as number) > MAX_PAGE_OFFSET
    || (value.offset as number) % MAX_PREVIEW_ROWS !== 0) {
    return false;
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
