import { parseHttpHeaders } from '../http-headers-parser/http-headers-parser.service';

export type SecurityHeaderStatus = 'pass' | 'warning' | 'fail';

export interface SecurityHeaderCheck {
  name: string
  status: SecurityHeaderStatus
  value: string
  summary: string
  recommendation: string
}

export interface SecurityHeadersAnalysis {
  checks: SecurityHeaderCheck[]
  passed: number
  warnings: number
  failed: number
  score: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
}

type HeaderMap = Record<string, string[] | undefined>;

const HSTS_MIN_AGE_SECONDS = 15_552_000;
const HSTS_RECOMMENDED_AGE_SECONDS = 31_536_000;

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
  return getHeaderValues(headers, name).join('\n');
}

function check(
  name: string,
  status: SecurityHeaderStatus,
  value: string,
  summary: string,
  recommendation: string,
): SecurityHeaderCheck {
  return { name, status, value, summary, recommendation };
}

function parseDirectives(value: string): Map<string, string | true> {
  const directives = new Map<string, string | true>();

  for (const rawDirective of value.split(';')) {
    const directive = rawDirective.trim();
    if (!directive) {
      continue;
    }

    const [rawName = '', ...rawValueParts] = directive.split('=');
    const name = rawName.trim().toLowerCase();
    const rawValue = rawValueParts.join('=').trim();
    directives.set(name, rawValue === '' ? true : rawValue.replace(/^"|"$/g, ''));
  }

  return directives;
}

function hasCspDirective(value: string, directive: string): boolean {
  const directivePattern = new RegExp(`(?:^|;)\\s*${directive}\\s+`, 'i');
  return directivePattern.test(value);
}

function checkStrictTransportSecurity(headers: HeaderMap): SecurityHeaderCheck {
  const value = getHeaderValue(headers, 'strict-transport-security');
  if (!value) {
    return check(
      'Strict-Transport-Security',
      'fail',
      '',
      'Missing HTTPS downgrade protection.',
      'Add Strict-Transport-Security with a long max-age on HTTPS responses.',
    );
  }

  const directives = parseDirectives(value);
  const rawMaxAge = directives.get('max-age');
  const maxAge = typeof rawMaxAge === 'string' ? Number(rawMaxAge) : Number.NaN;

  if (!Number.isFinite(maxAge) || maxAge <= 0) {
    return check(
      'Strict-Transport-Security',
      'fail',
      value,
      'HSTS is present but max-age is missing or invalid.',
      'Set a positive max-age value, ideally at least 31536000 seconds.',
    );
  }

  if (maxAge < HSTS_MIN_AGE_SECONDS) {
    return check(
      'Strict-Transport-Security',
      'warning',
      value,
      'HSTS max-age is shorter than 180 days.',
      'Use a longer max-age once HTTPS is stable for the whole site.',
    );
  }

  if (!directives.has('includesubdomains')) {
    return check(
      'Strict-Transport-Security',
      'warning',
      value,
      'HSTS does not include subdomains.',
      'Add includeSubDomains when all subdomains are HTTPS-ready.',
    );
  }

  return check(
    'Strict-Transport-Security',
    maxAge >= HSTS_RECOMMENDED_AGE_SECONDS ? 'pass' : 'warning',
    value,
    maxAge >= HSTS_RECOMMENDED_AGE_SECONDS
      ? 'HSTS is configured with a strong max-age.'
      : 'HSTS is configured, but max-age is below one year.',
    'Keep HSTS enabled on all HTTPS responses.',
  );
}

function checkContentSecurityPolicy(headers: HeaderMap): SecurityHeaderCheck {
  const value = getHeaderValue(headers, 'content-security-policy');
  if (!value) {
    return check(
      'Content-Security-Policy',
      'fail',
      '',
      'Missing browser content injection controls.',
      'Add a Content-Security-Policy that restricts scripts, objects, and framing.',
    );
  }

  const lowerValue = value.toLowerCase();
  if (!hasCspDirective(value, 'default-src')) {
    return check(
      'Content-Security-Policy',
      'warning',
      value,
      'CSP is present but has no default-src fallback.',
      'Add default-src to define a safe baseline for resource loading.',
    );
  }

  if (lowerValue.includes("'unsafe-inline'") || lowerValue.includes("'unsafe-eval'")) {
    return check(
      'Content-Security-Policy',
      'warning',
      value,
      'CSP allows unsafe script execution.',
      'Replace unsafe-inline and unsafe-eval with nonces, hashes, or stricter script sources.',
    );
  }

  return check(
    'Content-Security-Policy',
    'pass',
    value,
    'CSP is present with a default-src fallback.',
    'Review the policy whenever scripts, embeds, or third-party origins change.',
  );
}

