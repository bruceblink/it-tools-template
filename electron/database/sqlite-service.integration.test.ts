import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQLiteDatabaseService } from './sqlite-service';

const sessionId = randomUUID();
const service = new SQLiteDatabaseService();
let databaseDirectory = '';
let databasePath = '';

describe('SQLite metadata browsing integration', () => {
  beforeAll(async () => {
    databaseDirectory = await mkdtemp(join(tmpdir(), 'it-tools-sqlite-service-'));
    databasePath = join(databaseDirectory, 'metadata.sqlite');
    createTestDatabase(databasePath);

    const result = await service.connect(sessionId, databasePath);
    if (!result.ok) {
      throw new Error(`Could not open the local SQLite fixture: ${result.error}`);
    }
    expect(result.value.serverVersion).toMatch(/^3\./);
  });

  afterAll(async () => {
    await service.closeAll();
    if (databaseDirectory) {
      await rm(databaseDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    }
  });

  it('lists only the selected file schema and bounded tables and views', async () => {
    expect(await service.listSchemas(sessionId)).toEqual({ ok: true, value: [{ name: 'main' }] });
    expect(await service.listTables(sessionId, 'main')).toEqual({
      ok: true,
      value: [
        { name: 's3_sqlite_long_index', kind: 'table' },
        { name: 's3_sqlite_many_indexes', kind: 'table' },
        { name: 's3_sqlite_probe', kind: 'table' },
        { name: 's3_sqlite_probe_view', kind: 'view' },
        { name: 's3_sqlite_wide', kind: 'table' },
      ],
    });
    expect(await service.listTables(sessionId, 'attached')).toEqual({ ok: false, error: 'invalid-request' });
  });

  it('returns bounded column and index metadata for tables and views', async () => {
    const tableResult = await service.getStructure(sessionId, 'main', 's3_sqlite_probe');
    expect(tableResult.ok).toBe(true);
    if (!tableResult.ok) {
      return;
    }
    expect(tableResult.value.columns).toEqual([
      {
        name: 'id', dataType: 'INTEGER', nullable: false, defaultValue: null,
        primaryKey: true, primaryKeyPosition: 1, ordinalPosition: 1,
      },
      {
        name: 'username', dataType: 'TEXT', nullable: false, defaultValue: null,
        primaryKey: true, primaryKeyPosition: 2, ordinalPosition: 2,
      },
      {
        name: 'nickname', dataType: 'TEXT', nullable: true, defaultValue: null,
        primaryKey: false, primaryKeyPosition: null, ordinalPosition: 3,
      },
      {
        name: 'payload', dataType: 'BLOB', nullable: true, defaultValue: null,
        primaryKey: false, primaryKeyPosition: null, ordinalPosition: 4,
      },
    ]);
    expect(tableResult.value.columnsTruncated).toBe(false);
    expect(tableResult.value.indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'uq_s3_sqlite_username', primary: false, unique: true, valid: true }),
      expect.objectContaining({ primary: true, unique: true, valid: true, method: 'btree' }),
    ]));

    const viewResult = await service.getStructure(sessionId, 'main', 's3_sqlite_probe_view');
    expect(viewResult.ok && viewResult.value.columns.map(column => column.name)).toEqual(['id', 'username']);
    expect(viewResult.ok && viewResult.value.indexes).toEqual([]);
  });

  it('caps columns, indexes, and index definitions', async () => {
    const wideResult = await service.getStructure(sessionId, 'main', 's3_sqlite_wide');
    expect(wideResult.ok).toBe(true);
    if (wideResult.ok) {
      expect(wideResult.value.columns).toHaveLength(256);
      expect(wideResult.value.columnsTruncated).toBe(true);
    }

    const manyIndexesResult = await service.getStructure(sessionId, 'main', 's3_sqlite_many_indexes');
    expect(manyIndexesResult.ok).toBe(true);
    if (manyIndexesResult.ok) {
      expect(manyIndexesResult.value.indexes).toHaveLength(64);
      expect(manyIndexesResult.value.indexesTruncated).toBe(true);
    }

    const longDefinitionResult = await service.getStructure(sessionId, 'main', 's3_sqlite_long_index');
    expect(longDefinitionResult.ok).toBe(true);
    if (longDefinitionResult.ok) {
      expect(longDefinitionResult.value.indexes[0]?.definition).toHaveLength(2_048);
      expect(longDefinitionResult.value.indexes[0]?.definitionTruncated).toBe(true);
    }
  });

  it('runs read-only SELECT results with bounded cells and pages', async () => {
    const firstPage = await service.executeReadOnlyQuery(
      sessionId,
      'WITH RECURSIVE valueset(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM valueset WHERE value < 26) SELECT value FROM valueset ORDER BY value',
      0,
    );
    expect(firstPage.ok).toBe(true);
    if (!firstPage.ok) {
      return;
    }
    expect(firstPage.value.rows).toHaveLength(25);
    expect(firstPage.value.rows[0]?.cells[0]).toEqual({ value: '1', truncated: false });
    expect(firstPage.value.hasNext).toBe(true);
    expect(firstPage.value.nextOffset).toBe(25);

    const secondPage = await service.executeReadOnlyQuery(
      sessionId,
      'WITH RECURSIVE valueset(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM valueset WHERE value < 26) SELECT value FROM valueset ORDER BY value',
      25,
    );
    expect(secondPage.ok && secondPage.value.rows[0]?.cells[0]).toEqual({ value: '26', truncated: false });

    const largeCells = await service.executeReadOnlyQuery(
      sessionId,
      "SELECT printf('%02000d', 1) AS large_text, randomblob(1000000) AS large_blob",
      0,
    );
    expect(largeCells.ok).toBe(true);
    if (largeCells.ok) {
      expect(largeCells.value.rows[0]?.cells[0]).toEqual({ value: '0'.repeat(256), truncated: true });
      expect(largeCells.value.rows[0]?.cells[1]?.value).toHaveLength(256);
      expect(largeCells.value.rows[0]?.cells[1]?.truncated).toBe(true);
      expect(new TextEncoder().encode(JSON.stringify(largeCells.value)).byteLength).toBeLessThan(16 * 1024);
    }

    expect(await service.executeReadOnlyQuery(sessionId, 'UPDATE s3_sqlite_probe SET username = \'blocked\'', 0)).toEqual({
      ok: false,
      error: 'invalid-request',
    });
  });

  it('enforces SQLite read-only mode and rejects unsupported paths and identifiers', async () => {
    const connection = (service as unknown as {
      connections: Map<string, { database: DatabaseSync }>;
    }).connections.get(sessionId)?.database;
    expect(connection).toBeDefined();
    expect(connection?.prepare('PRAGMA query_only').get()).toEqual({ query_only: 1 });
    expect(() => connection?.exec("INSERT INTO s3_sqlite_probe (id, username) VALUES (99, 'blocked')"))
      .toThrow(/readonly|read-only/i);
    expect(await service.connect(randomUUID(), 'relative.sqlite')).toEqual({ ok: false, error: 'invalid-request' });
    expect(await service.getStructure(sessionId, 'main', 'x'.repeat(257))).toEqual({
      ok: false,
      error: 'invalid-request',
    });
    expect(await service.getStructure(sessionId, 'main', 'missing_table')).toEqual({
      ok: false,
      error: 'query-failed',
    });
  });

  it('waits for a conflicting exclusive lock and continues after the lock is released', async () => {
    const lockOwner = new DatabaseSync(databasePath);
    try {
      lockOwner.exec('BEGIN EXCLUSIVE');
      const startedAt = Date.now();
      expect(await service.listTables(sessionId, 'main')).toEqual({ ok: false, error: 'query-failed' });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4_500);
    }
    finally {
      lockOwner.exec('ROLLBACK');
      lockOwner.close();
    }
    expect((await service.listTables(sessionId, 'main')).ok).toBe(true);
  }, 15_000);

  it('closes the file so a later writer can open and update it', async () => {
    expect(await service.disconnect(sessionId)).toEqual({ ok: true, value: true });
    const writer = new DatabaseSync(databasePath);
    try {
      writer.prepare('INSERT INTO s3_sqlite_probe (id, username) VALUES (?, ?)').run(99, 'after-close');
      expect(writer.prepare('SELECT username FROM s3_sqlite_probe WHERE id = 99').get()).toEqual({
        username: 'after-close',
      });
    }
    finally {
      writer.close();
    }
  });
});

