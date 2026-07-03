import { describe, expect, it } from 'vitest';
import { parseBearerToken } from './bearer-token-parser.service';

const JWT_IO_SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const EXPIRED_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiZXhwIjoxLCJpYXQiOjB9.signature';
const NONE_ALG_JWT = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxIiwiZXhwIjo0MTAyNDQ0ODAwfQ.';
const FUTURE_EXP_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiZXhwIjoxNzI4MDg2NDAwLCJuYmYiOjE3MjgwMDAwMDB9.signature';
const FUTURE_NBF_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiZXhwIjoxNzI4MDg2NDAwLCJuYmYiOjE3MjgwNDMyMDB9.signature';

describe('bearer-token-parser service', () => {
  it('parses a complete Bearer Authorization header containing a JWT', () => {
    const parsed = parseBearerToken(`Authorization: Bearer ${JWT_IO_SAMPLE}`);

    expect(parsed).toMatchObject({
      scheme: 'Bearer',
      token: JWT_IO_SAMPLE,
      kind: 'jwt',
      header: `Authorization: Bearer ${JWT_IO_SAMPLE}`,
      expired: undefined,
      active: undefined,
    });
    expect(parsed.jwtHeader).toEqual(expect.arrayContaining([
      expect.objectContaining({ claim: 'alg', value: 'HS256' }),
      expect.objectContaining({ claim: 'typ', value: 'JWT' }),
    ]));
    expect(parsed.jwtPayload).toEqual(expect.arrayContaining([
      expect.objectContaining({ claim: 'sub', value: '1234567890' }),
      expect.objectContaining({ claim: 'name', value: 'John Doe' }),
      expect.objectContaining({ claim: 'iat', friendlyValue: expect.any(String) }),
    ]));
    expect(parsed.warnings).toEqual(['JWT has no exp claim.']);
  });

  it('parses a Bearer scheme value', () => {
    expect(parseBearerToken(`Bearer ${JWT_IO_SAMPLE}`)).toMatchObject({
      token: JWT_IO_SAMPLE,
      kind: 'jwt',
    });
  });

  it('parses opaque bearer tokens without JWT details', () => {
    expect(parseBearerToken('opaque-token-value-1234567890')).toMatchObject({
      kind: 'opaque',
      tokenLength: 29,
      tokenPreview: 'opaque-token...34567890',
      jwtHeader: [],
      jwtPayload: [],
      warnings: ['Token is not a JWT; only opaque token metadata is available.'],
    });
  });

  it('reports expired JWTs', () => {
    expect(parseBearerToken(EXPIRED_JWT, { now: new Date('1970-01-01T00:00:02.000Z') })).toMatchObject({
      kind: 'jwt',
      expiresAt: '1970-01-01T00:00:01.000Z',
      issuedAt: '1970-01-01T00:00:00.000Z',
      expired: true,
      active: false,
      timeToExpiry: '1 second',
      warnings: ['JWT is expired.'],
    });
  });

  it('reports active JWT lifecycle details', () => {
    expect(parseBearerToken(FUTURE_EXP_JWT, { now: new Date('2024-10-04T00:00:00.000Z') })).toMatchObject({
      kind: 'jwt',
      expiresAt: '2024-10-05T00:00:00.000Z',
      notBefore: '2024-10-04T00:00:00.000Z',
      expired: false,
      active: true,
      timeToExpiry: '1 day',
      timeUntilActive: undefined,
      warnings: [],
    });
  });

  it('warns when a JWT is not active yet', () => {
    expect(parseBearerToken(FUTURE_NBF_JWT, { now: new Date('2024-10-04T00:00:00.000Z') })).toMatchObject({
      kind: 'jwt',
      expired: false,
      active: false,
      timeToExpiry: '1 day',
      timeUntilActive: '12 hours',
      warnings: ['JWT is not active yet.'],
    });
  });

  it('warns when algorithm is none', () => {
    expect(parseBearerToken(NONE_ALG_JWT).warnings).toContain('JWT algorithm is missing or set to none.');
  });

  it('rejects invalid JWT-shaped input', () => {
    expect(() => parseBearerToken('not.a.jwt')).toThrow();
  });

  it('rejects empty input', () => {
    expect(() => parseBearerToken('')).toThrow('Bearer token value is empty.');
  });
});
