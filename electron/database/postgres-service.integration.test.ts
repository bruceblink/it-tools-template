import { randomUUID } from 'node:crypto';
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
    const firstPage = await service.getDataPage(sessionId, 'public', 's2b_keyset_probe', { cursor: null, offset: 0 });
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
    });
    expect(secondPage.ok).toBe(true);
    if (secondPage.ok) {
      expect(secondPage.value.rows[0]?.cells[0]?.value).toBe('26');
    }
  });

  it('warns and uses bounded offset pages when a table has no primary key', async () => {
    const firstPage = await service.getDataPage(sessionId, 'public', 's2b_offset_probe', { cursor: null, offset: 0 });
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
    });
    expect(secondPage.ok).toBe(true);
    if (secondPage.ok) {
      expect(secondPage.value.rows[0]?.cells[0]?.value).toBe('row 26');
    }
  });
});
