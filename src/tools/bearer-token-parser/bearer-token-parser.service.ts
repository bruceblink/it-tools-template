import { jwtDecode, type JwtHeader, type JwtPayload } from 'jwt-decode';

export type BearerTokenKind = 'jwt' | 'opaque';

export interface BearerTokenClaim {
  claim: string
  value: string
  friendlyValue?: string
}

export interface ParsedBearerToken {
  scheme: 'Bearer'
  token: string
  kind: BearerTokenKind
  header: string
  tokenPreview: string
  tokenLength: number
  jwtHeader: BearerTokenClaim[]
  jwtPayload: BearerTokenClaim[]
  expiresAt?: string
  issuedAt?: string
  notBefore?: string
  expired?: boolean
  warnings: string[]
}

function extractToken(input: string) {
  const trimmedInput = input.trim();
  const headerMatch = /^authorization\s*:\s*bearer\s+(.+)$/i.exec(trimmedInput);
  if (headerMatch?.[1]) {
    return headerMatch[1].trim();
  }

  const schemeMatch = /^bearer\s+(.+)$/i.exec(trimmedInput);
  if (schemeMatch?.[1]) {
    return schemeMatch[1].trim();
  }

  return trimmedInput;
}

function isJwtLike(token: string) {
  return token.split('.').length === 3;
}

function formatValue(value: unknown) {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function formatUnixTimestamp(value: unknown) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  return new Date(timestamp * 1000).toISOString();
}

function claimsToRows(claims: Record<string, unknown>): BearerTokenClaim[] {
  return Object.entries(claims).map(([claim, value]) => ({
    claim,
    value: formatValue(value),
    friendlyValue: ['exp', 'iat', 'nbf'].includes(claim) ? formatUnixTimestamp(value) : undefined,
  }));
}

function tokenPreview(token: string) {
  if (token.length <= 24) {
    return token;
  }

  return `${token.slice(0, 12)}...${token.slice(-8)}`;
}

export function parseBearerToken(input: string): ParsedBearerToken {
  const token = extractToken(input);
  if (!token) {
    throw new Error('Bearer token value is empty.');
  }

  const baseResult = {
    scheme: 'Bearer' as const,
    token,
    header: `Authorization: Bearer ${token}`,
    tokenPreview: tokenPreview(token),
    tokenLength: token.length,
  };

  if (!isJwtLike(token)) {
    return {
      ...baseResult,
      kind: 'opaque',
      jwtHeader: [],
      jwtPayload: [],
      warnings: ['Token is not a JWT; only opaque token metadata is available.'],
    };
  }

  const rawHeader = jwtDecode<JwtHeader>(token, { header: true });
  const rawPayload = jwtDecode<JwtPayload>(token);
  const expiresAt = formatUnixTimestamp(rawPayload.exp);
  const issuedAt = formatUnixTimestamp(rawPayload.iat);
  const notBefore = formatUnixTimestamp(rawPayload.nbf);
  const expired = typeof rawPayload.exp === 'number' ? rawPayload.exp * 1000 <= Date.now() : undefined;
  const warnings: string[] = [];

  if (!rawPayload.exp) {
    warnings.push('JWT has no exp claim.');
  }
  else if (expired) {
    warnings.push('JWT is expired.');
  }

  if (!rawHeader.alg || rawHeader.alg === 'none') {
    warnings.push('JWT algorithm is missing or set to none.');
  }

  return {
    ...baseResult,
    kind: 'jwt',
    jwtHeader: claimsToRows(rawHeader as Record<string, unknown>),
    jwtPayload: claimsToRows(rawPayload as Record<string, unknown>),
    expiresAt,
    issuedAt,
    notBefore,
    expired,
    warnings,
  };
}
