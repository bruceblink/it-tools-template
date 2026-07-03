export interface TextToHexOptions {
  uppercase?: boolean
  separator?: string
}

export interface HexToTextOptions {
  allowSeparators?: boolean
}

export interface HexInputSummary {
  valid: boolean
  normalizedLength: number
  byteLength: number
  error?: string
}

export class HexStringConverterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HexStringConverterError';
  }
}

function byteToHex(byte: number, uppercase: boolean) {
  const hex = byte.toString(16).padStart(2, '0');

  return uppercase ? hex.toUpperCase() : hex;
}

function normalizeHexInput(input: string, { allowSeparators = true }: HexToTextOptions = {}) {
  const trimmedInput = input.trim();
  const normalized = allowSeparators
    ? trimmedInput.replace(/0x/gi, '').replace(/[\s:_-]/g, '')
    : trimmedInput;

  if (normalized.length % 2 !== 0) {
    throw new HexStringConverterError('Hex input must contain an even number of digits.');
  }

  if (!/^[0-9a-fA-F]*$/.test(normalized)) {
    throw new HexStringConverterError('Input contains non-hexadecimal characters.');
  }

  return normalized;
}

export function textToHex(input: string, { uppercase = false, separator = '' }: TextToHexOptions = {}) {
  const bytes = new TextEncoder().encode(input);

  return [...bytes].map(byte => byteToHex(byte, uppercase)).join(separator);
}

export function hexToText(input: string, options: HexToTextOptions = {}) {
  const normalized = normalizeHexInput(input, options);
  const bytes = new Uint8Array(normalized.length / 2);

  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  catch {
    throw new HexStringConverterError('Decoded bytes are not valid UTF-8 text.');
  }
}

export function isValidHex(input: string, options: HexToTextOptions = {}) {
  try {
    normalizeHexInput(input, options);
    return true;
  }
  catch {
    return false;
  }
}

export function summarizeHexInput(input: string, options: HexToTextOptions = {}): HexInputSummary {
  try {
    const normalized = normalizeHexInput(input, options);

    return {
      valid: true,
      normalizedLength: normalized.length,
      byteLength: normalized.length / 2,
    };
  }
  catch (error) {
    return {
      valid: false,
      normalizedLength: 0,
      byteLength: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
