import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQLiteDatabaseService } from './sqlite-service';

const sessionId = randomUUID();
const writeSessionId = randomUUID();
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
    const writeResult = await service.connect(writeSessionId, databasePath, 'read-write');
    if (!writeResult.ok) {
      throw new Error(`Could not open the writable SQLite fixture: ${writeResult.error}`);
    }
    expect(writeResult.value.accessMode).toBe('read-write');
  }, 30_000);

  afterAll(async () => {
    await service.closeAll();
    if (databaseDirectory) {
      await rm(databaseDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    }
  }, 30_000);

  it('lists only the selected file schema and bounded tables and views', async () => {
    expect(await service.listSchemas(sessionId)).toEqual({ ok: true, value: [{ name: 'main' }] });
    expect(await service.listTables(sessionId, 'main')).toEqual({
      ok: true,
      value: [
        { name: 's3_sqlite_crud_probe', kind: 'table' },
        { name: 's3_sqlite_long_index', kind: 'table' },
        { name: 's3_sqlite_long_key', kind: 'table' },
        { name: 's3_sqlite_many_indexes', kind: 'table' },
        { name: 's3_sqlite_many_rows', kind: 'table' },
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
    expect(await service.executeStatement(sessionId, "UPDATE s3_sqlite_probe SET username = 'blocked'", 0))
      .toEqual({ ok: false, error: 'write-disabled' });
    expect(await service.getStructure(sessionId, 'main', 'x'.repeat(257))).toEqual({
      ok: false,
      error: 'invalid-request',
    });
    expect(await service.getStructure(sessionId, 'main', 'missing_table')).toEqual({
      ok: false,
      error: 'query-failed',
    });
  });

  it('executes CRUD statements only in read-write mode and reports changed rows', async () => {
    const inserted = await service.executeStatement(
      writeSessionId,
      "INSERT INTO s3_sqlite_crud_probe (id, value) VALUES (1, 'before')",
      0,
    );
    expect(inserted).toMatchObject({ ok: true, value: { kind: 'mutation', statement: 'insert', affectedRows: 1 } });

    const updated = await service.executeStatement(
      writeSessionId,
      "UPDATE s3_sqlite_crud_probe SET value = 'after' WHERE id = 1",
      0,
    );
    expect(updated).toMatchObject({ ok: true, value: { kind: 'mutation', statement: 'update', affectedRows: 1 } });
    const selected = await service.executeStatement(writeSessionId, 'SELECT value FROM s3_sqlite_crud_probe WHERE id = 1', 0);
    expect(selected.ok && selected.value.kind === 'query' && selected.value.page.rows[0]?.cells[0])
      .toEqual({ value: 'after', truncated: false });

    const deleted = await service.executeStatement(writeSessionId, 'DELETE FROM s3_sqlite_crud_probe WHERE id = 1', 0);
    expect(deleted).toMatchObject({ ok: true, value: { kind: 'mutation', statement: 'delete', affectedRows: 1 } });
  });

  it('loads editable table and direct query results and rejects stale cell updates', async () => {
    expect(await service.executeStatement(
      writeSessionId,
      "INSERT INTO s3_sqlite_crud_probe (id, value) VALUES (7, 'before')",
      0,
    )).toMatchObject({ ok: true, value: { kind: 'mutation', affectedRows: 1 } });

    const readOnlyPage = await service.getDataPage(sessionId, 'main', 's3_sqlite_crud_probe', { cursor: null, offset: 0 });
    expect(readOnlyPage.ok && readOnlyPage.value.editable).toBe(false);
    const tablePage = await service.getDataPage(writeSessionId, 'main', 's3_sqlite_crud_probe', { cursor: null, offset: 0 });
    expect(tablePage.ok && tablePage.value).toMatchObject({
      editable: true,
      primaryKeyColumns: ['id'],
      rows: [{ cells: [{ value: '7', truncated: false }, { value: 'before', truncated: false }], primaryKeyValues: ['7'] }],
    });
    const query = await service.executeStatement(writeSessionId, 'SELECT id, value FROM s3_sqlite_crud_probe', 0);
    expect(query.ok && query.value.kind === 'query' && query.value.page.editableTarget).toEqual({
      schema: 'main',
      table: 's3_sqlite_crud_probe',
      primaryKeyColumns: ['id'],
      editableColumns: ['id', 'value'],
    });

    const input = {
      schema: 'main',
      table: 's3_sqlite_crud_probe',
      column: 'value',
      primaryKeys: [{ column: 'id', value: '7' }],
      originalValue: 'before',
      newValue: 'after',
    };
    expect(await service.updateCell(sessionId, input)).toEqual({ ok: false, error: 'write-disabled' });
    expect(await service.updateCell(writeSessionId, input)).toEqual({ ok: true, value: true });
    expect(await service.updateCell(writeSessionId, input)).toEqual({ ok: false, error: 'write-conflict' });
    expect(await service.executeStatement(writeSessionId, 'DELETE FROM s3_sqlite_crud_probe WHERE id = 7', 0))
      .toMatchObject({ ok: true, value: { kind: 'mutation', affectedRows: 1 } });

    const longKeyPage = await service.getDataPage(writeSessionId, 'main', 's3_sqlite_long_key', { cursor: null, offset: 0 });
    expect(longKeyPage.ok && longKeyPage.value.rows[0]?.primaryKeyValues).toEqual(['k'.repeat(256)]);
    expect(longKeyPage.ok && longKeyPage.value.rows[0]?.primaryKeyValuesTruncated).toBe(true);
  });

  it('applies bounded filters and stable sorts to table pages', async () => {
    const filtered = await service.getDataPage(writeSessionId, 'main', 's3_sqlite_many_rows', {
      cursor: null,
      offset: 0,
      filters: [{ column: 'value', operator: 'equals', value: 'row-1001' }],
      sort: [{ column: 'id', direction: 'desc' }],
    });
    expect(filtered.ok).toBe(true);
    if (filtered.ok) {
      expect(filtered.value.pagingMode).toBe('offset');
      expect(filtered.value.pagingNotice).toBe('offset-paging');
      expect(filtered.value.rows).toHaveLength(1);
      expect(filtered.value.rows[0]?.cells[0]).toEqual({ value: '1001', truncated: false });
    }

    const sorted = await service.getDataPage(sessionId, 'main', 's3_sqlite_many_rows', {
      cursor: null,
      offset: 0,
      sort: [{ column: 'id', direction: 'desc' }],
    });
    expect(sorted.ok && sorted.value.rows[0]?.cells[0]).toEqual({ value: '1001', truncated: false });
    expect(await service.getDataPage(sessionId, 'main', 's3_sqlite_many_rows', {
      cursor: null,
      offset: 0,
      filters: [{ column: 'missing', operator: 'equals', value: 'x' }],
    })).toEqual({ ok: false, error: 'invalid-request' });
  });

  it('rolls back mutations that exceed the 1,000-row limit', async () => {
    expect(await service.executeStatement(writeSessionId, 'DELETE FROM s3_sqlite_many_rows', 0))
      .toEqual({ ok: false, error: 'write-limit-exceeded' });
    const result = await service.executeStatement(writeSessionId, 'SELECT count(*) AS row_count FROM s3_sqlite_many_rows', 0);
    expect(result.ok && result.value.kind === 'query' && result.value.page.rows[0]?.cells[0])
      .toEqual({ value: '1001', truncated: false });
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
      CREATE TABLE s3_sqlite_crud_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE s3_sqlite_long_key (id TEXT PRIMARY KEY, value TEXT);
      INSERT INTO s3_sqlite_long_key (id, value) VALUES ('${'k'.repeat(300)}', 'bounded');
      CREATE VIEW s3_sqlite_probe_view AS SELECT id, username FROM s3_sqlite_probe;
      INSERT INTO s3_sqlite_probe (id, username, nickname, payload) VALUES (1, 'sqlite-user', 'local', X'010203');
      CREATE TABLE s3_sqlite_many_indexes (id INTEGER PRIMARY KEY, value TEXT);
      CREATE TABLE s3_sqlite_long_index (${Array.from({ length: 192 }, (_, index) => `column_${index} TEXT`).join(', ')});
      CREATE INDEX idx_s3_sqlite_long_definition ON s3_sqlite_long_index(${Array.from({ length: 192 }, (_, index) => `column_${index}`).join(', ')});
      CREATE TABLE s3_sqlite_wide (${Array.from({ length: 257 }, (_, index) => `column_${String(index).padStart(3, '0')} TEXT`).join(', ')});
      CREATE TABLE s3_sqlite_many_rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    `);
    for (let index = 0; index < 66; index += 1) {
      database.exec(`CREATE INDEX idx_s3_sqlite_many_${String(index).padStart(2, '0')} ON s3_sqlite_many_indexes(value);`);
    }
    const insert = database.prepare('INSERT INTO s3_sqlite_many_rows (id, value) VALUES (?, ?)');
    for (let index = 1; index <= 1_001; index += 1) {
      insert.run(index, `row-${index}`);
    }
  }
  finally {
    database.close();
  }
}
