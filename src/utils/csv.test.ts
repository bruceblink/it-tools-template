import { describe, expect, it } from 'vitest';
import { normalizeCsvRows, parseCsv } from './csv';

describe('csv utils', () => {
  describe('parseCsv', () => {
    it('parses comma separated rows', () => {
      expect(parseCsv('name,age\nAlice,30\nBob,25')).toEqual([
        ['name', 'age'],
        ['Alice', '30'],
        ['Bob', '25'],
      ]);
    });

    it('parses quoted fields with commas, quotes, and new lines', () => {
      expect(parseCsv('name,note\nAlice,"hello, ""world"""\nBob,"line 1\nline 2"')).toEqual([
        ['name', 'note'],
        ['Alice', 'hello, "world"'],
        ['Bob', 'line 1\nline 2'],
      ]);
    });

    it('supports CRLF line endings and custom delimiters', () => {
      expect(parseCsv('name;age\r\nAlice;30', { delimiter: ';' })).toEqual([
        ['name', 'age'],
        ['Alice', '30'],
      ]);
    });

    it('skips empty rows by default', () => {
      expect(parseCsv('name,age\n\nAlice,30\n')).toEqual([
        ['name', 'age'],
        ['Alice', '30'],
      ]);
    });

    it('rejects unterminated quoted fields', () => {
      expect(() => parseCsv('name,note\nAlice,"hello')).toThrow('Unterminated quoted CSV field.');
    });
  });

  describe('normalizeCsvRows', () => {
    it('pads rows to the widest row', () => {
      expect(normalizeCsvRows([['a', 'b'], ['1']])).toEqual([
        ['a', 'b'],
        ['1', ''],
      ]);
    });
  });
});
