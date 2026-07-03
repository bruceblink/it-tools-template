import { shuffleString } from '@/utils/random';

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

export function createToken(options: TokenOptions) {
  const length = options.length ?? 64;
  const allAlphabet = getAlphabet(options);

  return shuffleString(allAlphabet.repeat(length)).substring(0, length);
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
