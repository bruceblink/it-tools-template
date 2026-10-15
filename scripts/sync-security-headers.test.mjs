import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildCsp,
  buildResponseHeaders,
  findOutputDrift,
  loadSecurityHeaderConfig,
  renderNetlify,
  renderNginx,
  renderOutputs,
  renderVercel,
  validateConfiguredPlausibleHost,
  validateSecurityHeaderConfig,
} from './sync-security-headers.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('baseline CSP permits only reviewed runtime sources and excludes unsafe-eval', async () => {
  const config = await loadSecurityHeaderConfig();
  const directives = Object.fromEntries(buildCsp(config).split('; ').map((directive) => {
    const [name, ...sources] = directive.split(' ');
    return [name, sources];
  }));

  assert.deepEqual(directives['script-src'], ["'self'"]);
  assert.deepEqual(directives['style-src'], ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(directives['img-src'], ["'self'", 'data:', 'https:']);
  assert.deepEqual(directives['connect-src'], ["'self'", 'https://unpkg.com']);
  assert.deepEqual(directives['worker-src'], ["'self'", 'blob:']);
  assert.deepEqual(directives['media-src'], ["'self'", 'blob:']);
  assert.doesNotMatch(buildCsp(config), /unsafe-eval/);
  assert.ok(directives['connect-src'].every(source => source === "'self'" || source === 'https://unpkg.com'));
  assert.ok(!directives['img-src'].includes('blob:'));

  const unsafeConfig = structuredClone(config);
  unsafeConfig.directives['script-src'].push("'unsafe-eval'");
  assert.throws(() => validateSecurityHeaderConfig(unsafeConfig), /unsafe-eval is not permitted/);
});

test('custom Plausible API host is added as one exact HTTPS origin', async () => {
  const config = structuredClone(await loadSecurityHeaderConfig());
  config.plausibleApiOrigin = 'https://metrics.example.test:8443';

  const csp = buildCsp(validateSecurityHeaderConfig(config));
  assert.match(csp, /connect-src 'self' https:\/\/unpkg\.com https:\/\/metrics\.example\.test:8443/);
  assert.doesNotMatch(csp, /connect-src[^;]*https:(?:\s|;)/);
  assert.throws(() => validateConfiguredPlausibleHost(config, undefined), /pass --plausible-api-host/);
  assert.throws(() => validateConfiguredPlausibleHost(config, 'https://other.example.test'), /must match/);
  assert.doesNotThrow(() => validateConfiguredPlausibleHost(config, 'https://metrics.example.test:8443'));
});

test('Plausible host validation rejects paths, cleartext HTTP, and wildcard origins', async () => {
  const config = structuredClone(await loadSecurityHeaderConfig());
  for (const origin of ['http://metrics.example.test', 'https://metrics.example.test/path', 'https:', '*.example.test', 'https://*.example.test']) {
    config.plausibleApiOrigin = origin;
    assert.throws(() => validateSecurityHeaderConfig(config), /HTTPS origin/);
  }

  config.plausibleApiOrigin = null;
  assert.throws(() => validateConfiguredPlausibleHost(config, 'https://metrics.example.test'), /is null/);
});

test('connect-src rejects broad schemes, cleartext origins, and wildcard hosts', async () => {
  const baseline = await loadSecurityHeaderConfig();
  for (const source of ['http:', 'http://example.test', 'https:', 'https://*.example.test', 'example.test', 'https://example.test/path']) {
    const config = structuredClone(baseline);
    config.directives['connect-src'].push(source);
    assert.throws(() => validateSecurityHeaderConfig(config));
  }

  const exactOrigin = structuredClone(baseline);
  exactOrigin.directives['connect-src'].push('https://example.test:8443');
  assert.doesNotThrow(() => validateSecurityHeaderConfig(exactOrigin));
});

test('deployment outputs carry matching headers and preserve SPA fallback behavior', async () => {
  const config = await loadSecurityHeaderConfig();
  const headers = buildResponseHeaders(config);
  const nginx = renderNginx(config);
  const vercelText = renderVercel(config);
  const vercel = JSON.parse(vercelText);
  const netlify = renderNetlify(config);

  for (const [name, value] of headers) {
    assert.ok(nginx.includes(`add_header ${name} "${value}" always;`));
    assert.ok(vercel.headers[0].headers.some(header => header.key === name && header.value === value));
    assert.ok(netlify.includes(`    ${name} = "${value}"`));
  }
  assert.doesNotMatch(vercelText, /"routes"\s*:/);
  assert.deepEqual(vercel.rewrites, [{ source: '/(.*)', destination: '/index.html' }]);
  assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html;/);
  assert.match(netlify, /from = "\/\*"\n  to = "\/index\.html"\n  status = 200/);
});

test('--check detects generated-file drift without modifying the changed file', async () => {
  const config = await loadSecurityHeaderConfig();
  const tempRoot = await mkdtemp(resolve(os.tmpdir(), 'it-tools-security-headers-'));

  try {
    for (const [filename, content] of renderOutputs(config)) {
      await writeFile(resolve(tempRoot, filename), content, 'utf8');
    }
    assert.deepEqual(await findOutputDrift(tempRoot, config), []);

    const changedPath = resolve(tempRoot, 'netlify.toml');
    const changed = `${await readFile(changedPath, 'utf8')}# local drift\n`;
    await writeFile(changedPath, changed, 'utf8');

    assert.deepEqual(await findOutputDrift(tempRoot, config), ['netlify.toml']);
    assert.equal(await readFile(changedPath, 'utf8'), changed);
  }
  finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('all deployment files are currently synchronized with the JSON source', async () => {
  const config = await loadSecurityHeaderConfig();
  assert.deepEqual(await findOutputDrift(root, config), []);

  const vercel = JSON.parse(await readFile(resolve(root, 'vercel.json'), 'utf8'));
  assert.ok(Array.isArray(vercel.headers));
  assert.ok(Array.isArray(vercel.rewrites));
});
