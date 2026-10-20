import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresDatabaseService } from './postgres-service';

const postgresPort = Number(process.env.IT_TOOLS_TEST_POSTGRES_PORT);
const enabled = Number.isInteger(postgresPort) && postgresPort > 0 && postgresPort <= 65_535;

describe.skipIf(!enabled)('PostgreSQL row preview integration', () => {
  const service = new PostgresDatabaseService();
  const sessionId = randomUUID();

  beforeAll(async () => {
    const result = await service.connect(sessionId, {
      host: '127.0.0.1',
      port: postgresPort,
      database: 'postgres',
      username: 'postgres',
      password: '',
      tlsMode: 'disable',
    });
    if (!result.ok) {
      throw new Error(`Could not connect to the isolated PostgreSQL test service: ${result.error}`);
    }
  });

  afterAll(async () => {
    await service.closeAll();
  });

  it('caps row and cell output and pages a primary key with a typed cursor', async () => {
    const firstPage = await service.getDataPage(sessionId, 'public', 's2b_keyset_probe', { cursor: null, offset: 0 }, randomUUID());
    expect(firstPage.ok).toBe(true);
    if (!firstPage.ok) {
      return;
    }

    expect(firstPage.value.pagingMode).toBe('keyset');
    expect(firstPage.value.rows).toHaveLength(25);
    expect(firstPage.value.hasNext).toBe(true);
    expect(firstPage.value.columns).toHaveLength(3);
    expect(firstPage.value.rows[0]?.cells[1]).toEqual({ value: 'x'.repeat(256), truncated: true });
    expect(firstPage.value.rows[0]?.cells[2]).toEqual({ value: null, truncated: false });

    const secondPage = await service.getDataPage(sessionId, 'public', 's2b_keyset_probe', {
      cursor: firstPage.value.nextCursor,
      offset: 0,
    }, randomUUID());
    expect(secondPage.ok).toBe(true);
    if (secondPage.ok) {
      expect(secondPage.value.rows[0]?.cells[0]?.value).toBe('26');
    }
  });

  it('warns and uses bounded offset pages when a table has no primary key', async () => {
    const firstPage = await service.getDataPage(sessionId, 'public', 's2b_offset_probe', { cursor: null, offset: 0 }, randomUUID());
    expect(firstPage.ok).toBe(true);
    if (!firstPage.ok) {
      return;
    }

    expect(firstPage.value.pagingMode).toBe('offset');
    expect(firstPage.value.pagingNotice).toBe('no-primary-key');
    expect(firstPage.value.rows).toHaveLength(25);
    expect(firstPage.value.nextOffset).toBe(25);

    const secondPage = await service.getDataPage(sessionId, 'public', 's2b_offset_probe', {
      cursor: null,
      offset: firstPage.value.nextOffset ?? -1,
    }, randomUUID());
    expect(secondPage.ok).toBe(true);
    if (secondPage.ok) {
      expect(secondPage.value.rows[0]?.cells[0]?.value).toBe('row 26');
    }
  });

  it('caps multi-megabyte text, JSON, and binary cells before returning a page', async () => {
    const result = await service.getDataPage(
      sessionId,
      'public',
      's2b_large_cell_probe',
      { cursor: null, offset: 0 },
      randomUUID(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const cells = result.value.rows[0]?.cells;
    expect(result.value.rows).toHaveLength(1);
    expect(result.value.columns.map(column => column.name)).toEqual([
      'probe_id',
      'large_text',
      'large_json',
      'large_binary',
    ]);
    expect(cells?.[1]).toEqual({ value: 'x'.repeat(256), truncated: true });
    expect(cells?.[2]?.value).toHaveLength(256);
    expect(cells?.[2]?.truncated).toBe(true);
    expect(cells?.[3]?.value).toHaveLength(256);
    expect(cells?.[3]?.truncated).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(result.value)).byteLength).toBeLessThan(16 * 1024);
  });

  it('runs single read-only SELECT queries, pages rows, and caps large values before returning them', async () => {
    const pagedQuery = 'SELECT value FROM generate_series(1, 26) AS series(value) ORDER BY value';
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

    const largeCells = await service.executeReadOnlyQuery(
      sessionId,
      "SELECT repeat('x', 2097152) AS large_text, NULL::text AS null_value",
      0,
    );
    expect(largeCells.ok).toBe(true);
    if (largeCells.ok) {
      expect(largeCells.value.rows[0]?.cells[0]).toEqual({ value: 'x'.repeat(256), truncated: true });
      expect(largeCells.value.rows[0]?.cells[1]).toEqual({ value: null, truncated: false });
      expect(new TextEncoder().encode(JSON.stringify(largeCells.value)).byteLength).toBeLessThan(16 * 1024);
    }

    expect(await service.executeReadOnlyQuery(sessionId, 'DELETE FROM s2b_keyset_probe', 0)).toEqual({
      ok: false,
      error: 'invalid-request',
    });
    expect(await service.executeReadOnlyQuery(sessionId, 'SELECT 1; SELECT 2', 0)).toEqual({
      ok: false,
      error: 'invalid-request',
    });
  });

  it('returns bounded index metadata for primary, included, expression, and partial indexes', async () => {
    const result = await service.getStructure(sessionId, 'public', 's2e_index_probe');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const primaryIndex = result.value.indexes.find(index => index.name === 's2e_index_probe_pkey');
    expect(primaryIndex).toMatchObject({ primary: true, unique: true, method: 'btree', valid: true });

    const includedIndex = result.value.indexes.find(index => index.name === 's2e_index_probe_key_idx');
    expect(includedIndex).toMatchObject({ primary: false, unique: true, method: 'btree', valid: true });
    expect(includedIndex?.definition).toContain('INCLUDE (include_value)');

    const expressionIndex = result.value.indexes.find(index => index.name === 's2e_index_probe_active_expr_idx');
    expect(expressionIndex?.definition).toContain('lower(key_value)');
    expect(expressionIndex?.definition).toContain('WHERE active');

    const longDefinition = result.value.indexes.find(index => index.name === 's2e_index_probe_long_predicate_idx');
    expect(longDefinition?.definition).toHaveLength(2_048);
    expect(longDefinition?.definitionTruncated).toBe(true);
    expect(result.value.indexesTruncated).toBe(false);
  });

  it('returns a bounded index list and marks when more indexes exist', async () => {
    const result = await service.getStructure(sessionId, 'public', 's2e_many_index_probe');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.indexes).toHaveLength(64);
      expect(result.value.indexesTruncated).toBe(true);
    }
  });

  it('cancels only the matching preview request and keeps the session usable', async () => {
    const observer = new Client({
      host: '127.0.0.1',
      port: postgresPort,
      database: 'postgres',
      user: 'postgres',
      password: '',
      ssl: false,
      connectionTimeoutMillis: 2_000,
    });
    await observer.connect();
    try {
      const requestId = randomUUID();
      const pagePromise = service.getDataPage(
        sessionId,
        'public',
        's2d_slow_view',
        { cursor: null, offset: 0 },
        requestId,
      );
      await waitForSlowPreviewQuery(observer);

      expect(await service.cancelDataPage(sessionId, randomUUID())).toEqual({ ok: true, value: false });
      await waitForSlowPreviewQuery(observer);
      expect(await service.cancelDataPage(sessionId, requestId)).toEqual({ ok: true, value: true });
      expect(await pagePromise).toEqual({ ok: false, error: 'query-timeout' });
      await waitForNoSlowPreviewQuery(observer);

      const schemas = await service.listSchemas(sessionId);
      expect(schemas.ok).toBe(true);
    }
    finally {
      await observer.end();
    }
  });
});

async function waitForSlowPreviewQuery(observer: Client): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ pid: number }>(
      `SELECT pid
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND application_name = 'IT Tools Desktop'
         AND state = 'active'
         AND query LIKE 'SELECT left(%'`,
    );
    if (result.rows.length > 0) {
      return;
    }
    await delay(25);
  }
  throw new Error('The PostgreSQL preview query did not become active.');
}

async function waitForNoSlowPreviewQuery(observer: Client): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ pid: number }>(
      `SELECT pid
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND application_name = 'IT Tools Desktop'
         AND state = 'active'
         AND query LIKE 'SELECT left(%'`,
    );
    if (result.rows.length === 0) {
      return;
    }
    await delay(25);
  }
  throw new Error('The cancelled PostgreSQL preview query is still active.');
}
