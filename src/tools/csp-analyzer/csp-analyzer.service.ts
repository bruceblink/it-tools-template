export type CspCheckStatus = 'pass' | 'warning' | 'fail';

export interface CspDirective {
  name: string
  values: string[]
}

export interface CspCheck {
  name: string
  status: CspCheckStatus
  value: string
  summary: string
  recommendation: string
}

export interface CspAnalysis {
  directives: CspDirective[]
  checks: CspCheck[]
  passed: number
  warnings: number
  failed: number
  score: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
}

const FETCH_DIRECTIVES = [
  'child-src',
  'connect-src',
  'default-src',
  'font-src',
  'frame-src',
  'img-src',
  'manifest-src',
  'media-src',
  'object-src',
  'prefetch-src',
  'script-src',
  'script-src-attr',
  'script-src-elem',
  'style-src',
  'style-src-attr',
  'style-src-elem',
  'worker-src',
];

const KEYWORD_SOURCES = new Set([
  "'none'",
  "'self'",
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'unsafe-hashes'",
  "'strict-dynamic'",
  "'report-sample'",
  "'wasm-unsafe-eval'",
]);

function normalizeInput(input: string) {
  const trimmedInput = input.trim();
  const headerPrefix = /^content-security-policy(?:-report-only)?\s*:/i;

  return trimmedInput.replace(headerPrefix, '').trim();
}

export function parseCsp(input: string): CspDirective[] {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput) {
    return [];
  }

  const seenDirectives = new Set<string>();

  return normalizedInput
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [rawName = '', ...rawValues] = part.split(/\s+/);
      const name = rawName.toLowerCase();
      if (!name) {
        throw new Error('CSP directive name cannot be empty.');
      }
      if (seenDirectives.has(name)) {
        throw new Error(`Duplicate CSP directive: ${name}`);
      }

      seenDirectives.add(name);

      return {
        name,
        values: rawValues,
      };
    });
}

function getDirective(directives: CspDirective[], name: string) {
  return directives.find(directive => directive.name === name);
}

function hasDirective(directives: CspDirective[], name: string) {
  return getDirective(directives, name) !== undefined;
}

function getDirectiveValues(directives: CspDirective[], names: string[]) {
  return names.flatMap(name => getDirective(directives, name)?.values ?? []);
}

function hasValue(values: string[], value: string) {
  return values.some(source => source.toLowerCase() === value.toLowerCase());
}

