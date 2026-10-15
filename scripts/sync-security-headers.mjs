import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(repositoryRoot, 'security-headers.json');
const targetPaths = ['nginx.conf', 'vercel.json', 'netlify.toml'];
const requiredResponseHeaders = new Map([
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'no-referrer'],
  ['X-Frame-Options', 'DENY'],
]);
const requiredDirectives = [
  'default-src',
  'base-uri',
  'object-src',
  'form-action',
  'frame-ancestors',
  'script-src',
  'style-src',
  'img-src',
  'font-src',
  'connect-src',
  'worker-src',
  'media-src',
  'frame-src',
  'manifest-src',
];

export { sourcePath, targetPaths };

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireHttpsOrigin(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${fieldName} must be an HTTPS origin without a path, query, or fragment.`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  }
  catch {
    throw new TypeError(`${fieldName} must be a valid HTTPS origin without a path, query, or fragment.`);
  }

  if (parsed.protocol !== 'https:'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.hostname.includes('*')
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
    || parsed.origin !== value) {
    throw new TypeError(`${fieldName} must be an HTTPS origin without a path, query, or fragment.`);
  }

  return parsed.origin;
}

function validateDirectiveSource(directive, source) {
  if (typeof source !== 'string' || source.length === 0 || source.trim() !== source) {
    throw new TypeError(`${directive} contains an empty or malformed source expression.`);
  }
  if (/[;"\\\r\n$]/.test(source)) {
    throw new TypeError(`${directive} contains a source expression that cannot be safely emitted.`);
  }
  if (source === '*') {
    throw new TypeError(`${directive} must not allow every source.`);
  }
  // User-supplied Markdown may render remote images in its print preview; keep HTTPS limited to images.
  if (source === 'https:' && directive !== 'img-src') {
    throw new TypeError(`A broad HTTPS source is permitted only for img-src.`);
  }
  if (source === "'unsafe-eval'") {
    throw new TypeError(`unsafe-eval is not permitted in the security policy.`);
  }
  if (source === "'unsafe-inline'" && directive !== 'style-src') {
    throw new TypeError(`unsafe-inline is permitted only for style-src.`);
  }
  // Runtime-produced QR/SVG images, Monaco's worker bootstrap, and recorded video need these scoped URI sources.
  if ((source === 'data:' && directive !== 'img-src')
    || (source === 'blob:' && !['worker-src', 'media-src'].includes(directive))) {
    throw new TypeError(`${source} is not permitted in ${directive}.`);
  }

  if (!["'self'", "'none'", "'unsafe-inline'", 'https:', 'data:', 'blob:'].includes(source)) {
    requireHttpsOrigin(source, `${directive} source`);
  }
}

// Validate the shared policy before emitting any server syntax; reject malformed or broadened script permissions.
export function validateSecurityHeaderConfig(config) {
  if (!isRecord(config) || config.schemaVersion !== 1) {
    throw new TypeError('security-headers.json must use schemaVersion 1.');
  }
  if (!isRecord(config.directives)) {
    throw new TypeError('security-headers.json must define CSP directives.');
  }

  for (const directive of requiredDirectives) {
    const sources = config.directives[directive];
    if (!Array.isArray(sources) || sources.length === 0 || new Set(sources).size !== sources.length) {
      throw new TypeError(`${directive} must contain a non-empty list of unique sources.`);
    }
    for (const source of sources) {
      validateDirectiveSource(directive, source);
    }
    if (sources.includes("'none'") && sources.length !== 1) {
      throw new TypeError(`${directive} cannot combine 'none' with another source.`);
    }
  }

  const directiveNames = Object.keys(config.directives);
  if (directiveNames.length !== requiredDirectives.length
    || requiredDirectives.some(name => !directiveNames.includes(name))) {
    throw new TypeError('CSP directives must match the reviewed directive set.');
  }
  if (config.directives['script-src'].length !== 1 || config.directives['script-src'][0] !== "'self'") {
    throw new TypeError("script-src must be limited to 'self'.");
  }
  if (!config.directives['style-src'].includes("'unsafe-inline'")) {
    throw new TypeError("style-src must retain 'unsafe-inline' for the runtime styles used by Naive UI.");
  }
  if (config.directives['connect-src'].includes('https:')) {
    throw new TypeError('connect-src must use exact HTTPS origins instead of a scheme-wide source.');
  }

  if (config.plausibleApiOrigin !== null) {
    requireHttpsOrigin(config.plausibleApiOrigin, 'plausibleApiOrigin');
    if (config.directives['connect-src'].includes(config.plausibleApiOrigin)) {
      throw new TypeError('plausibleApiOrigin must not duplicate a connect-src source.');
    }
  }

  if (!Array.isArray(config.responseHeaders)) {
    throw new TypeError('responseHeaders must be a list of name/value pairs.');
  }
  const providedHeaders = new Map();
  for (const pair of config.responseHeaders) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new TypeError('Each responseHeaders entry must contain a name and value.');
    }
    const [name, value] = pair;
    if (typeof name !== 'string' || !/^[A-Za-z0-9-]+$/.test(name)
      || typeof value !== 'string' || value.length === 0 || /[\r\n]/.test(value)) {
      throw new TypeError('Response header names and values must be valid single-line strings.');
    }
    if (providedHeaders.has(name)) {
      throw new TypeError(`Duplicate response header: ${name}.`);
    }
    providedHeaders.set(name, value);
  }
  if (providedHeaders.size !== requiredResponseHeaders.size
    || [...requiredResponseHeaders].some(([name, value]) => providedHeaders.get(name) !== value)) {
    throw new TypeError('responseHeaders must define the reviewed nosniff, no-referrer, and DENY headers.');
  }

  return config;
}

export async function loadSecurityHeaderConfig(path = sourcePath) {
  const raw = await readFile(path, 'utf8');
  return validateSecurityHeaderConfig(JSON.parse(raw));
}

export function buildCsp(config) {
  validateSecurityHeaderConfig(config);
  const directives = Object.entries(config.directives).map(([name, sources]) => {
    const effectiveSources = name === 'connect-src' && config.plausibleApiOrigin !== null
      ? [...sources, config.plausibleApiOrigin]
      : sources;
    return `${name} ${effectiveSources.join(' ')}`;
  });

  return directives.join('; ');
}

export function buildResponseHeaders(config) {
  const headers = [['Content-Security-Policy', buildCsp(config)]];
  for (const [name, value] of config.responseHeaders) {
    headers.push([name, value]);
  }
  return headers;
}

// Naive UI injects style elements at runtime, and existing Vue templates use style attributes.
// Keep inline permission limited to styles; the reviewed script policy remains same-origin only.
export function renderNginx(config) {
  const headerLines = buildResponseHeaders(config)
    .map(([name, value]) => `    add_header ${name} "${value}" always;`);

  return [
    'server {',
    '    listen 80;',
    '    server_name localhost;',
    '    root /usr/share/nginx/html;',
    '    index index.html;',
    '',
    ...headerLines,
    '',
    '    location / {',
    '        try_files $uri $uri/ /index.html;',
    '    }',
    '}',
    '',
  ].join('\n');
}

export function renderVercel(config) {
  // Vercel checks the filesystem before rewrites, so existing assets keep their direct-file behavior.
  return `${JSON.stringify({
    $schema: 'https://openapi.vercel.sh/vercel.json',
    headers: [{
      source: '/(.*)',
      headers: buildResponseHeaders(config).map(([key, value]) => ({ key, value })),
    }],
    rewrites: [{ source: '/(.*)', destination: '/index.html' }],
  }, null, 2)}\n`;
}

function quoteToml(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function renderNetlify(config) {
  const headerLines = buildResponseHeaders(config)
    .map(([name, value]) => `    ${name} = ${quoteToml(value)}`);

  return [
    '[[headers]]',
    '  for = "/*"',
    '',
    '  [headers.values]',
    ...headerLines,
    '',
    '[[redirects]]',
    '  from = "/*"',
    '  to = "/index.html"',
    '  status = 200',
    '',
  ].join('\n');
}

export function renderOutputs(config) {
  return new Map([
    ['nginx.conf', renderNginx(config)],
    ['vercel.json', renderVercel(config)],
    ['netlify.toml', renderNetlify(config)],
  ]);
}

export function validateConfiguredPlausibleHost(config, expectedHost) {
  validateSecurityHeaderConfig(config);
  const providedHost = typeof expectedHost === 'string' && expectedHost.length > 0
    ? requireHttpsOrigin(expectedHost, 'VITE_PLAUSIBLE_API_HOST')
    : null;

  if (config.plausibleApiOrigin === null && providedHost !== null) {
    throw new Error('VITE_PLAUSIBLE_API_HOST is set but plausibleApiOrigin is null; configure the origin in security-headers.json and sync the deployment files.');
  }
  if (config.plausibleApiOrigin !== null && providedHost === null) {
    throw new Error('plausibleApiOrigin is configured; pass --plausible-api-host <origin> or set VITE_PLAUSIBLE_API_HOST to verify the matching Vite build setting.');
  }
  if (config.plausibleApiOrigin !== null && providedHost !== config.plausibleApiOrigin) {
    throw new Error('VITE_PLAUSIBLE_API_HOST must match plausibleApiOrigin in security-headers.json.');
  }
}

export async function findOutputDrift(root, config) {
  const expectedOutputs = renderOutputs(config);
  const drift = [];

  for (const [filename, expected] of expectedOutputs) {
    let current;
    try {
      current = await readFile(resolve(root, filename), 'utf8');
    }
    catch {
      drift.push(filename);
      continue;
    }
    if (current !== expected) {
      drift.push(filename);
    }
  }

  return drift;
}

function parseArguments(args) {
  const options = { check: false, help: false, plausibleApiHost: undefined };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--check') {
      options.check = true;
    }
    else if (argument === '--help' || argument === '-h') {
      options.help = true;
    }
    else if (argument === '--plausible-api-host') {
      index += 1;
      if (!args[index]) {
        throw new Error('--plausible-api-host requires an HTTPS origin.');
      }
      options.plausibleApiHost = args[index];
    }
    else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function printHelp() {
  process.stdout.write([
    'Usage:',
    '  node scripts/sync-security-headers.mjs [--check] [--plausible-api-host <origin>]',
    '',
    'Without --check, synchronizes nginx.conf, vercel.json, and netlify.toml from security-headers.json.',
    'With --check, verifies exact generated-file parity and does not write files.',
    '',
    'For a custom Plausible API host:',
    '  1. Set plausibleApiOrigin in security-headers.json to its exact HTTPS origin.',
    '  2. Set VITE_PLAUSIBLE_API_HOST to the same origin in the Vite build environment.',
    '  3. Run this script to sync all three deployment configurations.',
    '  4. Run --check --plausible-api-host <origin> (or set VITE_PLAUSIBLE_API_HOST) to verify parity.',
    '',
    'Use an origin without a path or trailing slash. The CSP allows no generic HTTPS connect source.',
    '',
  ].join('\n'));
}

async function main(args) {
  const options = parseArguments(args);
  if (options.help) {
    printHelp();
    return;
  }

  const config = await loadSecurityHeaderConfig();
  const expectedPlausibleHost = options.plausibleApiHost ?? process.env.VITE_PLAUSIBLE_API_HOST;
  validateConfiguredPlausibleHost(config, expectedPlausibleHost);

  if (options.check) {
    const drift = await findOutputDrift(repositoryRoot, config);
    if (drift.length > 0) {
      throw new Error(`Security headers are out of sync: ${drift.join(', ')}. Run node scripts/sync-security-headers.mjs.`);
    }
    process.stdout.write('Security header deployment files match security-headers.json.\n');
    return;
  }

  for (const [filename, content] of renderOutputs(config)) {
    const path = resolve(repositoryRoot, filename);
    let current;
    try {
      current = await readFile(path, 'utf8');
    }
    catch {
      current = null;
    }
    if (current !== content) {
      await writeFile(path, content, 'utf8');
      process.stdout.write(`Updated ${filename}.\n`);
    }
  }
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
