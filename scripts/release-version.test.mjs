import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { assertReleaseVersionIsNewer, releaseVersion } from './shared/release-version.mjs';

const updaterRequire = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { valid, gt } = updaterRequire('semver');
test('release versions use the UTC date and short commit', () => {
  const first = releaseVersion(new Date('2026-11-01T01:00:00Z'), 'abcdef0');
  const nextDay = releaseVersion(new Date('2026-11-02T02:00:00Z'), '1234567');
  assert.equal(first, '2026.11.1-abcdef0');
  assert.equal(valid(first), first);
  assert.equal(valid(releaseVersion(new Date('2027-01-01T00:00:00Z'), 'abcdef0'))?.startsWith('2027.1.1-'), true);
  assert.throws(() => releaseVersion(new Date('2027-01-01T00:00:00Z'), '0123456'), /valid SemVer/);
  assert.ok(gt(nextDay, first));
  assert.ok(gt(first, '2026.10.30-e60c009'));
});

test('rejects a same-day hash that would be older for the updater', () => {
  assert.doesNotThrow(() => assertReleaseVersionIsNewer('2026.11.1-fedcba9', [
    'v2026.10.30-e60c009',
    'v2026.11.1-abcdef0',
  ]));
  assert.throws(
    () => assertReleaseVersionIsNewer('2026.11.1-123abcd', ['v2026.11.1-abcdef0']),
    /automatic updates would not offer it/,
  );
  assert.throws(
    () => assertReleaseVersionIsNewer('2026.11.1-abcdef0', ['v2026.11.1-abcdef0']),
    /existing version/,
  );
});
