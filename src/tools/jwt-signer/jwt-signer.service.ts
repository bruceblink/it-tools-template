import JSON5 from 'json5';
import { HmacSHA256, HmacSHA384, HmacSHA512, enc, type lib } from 'crypto-js';

export const jwtHmacAlgorithms = ['HS256', 'HS384', 'HS512'] as const;

export type JwtHmacAlgorithm = typeof jwtHmacAlgorithms[number];

export interface SignJwtOptions {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  secret: string
  algorithm: JwtHmacAlgorithm
}

export interface VerifyJwtSignatureOptions {
  token: string
  secret: string
}

export interface JwtSignatureVerificationResult {
  valid: boolean
  algorithm?: JwtHmacAlgorithm
  message: string
}

const hmacSigners: Record<JwtHmacAlgorithm, (message: string, secret: string) => lib.WordArray> = {
  HS256: HmacSHA256,
  HS384: HmacSHA384,
  HS512: HmacSHA512,
};

function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeString(value: string): string {
  return toBase64Url(enc.Utf8.parse(value).toString(enc.Base64));
}

function base64UrlEncodeWords(value: lib.WordArray): string {
  return toBase64Url(value.toString(enc.Base64));
}

function base64UrlDecodeString(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');

  return enc.Utf8.stringify(enc.Base64.parse(padded));
}

function createSignature(signingInput: string, secret: string, algorithm: JwtHmacAlgorithm): string {
  return base64UrlEncodeWords(hmacSigners[algorithm](signingInput, secret));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isJwtHmacAlgorithm(value: unknown): value is JwtHmacAlgorithm {
  return typeof value === 'string' && (jwtHmacAlgorithms as readonly string[]).includes(value);
}

function parseJwtHeaderSegment(headerSegment: string): Record<string, unknown> {
  const header = JSON.parse(base64UrlDecodeString(headerSegment));

  if (!isPlainObject(header)) {
    throw new Error('JWT header must be a JSON object.');
  }

  return header;
}

export function parseJwtJson(input: string, label: string): Record<string, unknown> {
  const value = JSON5.parse(input);

  if (!isPlainObject(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return value;
}

export function signJwt({ header, payload, secret, algorithm }: SignJwtOptions): string {
  const extraHeader = { ...header };
  delete extraHeader.alg;
  const typ = extraHeader.typ ?? 'JWT';
  delete extraHeader.typ;

  const normalizedHeader = {
    alg: algorithm,
    typ,
    ...extraHeader,
  };
  const encodedHeader = base64UrlEncodeString(JSON.stringify(normalizedHeader));
  const encodedPayload = base64UrlEncodeString(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createSignature(signingInput, secret, algorithm);

  return `${signingInput}.${signature}`;
}

export function signJwtText({
  headerJson,
  payloadJson,
  secret,
  algorithm,
}: {
  headerJson: string
  payloadJson: string
  secret: string
  algorithm: JwtHmacAlgorithm
}): string {
  return signJwt({
    header: parseJwtJson(headerJson, 'Header'),
    payload: parseJwtJson(payloadJson, 'Payload'),
    secret,
    algorithm,
  });
}

export function verifyJwtSignature({ token, secret }: VerifyJwtSignatureOptions): JwtSignatureVerificationResult {
  const segments = token.trim().split('.');

  if (segments.length !== 3 || segments.some(segment => segment.length === 0)) {
    return {
      valid: false,
      message: 'JWT must contain header, payload, and signature segments.',
    };
  }

  try {
    const [headerSegment, payloadSegment, signature] = segments as [string, string, string];
    const header = parseJwtHeaderSegment(headerSegment);
    const algorithm = header.alg;

    if (!isJwtHmacAlgorithm(algorithm)) {
      return {
        valid: false,
        message: `Unsupported or missing HMAC algorithm: ${String(algorithm ?? 'none')}.`,
      };
    }

    const expectedSignature = createSignature(`${headerSegment}.${payloadSegment}`, secret, algorithm);
    const valid = timingSafeEqual(expectedSignature, signature);

    return {
      valid,
      algorithm,
      message: valid ? 'Signature is valid.' : 'Signature does not match this secret.',
    };
  }
  catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : 'JWT could not be verified.',
    };
  }
}
