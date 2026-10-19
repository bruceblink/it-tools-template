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
