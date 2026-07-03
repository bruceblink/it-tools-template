import { base64ToText, textToBase64 } from '@/utils/base64';

export interface ParsedBasicAuth {
  scheme: 'Basic'
  token: string
  username: string
  password: string
  credential: string
  header: string
  warnings: string[]
}

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

  return {
    scheme: 'Basic',
    token,
    username,
    password,
    credential,
    header: `Authorization: Basic ${textToBase64(credential)}`,
    warnings,
  };
}
