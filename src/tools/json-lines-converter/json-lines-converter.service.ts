import JSON5 from 'json5';

export type JsonLinesDirection = 'json-to-jsonl' | 'jsonl-to-json';

export interface JsonLinesConverterOptions {
  ignoreEmptyLines?: boolean
  indentSize?: number
}

export class JsonLinesConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonLinesConversionError';
  }
}

function normalizeJsonLineValue(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value !== null && typeof value === 'object') {
    return [value];
  }

  throw new JsonLinesConversionError('JSON input must be an object or an array.');
}

export function convertJsonToJsonLines(input: string): string {
  if (input.trim() === '') {
    return '';
  }

  return normalizeJsonLineValue(JSON5.parse(input))
    .map(item => JSON.stringify(item))
    .join('\n');
}

export function convertJsonLinesToJson(input: string, options: JsonLinesConverterOptions = {}): string {
  const ignoreEmptyLines = options.ignoreEmptyLines ?? true;
  const indentSize = options.indentSize ?? 2;

  if (input.trim() === '') {
    return '';
  }

  const values = input
    .split(/\r?\n/)
    .flatMap((line, index) => {
      if (line.trim() === '') {
        if (ignoreEmptyLines) {
          return [];
        }

        throw new JsonLinesConversionError(`Line ${index + 1} is empty.`);
      }

      try {
        return [JSON.parse(line)];
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new JsonLinesConversionError(`Line ${index + 1} is not valid JSON: ${message}`);
      }
    });

  return JSON.stringify(values, null, indentSize);
}

export function convertJsonLines(
  input: string,
  direction: JsonLinesDirection,
  options: JsonLinesConverterOptions = {},
): string {
  return direction === 'json-to-jsonl'
    ? convertJsonToJsonLines(input)
    : convertJsonLinesToJson(input, options);
}
