/** CalVer remains valid SemVer and orders releases made on the same UTC day. */
export function releaseVersion(now, shortSha) {
  if (!/^[a-f0-9]+$/.test(shortSha) || !Number.isFinite(now.getTime())) {
    throw new Error('Invalid release date or revision.');
  }
  return `${now.getUTCFullYear()}.${now.getUTCMonth() + 1}.${now.getUTCDate()}-${Math.floor(now.getTime() / 1000)}.g${shortSha}`;
}
