import { textToBase64 } from '@/utils/base64';

export type CurlCodeOutput = 'fetch' | 'axios' | 'httpie';

export interface CurlHeader {
  name: string
  value: string
}

export interface CurlRequest {
  url: string
  method: string
  headers: CurlHeader[]
  data: string
  compressed: boolean
  warnings: string[]
}

export interface CurlCodeGeneration {
  request: CurlRequest
  fetch: string
  axios: string
  httpie: string
  summary: {
    method: string
    headerCount: number
    hasBody: boolean
    warningCount: number
  }
}

export class CurlCodeGeneratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CurlCodeGeneratorError';
  }
}

const DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii']);
const HEADER_FLAGS = new Set(['-H', '--header']);
const METHOD_FLAGS = new Set(['-X', '--request']);
const USER_FLAGS = new Set(['-u', '--user']);
const IGNORED_FLAGS = new Set(['--location', '-L', '--silent', '-s', '--verbose', '-v', '--insecure', '-k']);
const UNSUPPORTED_VALUE_FLAGS = new Set([
  '--connect-timeout',
  '--cookie',
  '-b',
  '--max-time',
  '-m',
  '--output',
  '-o',
  '--proxy',
  '-x',
  '--referer',
  '-e',
  '--retry',
  '--url',
  '--user-agent',
  '-A',
]);

function tokenizeShell(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | '\'' | undefined;
  let escaped = false;

  for (const character of input.replace(/\\\r?\n/g, ' ')) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === '\\' && quote !== '\'') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === '\'') {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (escaped) {
    current += '\\';
  }

  if (quote) {
    throw new CurlCodeGeneratorError('Shell quote is not closed.');
  }

  if (current !== '') {
    tokens.push(current);
  }

  return tokens;
}

function consumeValue(tokens: string[], index: number, flag: string): { value: string, nextIndex: number } {
  const value = tokens[index + 1];
  if (value === undefined) {
    throw new CurlCodeGeneratorError(`${flag} is missing a value.`);
  }

  return {
    value,
    nextIndex: index + 2,
  };
}

function parseHeader(value: string): CurlHeader {
  const colonIndex = value.indexOf(':');
  if (colonIndex <= 0) {
    throw new CurlCodeGeneratorError(`Invalid header "${value}".`);
  }

  return {
    name: value.slice(0, colonIndex).trim(),
    value: value.slice(colonIndex + 1).trim(),
  };
}

function jsonString(value: string) {
  return JSON.stringify(value);
}

function indent(value: string, spaces = 2) {
  const padding = ' '.repeat(spaces);
  return value.split('\n').map(line => `${padding}${line}`).join('\n');
}

function normalizeMethod(method: string, data: string, isHead: boolean) {
  if (isHead) {
    return 'HEAD';
  }

  if (method) {
    return method.toUpperCase();
  }

  return data === '' ? 'GET' : 'POST';
}

function createHeaderObject(headers: CurlHeader[]) {
  if (headers.length === 0) {
    return '';
  }

  return `{\n${headers.map(({ name, value }) => `  ${jsonString(name)}: ${jsonString(value)},`).join('\n')}\n}`;
}

function createFetchCode(request: CurlRequest) {
  const options: string[] = [`method: ${jsonString(request.method)}`];
  const headerObject = createHeaderObject(request.headers);

  if (headerObject) {
    options.push(`headers: ${indent(headerObject, 2).trimStart()}`);
  }

  if (request.data !== '') {
    options.push(`body: ${jsonString(request.data)}`);
  }

  return [
    `const response = await fetch(${jsonString(request.url)}, {`,
    options.map(option => `  ${option}`).join(',\n'),
    '});',
    '',
    'const data = await response.text();',
    'console.log(data);',
  ].join('\n');
}

