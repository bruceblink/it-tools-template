export interface Base32DecodeOptions {
  allowSeparators?: boolean
}

export interface Base32InputSummary {
  valid: boolean
  normalizedLength: number
  paddingLength: number
  byteLength: number
  error?: string
}

export class Base32StringConverterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Base32StringConverterError';
  }
}

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32ValueByCharacter = new Map([...base32Alphabet].map((character, index) => [character, index]));

function getBase32Character(index: number) {
  const character = base32Alphabet[index];
  if (character === undefined) {
    throw new Base32StringConverterError(`Invalid Base32 value "${index}".`);
  }

  return character;
}

function bytesToBase32(bytes: Uint8Array, { padding }: { padding: boolean }) {
  if (bytes.length === 0) {
    return '';
  }

  let bitsLeft = 0;
  let buffer = 0;
  let output = '';

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;

    while (bitsLeft >= 5) {
      output += getBase32Character((buffer >>> (bitsLeft - 5)) & 31);
      bitsLeft -= 5;
      buffer &= (1 << bitsLeft) - 1;
    }
  }

  if (bitsLeft > 0) {
    output += getBase32Character((buffer << (5 - bitsLeft)) & 31);
  }

  return padding ? output.padEnd(Math.ceil(output.length / 8) * 8, '=') : output;
}

function normalizeBase32Input(input: string, options: Base32DecodeOptions) {
  const cleanInput = options.allowSeparators
    ? input.replace(/[\s-]/g, '')
    : input.trim();
  const normalized = cleanInput.toUpperCase();

  if (!/^[A-Z2-7]*={0,6}$/.test(normalized)) {
    throw new Base32StringConverterError('Input contains characters outside the Base32 alphabet.');
  }

  const firstPaddingIndex = normalized.indexOf('=');
  if (firstPaddingIndex !== -1) {
    const paddingLength = normalized.length - firstPaddingIndex;
    if (normalized.length % 8 !== 0 || ![1, 3, 4, 6].includes(paddingLength)) {
      throw new Base32StringConverterError('Invalid Base32 padding.');
    }
  }

  const withoutPadding = normalized.replace(/=+$/, '');
  if ([1, 3, 6].includes(withoutPadding.length % 8)) {
    throw new Base32StringConverterError('Invalid Base32 length.');
  }

  return withoutPadding;
}

function base32ToBytes(input: string, options: Base32DecodeOptions = {}) {
  const normalized = normalizeBase32Input(input, options);
  const bytes: number[] = [];
  let bitsLeft = 0;
  let buffer = 0;

  for (const character of normalized) {
    const nextValue = base32ValueByCharacter.get(character);
    if (nextValue === undefined) {
      throw new Base32StringConverterError(`Invalid Base32 character "${character}".`);
    }

    buffer = (buffer << 5) | nextValue;
    bitsLeft += 5;

    while (bitsLeft >= 8) {
      bytes.push((buffer >>> (bitsLeft - 8)) & 255);
      bitsLeft -= 8;
      buffer &= (1 << bitsLeft) - 1;
    }
  }

  if (bitsLeft > 0 && buffer !== 0) {
    throw new Base32StringConverterError('Invalid trailing Base32 bits.');
  }

  return new Uint8Array(bytes);
}

export function textToBase32(input: string, { padding = true }: { padding?: boolean } = {}) {
  return bytesToBase32(new TextEncoder().encode(input), { padding });
}

export function base32ToText(input: string, options: Base32DecodeOptions = {}) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(base32ToBytes(input, options));
  }
  catch (error) {
    if (error instanceof Base32StringConverterError) {
      throw error;
    }

    throw new Base32StringConverterError('Decoded bytes are not valid UTF-8 text.');
  }
}

export function isValidBase32(input: string, options: Base32DecodeOptions = {}) {
  try {
    base32ToBytes(input, options);
    return true;
  }
  catch {
    return false;
  }
}

export function summarizeBase32Input(input: string, options: Base32DecodeOptions = {}): Base32InputSummary {
  try {
    const cleanInput = options.allowSeparators
      ? input.replace(/[\s-]/g, '')
      : input.trim();
    const normalizedLength = cleanInput.length;
    const paddingLength = cleanInput.match(/=+$/)?.[0].length ?? 0;
    const bytes = base32ToBytes(input, options);

    return {
      valid: true,
      normalizedLength,
      paddingLength,
      byteLength: bytes.length,
    };
  }
  catch (error) {
    return {
      valid: false,
      normalizedLength: 0,
      paddingLength: 0,
      byteLength: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
