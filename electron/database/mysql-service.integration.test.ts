import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MySqlDatabaseService } from './mysql-service';

const mysqlPort = Number(process.env.IT_TOOLS_TEST_MYSQL_PORT);
const mysqlPassword = process.env.IT_TOOLS_TEST_MYSQL_PASSWORD ?? '';
const enabled = Number.isInteger(mysqlPort) && mysqlPort > 0 && mysqlPort <= 65_535 && mysqlPassword.length > 0;

describe.skipIf(!enabled)('MySQL metadata browsing integration', () => {
  const service = new MySqlDatabaseService();
  const sessionId = randomUUID();

  beforeAll(async () => {
    const result = await service.connect(sessionId, {
      host: '127.0.0.1',
      port: mysqlPort,
      database: 'it_tools_e2e',
      username: 'it_tools_reader',
      password: mysqlPassword,
      tlsMode: 'disable',
    });
    if (!result.ok) {
      throw new Error(`Could not connect to the isolated MySQL test service: ${result.error}`);
    }
    expect(result.value.serverVersion).toMatch(/^8\./);
  });

  afterAll(async () => {
    await service.closeAll();
  });

  it('lists only visible user databases and bounded tables and views', async () => {
    const schemas = await service.listSchemas(sessionId);
    expect(schemas).toEqual({ ok: true, value: [{ name: 'it_tools_e2e' }] });

    const tables = await service.listTables(sessionId, 'it_tools_e2e');
    expect(tables).toEqual({
      ok: true,
      value: [
        { name: 's3_mysql_probe', kind: 'table' },
        { name: 's3_mysql_probe_view', kind: 'view' },
      ],
    });
  });

  it('returns bounded column and index metadata without exposing driver errors', async () => {
    const result = await service.getStructure(sessionId, 'it_tools_e2e', 's3_mysql_probe');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.columns).toMatchObject([
      { name: 'id', dataType: 'bigint', nullable: false, primaryKey: true, primaryKeyPosition: 1 },
      { name: 'username', dataType: 'varchar(100)', nullable: false, primaryKey: false, defaultValue: null },
      { name: 'created_at', dataType: 'timestamp', nullable: false, primaryKey: false, defaultValue: 'CURRENT_TIMESTAMP' },
      { name: 'optional_value', dataType: 'varchar(32)', nullable: true, primaryKey: false },
    ]);
    expect(result.value.columnsTruncated).toBe(false);
    expect(result.value.indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'PRIMARY', primary: true, unique: true, valid: null, definition: 'id' }),
      expect.objectContaining({ name: 'uq_s3_mysql_username', primary: false, unique: true, valid: null, definition: 'username' }),
      expect.objectContaining({ name: 'idx_s3_mysql_created_at', primary: false, unique: false, valid: null, definition: 'created_at' }),
    ]));
    expect(result.value.indexesTruncated).toBe(false);

    expect(await service.getStructure(sessionId, 'missing_schema', 's3_mysql_probe')).toEqual({
      ok: false,
      error: 'query-failed',
    });
  });

  it('rejects invalid identifiers before querying the server', async () => {
    expect(await service.listTables(sessionId, 'x'.repeat(65))).toEqual({ ok: false, error: 'invalid-request' });
    expect(await service.getStructure(sessionId, 'it_tools_e2e', 'bad\u0000table')).toEqual({
      ok: false,
      error: 'invalid-request',
    });
  });

  it('displays paged SELECT results and bounds large cells before returning them', async () => {
    const pagedQuery = 'WITH RECURSIVE valueset(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM valueset WHERE value < 26) SELECT value FROM valueset ORDER BY value';
    const firstPage = await service.executeReadOnlyQuery(sessionId, pagedQuery, 0);
    expect(firstPage.ok).toBe(true);
    if (!firstPage.ok) {
      return;
    }
    expect(firstPage.value.rows).toHaveLength(25);
    expect(firstPage.value.rows[0]?.cells[0]).toEqual({ value: '1', truncated: false });
    expect(firstPage.value.hasNext).toBe(true);
    expect(firstPage.value.nextOffset).toBe(25);

    const secondPage = await service.executeReadOnlyQuery(sessionId, pagedQuery, 25);
    expect(secondPage.ok && secondPage.value.rows[0]?.cells[0]).toEqual({ value: '26', truncated: false });

    const largeCell = await service.executeReadOnlyQuery(
      sessionId,
      `SELECT 1 AS id, REPEAT('x', 1048576) AS large_value`,
      0,
    );
    expect(largeCell.ok).toBe(true);
    if (largeCell.ok) {
      expect(largeCell.value.rows[0]?.cells[1]).toEqual({ value: 'x'.repeat(256), truncated: true });
      expect(new TextEncoder().encode(JSON.stringify(largeCell.value)).byteLength).toBeLessThan(16 * 1024);
    }

    expect(await service.executeReadOnlyQuery(sessionId, 'DELETE FROM s3_mysql_probe', 0)).toEqual({
      ok: false,
      error: 'invalid-request',
    });
    expect(await service.executeReadOnlyQuery(sessionId, 'SELECT 1; SELECT 2', 0)).toEqual({
      ok: false,
      error: 'invalid-request',
    });
  });
});
