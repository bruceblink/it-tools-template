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
  expiresAt?: string
  expired?: boolean
  warnings: string[]
}

export interface CookieParseResult {
  cookies: ParsedCookie[]
  requestCookies: ParsedCookie[]
  responseCookies: ParsedCookie[]
  requestHeader: string
  responseHeaders: string
  json: Record<string, string | string[]>
}

export interface CookieParseOptions {
  now?: Date
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

function addExpirationDetails(cookie: ParsedCookie, now: Date): void {
  const maxAge = getAttributeValue(cookie, 'max-age');
  if (maxAge !== undefined) {
    const maxAgeSeconds = Number(maxAge);
    if (Number.isFinite(maxAgeSeconds)) {
      const expiresAt = new Date(now.getTime() + (maxAgeSeconds * 1000));
      cookie.expiresAt = expiresAt.toISOString();
      cookie.expired = maxAgeSeconds <= 0;
    }
  }

  const expires = getAttributeValue(cookie, 'expires');
  if (cookie.expiresAt === undefined && expires !== undefined) {
    const expiresTime = Date.parse(expires);
    if (!Number.isNaN(expiresTime)) {
      cookie.expiresAt = new Date(expiresTime).toISOString();
      cookie.expired = expiresTime <= now.getTime();
    }
  }
}

function addResponseWarnings(cookie: ParsedCookie, now: Date): void {
  addExpirationDetails(cookie, now);

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

  if (cookie.name.startsWith('__Secure-') && !hasAttribute(cookie, 'secure')) {
    cookie.warnings.push('__Secure- cookies require Secure.');
  }

  if (cookie.name.startsWith('__Host-')) {
    const path = getAttributeValue(cookie, 'path');

    if (!hasAttribute(cookie, 'secure')) {
      cookie.warnings.push('__Host- cookies require Secure.');
    }

    if (hasAttribute(cookie, 'domain')) {
      cookie.warnings.push('__Host- cookies must not include Domain.');
    }

    if (path !== '/') {
      cookie.warnings.push('__Host- cookies require Path=/.');
    }
  }

  if (hasAttribute(cookie, 'partitioned') && !hasAttribute(cookie, 'secure')) {
    cookie.warnings.push('Partitioned cookies require Secure.');
  }
}

function serializeCookiePair(cookie: ParsedCookie): string {
  return `${cookie.name}=${cookie.value}`;
}

function serializeSetCookie(cookie: ParsedCookie): string {
  const attributes = cookie.attributes.map(({ name, value }) => value === true ? name : `${name}=${value}`);

  return [`Set-Cookie: ${serializeCookiePair(cookie)}`, ...attributes].join('; ');
}

function buildRequestHeader(cookies: ParsedCookie[]): string {
  if (cookies.length === 0) {
    return '';
  }

  return `Cookie: ${cookies.map(serializeCookiePair).join('; ')}`;
}

function buildResponseHeaders(cookies: ParsedCookie[]): string {
  return cookies.map(serializeSetCookie).join('\n');
}

function parseRequestCookieHeader(value: string): ParsedCookie[] {
  return splitCookieSegments(value).map(segment => parseCookiePair(segment, 'request'));
}

function parseSetCookieHeader(value: string, now: Date): ParsedCookie {
  const [cookieSegment, ...attributeSegments] = splitCookieSegments(value);
  if (!cookieSegment) {
    throw new Error('Set-Cookie header is empty.');
  }

  const cookie = parseCookiePair(cookieSegment, 'response');
  cookie.attributes = attributeSegments.map(parseAttribute);
  addResponseWarnings(cookie, now);

  return cookie;
}

function looksLikeSetCookie(value: string): boolean {
  const [, ...attributeSegments] = splitCookieSegments(value);

  return attributeSegments.some((segment) => {
    const [name] = splitFirst(segment, '=');
    return SET_COOKIE_ATTRIBUTES.has(name.trim().toLowerCase());
  });
}

function parseLine(line: string, now: Date): ParsedCookie[] {
  const trimmedLine = line.trim();
  const [rawHeaderName, rawHeaderValue] = splitFirst(trimmedLine, ':');
  const headerName = rawHeaderName.trim().toLowerCase();
  const headerValue = rawHeaderValue.trim();

  if (rawHeaderValue !== '' && headerName === 'cookie') {
    return parseRequestCookieHeader(headerValue);
  }

  if (rawHeaderValue !== '' && headerName === 'set-cookie') {
    return [parseSetCookieHeader(headerValue, now)];
  }

  if (HTTP_STATUS_LINE_PATTERN.test(trimmedLine)) {
    return [];
  }

  if (rawHeaderValue !== '') {
    return [];
  }

  if (looksLikeSetCookie(trimmedLine)) {
    return [parseSetCookieHeader(trimmedLine, now)];
  }

  return parseRequestCookieHeader(trimmedLine);
}

export function parseCookies(input: string, { now = new Date() }: CookieParseOptions = {}): CookieParseResult {
  const cookies = input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => parseLine(line, now));
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
    requestHeader: buildRequestHeader(requestCookies),
    responseHeaders: buildResponseHeaders(responseCookies),
    json,
  };
}