function hasNonceOrHash(values: string[]) {
  return values.some(source => /^'(nonce|sha256|sha384|sha512)-/i.test(source));
}

function hasWildcard(values: string[]) {
  return values.some(source => source === '*' || source.startsWith('*.'));
}

function hasHttpSource(values: string[]) {
  return values.some(source => source.toLowerCase().startsWith('http:') || source.toLowerCase().startsWith('http://'));
}

function check(
  name: string,
  status: CspCheckStatus,
  value: string,
  summary: string,
  recommendation: string,
): CspCheck {
  return { name, status, value, summary, recommendation };
}

function checkDefaultSrc(directives: CspDirective[]): CspCheck {
  const defaultSrc = getDirective(directives, 'default-src');

  if (!defaultSrc) {
    return check(
      'default-src',
      'fail',
      '',
      'No default-src fallback is defined.',
      'Add default-src to establish a restrictive baseline for resource loading.',
    );
  }

  if (hasValue(defaultSrc.values, "'none'") || hasValue(defaultSrc.values, "'self'")) {
    return check(
      'default-src',
      'pass',
      defaultSrc.values.join(' '),
      'default-src provides a restrictive fallback.',
      'Keep specific directives tighter than the default when needed.',
    );
  }

  return check(
    'default-src',
    hasWildcard(defaultSrc.values) ? 'fail' : 'warning',
    defaultSrc.values.join(' '),
    'default-src is broad or uncommon.',
    'Prefer default-src \'self\' or default-src \'none\', then open only required resource types.',
  );
}

function checkScriptSrc(directives: CspDirective[]): CspCheck[] {
  const values = getDirectiveValues(directives, ['script-src', 'script-src-elem', 'default-src']);
  const value = values.join(' ');
  const hasUnsafeInline = hasValue(values, "'unsafe-inline'");
  const hasUnsafeEval = hasValue(values, "'unsafe-eval'") || hasValue(values, "'wasm-unsafe-eval'");
  const hasStrictDynamic = hasValue(values, "'strict-dynamic'");

  const checks: CspCheck[] = [];

  checks.push(
    hasUnsafeInline && !hasNonceOrHash(values)
      ? check('script inline execution', 'fail', value, 'Scripts allow unsafe inline execution.', 'Use nonces or hashes and remove unsafe-inline.')
      : check('script inline execution', hasUnsafeInline ? 'warning' : 'pass', value, hasUnsafeInline ? 'Inline scripts are allowed but nonce/hash controls are present.' : 'Inline script execution is restricted.', 'Keep inline script execution locked down.'),
  );

  checks.push(
    hasUnsafeEval
      ? check('script eval execution', 'fail', value, 'Scripts allow eval-like execution.', 'Remove unsafe-eval and wasm-unsafe-eval unless a reviewed dependency strictly requires it.')
      : check('script eval execution', 'pass', value, 'Eval-like script execution is restricted.', 'Keep eval-like execution disabled.'),
  );

  checks.push(
    hasStrictDynamic && hasNonceOrHash(values)
      ? check('strict-dynamic', 'pass', value, 'strict-dynamic is paired with nonce or hash based trust.', 'Keep host allowlists minimal when strict-dynamic is used.')
      : check('strict-dynamic', hasStrictDynamic ? 'warning' : 'warning', value, hasStrictDynamic ? 'strict-dynamic is present without an obvious nonce or hash.' : 'strict-dynamic is not used.', 'Consider strict-dynamic with nonces or hashes for modern script loading.'),
  );

  return checks;
}

function checkObjectSrc(directives: CspDirective[]): CspCheck {
  const values = getDirectiveValues(directives, ['object-src']);
  if (values.length === 0) {
    return check(
      'object-src',
      'fail',
      '',
      'Object/plugin loading is not explicitly blocked.',
      'Add object-src \'none\' unless legacy plugins are required.',
    );
  }

  return hasValue(values, "'none'")
    ? check('object-src', 'pass', values.join(' '), 'Object/plugin loading is blocked.', 'Keep object-src set to none.')
    : check('object-src', 'fail', values.join(' '), 'Object/plugin loading is allowed.', 'Set object-src \'none\'.');
}

function checkFrameAncestors(directives: CspDirective[]): CspCheck {
  const values = getDirectiveValues(directives, ['frame-ancestors']);
  if (values.length === 0) {
    return check(
      'frame-ancestors',
      'warning',
      '',
      'Clickjacking protection is not declared in CSP.',
      'Add frame-ancestors \'none\', \'self\', or trusted embedding origins.',
    );
  }

  return hasWildcard(values)
    ? check('frame-ancestors', 'fail', values.join(' '), 'Any site can frame this page.', 'Restrict frame-ancestors to none, self, or trusted origins.')
    : check('frame-ancestors', 'pass', values.join(' '), 'Page framing is controlled.', 'Keep frame ancestors aligned with embedding requirements.');
}

function checkBaseUri(directives: CspDirective[]): CspCheck {
  const values = getDirectiveValues(directives, ['base-uri']);
  if (values.length === 0) {
    return check(
      'base-uri',
      'warning',
      '',
      'Document base URL injection is not restricted.',
      'Add base-uri \'self\' or base-uri \'none\'.',
    );
  }

  return hasValue(values, "'none'") || hasValue(values, "'self'")
    ? check('base-uri', 'pass', values.join(' '), 'Base URL injection is restricted.', 'Keep base-uri restrictive.')
    : check('base-uri', 'warning', values.join(' '), 'base-uri allows external locations.', 'Use base-uri self or none unless external base URLs are required.');
}

function checkFormAction(directives: CspDirective[]): CspCheck {
  const values = getDirectiveValues(directives, ['form-action']);
  if (values.length === 0) {
    return check(
      'form-action',
      'warning',
      '',
      'Form submission destinations are not restricted.',
      'Add form-action \'self\' or an explicit list of trusted submission endpoints.',
    );
  }

  if (hasValue(values, "'none'") || hasValue(values, "'self'")) {
    return check(
      'form-action',
      'pass',
      values.join(' '),
      'Form submission destinations are restricted.',
      'Keep form-action aligned with legitimate login, checkout, and contact form targets.',
    );
  }

  return check(
    'form-action',
    hasWildcard(values) ? 'fail' : 'warning',
    values.join(' '),
    'form-action allows broad or external submission targets.',
    'Restrict form-action to self or known HTTPS endpoints.',
  );
}

function checkMixedContent(directives: CspDirective[]): CspCheck[] {
  const allFetchValues = directives
    .filter(({ name }) => FETCH_DIRECTIVES.includes(name))
    .flatMap(({ values }) => values);
  const hasUpgrade = hasDirective(directives, 'upgrade-insecure-requests');
  const hasBlockMixedContent = hasDirective(directives, 'block-all-mixed-content');

  return [
    hasHttpSource(allFetchValues)
      ? check('plain HTTP sources', 'fail', allFetchValues.filter(source => source.toLowerCase().startsWith('http')).join(' '), 'Policy allows plain HTTP resource loading.', 'Replace http: sources with https: or remove them.')
      : check('plain HTTP sources', 'pass', '', 'No plain HTTP resource source was found.', 'Keep external sources on HTTPS.'),

    hasUpgrade || hasBlockMixedContent
      ? check('mixed content directive', 'pass', hasUpgrade ? 'upgrade-insecure-requests' : 'block-all-mixed-content', 'Mixed content handling is declared.', 'Prefer upgrade-insecure-requests for HTTPS sites.')
      : check('mixed content directive', 'warning', '', 'Mixed content handling is not declared.', 'Add upgrade-insecure-requests after confirming all subresources support HTTPS.'),
  ];
}

function checkWildcards(directives: CspDirective[]): CspCheck {
  const wildcardDirectives = directives
    .filter(({ values }) => hasWildcard(values))
    .map(({ name }) => name);

  if (wildcardDirectives.length === 0) {
    return check('wildcards', 'pass', '', 'No broad wildcard sources were found.', 'Keep host allowlists explicit.');
  }

  return check(
    'wildcards',
    wildcardDirectives.includes('default-src') || wildcardDirectives.includes('script-src') ? 'fail' : 'warning',
    wildcardDirectives.join(', '),
    'Policy uses broad wildcard sources.',
    'Replace wildcard sources with explicit origins where possible.',
  );
}

function checkReporting(directives: CspDirective[]): CspCheck {
  const reportTo = getDirective(directives, 'report-to');
  const reportUri = getDirective(directives, 'report-uri');

  if (reportTo || reportUri) {
    return check(
      'reporting',
      'pass',
      [reportTo?.values.join(' '), reportUri?.values.join(' ')].filter(Boolean).join(' '),
      'CSP violation reporting is configured.',
      'Monitor reports and phase out noisy legacy violations.',
    );
  }

  return check(
    'reporting',
    'warning',
    '',
    'CSP violation reporting is not configured.',
    'Add report-to or report-uri while tuning the policy.',
  );
}

function checkUnknownKeywords(directives: CspDirective[]): CspCheck {
  const unknownKeywords = directives
    .flatMap(({ values }) => values)
    .filter(value => value.startsWith("'") && value.endsWith("'") && !KEYWORD_SOURCES.has(value.toLowerCase()) && !/^'(nonce|sha256|sha384|sha512)-/i.test(value));

  if (unknownKeywords.length === 0) {
    return check('keyword sources', 'pass', '', 'Keyword sources look valid.', 'Keep quoted keywords spelled exactly as defined by CSP.');
  }

  return check(
    'keyword sources',
    'warning',
    [...new Set(unknownKeywords)].join(' '),
    'Policy contains unknown quoted keyword sources.',
    'Check for typos such as missing hyphens or unsupported keywords.',
  );
}

function getGrade(score: number): CspAnalysis['grade'] {
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

export function analyzeCsp(input: string): CspAnalysis {
  const directives = parseCsp(input);
  const checks = directives.length === 0
    ? [
        check(
          'policy',
          'fail',
          '',
          'No Content-Security-Policy was provided.',
          'Paste a Content-Security-Policy header value to analyze it.',
        ),
      ]
    : [
        checkDefaultSrc(directives),
        ...checkScriptSrc(directives),
        checkObjectSrc(directives),
        checkFrameAncestors(directives),
        checkBaseUri(directives),
        checkFormAction(directives),
        ...checkMixedContent(directives),
        checkWildcards(directives),
        checkReporting(directives),
        checkUnknownKeywords(directives),
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
    directives,
    checks,
    passed,
    warnings,
    failed,
    score,
    grade: getGrade(score),
  };
}
