import { describe, expect, it } from 'vitest';
import { serializeDatabasePage } from './database-export';

const columns = [
  { name: 'id', dataType: 'integer' },
  { name: 'note', dataType: 'text' },
];

const rows = [
  { cells: [{ value: '1', truncated: false }, { value: 'hello, "world"', truncated: false }] },
  { cells: [{ value: '2', truncated: false }, { value: null, truncated: false }] },
];

describe('database page export', () => {
  it('exports the bounded page as RFC-style CSV with null cells empty', () => {
    expect(serializeDatabasePage(columns, rows, 'csv')).toBe(
      'id,note\n1,"hello, ""world"""\n2,',
    );
  });

  it('exports one JSON object per bounded row', () => {
    expect(serializeDatabasePage(columns, rows, 'jsonl')).toBe(
      '{"id":"1","note":"hello, \\\"world\\\""}\n{"id":"2","note":null}',
    );
  });

  it('preserves line breaks in CSV fields by quoting them', () => {
    expect(serializeDatabasePage(
      [{ name: 'message', dataType: 'text' }],
      [{ cells: [{ value: 'line 1\nline 2', truncated: false }] }],
      'csv',
    )).toBe('message\n"line 1\nline 2"');
  });
});
