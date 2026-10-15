import { randIntFromInterval, webCryptoRandomSource, type RandomSource } from '@/utils/random';

export interface TokenOptions {
  withUppercase?: boolean
  withLowercase?: boolean
  withNumbers?: boolean
  withSymbols?: boolean
  length?: number
  alphabet?: string
}

export interface TokenSummary {
  alphabetSize: number
  length: number
  entropyBits: number
  combinationsExponent: number
  warnings: string[]
}

// The UI uses at most 512 characters; this service cap bounds direct callers and output allocation.
const MAX_TOKEN_LENGTH = 65_536;

function getAlphabet({
  withUppercase = true,
  withLowercase = true,
  withNumbers = true,
  withSymbols = false,
  alphabet,
}: TokenOptions) {
  return alphabet ?? [
    withUppercase ? 'ABCDEFGHIJKLMOPQRSTUVWXYZ' : '',
    withLowercase ? 'abcdefghijklmopqrstuvwxyz' : '',
    withNumbers ? '0123456789' : '',
    withSymbols ? '.,;:!?./-"\'#{([-|\\@)]=}*+' : '',
  ].join('');
}

/** Generates tokens with unbiased alphabet indexes; non-empty output is capped at 65,536 characters. */
export function createToken(options: TokenOptions, source: RandomSource = webCryptoRandomSource) {
  const requestedLength = options.length ?? 64;
  if (Number.isNaN(requestedLength)) {
    return '';
  }

  if (!Number.isFinite(requestedLength)) {
    throw new RangeError('Token length must be finite.');
  }

  const length = Math.trunc(requestedLength);
  if (length < 0) {
    throw new RangeError('Token length must not be negative.');
  }

  const alphabet = getAlphabet(options);
  if (alphabet.length === 0 || length === 0) {
    return '';
  }

  if (length > MAX_TOKEN_LENGTH) {
    throw new RangeError(`Token length must not exceed ${MAX_TOKEN_LENGTH}.`);
  }

  const characters = new Array<string>(length);
  for (let index = 0; index < length; index++) {
    characters[index] = alphabet[randIntFromInterval(0, alphabet.length, source)]!;
  }

  return characters.join('');
}

export function summarizeTokenOptions(options: TokenOptions): TokenSummary {
  const length = options.length ?? 64;
  const alphabetSize = new Set(getAlphabet(options)).size;
  const entropyBits = alphabetSize > 0 ? Math.round(length * Math.log2(alphabetSize)) : 0;
  const combinationsExponent = alphabetSize > 0 ? Math.round(length * Math.log10(alphabetSize)) : 0;
  const warnings: string[] = [];

  if (alphabetSize === 0) {
    warnings.push('No characters are enabled.');
  }

  if (entropyBits > 0 && entropyBits < 64) {
    warnings.push('Entropy is below 64 bits.');
  }

  return {
    alphabetSize,
    length,
    entropyBits,
    combinationsExponent,
    warnings,
  };
}
