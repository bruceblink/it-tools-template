import { normalizeCsvRows, parseCsv } from '@/utils/csv';

export interface CsvToMarkdownTableOptions {
  delimiter?: string
  hasHeader?: boolean
}

function escapeMarkdownCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim();
}

function makeHeaders(row: string[], width: number): string[] {
  return Array.from({ length: width }, (_, index) => {
    const header = row[index]?.trim();
    return header || `Column ${index + 1}`;
  });
}

export function convertCsvToMarkdownTable(input: string, options: CsvToMarkdownTableOptions = {}): string {
  if (input === '') {
    return '';
  }

  const rows = normalizeCsvRows(parseCsv(input, { delimiter: options.delimiter }));
  if (rows.length === 0) {
    return '';
  }

  const hasHeader = options.hasHeader ?? true;
  const firstRow = rows[0] ?? [];
  const headers = hasHeader ? makeHeaders(firstRow, firstRow.length) : makeHeaders([], firstRow.length);
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const markdownRows = [
    headers,
    headers.map(() => '---'),
    ...dataRows,
  ];

  return markdownRows
    .map(row => `| ${row.map(escapeMarkdownCell).join(' | ')} |`)
    .join('\n');
}
