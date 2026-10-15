import { jwtHmacAlgorithms, type JwtHmacAlgorithm } from './jwt-signer.service';

export const jwtSignerAlgorithmStorageKey = 'jwt-signer:algorithm';

export const jwtSignerSensitiveStorageKeys = [
  'jwt-signer:secret',
  'jwt-signer:header',
  'jwt-signer:payload',
  'jwt-signer:token-to-verify',
  'jwt-signer:verification-secret',
] as const;

type JwtSignerStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

/**
 * Remove only the sensitive values saved by earlier JWT signer versions.
 * The helper never reads those values and continues after an individual failure.
 */
export function clearLegacyJwtSignerInputs(storage: Pick<Storage, 'removeItem'> | null): boolean {
  if (!storage) {
    return false;
  }

  let cleared = true;

  for (const key of jwtSignerSensitiveStorageKeys) {
    try {
      storage.removeItem(key);
    }
    catch {
      cleared = false;
    }
  }

  return cleared;
}

/**
 * Load only the non-sensitive algorithm preference and validate it before use.
 */
export function readJwtSignerAlgorithm(
  storage: Pick<Storage, 'getItem'> | null,
  onStorageFailure: () => void,
): JwtHmacAlgorithm {
  if (!storage) {
    onStorageFailure();
    return 'HS256';
  }

  try {
    const storedAlgorithm = storage.getItem(jwtSignerAlgorithmStorageKey);

    return jwtHmacAlgorithms.includes(storedAlgorithm as JwtHmacAlgorithm)
      ? storedAlgorithm as JwtHmacAlgorithm
      : 'HS256';
  }
  catch {
    onStorageFailure();
    return 'HS256';
  }
}

/**
 * Persist only the selected algorithm; storage errors do not block signing.
 */
export function writeJwtSignerAlgorithm(
  storage: Pick<Storage, 'setItem'> | null,
  algorithm: JwtHmacAlgorithm,
  onStorageFailure: () => void,
): void {
  if (!storage) {
    onStorageFailure();
    return;
  }

  try {
    storage.setItem(jwtSignerAlgorithmStorageKey, algorithm);
  }
  catch {
    onStorageFailure();
  }
}

/**
 * Access localStorage without allowing a restricted browser context to abort setup.
 */
export function getJwtSignerStorage(): JwtSignerStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  }
  catch {
    return null;
  }
}