function createAxiosCode(request: CurlRequest) {
  const lines = [
    'const response = await axios({',
    `  method: ${jsonString(request.method.toLowerCase())},`,
    `  url: ${jsonString(request.url)},`,
  ];
  const headerObject = createHeaderObject(request.headers);

  if (headerObject) {
    lines.push(`  headers: ${indent(headerObject, 2).trimStart()},`);
  }

  if (request.data !== '') {
    lines.push(`  data: ${jsonString(request.data)},`);
  }

  lines.push('});', '');
  lines.push('console.log(response.data);');

  return lines.join('\n');
}

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function createHttpieCode(request: CurlRequest) {
  const parts = ['http', request.method, shellSingleQuote(request.url)];
  for (const header of request.headers) {
    parts.push(`${shellSingleQuote(`${header.name}:${header.value}`)}`);
  }

  if (request.data !== '') {
    parts.push(`<<< ${shellSingleQuote(request.data)}`);
  }

  return parts.join(' \\\n  ');
}

function addBasicAuthHeader(headers: CurlHeader[], credentials: string) {
  if (headers.some(({ name }) => name.toLowerCase() === 'authorization')) {
    return;
  }

  headers.push({
    name: 'Authorization',
    value: `Basic ${textToBase64(credentials)}`,
  });
}

export function parseCurlCommand(input: string): CurlRequest {
  const tokens = tokenizeShell(input.trim());
  if (tokens.length === 0) {
    throw new CurlCodeGeneratorError('Paste a cURL command.');
  }

  if (tokens[0] !== 'curl') {
    throw new CurlCodeGeneratorError('Command must start with curl.');
  }

  let url = '';
  let method = '';
  let data = '';
  let compressed = false;
  let isHead = false;
  const headers: CurlHeader[] = [];
  const warnings: string[] = [];
  let index = 1;

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) {
      index += 1;
      continue;
    }

    if (METHOD_FLAGS.has(token)) {
      const consumed = consumeValue(tokens, index, token);
      method = consumed.value;
      index = consumed.nextIndex;
      continue;
    }

    if (HEADER_FLAGS.has(token)) {
      const consumed = consumeValue(tokens, index, token);
      headers.push(parseHeader(consumed.value));
      index = consumed.nextIndex;
      continue;
    }

    if (DATA_FLAGS.has(token)) {
      const consumed = consumeValue(tokens, index, token);
      data = data === '' ? consumed.value : `${data}&${consumed.value}`;
      index = consumed.nextIndex;
      continue;
    }

    if (USER_FLAGS.has(token)) {
      const consumed = consumeValue(tokens, index, token);
      addBasicAuthHeader(headers, consumed.value);
      index = consumed.nextIndex;
      continue;
    }

    if (token === '--compressed') {
      compressed = true;
      index += 1;
      continue;
    }

    if (token === '-I' || token === '--head') {
      isHead = true;
      index += 1;
      continue;
    }

    if (IGNORED_FLAGS.has(token)) {
      warnings.push(`Option ${token} was ignored.`);
      index += 1;
      continue;
    }

    if (UNSUPPORTED_VALUE_FLAGS.has(token)) {
      const consumed = consumeValue(tokens, index, token);
      warnings.push(`Unsupported option ${token} was ignored.`);
      index = consumed.nextIndex;
      continue;
    }

    if (token.startsWith('-')) {
      warnings.push(`Unsupported option ${token} was ignored.`);
      index += 1;
      continue;
    }

    if (url === '') {
      url = token;
    }
    else {
      warnings.push(`Extra argument "${token}" was ignored.`);
    }
    index += 1;
  }

  if (url === '') {
    throw new CurlCodeGeneratorError('cURL command is missing a URL.');
  }

  return {
    url,
    method: normalizeMethod(method, data, isHead),
    headers,
    data,
    compressed,
    warnings,
  };
}

export function generateCurlCode(input: string): CurlCodeGeneration {
  const request = parseCurlCommand(input);

  return {
    request,
    fetch: createFetchCode(request),
    axios: createAxiosCode(request),
    httpie: createHttpieCode(request),
    summary: {
      method: request.method,
      headerCount: request.headers.length,
      hasBody: request.data !== '',
      warningCount: request.warnings.length,
    },
  };
}

export function formatCurlCode(input: string, output: CurlCodeOutput): string {
  const generation = generateCurlCode(input);

  if (output === 'axios') {
    return generation.axios;
  }

  if (output === 'httpie') {
    return generation.httpie;
  }

  return generation.fetch;
}
