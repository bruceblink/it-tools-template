import { describe, expect, it } from 'vitest';
import { isEditableDatabaseColumnType, isValidCellUpdateInput } from './cell-edit';

const validUpdate = {
  schema: 'public',
  table: 'records',
  column: 'value',
  primaryKeys: [{ column: 'id', value: '7' }],
  originalValue: null,
  newValue: 'updated',
};

describe('database cell editing boundaries', () => {
  it('accepts bounded, exact optimistic update inputs', () => {
    expect(isValidCellUpdateInput(validUpdate, 'postgres')).toBe(true);
    expect(isValidCellUpdateInput({ ...validUpdate, schema: 'main' }, 'sqlite')).toBe(true);
    expect(isValidCellUpdateInput({ ...validUpdate, schema: 'app' }, 'mysql')).toBe(true);
  });

  it('rejects oversized values, duplicate keys, and unexpected fields', () => {
    expect(isValidCellUpdateInput({ ...validUpdate, newValue: 'x'.repeat(4_097) }, 'postgres')).toBe(false);
    expect(isValidCellUpdateInput({
      ...validUpdate,
      primaryKeys: [{ column: 'id', value: '7' }, { column: 'id', value: '8' }],
    }, 'postgres')).toBe(false);
    expect(isValidCellUpdateInput({ ...validUpdate, sql: 'DELETE FROM records' }, 'postgres')).toBe(false);
  });

  it('keeps binary and unsupported column types out of the cell editor', () => {
    expect(isEditableDatabaseColumnType('postgres', 'text')).toBe(true);
    expect(isEditableDatabaseColumnType('postgres', 'bytea')).toBe(false);
    expect(isEditableDatabaseColumnType('mysql', 'varchar(128)')).toBe(true);
    expect(isEditableDatabaseColumnType('mysql', 'longblob')).toBe(false);
    expect(isEditableDatabaseColumnType('sqlite', 'BLOB')).toBe(false);
    expect(isEditableDatabaseColumnType('sqlite', 'TEXT')).toBe(true);
  });
});
