import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

export const shellIcons = [
  'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png',
  'safari-pinned-tab.svg', 'android-chrome-192x192.png', 'android-chrome-512x512.png',
];

export const budgets = {
  precacheBytes: 8 * 1024 * 1024,
  initialJavaScriptGzipBytes: 300 * 1024,
  toolJavaScriptGzipBytes: 500 * 1024,
};

/** @param {string} path */
export function assertBuildPath(path) {
  if (!/^[\w./-]+$/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid build resource path: ${path}`);
  }
  return path;
}

/**
 * Follow static imports only. A shared dependency is counted once, including cycles.
 * @param {import('vite').Manifest} manifest
 * @param {string} entry
 */
export function collectStaticFiles(manifest, entry) {
  const visited = new Set();
  const files = new Set();
  function visit(key) {
    if (visited.has(key)) {
      return;
    }
    const chunk = manifest[key];
    if (!chunk) {
      throw new Error(`Missing Vite manifest entry: ${key}`);
    }
    visited.add(key);
    for (const file of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) {
      files.add(assertBuildPath(file));
    }
    for (const dependency of chunk.imports ?? []) {
      visit(dependency);
    }
  }
  visit(entry);
  return [...files].sort();
}

/** The registration helper is a dynamic startup dependency, rather than an optional tool.
 * @param {import('vite').Manifest} manifest
 */
export function collectAppShellFiles(manifest) {
  const files = new Set(collectStaticFiles(manifest, 'index.html'));
  for (const entry of manifest['index.html'].dynamicImports ?? []) {
    if (/(?:^|\/)workbox-window\//.test(entry)) {
      collectStaticFiles(manifest, entry).forEach(file => files.add(file));
    }
  }
  return [...files].sort();
}

/** @param {string} directory @param {string} file */
async function readBuildFile(directory, file) {
  const root = await realpath(directory);
  const path = await realpath(resolve(root, assertBuildPath(file)));
  if (!path.startsWith(`${root}${sep}`)) {
    throw new Error(`Build resource escapes the output directory: ${file}`);
  }
  return readFile(path);
}

/** @param {string} directory */
export async function readBuildManifest(directory) {
  return JSON.parse(await readFile(resolve(directory, '.vite/manifest.json'), 'utf8'));
}

/** Include worker scripts and emitted fonts even when Vite omits them from its manifest. */
export async function getRuntimeAssets(directory) {
  const paths = [];
  async function visit(folder) {
    for (const entry of await readdir(resolve(directory, folder), { withFileTypes: true })) {
      const path = assertBuildPath(`${folder}/${entry.name}`);
      if (entry.isDirectory()) {
        await visit(path);
      }
      else if (entry.isFile() && /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|svg|gif|webp|ico|wasm|json)$/.test(path)) {
        paths.push(path);
      }
    }
  }
  await visit('assets');
  paths.sort();
  return { paths, buildId: createHash('sha256').update(JSON.stringify(paths)).digest('hex').slice(0, 16) };
}

/** @param {number} bytes @param {number} limit */
export function assertPrecacheBudget(bytes, limit = budgets.precacheBytes) {
  if (bytes > limit) {
    throw new Error(`PWA precache budget exceeded: ${bytes} bytes > ${limit} bytes.`);
  }
}

/**
 * @param {string} directory
 * @param {import('workbox-build').ManifestEntry[]} entries
 * @param {import('workbox-build').ManifestEntry[]} additionalEntries Workbox appends these after transforms.
 */
export async function filterAppShell(directory, entries, additionalEntries = []) {
  const manifest = await readBuildManifest(directory);
  const shell = new Set(['index.html', 'manifest.webmanifest', ...shellIcons, ...collectAppShellFiles(manifest)]);
  const candidates = new Map([...entries, ...additionalEntries].map(entry => [assertBuildPath(entry.url), entry]));
  if (additionalEntries.some(entry => !shell.has(entry.url))) {
    throw new Error('Additional Workbox entries must belong to the application shell.');
  }
  for (const file of shell) {
    if (!candidates.has(file)) {
      throw new Error(`Application shell resource missing from Workbox candidates: ${file}`);
    }
  }

  const sizes = new Map();
  const allFiles = new Set(shell);
  const runtimeAssets = await getRuntimeAssets(directory);
  runtimeAssets.paths.forEach(file => allFiles.add(file));
  // Root dynamic imports include all tool entries, including synthesized shared entry keys.
  const optionalEntries = (manifest['index.html'].dynamicImports ?? [])
    .filter(entry => !shell.has(manifest[entry]?.file))
    .map(entry => ({ entry, files: collectStaticFiles(manifest, entry) }));
  for (const entry of optionalEntries) {
    entry.files.forEach(file => allFiles.add(file));
  }
  for (const file of [...allFiles].sort()) {
    const content = await readBuildFile(directory, file);
    sizes.set(file, { file, bytes: content.byteLength, gzipBytes: gzipSync(content).byteLength });
  }
  function summarize(files) {
    const resources = [...new Set(files)].map(file => sizes.get(file));
    return {
      bytes: resources.reduce((sum, file) => sum + file.bytes, 0),
      gzipBytes: resources.reduce((sum, file) => sum + file.gzipBytes, 0),
      javaScriptGzipBytes: resources.filter(file => file.file.endsWith('.js')).reduce((sum, file) => sum + file.gzipBytes, 0),
      files: resources,
    };
  }
  const precache = summarize([...shell].sort());
  const initial = summarize(collectAppShellFiles(manifest));
  const optional = optionalEntries.map(entry => ({ entry: entry.entry, ...summarize(entry.files) }))
    .sort((a, b) => b.javaScriptGzipBytes - a.javaScriptGzipBytes);
  const report = {
    budgets,
    precache,
    initial,
    optionalEntries: optional,
    runtimeAssets: summarize(runtimeAssets.paths),
    // Only the precache limit is enforced in this slice. Keep the long-term targets visible.
    pendingOptimizations: {
      initialJavaScript: initial.javaScriptGzipBytes > budgets.initialJavaScriptGzipBytes,
      entries: optional.filter(entry => entry.javaScriptGzipBytes > budgets.toolJavaScriptGzipBytes).map(entry => entry.entry),
      assets: runtimeAssets.paths.filter(file => file.endsWith('.js') && sizes.get(file).gzipBytes > budgets.toolJavaScriptGzipBytes),
    },
  };
  await writeFile(resolve(directory, 'bundle-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  assertPrecacheBudget(precache.bytes);
  console.log(`[PWA] Application shell: ${shell.size} files, ${(precache.bytes / 1024).toFixed(2)} KiB; initial JS gzip: ${(initial.javaScriptGzipBytes / 1024).toFixed(2)} KiB.`);
  const appendedFiles = new Set(additionalEntries.map(entry => entry.url));
  return { manifest: [...shell].sort().filter(file => !appendedFiles.has(file)).map(file => candidates.get(file)), warnings: [] };
}

/** @param {string} directory @returns {import('vite').Plugin} */
export function runtimeAssetsPlugin(directory) {
  const moduleId = 'virtual:pwa-runtime-assets';
  return {
    name: 'it-tools-pwa-runtime-assets',
    resolveId(id) {
      return id === moduleId ? `\0${moduleId}` : undefined;
    },
    async load(id) {
      if (id !== `\0${moduleId}`) {
        return;
      }
      const { paths, buildId } = await getRuntimeAssets(directory);
      return `export const assetPaths = ${JSON.stringify(paths)}; export const buildId = ${JSON.stringify(buildId)};`;
    },
  };
}
