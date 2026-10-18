import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { assertBuildPath, assertPerformanceBudgets, assertPrecacheBudget, budgets, collectAppShellFiles, collectStaticFiles, filterAppShell, getRuntimeAssets, shellIcons } from './pwa-cache.mjs';

const manifest = {
  'index.html': { file: 'assets/home-12345678.js', imports: ['shared'], css: ['assets/home-12345678.css'], dynamicImports: ['src/tools/example/example.vue'] },
  shared: { file: 'assets/shared-12345678.js', imports: ['cycle'], assets: ['assets/font-12345678.woff2'] },
  cycle: { file: 'assets/cycle-12345678.js', imports: ['shared'] },
  'src/tools/example/example.vue': { file: 'assets/tool-12345678.js', isDynamicEntry: true, imports: ['shared'] },
};

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'it-tools-pwa-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(resolve(directory, '.vite'));
  await mkdir(resolve(directory, 'assets'));
  await writeFile(resolve(directory, '.vite/manifest.json'), JSON.stringify(manifest));
  const paths = new Set(['index.html', 'manifest.webmanifest', ...shellIcons,
    ...collectStaticFiles(manifest, 'index.html'), ...collectStaticFiles(manifest, 'src/tools/example/example.vue')]);
  for (const file of paths) {
    await writeFile(resolve(directory, file), `fixture ${file}`);
  }
  return { directory, entries: [...paths].map(url => ({ url, revision: 'fixture' })) };
}

test('static closure deduplicates shared dependencies and cycles, excluding dynamic imports', () => {
  assert.deepEqual(collectStaticFiles(manifest, 'index.html'), [
    'assets/cycle-12345678.js', 'assets/font-12345678.woff2', 'assets/home-12345678.css',
    'assets/home-12345678.js', 'assets/shared-12345678.js',
  ]);
});

test('missing static imports fail instead of silently producing an incomplete shell', () => {
  assert.throws(() => collectStaticFiles({ root: { file: 'assets/root.js', imports: ['missing'] } }, 'root'), /Missing Vite manifest entry: missing/);
  assert.throws(() => collectStaticFiles(manifest, 'missing'), /Missing Vite manifest entry/);
});

test('the deferred PWA registration helper and tool imports stay outside the application shell', () => {
  const entry = 'node_modules/.pnpm/workbox-window@7.4.0/node_modules/workbox-window/build/workbox-window.prod.es5.mjs';
  const withStartupHelper = {
    ...manifest,
    'index.html': { ...manifest['index.html'], dynamicImports: [...manifest['index.html'].dynamicImports, entry] },
    [entry]: { file: 'assets/registration-12345678.js' },
  };
  const files = collectAppShellFiles(withStartupHelper);
  assert(!files.includes('assets/registration-12345678.js'));
  assert(!files.includes('assets/tool-12345678.js'));
});

test('build paths reject traversal, URLs, query strings, encoded paths and Windows separators', () => {
  for (const file of ['../secret', '/absolute', './relative', 'assets/../secret', 'assets//file', 'https://example.test/a.js', 'assets/a.js?token=secret', 'assets/a.js#fragment', 'assets/%2e%2e/secret', 'assets\\secret', 'assets/']) {
    assert.throws(() => assertBuildPath(file), /Invalid build resource path/);
  }
  assert.equal(assertBuildPath('assets/nested/editor.worker-1234_ab-.js'), 'assets/nested/editor.worker-1234_ab-.js');
});

test('precache budget includes its exact boundary and rejects one extra byte', () => {
  assert.doesNotThrow(() => assertPrecacheBudget(budgets.precacheBytes));
  assert.throws(() => assertPrecacheBudget(budgets.precacheBytes + 1), /PWA precache budget exceeded/);
});

test('initial and tool JavaScript budgets include their exact boundaries and reject one extra byte', () => {
  assert.doesNotThrow(() => assertPerformanceBudgets({
    initial: { javaScriptGzipBytes: budgets.initialJavaScriptGzipBytes },
    optionalEntries: [{ entry: 'tool', javaScriptGzipBytes: budgets.toolJavaScriptGzipBytes }],
  }));
  assert.throws(() => assertPerformanceBudgets({
    initial: { javaScriptGzipBytes: budgets.initialJavaScriptGzipBytes + 1 },
    optionalEntries: [],
  }), /initial JavaScript gzip .* > /);
  assert.throws(() => assertPerformanceBudgets({
    initial: { javaScriptGzipBytes: budgets.initialJavaScriptGzipBytes },
    optionalEntries: [{ entry: 'tool', javaScriptGzipBytes: budgets.toolJavaScriptGzipBytes + 1 }],
  }), /tool JavaScript closure .* > /);
});

test('Workbox candidates are filtered by graph; report measures unique raw and gzip bytes', async (t) => {
  const { directory, entries } = await fixture(t);
  const result = await filterAppShell(directory, [...entries, entries[0]]);
  assert.equal(result.manifest.length, new Set(result.manifest.map(entry => entry.url)).size);
  assert(!result.manifest.some(entry => entry.url === 'assets/tool-12345678.js'));
  assert(result.manifest.some(entry => entry.url === 'assets/font-12345678.woff2'));
  assert(result.manifest.some(entry => entry.url === 'manifest.webmanifest'));
  const report = JSON.parse(await readFile(resolve(directory, 'bundle-report.json'), 'utf8'));
  let bytes = 0;
  let gzipBytes = 0;
  for (const entry of result.manifest) {
    const content = await readFile(resolve(directory, entry.url));
    bytes += content.byteLength;
    gzipBytes += gzipSync(content).byteLength;
  }
  assert.equal(report.precache.bytes, bytes);
  assert.equal(report.precache.gzipBytes, gzipBytes);
  assert.equal(report.optionalEntries.length, 1);
  assert.equal(report.optionalEntries[0].files.length, 4);
  assert.equal(report.budgets.initialJavaScriptGzipBytes, 300 * 1024);
  assert.equal(report.budgets.toolJavaScriptGzipBytes, 500 * 1024);
});

