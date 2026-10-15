// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  clearLegacyJwtSignerInputs,
  getJwtSignerStorage,
  jwtSignerAlgorithmStorageKey,
  jwtSignerSensitiveStorageKeys,
  readJwtSignerAlgorithm,
  writeJwtSignerAlgorithm,
} from './jwt-signer.storage';

describe('JWT signer storage policy', () => {
  it('removes only the five legacy sensitive keys without reading or writing values', () => {
    const removeItem = vi.fn();
    const storage = {
      removeItem,
      getItem: vi.fn(),
      setItem: vi.fn(),
    };

    expect(clearLegacyJwtSignerInputs(storage)).toBe(true);
    expect(removeItem.mock.calls).toEqual(jwtSignerSensitiveStorageKeys.map(key => [key]));
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(jwtSignerSensitiveStorageKeys).not.toContain(jwtSignerAlgorithmStorageKey);
  });

  it('continues cleaning the remaining keys and reports a removal failure', () => {
    const failedKey = jwtSignerSensitiveStorageKeys[1];
    const removeItem = vi.fn((key: string) => {
      if (key === failedKey) {
        throw new DOMException('Blocked by test storage', 'SecurityError');
      }
    });

    expect(clearLegacyJwtSignerInputs({ removeItem })).toBe(false);
    expect(removeItem.mock.calls).toEqual(jwtSignerSensitiveStorageKeys.map(key => [key]));
  });

  it('uses HS256 when the algorithm preference cannot be read', () => {
    const onStorageFailure = vi.fn();
    const storage = {
      getItem: vi.fn(() => {
        throw new DOMException('Blocked by test storage', 'SecurityError');
      }),
    };

    expect(readJwtSignerAlgorithm(storage, onStorageFailure)).toBe('HS256');
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(jwtSignerAlgorithmStorageKey);
    expect(onStorageFailure).toHaveBeenCalledExactlyOnceWith();
  });

  it('restores a supported algorithm preference', () => {
    const onStorageFailure = vi.fn();
    const storage = {
      getItem: vi.fn(() => 'HS384'),
    };

    expect(readJwtSignerAlgorithm(storage, onStorageFailure)).toBe('HS384');
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(jwtSignerAlgorithmStorageKey);
    expect(onStorageFailure).not.toHaveBeenCalled();
  });

  it('uses HS256 for an unsupported stored algorithm', () => {
    const onStorageFailure = vi.fn();
    const storage = {
      getItem: vi.fn(() => 'RS256'),
    };

    expect(readJwtSignerAlgorithm(storage, onStorageFailure)).toBe('HS256');
    expect(onStorageFailure).not.toHaveBeenCalled();
  });

  it('uses in-memory defaults when the browser storage accessor is blocked', () => {
    const storageAccessor = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked by test storage', 'SecurityError');
    });
    const onStorageFailure = vi.fn();

    try {
      const storage = getJwtSignerStorage();

      expect(storage).toBeNull();
      expect(clearLegacyJwtSignerInputs(storage)).toBe(false);
      expect(readJwtSignerAlgorithm(storage, onStorageFailure)).toBe('HS256');
      expect(onStorageFailure).toHaveBeenCalledExactlyOnceWith();
    }
    finally {
      storageAccessor.mockRestore();
    }
  });

  it('keeps algorithm writes isolated and reports write failures', () => {
    const onStorageFailure = vi.fn();
    const storage = {
      setItem: vi.fn(() => {
        throw new DOMException('Blocked by test storage', 'SecurityError');
      }),
    };

    writeJwtSignerAlgorithm(storage, 'HS512', onStorageFailure);

    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(jwtSignerAlgorithmStorageKey, 'HS512');
    expect(onStorageFailure).toHaveBeenCalledExactlyOnceWith();
  });

  it('writes a supported algorithm preference without touching other keys', () => {
    const onStorageFailure = vi.fn();
    const storage = {
      setItem: vi.fn(),
    };

    writeJwtSignerAlgorithm(storage, 'HS384', onStorageFailure);

    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(jwtSignerAlgorithmStorageKey, 'HS384');
    expect(onStorageFailure).not.toHaveBeenCalled();
  });
});
