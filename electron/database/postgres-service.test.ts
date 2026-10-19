import { describe, expect, it } from 'vitest';
import { isValidDatabaseIdentifier, isValidPostgresConnectionInput } from './postgres-service';

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
});
