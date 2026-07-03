import { Base64 } from 'js-base64';

export {
  textToBase64,
  base64ToText,
  isValidBase64,
  removePotentialDataAndMimePrefix,
  summarizeBase64Input,
};

interface Base64Options {
  makeUrlSafe?: boolean
}

export interface Base64InputSummary {
  valid: boolean
  normalizedLength: number
  paddingLength: number
  byteLength: number
  hasDataUriPrefix: boolean
  error?: string
}

function textToBase64(str: string, { makeUrlSafe = false }: Base64Options = {}) {
  const encoded = Base64.encode(str);
  return makeUrlSafe ? makeUriSafe(encoded) : encoded;
}

function base64ToText(str: string, { makeUrlSafe = false }: Base64Options = {}) {
  if (!isValidBase64(str, { makeUrlSafe })) {
    throw new Error('Incorrect base64 string');
  }

  let cleanStr = removePotentialDataAndMimePrefix(str);
  if (makeUrlSafe) {
    cleanStr = unURI(cleanStr);
  }

  try {
    return Base64.decode(cleanStr);
  }
  catch {
    throw new Error('Incorrect base64 string');
  }
}

function removePotentialDataAndMimePrefix(str: string) {
  return str.replace(/^data:.*?;base64,/, '');
}

function isValidBase64(str: string, { makeUrlSafe = false }: Base64Options = {}) {
  let cleanStr = removePotentialDataAndMimePrefix(str);
  if (makeUrlSafe) {
    cleanStr = unURI(cleanStr);
  }

  try {
    const reEncodedBase64 = Base64.fromUint8Array(Base64.toUint8Array(cleanStr));
    if (makeUrlSafe) {
      return removePotentialPadding(reEncodedBase64) === cleanStr;
    }
    return reEncodedBase64 === cleanStr.replace(/\s/g, '');
  }
  catch {
    return false;
  }
}

function summarizeBase64Input(str: string, { makeUrlSafe = false }: Base64Options = {}): Base64InputSummary {
  try {
    if (!isValidBase64(str, { makeUrlSafe })) {
      throw new Error('Incorrect base64 string');
    }

    const trimmed = str.trim();
    const hasDataUriPrefix = trimmed !== removePotentialDataAndMimePrefix(trimmed);
    const withoutPrefix = removePotentialDataAndMimePrefix(trimmed);
    const normalized = makeUrlSafe
      ? unURI(withoutPrefix)
      : withoutPrefix.replace(/\s/g, '');
    const bytes = Base64.toUint8Array(normalized);

    return {
      valid: true,
      normalizedLength: normalized.length,
      paddingLength: withoutPrefix.match(/=+$/)?.[0].length ?? 0,
      byteLength: bytes.length,
      hasDataUriPrefix,
    };
  }
  catch (error) {
    return {
      valid: false,
      normalizedLength: 0,
      paddingLength: 0,
      byteLength: 0,
      hasDataUriPrefix: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function makeUriSafe(encoded: string) {
  return encoded.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function unURI(encoded: string): string {
  return encoded
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/]/g, '');
}

function removePotentialPadding(str: string) {
  return str.replace(/=/g, '');
}
