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
  subject: string
  issuer: string
  audiences: string[]
  scopes: string[]
  roles: string[]
  jwtHeader: BearerTokenClaim[]
  jwtPayload: BearerTokenClaim[]
  expiresAt?: string
  issuedAt?: string
  notBefore?: string
  expired?: boolean
  active?: boolean
  timeToExpiry?: string
  timeUntilActive?: string
  warnings: string[]
}

export interface ParseBearerTokenOptions {
  now?: Date
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

function getUnixTimestamp(value: unknown): number | undefined {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function stringifyClaimValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function claimToList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(stringifyClaimValue)
      .filter((item): item is string => Boolean(item));
  }

  const stringValue = stringifyClaimValue(value);
  if (!stringValue) {
    return [];
  }

  return stringValue.split(/\s+/).map(item => item.trim()).filter(Boolean);
}

function formatDurationFromSeconds(seconds: number): string {
  const absSeconds = Math.max(Math.floor(Math.abs(seconds)), 0);

  if (absSeconds === 0) {
    return 'now';
  }

  const units = [
    { label: 'day', value: 86_400 },
    { label: 'hour', value: 3_600 },
    { label: 'minute', value: 60 },
  ];

  for (const unit of units) {
    if (absSeconds >= unit.value && absSeconds % unit.value === 0) {
      const amount = absSeconds / unit.value;
      return `${amount} ${unit.label}${amount === 1 ? '' : 's'}`;
    }
  }

  return `${absSeconds} second${absSeconds === 1 ? '' : 's'}`;
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

export function parseBearerToken(input: string, { now = new Date() }: ParseBearerTokenOptions = {}): ParsedBearerToken {
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
    subject: '',
    issuer: '',
    audiences: [],
    scopes: [],
    roles: [],
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
  const payloadClaims = rawPayload as Record<string, unknown>;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const exp = getUnixTimestamp(rawPayload.exp);
  const nbf = getUnixTimestamp(rawPayload.nbf);
  const expiresAt = formatUnixTimestamp(rawPayload.exp);
  const issuedAt = formatUnixTimestamp(rawPayload.iat);
  const notBefore = formatUnixTimestamp(rawPayload.nbf);
  const expired = exp === undefined ? undefined : exp <= nowSeconds;
  const active = nbf === undefined ? expired === undefined ? undefined : !expired : nbf <= nowSeconds && !expired;
  const timeToExpiry = exp === undefined ? undefined : formatDurationFromSeconds(exp - nowSeconds);
  const timeUntilActive = nbf === undefined || nbf <= nowSeconds ? undefined : formatDurationFromSeconds(nbf - nowSeconds);
  const warnings: string[] = [];

  if (exp === undefined) {
    warnings.push('JWT has no exp claim.');
  }
  else if (expired) {
    warnings.push('JWT is expired.');
  }

  if (nbf !== undefined && nbf > nowSeconds) {
    warnings.push('JWT is not active yet.');
  }

  if (!rawHeader.alg || rawHeader.alg === 'none') {
    warnings.push('JWT algorithm is missing or set to none.');
  }

  return {
    ...baseResult,
    kind: 'jwt',
    jwtHeader: claimsToRows(rawHeader as Record<string, unknown>),
    jwtPayload: claimsToRows(payloadClaims),
    subject: stringifyClaimValue(payloadClaims.sub) ?? '',
    issuer: stringifyClaimValue(payloadClaims.iss) ?? '',
    audiences: claimToList(payloadClaims.aud),
    scopes: [...new Set([...claimToList(payloadClaims.scope), ...claimToList(payloadClaims.scp)])],
    roles: [...new Set([...claimToList(payloadClaims.roles), ...claimToList(payloadClaims.role)])],
    expiresAt,
    issuedAt,
    notBefore,
    expired,
    active,
    timeToExpiry,
    timeUntilActive,
    warnings,
  };
}
