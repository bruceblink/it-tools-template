import { createRequire } from 'node:module';

const updaterRequire = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { gt, rcompare, valid } = updaterRequire('semver');

/** Use the UTC release date and the unique abbreviated source commit. */
export function releaseVersion(now, shortSha) {
  if (!/^[a-f0-9]+$/.test(shortSha) || !Number.isFinite(now.getTime())) {
    throw new Error('Invalid release date or revision.');
  }
  const version = `${now.getUTCFullYear()}.${now.getUTCMonth() + 1}.${now.getUTCDate()}-${shortSha}`;
  if (!valid(version)) {
    throw new Error('The abbreviated commit does not produce a valid SemVer version.');
  }
  return version;
}

/** A later same-day hash can sort before an older version in the updater. */
export function assertReleaseVersionIsNewer(version, tags) {
  const newest = tags
    .filter(tag => tag.startsWith('v') && valid(tag.slice(1)))
    .map(tag => tag.slice(1))
    .sort(rcompare)[0];
  if (newest && !gt(version, newest)) {
    throw new Error(`Release ${version} does not sort after existing version ${newest}; automatic updates would not offer it.`);
  }
}
