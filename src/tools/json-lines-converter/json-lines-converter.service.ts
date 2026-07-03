import JSON5 from 'json5';

export type JsonLinesDirection = 'json-to-jsonl' | 'jsonl-to-json';

export interface JsonLinesConverterOptions {
  ignoreEmptyLines?: boolean
  indentSize?: number
}

export interface JsonLinesSummary {
  inputLines: number
  outputValues: number
  emptyLines: number
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

export function summarizeJsonLines(
  input: string,
  direction: JsonLinesDirection,
  options: JsonLinesConverterOptions = {},
): JsonLinesSummary {
  if (input.trim() === '') {
    return {
      inputLines: 0,
      outputValues: 0,
      emptyLines: 0,
    };
  }

  if (direction === 'json-to-jsonl') {
    const values = normalizeJsonLineValue(JSON5.parse(input));

    return {
      inputLines: input.split(/\r?\n/).length,
      outputValues: values.length,
      emptyLines: input.split(/\r?\n/).filter(line => line.trim() === '').length,
    };
  }

  const ignoreEmptyLines = options.ignoreEmptyLines ?? true;
  const lines = input.split(/\r?\n/);
  const emptyLines = lines.filter(line => line.trim() === '').length;
  const outputValues = lines.filter(line => line.trim() !== '').length;

  if (!ignoreEmptyLines && emptyLines > 0) {
    convertJsonLinesToJson(input, options);
  }

  return {
    inputLines: lines.length,
    outputValues,
    emptyLines,
  };
}
