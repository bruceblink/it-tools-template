export type CookieSource = 'request' | 'response';

export interface ParsedCookieAttribute {
  name: string
  value: string | true
}

export interface ParsedCookie {
  source: CookieSource
  name: string
  value: string
  decodedValue: string
  attributes: ParsedCookieAttribute[]
  warnings: string[]
}

export interface CookieParseResult {
  cookies: ParsedCookie[]
  requestCookies: ParsedCookie[]
  responseCookies: ParsedCookie[]
  json: Record<string, string | string[]>
}

const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const SET_COOKIE_ATTRIBUTES = new Set([
  'domain',
  'expires',
  'httponly',
  'max-age',
  'partitioned',
  'path',
  'priority',
  'samesite',
  'secure',
]);
const HTTP_STATUS_LINE_PATTERN = /^HTTP\/\d(?:\.\d)?\s+\d{3}\b/i;

function splitFirst(value: string, delimiter: string): [string, string] {
  const delimiterIndex = value.indexOf(delimiter);
  if (delimiterIndex === -1) {
    return [value, ''];
  }

  return [value.slice(0, delimiterIndex), value.slice(delimiterIndex + delimiter.length)];
}

function splitCookieSegments(value: string): string[] {
  return value
    .split(';')
    .map(segment => segment.trim())
    .filter(Boolean);
}

function decodeCookieValue(value: string): { value: string, warning?: string } {
  try {
    return { value: decodeURIComponent(value) };
  }
  catch {
    return {
      value,
      warning: 'Value is not valid percent-encoded data.',
    };
  }
}

function assertCookieName(name: string): void {
  if (!COOKIE_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid cookie name: ${name || '(empty)'}`);
  }
}

function appendJsonValue(json: Record<string, string | string[]>, name: string, value: string): void {
  const currentValue = json[name];
  if (currentValue === undefined) {
    json[name] = value;
    return;
  }

  json[name] = Array.isArray(currentValue) ? [...currentValue, value] : [currentValue, value];
}

function parseCookiePair(segment: string, source: CookieSource): ParsedCookie {
  const delimiterIndex = segment.indexOf('=');
  if (delimiterIndex === -1) {
    throw new Error(`Cookie "${segment}" is missing a value.`);
  }

  const name = segment.slice(0, delimiterIndex).trim();
  assertCookieName(name);
  const value = segment.slice(delimiterIndex + 1).trim();
  const decoded = decodeCookieValue(value);

  return {
    source,
    name,
    value,
    decodedValue: decoded.value,
    attributes: [],
    warnings: decoded.warning ? [decoded.warning] : [],
  };
}

function parseAttribute(segment: string): ParsedCookieAttribute {
  const [rawName, rawValue] = splitFirst(segment, '=');
  const name = rawName.trim();

  if (!name) {
    throw new Error('Cookie attribute name cannot be empty.');
  }

  return {
    name,
    value: rawValue === '' ? true : rawValue.trim(),
  };
}

function hasAttribute(cookie: ParsedCookie, name: string): boolean {
  return cookie.attributes.some(attribute => attribute.name.toLowerCase() === name.toLowerCase());
}

function getAttributeValue(cookie: ParsedCookie, name: string): string | undefined {
  const attribute = cookie.attributes.find(({ name: attributeName }) => attributeName.toLowerCase() === name.toLowerCase());
  return typeof attribute?.value === 'string' ? attribute.value : undefined;
}

function addResponseWarnings(cookie: ParsedCookie): void {
  if (!hasAttribute(cookie, 'secure')) {
    cookie.warnings.push('Missing Secure attribute.');
  }

  if (!hasAttribute(cookie, 'httponly')) {
    cookie.warnings.push('Missing HttpOnly attribute.');
  }

  const sameSite = getAttributeValue(cookie, 'samesite');
  if (!sameSite) {
    cookie.warnings.push('Missing SameSite attribute.');
  }
  else if (!['strict', 'lax', 'none'].includes(sameSite.toLowerCase())) {
    cookie.warnings.push('SameSite has an unexpected value.');
  }
  else if (sameSite.toLowerCase() === 'none' && !hasAttribute(cookie, 'secure')) {
    cookie.warnings.push('SameSite=None requires Secure.');
  }

  const maxAge = getAttributeValue(cookie, 'max-age');
  if (maxAge !== undefined && !Number.isFinite(Number(maxAge))) {
    cookie.warnings.push('Max-Age is not a valid number of seconds.');
  }

  const expires = getAttributeValue(cookie, 'expires');
  if (expires !== undefined && Number.isNaN(Date.parse(expires))) {
    cookie.warnings.push('Expires is not a valid HTTP date.');
  }
}

function parseRequestCookieHeader(value: string): ParsedCookie[] {
  return splitCookieSegments(value).map(segment => parseCookiePair(segment, 'request'));
}

function parseSetCookieHeader(value: string): ParsedCookie {
  const [cookieSegment, ...attributeSegments] = splitCookieSegments(value);
  if (!cookieSegment) {
    throw new Error('Set-Cookie header is empty.');
  }

  const cookie = parseCookiePair(cookieSegment, 'response');
  cookie.attributes = attributeSegments.map(parseAttribute);
  addResponseWarnings(cookie);

  return cookie;
}

function looksLikeSetCookie(value: string): boolean {
  const [, ...attributeSegments] = splitCookieSegments(value);

  return attributeSegments.some((segment) => {
    const [name] = splitFirst(segment, '=');
    return SET_COOKIE_ATTRIBUTES.has(name.trim().toLowerCase());
  });
}

function parseLine(line: string): ParsedCookie[] {
  const trimmedLine = line.trim();
  const [rawHeaderName, rawHeaderValue] = splitFirst(trimmedLine, ':');
  const headerName = rawHeaderName.trim().toLowerCase();
  const headerValue = rawHeaderValue.trim();

  if (rawHeaderValue !== '' && headerName === 'cookie') {
    return parseRequestCookieHeader(headerValue);
  }

  if (rawHeaderValue !== '' && headerName === 'set-cookie') {
    return [parseSetCookieHeader(headerValue)];
  }

  if (HTTP_STATUS_LINE_PATTERN.test(trimmedLine)) {
    return [];
  }

  if (rawHeaderValue !== '') {
    return [];
  }

  if (looksLikeSetCookie(trimmedLine)) {
    return [parseSetCookieHeader(trimmedLine)];
  }

  return parseRequestCookieHeader(trimmedLine);
}

export function parseCookies(input: string): CookieParseResult {
  const cookies = input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(parseLine);
  const requestCookies = cookies.filter(({ source }) => source === 'request');
  const responseCookies = cookies.filter(({ source }) => source === 'response');
  const json: Record<string, string | string[]> = {};

  for (const cookie of cookies) {
    appendJsonValue(json, cookie.name, cookie.decodedValue);
  }

  return {
    cookies,
    requestCookies,
    responseCookies,
    json,
  };
}
