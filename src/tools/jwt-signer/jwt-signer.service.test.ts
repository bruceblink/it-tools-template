import { describe, expect, it } from 'vitest';
import { parseJwtJson, signJwt, signJwtText, verifyJwtSignature } from './jwt-signer.service';

describe('jwt-signer service', () => {
  it('signs the canonical HS256 JWT example', () => {
    expect(signJwt({
      header: { alg: 'HS256', typ: 'JWT' },
      payload: { sub: '1234567890', name: 'John Doe', iat: 1516239022 },
      secret: 'your-256-bit-secret',
      algorithm: 'HS256',
    })).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  });

  it('overrides the header algorithm with the selected signing algorithm', () => {
    const token = signJwt({
      header: { alg: 'HS256', typ: 'JWT' },
      payload: { scope: 'read' },
      secret: 'secret',
      algorithm: 'HS512',
    });

    const headerSegment = token.split('.')[0];
    expect(headerSegment).toBeDefined();
    expect(JSON.parse(Buffer.from(headerSegment ?? '', 'base64url').toString('utf8'))).toEqual({
      alg: 'HS512',
      typ: 'JWT',
    });
  });

  it('accepts JSON5 object input when signing text', () => {
    const token = signJwtText({
      headerJson: '{ alg: "HS256", typ: "JWT" }',
      payloadJson: '{ sub: "user-1", roles: ["admin", "editor"] }',
      secret: 'secret',
      algorithm: 'HS256',
    });

    expect(token.split('.')).toHaveLength(3);
  });

  it('rejects non-object JWT parts', () => {
    expect(() => parseJwtJson('[]', 'Payload')).toThrow('Payload must be a JSON object');
  });

  it('verifies a valid HMAC JWT signature', () => {
    const token = signJwt({
      header: { alg: 'HS384', typ: 'JWT' },
      payload: { scope: 'read' },
      secret: 'secret',
      algorithm: 'HS384',
    });

    expect(verifyJwtSignature({ token, secret: 'secret' })).toEqual({
      valid: true,
      algorithm: 'HS384',
      header: {
        alg: 'HS384',
        typ: 'JWT',
      },
      payload: {
        scope: 'read',
      },
      message: 'Signature is valid.',
    });
  });

  it('detects JWT signatures that do not match the secret', () => {
    const token = signJwt({
      header: { alg: 'HS256', typ: 'JWT' },
      payload: { scope: 'read' },
      secret: 'secret',
      algorithm: 'HS256',
    });

    expect(verifyJwtSignature({ token, secret: 'wrong-secret' })).toEqual({
      valid: false,
      algorithm: 'HS256',
      header: {
        alg: 'HS256',
        typ: 'JWT',
      },
      payload: {
        scope: 'read',
      },
      message: 'Signature does not match this secret.',
    });
  });

  it('rejects unsupported signing algorithms when verifying', () => {
    const token = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'user-1' })).toString('base64url'),
      'signature',
    ].join('.');

    expect(verifyJwtSignature({ token, secret: 'secret' })).toEqual({
      valid: false,
      header: {
        alg: 'none',
        typ: 'JWT',
      },
      payload: {
        sub: 'user-1',
      },
      message: 'Unsupported or missing HMAC algorithm: none.',
    });
  });

  it('rejects malformed tokens when verifying signatures', () => {
    expect(verifyJwtSignature({ token: 'not-a-jwt', secret: 'secret' })).toEqual({
      valid: false,
      message: 'JWT must contain header, payload, and signature segments.',
    });
  });
});