test('automatically appended Workbox entries are counted once and cannot bypass the shell boundary', async (t) => {
  const { directory, entries } = await fixture(t);
  const additional = entries.filter(entry => entry.url === 'manifest.webmanifest');
  const result = await filterAppShell(directory, entries, additional);
  assert(!result.manifest.some(entry => entry.url === 'manifest.webmanifest'));
  const report = JSON.parse(await readFile(resolve(directory, 'bundle-report.json'), 'utf8'));
  assert.equal(result.manifest.length + additional.length, report.precache.files.length);
  await assert.rejects(filterAppShell(directory, entries, [{ url: 'assets/tool-12345678.js', revision: 'fixture' }]), /must belong to the application shell/);
});

test('a shell resource omitted by Workbox fails the build', async (t) => {
  const { directory, entries } = await fixture(t);
  await assert.rejects(filterAppShell(directory, entries.filter(entry => entry.url !== 'assets/home-12345678.js')), /missing from Workbox candidates/);
});

test('size reports include synthesized dynamic entry keys and emitted worker resources', async (t) => {
  const { directory, entries } = await fixture(t);
  const withSharedEntry = {
    ...manifest,
    'index.html': { ...manifest['index.html'], dynamicImports: [...manifest['index.html'].dynamicImports, '_merged.js'] },
    '_merged.js': { file: 'assets/merged-12345678.js', isDynamicEntry: true, imports: ['shared'] },
  };
  await writeFile(resolve(directory, '.vite/manifest.json'), JSON.stringify(withSharedEntry));
  await writeFile(resolve(directory, 'assets/merged-12345678.js'), 'merged tool');
  await writeFile(resolve(directory, 'assets/editor.worker-12345678.js'), 'worker');
  await filterAppShell(directory, entries);
  const report = JSON.parse(await readFile(resolve(directory, 'bundle-report.json'), 'utf8'));
  assert(report.optionalEntries.some(entry => entry.entry === '_merged.js'));
  assert(report.runtimeAssets.files.some(file => file.file === 'assets/editor.worker-12345678.js'));
});

test('a missing file referenced by the manifest fails the build', async (t) => {
  const { directory, entries } = await fixture(t);
  await rm(resolve(directory, 'assets/tool-12345678.js'));
  await assert.rejects(filterAppShell(directory, entries), /ENOENT/);
});

test('symlinked resources cannot escape the build directory', async (t) => {
  const { directory, entries } = await fixture(t);
  const outside = await mkdtemp(resolve(tmpdir(), 'it-tools-pwa-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(resolve(outside, 'outside.js'), 'outside');
  // Directory junctions also work for ordinary Windows users without symlink privileges.
  await symlink(outside, resolve(directory, 'assets/linked'), 'junction');
  await writeFile(resolve(directory, '.vite/manifest.json'), JSON.stringify({
    ...manifest, 'index.html': { ...manifest['index.html'], file: 'assets/linked/outside.js' },
  }));
  const linkedEntries = entries.map(entry => entry.url === 'assets/home-12345678.js' ? { ...entry, url: 'assets/linked/outside.js' } : entry);
  await assert.rejects(filterAppShell(directory, linkedEntries), /escapes the output directory/);
});

test('an oversized shell fails with a report available for CI diagnostics', async (t) => {
  const { directory, entries } = await fixture(t);
  await writeFile(resolve(directory, 'assets/home-12345678.js'), Buffer.alloc(budgets.precacheBytes, 'a'));
  await assert.rejects(filterAppShell(directory, entries), /PWA precache budget exceeded/);
  const report = JSON.parse(await readFile(resolve(directory, 'bundle-report.json'), 'utf8'));
  assert(report.precache.bytes > budgets.precacheBytes);
});

test('runtime allowlist includes nested workers and fonts, excluding reports, maps and public files', async (t) => {
  const { directory } = await fixture(t);
  await mkdir(resolve(directory, 'assets/workers'));
  await writeFile(resolve(directory, 'assets/workers/editor-12345678.js'), 'worker');
  await writeFile(resolve(directory, 'assets/home-12345678.js.map'), 'source map');
  await writeFile(resolve(directory, 'bundle-report.json'), '{}');
  const first = await getRuntimeAssets(directory);
  assert(first.paths.includes('assets/workers/editor-12345678.js'));
  assert(first.paths.includes('assets/font-12345678.woff2'));
  assert(!first.paths.some(path => path.endsWith('.map') || !path.startsWith('assets/')));
  assert.deepEqual(await getRuntimeAssets(directory), first);
  await writeFile(resolve(directory, 'assets/home-12345678.js'), 'updated content at the same path');
  assert.notEqual((await getRuntimeAssets(directory)).buildId, first.buildId);
  await writeFile(resolve(directory, 'assets/new-87654321.js'), 'new build');
  assert.notEqual((await getRuntimeAssets(directory)).buildId, first.buildId);
});
