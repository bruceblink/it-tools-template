import { createConnection, type Connection, type RowDataPacket } from 'mysql2/promise';
import type {
  DatabaseBridgeResult,
  DatabaseQueryPage,
  MySqlColumnInfo,
  MySqlConnectionInput,
  MySqlIndexInfo,
  MySqlSchemaInfo,
  MySqlSessionInfo,
  MySqlStructureInfo,
  MySqlTableInfo,
} from '../../src/shared/desktop-services/database';
import { areValidQueryFieldNames, createBoundedQuerySql, createDatabaseQueryPage, MAX_QUERY_COLUMNS, MAX_QUERY_OFFSET } from './query-results';
import { normalizeReadOnlySelectQuery } from './sql-query';

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
      await connection.execute('SET SESSION TRANSACTION READ ONLY');
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
      return { ok: true, value: { sessionId, serverVersion } };
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

  /** Use the server-side read-only session to bound every returned value before it reaches mysql2. */
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

  private removeConnection(sessionId: string, connection: Connection): void {
    if (this.connections.get(sessionId) === connection) {
      this.connections.delete(sessionId);
    }
  }
}

/** Validate the complete credential record before handing it to the MySQL driver. */
export function isValidMySqlConnectionInput(value: unknown): value is MySqlConnectionInput {
  return isRecord(value)
    && hasExactKeys(value, ['host', 'port', 'database', 'username', 'password', 'tlsMode'])
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
    && (value.tlsMode === 'verify' || value.tlsMode === 'disable');
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
