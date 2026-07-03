import { parseHttpHeaders } from '../http-headers-parser/http-headers-parser.service';

export type CacheCheckStatus = 'pass' | 'warning' | 'fail';

export interface CacheDirective {
  name: string
  value: string | true
}

export interface CacheCheck {
  name: string
  status: CacheCheckStatus
  summary: string
  recommendation: string
}

export interface HttpCacheAnalysis {
  cacheControl: string
  directives: CacheDirective[]
  freshness: string
  sharedFreshness: string
  responseAge: string
  remainingFreshness: string
  staleWhileRevalidate: string
  staleIfError: string
  freshnessState: 'fresh' | 'stale' | 'unknown'
  cacheability: 'cacheable' | 'conditional' | 'not-cacheable' | 'unknown'
  validators: string[]
  vary: string[]
  checks: CacheCheck[]
  warnings: string[]
}

type HeaderMap = Record<string, string[] | undefined>;

const ONE_YEAR_SECONDS = 31_536_000;

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

function parseDirectives(value: string): CacheDirective[] {
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [rawName = '', ...rawValueParts] = part.split('=');
      const rawValue = rawValueParts.join('=').trim();

      return {
        name: rawName.trim().toLowerCase(),
        value: rawValue === '' ? true : rawValue.replace(/^"|"$/g, ''),
      };
    });
}

function getDirectiveValue(directives: CacheDirective[], name: string): string | undefined {
  const directive = directives.find(({ name: directiveName }) => directiveName === name);
  return typeof directive?.value === 'string' ? directive.value : undefined;
}

function hasDirective(directives: CacheDirective[], name: string): boolean {
  return directives.some(({ name: directiveName }) => directiveName === name);
}

function parseSeconds(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function parseIntegerSeconds(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

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
  status: CacheCheckStatus,
  summary: string,
  recommendation: string,
): CacheCheck {
  return { name, status, summary, recommendation };
}

function getVaryValues(headers: HeaderMap): string[] {
  return getHeaderValues(headers, 'vary')
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean);
}

function getValidators(headers: HeaderMap): string[] {
  return [
    getHeaderValue(headers, 'etag') ? 'ETag' : '',
    getHeaderValue(headers, 'last-modified') ? 'Last-Modified' : '',
  ].filter(Boolean);
}

function getFreshnessState(age: number | undefined, lifetime: number | undefined): HttpCacheAnalysis['freshnessState'] {
  if (age === undefined || lifetime === undefined) {
    return 'unknown';
  }

  return age <= lifetime ? 'fresh' : 'stale';
}

function getRemainingFreshness(age: number | undefined, lifetime: number | undefined): string {
  if (age === undefined || lifetime === undefined) {
    return 'Not specified';
  }

  return formatDuration(Math.max(lifetime - age, 0));
}

function getStaleReuseCheck({
  staleWhileRevalidate,
  staleIfError,
  hasInvalidStaleLifetime,
  hasNoStore,
  hasPrivate,
}: {
  staleWhileRevalidate: number | undefined
  staleIfError: number | undefined
  hasInvalidStaleLifetime: boolean
  hasNoStore: boolean
  hasPrivate: boolean
}): CacheCheck {
  if (hasInvalidStaleLifetime) {
    return check('Stale reuse', 'fail', 'stale-while-revalidate or stale-if-error is not a valid non-negative number of seconds.', 'Use integer seconds for stale reuse directives.');
  }

  if (staleWhileRevalidate !== undefined || staleIfError !== undefined) {
    return check(
      'Stale reuse',
      'pass',
      `stale-while-revalidate: ${formatDuration(staleWhileRevalidate)}, stale-if-error: ${formatDuration(staleIfError)}.`,
      'Keep stale reuse windows short enough for the resource risk profile.',
    );
  }

  if (hasNoStore || hasPrivate) {
    return check('Stale reuse', 'pass', 'Stale reuse is not enabled for this non-shared response.', 'Keep stale reuse disabled for sensitive or private responses.');
  }

  return check('Stale reuse', 'warning', 'No stale reuse directives were found.', 'Consider stale-while-revalidate or stale-if-error for resilient public cacheable resources.');
}

