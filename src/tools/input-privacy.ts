/**
 * Exact content keys used by earlier tool versions. Keys are removed only when
 * their tool opens; preferences and other tools' data are outside this boundary.
 */
export const legacyToolContentKeys: Readonly<Record<string, readonly string[]>> = {
  '/basic-auth-parser': ['basic-auth-parser:input'],
  '/bearer-token-parser': ['bearer-token-parser:input'],
  '/benchmark-builder': ['benchmark-builder:suites'],
  '/cookie-parser': ['cookie-parser:cookies'],
  '/cors-analyzer': ['cors-analyzer:headers'],
  '/csp-analyzer': ['csp-analyzer:policy'],
  '/curl-code-generator': ['curl-code-generator:curl'],
  '/env-vars-parser': ['env-vars-parser:env'],
  '/html-wysiwyg-editor': ['html-wysiwyg-editor--html'],
  '/http-cache-analyzer': ['http-cache-analyzer:headers'],
  '/http-headers-parser': ['http-headers-parser:headers'],
  '/ipv4-address-classifier': ['ipv4-address-classifier:ip'],
  '/ipv4-address-converter': ['ipv4-converter:ip'],
  '/ipv4-cidr-containment-checker': ['ipv4-cidr-containment-checker:rules', 'ipv4-cidr-containment-checker:targets'],
  '/ipv4-cidr-overlap-checker': ['ipv4-cidr-overlap-checker:cidrs'],
  '/ipv4-cidr-splitter': ['ipv4-cidr-splitter:source-cidr'],
  '/ipv4-range-expander': ['ipv4-range-expander:startAddress', 'ipv4-range-expander:endAddress'],
  '/ipv4-subnet-calculator': ['ipv4-subnet-calculator:ip'],
  '/ipv4-wildcard-mask': ['ipv4-wildcard-mask:input'],
  '/json-path-extractor': ['json-path-extractor:raw-json', 'json-path-extractor:path'],
  '/json-prettify': ['json-prettify:raw-json'],
  '/regex-tester': ['regex-tester:regex'],
  '/robots-txt-tester': ['robots-txt-tester:robots', 'robots-txt-tester:url', 'robots-txt-tester:user-agent'],
  '/security-headers-analyzer': ['security-headers-analyzer:headers'],
  '/sri-hash-generator': ['sri-hash-generator:content', 'sri-hash-generator:url'],
  '/url-query-builder': ['url-query-builder:base-url', 'url-query-builder:parameters'],
  '/yaml-prettify': ['yaml-prettify:raw-yaml'],
};

// These tools already keep their content in component refs. JWT has its own notice and migration.
const existingMemoryOnlyTools = new Set([
  '/basic-auth-generator',
  '/bcrypt',
  '/bip39-generator',
  '/encryption',
  '/hash-text',
  '/hmac-generator',
  '/jwt-parser',
  '/otp-generator',
  '/password-strength-analyser',
  '/rsa-key-pair-generator',
  '/token-generator',
  '/wifi-qrcode-generator',
]);

type ContentStorage = Pick<Storage, 'removeItem'>;

/** Identifies tools whose content stays in component memory, independently of saved preferences. */
export function hasMemoryOnlyContent(toolPath: string): boolean {
  return Object.hasOwn(legacyToolContentKeys, toolPath) || existingMemoryOnlyTools.has(toolPath);
}

/** Access storage without allowing a restricted browser context to interrupt tool setup. */
function getContentStorage(): ContentStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  }
  catch {
    return null;
  }
}

/**
 * Remove only the selected tool's known old content keys, without reading values.
 * Each failed removal is isolated so later keys are still attempted. False asks
 * the UI to explain that old content may remain; new content always stays in refs.
 */
export function clearLegacyToolContent(toolPath: string, storage?: ContentStorage | null): boolean {
  if (!Object.hasOwn(legacyToolContentKeys, toolPath)) {
    return true;
  }
  const keys = legacyToolContentKeys[toolPath];
  if (!keys?.length) {
    return true;
  }

  const contentStorage = storage === undefined ? getContentStorage() : storage;
  if (!contentStorage) {
    return false;
  }

  let cleared = true;
  for (const key of keys) {
    try {
      contentStorage.removeItem(key);
    }
    catch {
      cleared = false;
    }
  }

  return cleared;
}
