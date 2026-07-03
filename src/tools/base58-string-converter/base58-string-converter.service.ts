export type Base58AlphabetKey = 'bitcoin' | 'flickr';

export interface Base58Options {
  alphabet?: Base58AlphabetKey
}

export interface Base58InputSummary {
  valid: boolean
  normalizedLength: number
  leadingZeroBytes: number
  byteLength: number
  error?: string
}

export class Base58StringConverterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Base58StringConverterError';
  }
}

export const base58Alphabets: Record<Base58AlphabetKey, string> = {
  bitcoin: '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
  flickr: '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ',
};

function getAlphabet(alphabetKey: Base58AlphabetKey = 'bitcoin') {
  return base58Alphabets[alphabetKey];
}

function bytesToBase58(bytes: Uint8Array, alphabet: string) {
  if (bytes.length === 0) {
    return '';
  }

  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  let output = '';
  while (value > 0n) {
    const remainder = Number(value % 58n);
    output = alphabet[remainder] + output;
    value /= 58n;
  }

  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }
    output = alphabet[0] + output;
  }

  return output;
}

function base58ToBytes(input: string, alphabet: string) {
  const trimmedInput = input.trim();
  const valueByCharacter = new Map([...alphabet].map((character, index) => [character, BigInt(index)]));
  let value = 0n;

  for (const character of trimmedInput) {
    const characterValue = valueByCharacter.get(character);
    if (characterValue === undefined) {
      throw new Base58StringConverterError(`Invalid Base58 character "${character}".`);
    }

    value = value * 58n + characterValue;
  }

  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 255n));
    value >>= 8n;
  }

  for (const character of trimmedInput) {
    if (character !== alphabet[0]) {
      break;
    }
    bytes.unshift(0);
  }

  return new Uint8Array(bytes);
}

export function textToBase58(input: string, options: Base58Options = {}) {
  return bytesToBase58(new TextEncoder().encode(input), getAlphabet(options.alphabet));
}

export function base58ToText(input: string, options: Base58Options = {}) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(base58ToBytes(input, getAlphabet(options.alphabet)));
  }
  catch (error) {
    if (error instanceof Base58StringConverterError) {
      throw error;
    }

    throw new Base58StringConverterError('Decoded bytes are not valid UTF-8 text.');
  }
}

export function isValidBase58(input: string, options: Base58Options = {}) {
  try {
    base58ToBytes(input, getAlphabet(options.alphabet));
    return true;
  }
  catch {
    return false;
  }
}

export function summarizeBase58Input(input: string, options: Base58Options = {}): Base58InputSummary {
  try {
    const alphabet = getAlphabet(options.alphabet);
    const normalized = input.trim();
    const bytes = base58ToBytes(input, alphabet);
    const leadingZeroBytes = [...normalized].findIndex(character => character !== alphabet[0]);

    return {
      valid: true,
      normalizedLength: normalized.length,
      leadingZeroBytes: leadingZeroBytes === -1 ? normalized.length : leadingZeroBytes,
      byteLength: bytes.length,
    };
  }
  catch (error) {
    return {
      valid: false,
      normalizedLength: 0,
      leadingZeroBytes: 0,
      byteLength: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
