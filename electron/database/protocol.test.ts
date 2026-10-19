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
});
