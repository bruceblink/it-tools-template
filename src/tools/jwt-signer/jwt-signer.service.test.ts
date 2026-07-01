import { describe, expect, it } from 'vitest';
import { parseJwtJson, signJwt, signJwtText } from './jwt-signer.service';

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
});