function inferCacheability(directives: CacheDirective[], validators: string[]): HttpCacheAnalysis['cacheability'] {
  if (hasDirective(directives, 'no-store') || hasDirective(directives, 'private')) {
    return 'not-cacheable';
  }

  const maxAge = parseSeconds(getDirectiveValue(directives, 'max-age'));
  const sharedMaxAge = parseSeconds(getDirectiveValue(directives, 's-maxage'));
  if (maxAge !== undefined || sharedMaxAge !== undefined || hasDirective(directives, 'public') || hasDirective(directives, 'immutable')) {
    return 'cacheable';
  }

  if (hasDirective(directives, 'no-cache') || validators.length > 0) {
    return 'conditional';
  }

  return 'unknown';
}

function analyzeChecks(headers: HeaderMap, directives: CacheDirective[], validators: string[], vary: string[]): CacheCheck[] {
  const cacheControl = getHeaderValue(headers, 'cache-control');
  const expires = getHeaderValue(headers, 'expires');
  const rawAge = getHeaderValue(headers, 'age');
  const age = rawAge ? parseIntegerSeconds(rawAge) : undefined;
  const rawMaxAge = getDirectiveValue(directives, 'max-age');
  const rawSharedMaxAge = getDirectiveValue(directives, 's-maxage');
  const rawStaleWhileRevalidate = getDirectiveValue(directives, 'stale-while-revalidate');
  const rawStaleIfError = getDirectiveValue(directives, 'stale-if-error');
  const maxAge = parseSeconds(rawMaxAge);
  const sharedMaxAge = parseSeconds(rawSharedMaxAge);
  const staleWhileRevalidate = parseSeconds(rawStaleWhileRevalidate);
  const staleIfError = parseSeconds(rawStaleIfError);
  const freshnessLifetime = sharedMaxAge ?? maxAge;
  const hasNoStore = hasDirective(directives, 'no-store');
  const hasPrivate = hasDirective(directives, 'private');
  const hasPublic = hasDirective(directives, 'public');
  const hasInvalidLifetime = (rawMaxAge !== undefined && maxAge === undefined)
    || (rawSharedMaxAge !== undefined && sharedMaxAge === undefined);
  const hasInvalidStaleLifetime = (rawStaleWhileRevalidate !== undefined && staleWhileRevalidate === undefined)
    || (rawStaleIfError !== undefined && staleIfError === undefined);
  const isStale = age !== undefined && freshnessLifetime !== undefined && age > freshnessLifetime;

  return [
    cacheControl
      ? check('Cache-Control', 'pass', 'Cache-Control is present.', 'Keep cache directives explicit for predictable browser and proxy behavior.')
      : check('Cache-Control', 'fail', 'Cache-Control is missing.', 'Add Cache-Control to define freshness, storage, and revalidation behavior.'),

    hasNoStore
      ? check('Storage policy', 'pass', 'Response is marked no-store.', 'Use no-store for sensitive or per-user responses.')
      : check(
          'Storage policy',
          hasPrivate || hasPublic ? 'pass' : 'warning',
          hasPrivate
            ? 'Response is limited to private caches.'
            : hasPublic
              ? 'Response explicitly allows shared caches.'
              : 'Response may be stored by shared caches if other directives allow it.',
          'Use private or no-store for personalized content.',
        ),

    hasInvalidLifetime
      ? check('Freshness lifetime', 'fail', 'max-age or s-maxage is not a valid non-negative number of seconds.', 'Use integer seconds for max-age and s-maxage.')
      : maxAge !== undefined || sharedMaxAge !== undefined
        ? check('Freshness lifetime', maxAge === 0 && sharedMaxAge === undefined ? 'warning' : 'pass', `Freshness is ${formatDuration(sharedMaxAge ?? maxAge)}.`, 'Tune max-age and s-maxage to match how often this resource changes.')
        : check('Freshness lifetime', expires ? 'warning' : 'fail', expires ? 'Freshness relies on Expires only.' : 'No explicit freshness lifetime was found.', 'Prefer Cache-Control max-age or s-maxage over Expires.'),

    validators.length > 0
      ? check('Validators', 'pass', `Validator headers present: ${validators.join(', ')}.`, 'Keep validators stable so clients can revalidate efficiently.')
      : check('Validators', hasNoStore ? 'pass' : 'warning', 'No ETag or Last-Modified validator was found.', 'Add ETag or Last-Modified for cacheable resources.'),

    vary.includes('*')
      ? check('Vary', 'fail', 'Vary: * prevents cache reuse.', 'Avoid Vary: *; vary only on the request headers that affect representation.')
      : check('Vary', vary.length > 0 ? 'pass' : 'warning', vary.length > 0 ? `Vary headers: ${vary.join(', ')}.` : 'No Vary header is present.', 'Set Vary when content depends on headers such as Accept-Encoding, Origin, or Authorization.'),

    hasPublic && hasPrivate
      ? check('Directive conflict', 'fail', 'Cache-Control contains both public and private.', 'Choose either public or private based on whether shared caches may store the response.')
      : check('Directive conflict', 'pass', 'No public/private conflict detected.', 'Keep cache directives internally consistent.'),

    maxAge !== undefined && maxAge > ONE_YEAR_SECONDS
      ? check('Long-lived cache', 'warning', 'max-age is longer than one year.', 'Use immutable fingerprinted URLs for very long cache lifetimes.')
      : check('Long-lived cache', 'pass', 'No excessive max-age detected.', 'For static assets, pair long max-age with content-hashed filenames.'),

    rawAge
      ? check(
          'Current age',
          age === undefined ? 'fail' : isStale ? 'warning' : 'pass',
          age === undefined
            ? 'Age is not a valid non-negative integer number of seconds.'
            : isStale
              ? `Response age is ${formatDuration(age)}, which is beyond its freshness lifetime.`
              : `Response age is ${formatDuration(age)} with ${getRemainingFreshness(age, freshnessLifetime)} remaining.`,
          'Use Age with max-age or s-maxage to understand whether an intermediary cache is serving fresh or stale content.',
        )
      : check('Current age', 'pass', 'No Age header was provided.', 'Age is usually added by shared caches; origin responses may omit it.'),

    getStaleReuseCheck({
      staleWhileRevalidate,
      staleIfError,
      hasInvalidStaleLifetime,
      hasNoStore,
      hasPrivate,
    }),

    getHeaderValue(headers, 'authorization') && !hasPrivate && !hasNoStore
      ? check('Authorization response', 'warning', 'Input includes Authorization but response is not private or no-store.', 'Protect authenticated responses with private or no-store unless explicitly public.')
      : check('Authorization response', 'pass', 'No Authorization cache risk detected.', 'Keep authenticated response caching explicit.'),
  ];
}

