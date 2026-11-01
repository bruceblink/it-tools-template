import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { releaseVersion } from './shared/release-version.mjs';

const updaterRequire = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { valid, gt } = updaterRequire('semver');
test('release dates use valid, ordered versions including single-digit months and days', () => {
  const first = releaseVersion(new Date('2026-11-01T01:00:00Z'), 'abcdef0');
  const second = releaseVersion(new Date('2026-11-01T02:00:00Z'), '1234567');
  assert.equal(valid(first), first);
  assert.equal(valid(releaseVersion(new Date('2027-01-01T00:00:00Z'), 'abcdef0'))?.startsWith('2027.1.1-'), true);
  assert.ok(valid(releaseVersion(new Date('2027-01-01T00:00:00Z'), '0123456')));
  assert.ok(gt(second, first));
  assert.ok(gt(first, '2026.10.30-e60c009'));
});
