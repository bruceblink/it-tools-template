import { describe, expect, it } from 'vitest';
import { convertCsvToMarkdownTable } from './csv-to-markdown-table.service';

describe('csv-to-markdown-table service', () => {
  it('converts CSV to a markdown table', () => {
    expect(convertCsvToMarkdownTable('name,age\nAlice,30\nBob,25')).toMatchInlineSnapshot(`
      "| name | age |
      | --- | --- |
      | Alice | 30 |
      | Bob | 25 |"
    `);
  });

  it('can generate headers when the CSV has no header row', () => {
    expect(convertCsvToMarkdownTable('Alice,30', { hasHeader: false })).toMatchInlineSnapshot(`
      "| Column 1 | Column 2 |
      | --- | --- |
      | Alice | 30 |"
    `);
  });

  it('escapes markdown table separators and preserves multiline values', () => {
    expect(convertCsvToMarkdownTable('name,note\nAlice,"a | b"\nBob,"line 1\nline 2"')).toMatchInlineSnapshot(`
      "| name | note |
      | --- | --- |
      | Alice | a \\| b |
      | Bob | line 1<br>line 2 |"
    `);
  });

  it('supports custom delimiters', () => {
    expect(convertCsvToMarkdownTable('name;age\nAlice;30', { delimiter: ';' })).toMatchInlineSnapshot(`
      "| name | age |
      | --- | --- |
      | Alice | 30 |"
    `);
  });
});
