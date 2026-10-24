import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distDirectory = join(projectRoot, 'dist');
const scannedExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.webmanifest']);
const forbiddenMarkers = [
  'systeminformation',
  'desktop:system-monitor:',
  'desktop:database:',
  'mysql2',
  'pg-query-stream',
  'node:sqlite',
];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    }
    else if (scannedExtensions.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }
  return files;
}

test('production Web bundle excludes desktop-only database and system monitor code', async () => {
  const files = await listFiles(distDirectory);
  assert.ok(files.length > 0, 'the production Web bundle must exist before isolation checks run');

  const violations = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    for (const marker of forbiddenMarkers) {
      if (content.includes(marker)) {
        violations.push(`${file.replace(`${projectRoot}\\`, '')}: ${marker}`);
      }
    }
  }

  assert.deepEqual(violations, [], 'desktop-only dependencies or IPC markers leaked into dist');
});