function checkXFrameOptions(headers: HeaderMap): SecurityHeaderCheck {
  const value = getHeaderValue(headers, 'x-frame-options');
  const cspValue = getHeaderValue(headers, 'content-security-policy');

  if (!value) {
    if (hasCspDirective(cspValue, 'frame-ancestors')) {
      return check(
        'X-Frame-Options',
        'pass',
        '',
        'Clickjacking protection is covered by CSP frame-ancestors.',
        'Keep frame-ancestors in the Content-Security-Policy.',
      );
    }

    return check(
      'X-Frame-Options',
      'warning',
      '',
      'Missing legacy clickjacking protection.',
      'Add X-Frame-Options DENY or SAMEORIGIN, or use CSP frame-ancestors.',
    );
  }

  const normalizedValue = value.trim().toUpperCase();
  if (normalizedValue === 'DENY' || normalizedValue === 'SAMEORIGIN') {
    return check(
      'X-Frame-Options',
      'pass',
      value,
      'Legacy clickjacking protection is configured.',
      'Prefer CSP frame-ancestors for more precise framing rules.',
    );
  }

  return check(
    'X-Frame-Options',
    normalizedValue.startsWith('ALLOW-FROM') ? 'warning' : 'fail',
    value,
    'X-Frame-Options uses a weak or unsupported value.',
    'Use DENY, SAMEORIGIN, or CSP frame-ancestors.',
  );
}

function checkXContentTypeOptions(headers: HeaderMap): SecurityHeaderCheck {
  const value = getHeaderValue(headers, 'x-content-type-options');
  if (value.trim().toLowerCase() === 'nosniff') {
    return check(
      'X-Content-Type-Options',
      'pass',
      value,
      'MIME sniffing protection is enabled.',
      'Keep nosniff on script and style responses.',
    );
  }

  return check(
    'X-Content-Type-Options',
    'fail',
    value,
    value ? 'MIME sniffing protection has an unexpected value.' : 'Missing MIME sniffing protection.',
    'Set X-Content-Type-Options to nosniff.',
  );
}

function checkReferrerPolicy(headers: HeaderMap): SecurityHeaderCheck {
  const value = getHeaderValue(headers, 'referrer-policy');
  if (!value) {
    return check(
      'Referrer-Policy',
      'warning',
      '',
      'Missing referrer leakage controls.',
      'Set Referrer-Policy to strict-origin-when-cross-origin, same-origin, or no-referrer.',
    );
  }

  const normalizedValue = value.trim().toLowerCase();
  const strongPolicies = new Set(['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin']);

  if (strongPolicies.has(normalizedValue)) {
    return check(
      'Referrer-Policy',
      'pass',
      value,
      'Referrer data is limited by policy.',
      'Keep the policy aligned with analytics and cross-origin needs.',
    );
  }

  return check(
    'Referrer-Policy',
    normalizedValue === 'unsafe-url' ? 'fail' : 'warning',
    value,
    'Referrer policy is permissive or uncommon.',
    'Use a stricter policy unless full referrer URLs are required.',
  );
}

function checkPermissionsPolicy(headers: HeaderMap): SecurityHeaderCheck {
  const value = getHeaderValue(headers, 'permissions-policy');
  if (value.trim()) {
    return check(
      'Permissions-Policy',
      'pass',
      value,
      'Browser feature access is explicitly controlled.',
      'Keep only the features and origins that the application needs.',
    );
  }

  const legacyValue = getHeaderValue(headers, 'feature-policy');
  if (legacyValue.trim()) {
    return check(
      'Permissions-Policy',
      'warning',
      legacyValue,
      'Legacy Feature-Policy is present.',
      'Migrate Feature-Policy to Permissions-Policy.',
    );
  }

  return check(
    'Permissions-Policy',
    'warning',
    '',
    'Missing browser feature access controls.',
    'Add Permissions-Policy to disable unused sensitive APIs.',
  );
}