function createTestDatabase(filePath: string): void {
  const database = new DatabaseSync(filePath);
  try {
    database.exec(`
      CREATE TABLE s3_sqlite_probe (
        id INTEGER NOT NULL,
        username TEXT NOT NULL,
        nickname TEXT,
        payload BLOB,
        PRIMARY KEY (id, username)
      );
      CREATE UNIQUE INDEX uq_s3_sqlite_username ON s3_sqlite_probe(username);
      CREATE VIEW s3_sqlite_probe_view AS SELECT id, username FROM s3_sqlite_probe;
      INSERT INTO s3_sqlite_probe (id, username, nickname, payload) VALUES (1, 'sqlite-user', 'local', X'010203');
      CREATE TABLE s3_sqlite_many_indexes (id INTEGER PRIMARY KEY, value TEXT);
      CREATE TABLE s3_sqlite_long_index (${Array.from({ length: 192 }, (_, index) => `column_${index} TEXT`).join(', ')});
      CREATE INDEX idx_s3_sqlite_long_definition ON s3_sqlite_long_index(${Array.from({ length: 192 }, (_, index) => `column_${index}`).join(', ')});
      CREATE TABLE s3_sqlite_wide (${Array.from({ length: 257 }, (_, index) => `column_${String(index).padStart(3, '0')} TEXT`).join(', ')});
    `);
    for (let index = 0; index < 66; index += 1) {
      database.exec(`CREATE INDEX idx_s3_sqlite_many_${String(index).padStart(2, '0')} ON s3_sqlite_many_indexes(value);`);
    }
  }
  finally {
    database.close();
  }
}
