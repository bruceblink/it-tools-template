export interface CsvParseOptions {
  delimiter?: string
  skipEmptyLines?: boolean
}

export function parseCsv(input: string, options: CsvParseOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ',';
  const skipEmptyLines = options.skipEmptyLines ?? true;

  if (delimiter.length !== 1) {
    throw new Error('CSV delimiter must be a single character.');
  }

  if (input === '') {
    return [];
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotedField = false;
  let fieldStartedWithQuote = false;
  let justClosedQuote = false;

  const pushRow = () => {
    const nextRow = [...row, field];
    if (!skipEmptyLines || nextRow.some(cell => cell !== '')) {
      rows.push(nextRow);
    }

    row = [];
    field = '';
    fieldStartedWithQuote = false;
    justClosedQuote = false;
  };

  const pushField = () => {
    row.push(field);
    field = '';
    fieldStartedWithQuote = false;
    justClosedQuote = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? '';

    if (inQuotedField) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        }
        else {
          inQuotedField = false;
          justClosedQuote = true;
        }
      }
      else {
        field += char;
      }

      continue;
    }

    if (char === '"' && field === '' && !fieldStartedWithQuote) {
      inQuotedField = true;
      fieldStartedWithQuote = true;
      continue;
    }

    if (justClosedQuote && char !== delimiter && char !== '\n' && char !== '\r') {
      if (char.trim() === '') {
        continue;
      }

      throw new Error('Unexpected character after closing quote.');
    }

    if (char === delimiter) {
      pushField();
      continue;
    }

    if (char === '\n') {
      pushRow();
      continue;
    }

    if (char === '\r') {
      if (input[index + 1] === '\n') {
        index += 1;
      }
      pushRow();
      continue;
    }

    field += char;
  }

  if (inQuotedField) {
    throw new Error('Unterminated quoted CSV field.');
  }

  if (field !== '' || row.length > 0 || input.endsWith(delimiter)) {
    pushRow();
  }

  return rows;
}

export function normalizeCsvRows(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map(row => row.length));
  return rows.map(row => Array.from({ length: width }, (_, index) => row[index] ?? ''));
}
