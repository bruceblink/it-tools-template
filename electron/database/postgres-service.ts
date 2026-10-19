import { Client, type ClientConfig } from 'pg';
import type {
  DatabaseBridgeResult,
  PostgresColumnInfo,
  PostgresConnectionInput,
  PostgresSchemaInfo,
  PostgresSessionInfo,
  PostgresStructureInfo,
  PostgresTableInfo,
} from '../../src/shared/desktop-services/database';

const MAX_POSTGRES_SESSIONS = 4;
const MAX_SCHEMAS = 100;
const MAX_TABLES_PER_SCHEMA = 500;
const MAX_COLUMNS_PER_TABLE = 256;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Owns only PostgreSQL clients and metadata queries inside the isolated database utility process. */
export class PostgresDatabaseService {
  private readonly clients = new Map<string, Client>();

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

    const client = new Client(createClientConfig(input));
    try {
      await client.connect();
      await client.query('SET default_transaction_read_only = on');
      await client.query("SET statement_timeout = '15000ms'");
      await client.query("SET lock_timeout = '5000ms'");
      await client.query("SET idle_in_transaction_session_timeout = '10000ms'");
      const version = await client.query<{ server_version: string }>(
        'SELECT current_setting(\'server_version\') AS server_version',
      );
      const serverVersion = version.rows[0]?.server_version;
      if (!serverVersion) {
        await client.end();
        return { ok: false, error: 'connection-failed' };
      }

      client.on('error', () => this.clients.delete(sessionId));
      this.clients.set(sessionId, client);
      return { ok: true, value: { sessionId, serverVersion } };
    }
    catch (error) {
      await client.end().catch(() => undefined);
      return { ok: false, error: classifyPostgresError(error, 'connection-failed') };
    }
  }

  async disconnect(sessionId: string): Promise<DatabaseBridgeResult<boolean>> {
    const client = this.clients.get(sessionId);
    if (!client) {
      return { ok: true, value: false };
    }

    this.clients.delete(sessionId);
    try {
      await client.end();
      return { ok: true, value: true };
    }
    catch {
      return { ok: false, error: 'query-failed' };
    }
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
        primary_key: boolean;
        ordinal_position: number;
      }>(
        `SELECT column_info.column_name,
                column_info.data_type,
                column_info.is_nullable = 'YES' AS nullable,
                left(column_info.column_default, 512) AS default_value,
                column_info.ordinal_position::integer AS ordinal_position,
                EXISTS (
                  SELECT 1
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
                ) AS primary_key
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
        primaryKey: row.primary_key,
        ordinalPosition: row.ordinal_position,
      }));
      if (columns.length === 0) {
        return { ok: false, error: 'query-failed' };
      }
      return {
        ok: true,
        value: { columns, columnsTruncated: result.rows.length > MAX_COLUMNS_PER_TABLE },
      };
    }
    catch (error) {
      return { ok: false, error: classifyPostgresError(error, 'query-failed') };
    }
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.clients.keys()];
    await Promise.all(sessions.map(sessionId => this.disconnect(sessionId)));
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

function classifyPostgresError(error: unknown, fallback: 'connection-failed' | 'query-failed') {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === '57014' || error.code === 'ETIMEDOUT') {
      return 'query-timeout' as const;
    }
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}
