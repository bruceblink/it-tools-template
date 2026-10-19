import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseDatabaseWorkerCommand } from './protocol';

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
  });
});
