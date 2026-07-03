import { base64ToText, textToBase64 } from '@/utils/base64';

export interface ParsedBasicAuth {
  scheme: 'Basic'
  token: string
  normalizedToken: string
  username: string
  password: string
  passwordLength: number
  credential: string
  header: string
  warnings: string[]
  securityNotes: string[]
}

const COMMON_WEAK_PASSWORDS = new Set([
  'admin',
  'changeme',
  'default',
  'letmein',
  'password',
  'password1',
  'qwerty',
  'secret',
  'test',
  'welcome',
]);

function extractToken(input: string) {
  const trimmedInput = input.trim();
  const headerMatch = /^authorization\s*:\s*basic\s+(.+)$/i.exec(trimmedInput);
  if (headerMatch?.[1]) {
    return headerMatch[1].trim();
  }

  const schemeMatch = /^basic\s+(.+)$/i.exec(trimmedInput);
  if (schemeMatch?.[1]) {
    return schemeMatch[1].trim();
  }

  return trimmedInput;
}

export function parseBasicAuth(input: string): ParsedBasicAuth {
  const token = extractToken(input);
  if (!token) {
    throw new Error('Basic auth value is empty.');
  }

  const credential = base64ToText(token);
  const separatorIndex = credential.indexOf(':');
  if (separatorIndex === -1) {
    throw new Error('Decoded credentials must contain a username and password separated by ":".');
  }

  const username = credential.slice(0, separatorIndex);
  const password = credential.slice(separatorIndex + 1);
  const warnings: string[] = [];

  if (!username) {
    warnings.push('Username is empty.');
  }

  if (!password) {
    warnings.push('Password is empty.');
  }

  const normalizedToken = textToBase64(credential);
  const securityNotes = [
    'Basic authentication sends reusable credentials with every request; use HTTPS and prefer short-lived tokens when possible.',
  ];

  if (password.length > 0 && password.length < 8) {
    securityNotes.push('Password is shorter than 8 characters.');
  }

  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) {
    securityNotes.push('Password matches a common weak password.');
  }

  return {
    scheme: 'Basic',
    token,
    normalizedToken,
    username,
    password,
    passwordLength: password.length,
    credential,
    header: `Authorization: Basic ${normalizedToken}`,
    warnings,
    securityNotes,
  };
}
