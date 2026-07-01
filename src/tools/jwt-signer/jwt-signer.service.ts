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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
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
  const signature = base64UrlEncodeWords(hmacSigners[algorithm](signingInput, secret));

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
