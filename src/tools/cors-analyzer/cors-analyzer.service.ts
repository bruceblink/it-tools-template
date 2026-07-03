import { parseHttpHeaders } from '../http-headers-parser/http-headers-parser.service';

export type CorsCheckStatus = 'pass' | 'warning' | 'fail';

export interface CorsCheck {
  name: string
  status: CorsCheckStatus
  value: string
  summary: string
  recommendation: string
}

export interface CorsAnalysis {
  allowOrigin: string
  allowCredentials: boolean
  allowMethods: string[]
  allowHeaders: string[]
  exposeHeaders: string[]
  maxAge: string
  vary: string[]
  checks: CorsCheck[]
  passed: number
  warnings: number
  failed: number
}

type HeaderMap = Record<string, string[] | undefined>;

const SIMPLE_METHODS = new Set(['GET', 'HEAD', 'POST']);

function createHeaderMap(input: string): HeaderMap {
  const parsedHeaders = parseHttpHeaders(input);

  return parsedHeaders.headers.reduce<HeaderMap>((headers, header) => {
    const key = header.normalizedName.toLowerCase();
    headers[key] ??= [];
    headers[key]?.push(header.value);
    return headers;
  }, {});
}

function getHeaderValues(headers: HeaderMap, name: string): string[] {
  return headers[name.toLowerCase()] ?? [];
}

function getHeaderValue(headers: HeaderMap, name: string): string {
  return getHeaderValues(headers, name).join(', ');
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseMethods(value: string): string[] {
  return splitCsv(value).map(method => method.toUpperCase());
}

function parseMaxAge(value: string): number | undefined {
  if (!/^\d+$/.test(value.trim())) {
    return undefined;
  }

  return Number(value);
}

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) {
    return 'Not specified';
  }

  if (seconds === 0) {
    return '0 seconds';
  }

  const units = [
    { label: 'day', value: 86_400 },
    { label: 'hour', value: 3_600 },
    { label: 'minute', value: 60 },
  ];

  for (const unit of units) {
    if (seconds >= unit.value && seconds % unit.value === 0) {
      const amount = seconds / unit.value;
      return `${amount} ${unit.label}${amount === 1 ? '' : 's'}`;
    }
  }

  return `${seconds} seconds`;
}

function check(
  name: string,
  status: CorsCheckStatus,
  value: string,
  summary: string,
  recommendation: string,
): CorsCheck {
  return { name, status, value, summary, recommendation };
}