function checkCrossOriginOpenerPolicy(headers: HeaderMap): SecurityHeaderCheck {
  const value = getHeaderValue(headers, 'cross-origin-opener-policy');
  if (!value) {
    return check(
      'Cross-Origin-Opener-Policy',
      'warning',
      '',
      'Missing browsing context isolation policy.',
      'Use same-origin for applications that do not rely on cross-origin window access.',
    );
  }

  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue === 'same-origin' || normalizedValue === 'same-origin-allow-popups') {
    return check(
      'Cross-Origin-Opener-Policy',
      'pass',
      value,
      'Browsing context isolation is configured.',
      'Use same-origin when popup interoperability is not needed.',
    );
  }

  return check(
    'Cross-Origin-Opener-Policy',
    normalizedValue === 'unsafe-none' ? 'fail' : 'warning',
    value,
    'COOP is permissive or uncommon.',
    'Use same-origin unless the application needs looser window relationships.',
  );
}

function checkCrossOriginResourcePolicy(headers: HeaderMap): SecurityHeaderCheck {
  const value = getHeaderValue(headers, 'cross-origin-resource-policy');
  if (!value) {
    return check(
      'Cross-Origin-Resource-Policy',
      'warning',
      '',
      'Missing cross-origin resource embedding policy.',
      'Use same-origin or same-site for resources that should not be embedded elsewhere.',
    );
  }

  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue === 'same-origin' || normalizedValue === 'same-site') {
    return check(
      'Cross-Origin-Resource-Policy',
      'pass',
      value,
      'Cross-origin resource embedding is restricted.',
      'Use cross-origin only for intentionally public resources.',
    );
  }

  return check(
    'Cross-Origin-Resource-Policy',
    normalizedValue === 'cross-origin' ? 'warning' : 'fail',
    value,
    'CORP is permissive or invalid.',
    'Use same-origin or same-site for private application resources.',
  );
}

function checkInformationDisclosureHeader(headers: HeaderMap, name: string): SecurityHeaderCheck {
  const value = getHeaderValue(headers, name);
  if (!value) {
    return check(
      name,
      'pass',
      '',
      'Technology disclosure header is absent.',
      'Keep framework and server version details out of public responses.',
    );
  }

  return check(
    name,
    'warning',
    value,
    'Response discloses implementation details.',
    'Remove this header or hide version information at the edge.',
  );
}

function getGrade(score: number): SecurityHeadersAnalysis['grade'] {
  if (score >= 90) {
    return 'A';
  }
  if (score >= 75) {
    return 'B';
  }
  if (score >= 60) {
    return 'C';
  }
  if (score >= 40) {
    return 'D';
  }
  return 'F';
}

export function analyzeSecurityHeaders(input: string): SecurityHeadersAnalysis {
  const headers = createHeaderMap(input);
  const checks = [
    checkStrictTransportSecurity(headers),
    checkContentSecurityPolicy(headers),
    checkXFrameOptions(headers),
    checkXContentTypeOptions(headers),
    checkReferrerPolicy(headers),
    checkPermissionsPolicy(headers),
    checkCrossOriginOpenerPolicy(headers),
    checkCrossOriginResourcePolicy(headers),
    checkInformationDisclosureHeader(headers, 'Server'),
    checkInformationDisclosureHeader(headers, 'X-Powered-By'),
  ];

  const passed = checks.filter(({ status }) => status === 'pass').length;
  const warnings = checks.filter(({ status }) => status === 'warning').length;
  const failed = checks.filter(({ status }) => status === 'fail').length;
  const score = Math.round(checks.reduce((total, { status }) => {
    if (status === 'pass') {
      return total + 100;
    }
    if (status === 'warning') {
      return total + 50;
    }
    return total;
  }, 0) / checks.length);

  return {
    checks,
    passed,
    warnings,
    failed,
    score,
    grade: getGrade(score),
  };
}
