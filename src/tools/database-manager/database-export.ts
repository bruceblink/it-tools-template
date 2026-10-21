import type { PostgresDataCell } from '@/shared/desktop-services/database';

export type DatabaseExportFormat = 'csv' | 'jsonl';

export interface DatabaseExportColumn {
  name: string
  dataType: string
}

/** Serialize only the already bounded page held by the renderer; never fetches more rows. */
export function serializeDatabasePage(
  columns: DatabaseExportColumn[],
  rows: Array<{ cells: PostgresDataCell[] }>,
  format: DatabaseExportFormat,
): string {
  const records = rows.map(row => Object.fromEntries(
    columns.map((column, index) => [column.name, row.cells[index]?.value ?? null]),
  ));

  if (format === 'jsonl') {
    return records.map(record => JSON.stringify(record)).join('\n');
  }

  const header = columns.map(column => escapeCsvValue(column.name)).join(',');
  const lines = rows.map(row => columns.map((_, index) => escapeCsvValue(row.cells[index]?.value ?? null)).join(','));
  return [header, ...lines].join('\n');
}

function escapeCsvValue(value: string | null): string {
  if (value === null) {
    return '';
  }
  const escaped = value.replaceAll('"', '""');
  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
}