function analyzeChecks(headers: HeaderMap): CorsCheck[] {
  const allowOrigin = getHeaderValue(headers, 'access-control-allow-origin');
  const allowCredentials = getHeaderValue(headers, 'access-control-allow-credentials').toLowerCase() === 'true';
  const allowMethods = parseMethods(getHeaderValue(headers, 'access-control-allow-methods'));
  const allowHeaders = splitCsv(getHeaderValue(headers, 'access-control-allow-headers'));
  const exposeHeaders = splitCsv(getHeaderValue(headers, 'access-control-expose-headers'));
  const maxAgeValue = getHeaderValue(headers, 'access-control-max-age');
  const maxAge = maxAgeValue ? parseMaxAge(maxAgeValue) : undefined;
  const vary = splitCsv(getHeaderValue(headers, 'vary')).map(value => value.toLowerCase());
  const usesWildcardOrigin = allowOrigin === '*';
  const usesReflectedOrigin = allowOrigin.toLowerCase() === 'null' || allowOrigin.toLowerCase() === 'origin';

  return [
    allowOrigin
      ? check('Allowed origin', usesReflectedOrigin ? 'warning' : 'pass', allowOrigin, 'CORS origin policy is explicit.', 'Allow only trusted origins and avoid reflecting arbitrary Origin values.')
      : check('Allowed origin', 'fail', '', 'Access-Control-Allow-Origin is missing.', 'Add Access-Control-Allow-Origin when this response is intended for cross-origin browsers.'),

    usesWildcardOrigin && allowCredentials
      ? check('Credentials', 'fail', 'true', 'Wildcard origins cannot be used with credentials.', 'Use a specific origin when Access-Control-Allow-Credentials is true.')
      : check(
          'Credentials',
          allowCredentials ? 'warning' : 'pass',
          allowCredentials ? 'true' : 'false',
          allowCredentials ? 'Cross-origin credentials are allowed.' : 'Cross-origin credentials are not allowed.',
          allowCredentials ? 'Allow credentials only for trusted origins and authenticated flows.' : 'Keep credentials disabled for public APIs.',
        ),

    allowMethods.length > 0
      ? check(
          'Allowed methods',
          allowMethods.some(method => !SIMPLE_METHODS.has(method)) ? 'warning' : 'pass',
          allowMethods.join(', '),
          'Preflight methods are declared.',
          'Keep the method list as small as the API requires.',
        )
      : check('Allowed methods', 'warning', '', 'Access-Control-Allow-Methods is missing.', 'Add Access-Control-Allow-Methods for preflighted endpoints.'),

    allowHeaders.length > 0
      ? check(
          'Allowed headers',
          allowHeaders.includes('*') ? 'warning' : 'pass',
          allowHeaders.join(', '),
          'Preflight request headers are declared.',
          'List concrete request headers instead of using broad wildcards for credentialed APIs.',
        )
      : check('Allowed headers', 'warning', '', 'Access-Control-Allow-Headers is missing.', 'Declare the non-simple request headers accepted by the API.'),

    exposeHeaders.includes('*') && allowCredentials
      ? check('Exposed headers', 'warning', exposeHeaders.join(', '), 'Wildcard exposed headers are ineffective for credentialed requests.', 'List the response headers that browser JavaScript should read.')
      : check(
          'Exposed headers',
          exposeHeaders.length > 0 ? 'pass' : 'warning',
          exposeHeaders.join(', '),
          exposeHeaders.length > 0 ? 'Response headers are exposed to browser JavaScript.' : 'No custom response headers are exposed.',
          'Expose only headers that client code needs to read.',
        ),

    maxAgeValue
      ? check(
          'Preflight cache',
          maxAge === undefined ? 'fail' : maxAge > 86_400 ? 'warning' : 'pass',
          maxAgeValue,
          maxAge === undefined ? 'Access-Control-Max-Age is invalid.' : `Preflight cache lifetime is ${formatDuration(maxAge)}.`,
          'Use a non-negative number of seconds and keep it aligned with policy change frequency.',
        )
      : check('Preflight cache', 'warning', '', 'Preflight caching is not configured.', 'Set Access-Control-Max-Age to reduce repeated preflight requests.'),

    allowOrigin && !usesWildcardOrigin && !vary.includes('origin')
      ? check('Vary origin', 'warning', getHeaderValue(headers, 'vary'), 'Specific CORS origins should vary on Origin.', 'Add Vary: Origin when Access-Control-Allow-Origin changes per request.')
      : check('Vary origin', 'pass', getHeaderValue(headers, 'vary'), 'No Vary: Origin issue detected.', 'Keep Vary aligned with origin reflection and caches.'),
  ];
}

export function analyzeCors(input: string): CorsAnalysis {
  const headers = createHeaderMap(input);
  const allowMethods = parseMethods(getHeaderValue(headers, 'access-control-allow-methods'));
  const allowHeaders = splitCsv(getHeaderValue(headers, 'access-control-allow-headers'));
  const exposeHeaders = splitCsv(getHeaderValue(headers, 'access-control-expose-headers'));
  const maxAgeValue = getHeaderValue(headers, 'access-control-max-age');
  const checks = analyzeChecks(headers);

  return {
    allowOrigin: getHeaderValue(headers, 'access-control-allow-origin'),
    allowCredentials: getHeaderValue(headers, 'access-control-allow-credentials').toLowerCase() === 'true',
    allowMethods,
    allowHeaders,
    exposeHeaders,
    maxAge: maxAgeValue ? formatDuration(parseMaxAge(maxAgeValue)) : 'Not specified',
    vary: splitCsv(getHeaderValue(headers, 'vary')),
    checks,
    passed: checks.filter(({ status }) => status === 'pass').length,
    warnings: checks.filter(({ status }) => status === 'warning').length,
    failed: checks.filter(({ status }) => status === 'fail').length,
  };
}
