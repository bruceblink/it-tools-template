import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidMySqlConnectionInput, isValidMySqlIdentifier } from './mysql-service';
import { parseDatabaseWorkerCommand } from './protocol';
import { isValidSQLiteFilePath, isValidSQLiteIdentifier } from './sqlite-service';

describe('database utility process protocol', () => {
  it('accepts the fixed PostgreSQL connection command shape', () => {
    const command = {
      requestId: randomUUID(),
      operation: 'connect',
      sessionId: randomUUID(),
      input: {
        host: '127.0.0.1',
        port: 5432,
        database: 'postgres',
        username: 'postgres',
        password: '',
        tlsMode: 'verify',
      },
    };

    expect(parseDatabaseWorkerCommand(command)).toEqual(command);
  });

  it('accepts a bounded MySQL connection and rejects unsupported fields', () => {
    const command = {
      requestId: randomUUID(),
      operation: 'connect-mysql',
      sessionId: randomUUID(),
      input: {
        host: '127.0.0.1',
        port: 3306,
        database: 'app',
        username: 'reader',
        password: '',
        tlsMode: 'verify',
      },
    };

    expect(isValidMySqlConnectionInput(command.input)).toBe(true);
    expect(isValidMySqlConnectionInput({ ...command.input, accessMode: 'read-write' })).toBe(true);
    expect(isValidMySqlConnectionInput({ ...command.input, accessMode: 'unrestricted' })).toBe(false);
    expect(parseDatabaseWorkerCommand(command)).toEqual(command);
    expect(parseDatabaseWorkerCommand({ ...command, shell: 'not allowed' })).toBeNull();
    expect(parseDatabaseWorkerCommand({
      ...command,
      input: { ...command.input, password: 'x'.repeat(4097) },
    })).toBeNull();
    expect(isValidMySqlIdentifier('x'.repeat(64))).toBe(true);
    expect(isValidMySqlIdentifier('x'.repeat(65))).toBe(false);
    expect(isValidMySqlIdentifier('unsafe\u0000name')).toBe(false);
  });

  it('accepts only bounded MySQL metadata operations', () => {
    const sessionId = randomUUID();
    const schema = 'app';
    const table = 'records';
    const listSchemas = { requestId: randomUUID(), operation: 'list-mysql-schemas', sessionId };
    const listTables = { requestId: randomUUID(), operation: 'list-mysql-tables', sessionId, schema };
    const getStructure = { requestId: randomUUID(), operation: 'get-mysql-structure', sessionId, schema, table };

    expect(parseDatabaseWorkerCommand(listSchemas)).toEqual(listSchemas);
    expect(parseDatabaseWorkerCommand(listTables)).toEqual(listTables);
    expect(parseDatabaseWorkerCommand(getStructure)).toEqual(getStructure);
    expect(parseDatabaseWorkerCommand({ ...getStructure, sql: 'SELECT 1' })).toBeNull();
    expect(parseDatabaseWorkerCommand({ ...listTables, schema: 'x'.repeat(65) })).toBeNull();
  });

  it('accepts only an absolute SQLite file path and bounded metadata commands', () => {
    const sessionId = randomUUID();
    const filePath = resolve('test.sqlite');
    const connect = { requestId: randomUUID(), operation: 'connect-sqlite', sessionId, filePath };
    const listSchemas = { requestId: randomUUID(), operation: 'list-sqlite-schemas', sessionId };
    const listTables = { requestId: randomUUID(), operation: 'list-sqlite-tables', sessionId, schema: 'main' };
    const getStructure = {
      requestId: randomUUID(),
      operation: 'get-sqlite-structure',
      sessionId,
      schema: 'main',
      table: 'records',
    };

    expect(isValidSQLiteFilePath(filePath)).toBe(true);
    expect(isValidSQLiteFilePath('relative.sqlite')).toBe(false);
    expect(isValidSQLiteFilePath(`${filePath}\u0000unsafe`)).toBe(false);
    expect(parseDatabaseWorkerCommand(connect)).toEqual(connect);
    const writableConnect = { ...connect, accessMode: 'read-write' };
    expect(parseDatabaseWorkerCommand(writableConnect)).toEqual(writableConnect);
    expect(parseDatabaseWorkerCommand({ ...connect, accessMode: 'unrestricted' })).toBeNull();
    expect(parseDatabaseWorkerCommand(listSchemas)).toEqual(listSchemas);
    expect(parseDatabaseWorkerCommand(listTables)).toEqual(listTables);
    expect(parseDatabaseWorkerCommand(getStructure)).toEqual(getStructure);
    expect(parseDatabaseWorkerCommand({ ...connect, filePath: 'relative.sqlite' })).toBeNull();
    expect(parseDatabaseWorkerCommand({ ...listTables, schema: 'attached' })).toBeNull();
    expect(parseDatabaseWorkerCommand({ ...getStructure, table: 'x'.repeat(257) })).toBeNull();
    expect(parseDatabaseWorkerCommand({ ...getStructure, sql: 'SELECT 1' })).toBeNull();
    expect(isValidSQLiteIdentifier('quoted " table')).toBe(true);
    expect(isValidSQLiteIdentifier('x'.repeat(257))).toBe(false);
  });

  it('rejects unknown command fields, invalid session ids, and unbounded credentials', () => {
    const command = {
      requestId: randomUUID(),
      operation: 'connect',
      sessionId: randomUUID(),
      input: {
        host: '127.0.0.1',
        port: 5432,
        database: 'postgres',
        username: 'postgres',
        password: '',
        tlsMode: 'verify',
      },
    };

    expect(parseDatabaseWorkerCommand({ ...command, shell: 'not allowed' })).toBeNull();
    expect(parseDatabaseWorkerCommand({ ...command, sessionId: 'not-a-session' })).toBeNull();
    expect(parseDatabaseWorkerCommand({
      ...command,
      input: { ...command.input, password: 'x'.repeat(4097) },
    })).toBeNull();
    expect(parseDatabaseWorkerCommand({ requestId: randomUUID(), operation: 'execute-sql', sql: 'SELECT 1' })).toBeNull();
  });

  it('accepts only bounded row preview operations and page cursors', () => {
    const command = {
      requestId: randomUUID(),
      operation: 'get-data-page',
      sessionId: randomUUID(),
      pageRequestId: randomUUID(),
      schema: 'public',
      table: 'records',
      page: { cursor: null, offset: 0 },
    };
    expect(parseDatabaseWorkerCommand(command)).toEqual(command);
    expect(parseDatabaseWorkerCommand({ ...command, page: { cursor: null, offset: 1 } })).toBeNull();
    expect(parseDatabaseWorkerCommand({ ...command, sql: 'SELECT * FROM records' })).toBeNull();
    expect(parseDatabaseWorkerCommand({
      ...command,
      page: { cursor: '{"k0":null}', offset: 0 },
    })).toBeNull();

    const cancellation = {
      requestId: randomUUID(),
      operation: 'cancel-data-page',
      sessionId: command.sessionId,
      targetRequestId: command.pageRequestId,
    };
    expect(parseDatabaseWorkerCommand(cancellation)).toEqual(cancellation);
    expect(parseDatabaseWorkerCommand({ ...cancellation, targetRequestId: 'invalid' })).toBeNull();
    expect(parseDatabaseWorkerCommand({ ...cancellation, extra: true })).toBeNull();

    const mysqlPage = {
      requestId: randomUUID(),
      operation: 'get-mysql-data-page',
      sessionId: randomUUID(),
      schema: 'app',
      table: 'records',
      page: { cursor: null, offset: 25 },
    };
    expect(parseDatabaseWorkerCommand(mysqlPage)).toEqual(mysqlPage);
    expect(parseDatabaseWorkerCommand({ ...mysqlPage, page: { cursor: 'bad', offset: 0 } })).toBeNull();
    const sqlitePage = { ...mysqlPage, requestId: randomUUID(), operation: 'get-sqlite-data-page', schema: 'main' };
    expect(parseDatabaseWorkerCommand(sqlitePage)).toEqual(sqlitePage);
    expect(parseDatabaseWorkerCommand({ ...sqlitePage, schema: 'attached' })).toBeNull();

    const updateCell = {
      requestId: randomUUID(),
      operation: 'update-cell',
      sessionId: randomUUID(),
      engine: 'postgres',
      input: {
        schema: 'public',
        table: 'records',
        column: 'value',
        primaryKeys: [{ column: 'id', value: '1' }],
        originalValue: 'before',
        newValue: 'after',
      },
    };
    expect(parseDatabaseWorkerCommand(updateCell)).toEqual(updateCell);
    expect(parseDatabaseWorkerCommand({ ...updateCell, input: { ...updateCell.input, unknown: true } })).toBeNull();

    const batchMutation = {
      requestId: randomUUID(),
      operation: 'batch-mutation',
      sessionId: randomUUID(),
      engine: 'sqlite',
      input: {
        schema: 'main',
        table: 'records',
        inserts: [{ values: [{ column: 'id', value: '2' }, { column: 'value', value: 'new' }] }],
        deletes: [{
          primaryKeys: [{ column: 'id', value: '1' }],
          originalValues: [{ column: 'id', value: '1' }, { column: 'value', value: 'old' }],
        }],
      },
    };
    expect(parseDatabaseWorkerCommand(batchMutation)).toEqual(batchMutation);
    expect(parseDatabaseWorkerCommand({ ...batchMutation, input: { ...batchMutation.input, extra: true } })).toBeNull();
  });

  it('accepts one bounded SELECT or DML statement and rejects unsupported SQL or paging', () => {
    const command = {
      requestId: randomUUID(),
      operation: 'execute-sql-statement',
      sessionId: randomUUID(),
      queryRequestId: randomUUID(),
      engine: 'sqlite',
      sql: 'WITH records AS (SELECT 1 AS value) SELECT value FROM records',
      offset: 25,
    };
    expect(parseDatabaseWorkerCommand(command)).toEqual(command);
    const write = { ...command, sql: 'DELETE FROM records WHERE id = 1', offset: 0 };
    expect(parseDatabaseWorkerCommand(write)).toEqual(write);
    expect(parseDatabaseWorkerCommand({ ...write, offset: 25 })).toBeNull();
    expect(parseDatabaseWorkerCommand({ ...command, sql: 'SELECT 1; SELECT 2' })).toBeNull();
    expect(parseDatabaseWorkerCommand({ ...command, sql: 'DROP TABLE records' })).toBeNull();
    expect(parseDatabaseWorkerCommand({ ...command, engine: 'oracle' })).toBeNull();
    expect(parseDatabaseWorkerCommand({ ...command, offset: 1_000_001 })).toBeNull();
    expect(parseDatabaseWorkerCommand({ ...command, sql: 'SELECT 1', extra: true })).toBeNull();
  });

  it('accepts an engine-scoped query cancellation command', () => {
    const command = {
      requestId: randomUUID(),
      operation: 'cancel-query',
      sessionId: randomUUID(),
      engine: 'postgres',
      targetRequestId: randomUUID(),
    } as const;
    expect(parseDatabaseWorkerCommand(command)).toEqual(command);
    expect(parseDatabaseWorkerCommand({ ...command, engine: 'oracle' })).toBeNull();
    expect(parseDatabaseWorkerCommand({ ...command, extra: true })).toBeNull();
  });
});
