export interface ParsedHttpHeader {
  name: string
  normalizedName: string
  value: string
}

export interface ParsedDuplicateHeader {
  name: string
  values: string[]
}

export interface ParsedHttpHeaders {
  startLine: string
  headers: ParsedHttpHeader[]
  duplicates: ParsedDuplicateHeader[]
  warnings: string[]
  json: Record<string, string | string[]>
  normalizedText: string
  curlHeaders: string
}

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SENSITIVE_HEADER_NAMES = new Set([
  'Api-Key',
  'Authorization',
  'Cookie',
  'Proxy-Authorization',
  'Set-Cookie',
  'X-Api-Key',
  'X-Auth-Token',
  'X-Csrf-Token',
  'X-Xsrf-Token',
]);

function normalizeHeaderName(name: string): string {
  return name
    .toLowerCase()
    .split('-')
    .map((part) => {
      const firstLetter = part[0];
      return firstLetter ? firstLetter.toUpperCase() + part.slice(1) : part;
    })
    .join('-');
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function toHeaderJson(headers: ParsedHttpHeader[]): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};

  for (const header of headers) {
    const existingValue = result[header.normalizedName];
    if (existingValue === undefined) {
      result[header.normalizedName] = header.value;
      continue;
    }

    result[header.normalizedName] = Array.isArray(existingValue)
      ? [...existingValue, header.value]
      : [existingValue, header.value];
  }

  return result;
}

function findDuplicateHeaders(headers: ParsedHttpHeader[]): ParsedDuplicateHeader[] {
  const groupedHeaders = headers.reduce<Record<string, string[]>>((accumulator, header) => {
    accumulator[header.normalizedName] ??= [];
    accumulator[header.normalizedName]?.push(header.value);
    return accumulator;
  }, {});

  return Object.entries(groupedHeaders)
    .filter(([, values]) => values.length > 1)
    .map(([name, values]) => ({ name, values }));
}

function findSensitiveHeaderWarnings(headers: ParsedHttpHeader[]): string[] {
  const sensitiveHeaders = headers
    .filter(({ normalizedName }) => SENSITIVE_HEADER_NAMES.has(normalizedName))
    .map(({ normalizedName }) => normalizedName);
  const uniqueSensitiveHeaders = [...new Set(sensitiveHeaders)];

  return uniqueSensitiveHeaders.length > 0
    ? [`Sensitive headers detected: ${uniqueSensitiveHeaders.join(', ')}.`]
    : [];
}

export function parseHttpHeaders(input: string): ParsedHttpHeaders {
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  const headers: ParsedHttpHeader[] = [];
  let startLine = '';

  for (const rawLine of lines) {
    if (rawLine.trim() === '') {
      continue;
    }

    if (/^\s/.test(rawLine)) {
      const previousHeader = headers[headers.length - 1];
      if (!previousHeader) {
        throw new Error('Header continuation line found before any header.');
      }

      previousHeader.value = `${previousHeader.value} ${rawLine.trim()}`.trim();
      continue;
    }

    const colonIndex = rawLine.indexOf(':');
    if (colonIndex === -1 && headers.length === 0 && startLine === '') {
      startLine = rawLine.trim();
      continue;
    }

    if (colonIndex <= 0) {
      throw new Error(`Invalid HTTP header line: ${rawLine}`);
    }

    const name = rawLine.slice(0, colonIndex).trim();
    if (!HEADER_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid HTTP header name: ${name}`);
    }

    headers.push({
      name,
      normalizedName: normalizeHeaderName(name),
      value: rawLine.slice(colonIndex + 1).trim(),
    });
  }

  const normalizedHeaderLines = headers.map(({ normalizedName, value }) => `${normalizedName}: ${value}`);
  const normalizedText = [startLine, ...normalizedHeaderLines].filter(Boolean).join('\n');
  const json = toHeaderJson(headers);

  return {
    startLine,
    headers,
    duplicates: findDuplicateHeaders(headers),
    warnings: findSensitiveHeaderWarnings(headers),
    json,
    normalizedText,
    curlHeaders: normalizedHeaderLines.map(header => `-H ${shellSingleQuote(header)}`).join(' \\\n  '),
  };
}
