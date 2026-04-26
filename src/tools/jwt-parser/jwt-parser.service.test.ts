import { describe, expect, it } from 'vitest';
import { decodeJwt } from './jwt-parser.service';

// Well-known JWT from jwt.io: header={"alg":"HS256","typ":"JWT"}, payload={"sub":"1234567890","name":"John Doe","iat":1516239022}
const SAMPLE_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

// JWT with exp, nbf claims: {"alg":"RS256","typ":"JWT"} / {"iss":"test","sub":"user","iat":1700000000,"exp":1700086400,"nbf":1700000000}
const JWT_WITH_DATES = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ0ZXN0Iiwic3ViIjoidXNlciIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDg2NDAwLCJuYmYiOjE3MDAwMDAwMDB9.signature';

describe('jwt-parser service', () => {
  describe('decodeJwt', () => {
    it('decodes header claims from a JWT', () => {
      const { header } = decodeJwt({ jwt: SAMPLE_JWT });

      const algClaim = header.find(c => c.claim === 'alg');
      const typClaim = header.find(c => c.claim === 'typ');

      expect(algClaim?.value).toBe('HS256');
      expect(algClaim?.claimDescription).toBe('Algorithm');
      expect(algClaim?.friendlyValue).toBe('HMAC using SHA-256');

      expect(typClaim?.value).toBe('JWT');
      expect(typClaim?.claimDescription).toBe('Type');
    });

    it('decodes payload claims from a JWT', () => {
      const { payload } = decodeJwt({ jwt: SAMPLE_JWT });

      const subClaim = payload.find(c => c.claim === 'sub');
      const nameClaim = payload.find(c => c.claim === 'name');
      const iatClaim = payload.find(c => c.claim === 'iat');

      expect(subClaim?.value).toBe('1234567890');
      expect(subClaim?.claimDescription).toBe('Subject');

      expect(nameClaim?.value).toBe('John Doe');
      expect(nameClaim?.claimDescription).toBe('Full name');

      expect(iatClaim?.value).toBe('1516239022');
      expect(iatClaim?.claimDescription).toBe('Issued At');
      expect(iatClaim?.friendlyValue).toBeTruthy();
    });

    it('provides friendly date values for exp, nbf, iat claims', () => {
      const { payload } = decodeJwt({ jwt: JWT_WITH_DATES });

      const iatClaim = payload.find(c => c.claim === 'iat');
      const expClaim = payload.find(c => c.claim === 'exp');
      const nbfClaim = payload.find(c => c.claim === 'nbf');

      expect(iatClaim?.friendlyValue).toBeTruthy();
      expect(expClaim?.friendlyValue).toBeTruthy();
      expect(nbfClaim?.friendlyValue).toBeTruthy();
    });

    it('provides algorithm friendly description in header', () => {
      const { header } = decodeJwt({ jwt: JWT_WITH_DATES });

      const algClaim = header.find(c => c.claim === 'alg');
      expect(algClaim?.friendlyValue).toBe('RSASSA-PKCS1-v1_5 using SHA-256');
    });

    it('throws for an invalid JWT string', () => {
      expect(() => decodeJwt({ jwt: 'not.a.jwt' })).toThrow();
      expect(() => decodeJwt({ jwt: '' })).toThrow();
    });
  });
});
