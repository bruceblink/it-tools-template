import { normalizeCsvRows, parseCsv } from '@/utils/csv';

export interface CsvToJsonOptions {
  delimiter?: string
  expandDotNotation?: boolean
  hasHeader?: boolean
  inferTypes?: boolean
}

function inferCellValue(value: string): unknown {
  const trimmedValue = value.trim();

  if (trimmedValue === '') {
    return '';
  }

  if (trimmedValue === 'true') {
    return true;
  }

  if (trimmedValue === 'false') {
    return false;
  }

  if (trimmedValue === 'null') {
    return null;
  }

  if (/^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(trimmedValue)) {
    const numberValue = Number(trimmedValue);
    if (Number.isFinite(numberValue)) {
      return numberValue;
    }
  }

  return value;
}

function makeUniqueHeaders(headers: string[], width: number): string[] {
  const seen = new Map<string, number>();

  return Array.from({ length: width }, (_, index) => {
    const rawHeader = headers[index]?.trim() || `column${index + 1}`;
    const seenCount = seen.get(rawHeader) ?? 0;
    seen.set(rawHeader, seenCount + 1);

    return seenCount === 0 ? rawHeader : `${rawHeader}_${seenCount + 1}`;
  });
}

function assignRecordValue(record: Record<string, unknown>, header: string, value: unknown, expandDotNotation: boolean) {
  if (!expandDotNotation || !header.includes('.')) {
    record[header] = value;
    return;
  }

  const segments = header
    .split('.')
    .map(segment => segment.trim())
    .filter(Boolean);
  if (segments.length <= 1) {
    record[header] = value;
    return;
  }

  let target = record;
  for (const segment of segments.slice(0, -1)) {
    const existingValue = target[segment];
    if (existingValue === null || typeof existingValue !== 'object' || Array.isArray(existingValue)) {
      target[segment] = {};
    }

    target = target[segment] as Record<string, unknown>;
  }

  target[segments[segments.length - 1] ?? header] = value;
}

export function convertCsvToJson(input: string, options: CsvToJsonOptions = {}): string {
  if (input === '') {
    return '';
  }

  const rows = normalizeCsvRows(parseCsv(input, { delimiter: options.delimiter }));
  if (rows.length === 0) {
    return '[]';
  }

  const firstRow = rows[0] ?? [];
  const hasHeader = options.hasHeader ?? true;
  const inferTypes = options.inferTypes ?? false;
  const expandDotNotation = options.expandDotNotation ?? false;
  const headers = hasHeader
    ? makeUniqueHeaders(firstRow, firstRow.length)
    : makeUniqueHeaders([], firstRow.length);
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const records = dataRows.map((row) => {
    const record: Record<string, unknown> = {};

    headers.forEach((header, index) => {
      assignRecordValue(
        record,
        header,
        inferTypes ? inferCellValue(row[index] ?? '') : row[index] ?? '',
        expandDotNotation,
      );
    });

    return record;
  });

  return JSON.stringify(records, null, 2);
}
