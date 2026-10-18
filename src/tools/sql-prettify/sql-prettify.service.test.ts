import { describe, expect, it } from 'vitest';
import { formatSqlQuery } from './sql-prettify.service';

describe('formatSqlQuery', () => {
  it('formats standard SQL with the selected keyword case and indent style', () => {
    expect(formatSqlQuery('select id,name from users;', {
      keywordCase: 'upper',
      useTabs: false,
      language: 'sql',
      indentStyle: 'standard',
    })).toBe('SELECT\n  id,\n  name\nFROM\n  users;');
  });

  it('keeps the selected keyword case', () => {
    expect(formatSqlQuery('SELECT id FROM users;', {
      keywordCase: 'lower',
      useTabs: false,
      language: 'sql',
      indentStyle: 'standard',
    })).toBe('select\n  id\nfrom\n  users;');
  });
});