export function analyzeHttpCache(input: string): HttpCacheAnalysis {
  const headers = createHeaderMap(input);
  const cacheControl = getHeaderValue(headers, 'cache-control');
  const directives = parseDirectives(cacheControl);
  const validators = getValidators(headers);
  const vary = getVaryValues(headers);
  const age = parseIntegerSeconds(getHeaderValue(headers, 'age'));
  const maxAge = parseSeconds(getDirectiveValue(directives, 'max-age'));
  const sharedMaxAge = parseSeconds(getDirectiveValue(directives, 's-maxage'));
  const staleWhileRevalidate = parseSeconds(getDirectiveValue(directives, 'stale-while-revalidate'));
  const staleIfError = parseSeconds(getDirectiveValue(directives, 'stale-if-error'));
  const freshnessLifetime = sharedMaxAge ?? maxAge;
  const checks = analyzeChecks(headers, directives, validators, vary);
  const warnings = checks
    .filter(({ status }) => status !== 'pass')
    .map(({ summary }) => summary);

  return {
    cacheControl,
    directives,
    freshness: formatDuration(maxAge),
    sharedFreshness: formatDuration(sharedMaxAge),
    responseAge: formatDuration(age),
    remainingFreshness: getRemainingFreshness(age, freshnessLifetime),
    staleWhileRevalidate: formatDuration(staleWhileRevalidate),
    staleIfError: formatDuration(staleIfError),
    freshnessState: getFreshnessState(age, freshnessLifetime),
    cacheability: inferCacheability(directives, validators),
    validators,
    vary,
    checks,
    warnings,
  };
}
