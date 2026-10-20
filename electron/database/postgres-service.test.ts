import { describe, expect, it } from 'vitest';
import {
  isValidDatabaseIdentifier,
  isValidPostgresConnectionInput,
  isValidPostgresPageRequest,
  quotePostgresIdentifier,
} from './postgres-service';

describe('PostgreSQL database service input bounds', () => {
  const validInput = {
    host: '127.0.0.1',
    port: 5432,
    database: 'postgres',
    username: 'postgres',
    password: '',
    tlsMode: 'verify',
  } as const;

  it('accepts only bounded connection fields and explicit TLS modes', () => {
    expect(isValidPostgresConnectionInput(validInput)).toBe(true);
    expect(isValidPostgresConnectionInput({ ...validInput, accessMode: 'read-write' })).toBe(true);
    expect(isValidPostgresConnectionInput({ ...validInput, accessMode: 'unrestricted' })).toBe(false);
    expect(isValidPostgresConnectionInput({ ...validInput, tlsMode: 'disable' })).toBe(true);
    expect(isValidPostgresConnectionInput({ ...validInput, host: ' host.example' })).toBe(false);
    expect(isValidPostgresConnectionInput({ ...validInput, port: 65_536 })).toBe(false);
    expect(isValidPostgresConnectionInput({ ...validInput, database: '' })).toBe(false);
    expect(isValidPostgresConnectionInput({ ...validInput, password: 'x'.repeat(4097) })).toBe(false);
    expect(isValidPostgresConnectionInput({ ...validInput, tlsMode: 'allow' })).toBe(false);
    expect(isValidPostgresConnectionInput({ ...validInput, unexpected: true })).toBe(false);
    expect(isValidPostgresConnectionInput(null)).toBe(false);
  });

  it('accepts bounded database identifiers and rejects empty or NUL values', () => {
    expect(isValidDatabaseIdentifier('public')).toBe(true);
    expect(isValidDatabaseIdentifier('x'.repeat(63))).toBe(true);
    expect(isValidDatabaseIdentifier('x'.repeat(64))).toBe(false);
    expect(isValidDatabaseIdentifier('')).toBe(false);
    expect(isValidDatabaseIdentifier('unsafe\u0000name')).toBe(false);
  });

  it('accepts only bounded page requests and generated scalar keyset cursors', () => {
    expect(isValidPostgresPageRequest({ cursor: null, offset: 0 })).toBe(true);
    expect(isValidPostgresPageRequest({ cursor: null, offset: 25 })).toBe(true);
    expect(isValidPostgresPageRequest({ cursor: '{"k0":42,"k1":"00000000-0000-0000-0000-000000000001"}', offset: 0 })).toBe(true);
    expect(isValidPostgresPageRequest({ cursor: '{"k0":null}', offset: 0 })).toBe(false);
    expect(isValidPostgresPageRequest({ cursor: '[42]', offset: 0 })).toBe(false);
    expect(isValidPostgresPageRequest({ cursor: '{"k0":42}', offset: 25 })).toBe(false);
    expect(isValidPostgresPageRequest({ cursor: null, offset: 1 })).toBe(false);
    expect(isValidPostgresPageRequest({ cursor: null, offset: 1_000_025 })).toBe(false);
    expect(isValidPostgresPageRequest({ cursor: 'x'.repeat(4097), offset: 0 })).toBe(false);
    expect(isValidPostgresPageRequest({ cursor: null, offset: 0, unexpected: true })).toBe(false);
  });

  it('quotes SQL identifiers without changing their contents', () => {
    expect(quotePostgresIdentifier('odd"table')).toBe('"odd""table"');
  });
});
