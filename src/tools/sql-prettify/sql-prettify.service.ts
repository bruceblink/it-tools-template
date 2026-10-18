import { format as formatSql } from 'sql-formatter';
import type { FormatOptionsWithLanguage } from 'sql-formatter';

export function formatSqlQuery(value: string, options: FormatOptionsWithLanguage): string {
  return formatSql(value, options);
}
