import { describe, expect, it } from 'vitest';
import { parseBasicAuth } from './basic-auth-parser.service';

describe('basic-auth-parser service', () => {
  it('parses a complete Authorization header', () => {
    expect(parseBasicAuth('Authorization: Basic YWxpY2U6czNjcmV0')).toMatchObject({
      scheme: 'Basic',
      token: 'YWxpY2U6czNjcmV0',
      normalizedToken: 'YWxpY2U6czNjcmV0',
      username: 'alice',
      password: 's3cret',
      passwordLength: 6,
      credential: 'alice:s3cret',
      header: 'Authorization: Basic YWxpY2U6czNjcmV0',
      warnings: [],
    });
    expect(parseBasicAuth('Authorization: Basic YWxpY2U6czNjcmV0').securityNotes).toEqual([
      'Basic authentication sends reusable credentials with every request; use HTTPS and prefer short-lived tokens when possible.',
      'Password is shorter than 8 characters.',
    ]);
  });

  it('parses a Basic scheme value', () => {
    expect(parseBasicAuth('Basic Ym9iOnBhc3M=')).toMatchObject({
      username: 'bob',
      password: 'pass',
    });
  });

  it('parses a raw base64 token', () => {
    expect(parseBasicAuth('YXBpOnRva2Vu')).toMatchObject({
      username: 'api',
      password: 'token',
    });
  });

  it('keeps colons inside the password', () => {
    expect(parseBasicAuth('Basic dXNlcjpwYTpzczp3b3Jk')).toMatchObject({
      username: 'user',
      password: 'pa:ss:word',
      credential: 'user:pa:ss:word',
    });
  });

  it('reports empty username and password warnings', () => {
    expect(parseBasicAuth('Og==').warnings).toEqual(['Username is empty.', 'Password is empty.']);
    expect(parseBasicAuth('OnBhc3M=').warnings).toEqual(['Username is empty.']);
    expect(parseBasicAuth('dXNlcjo=').warnings).toEqual(['Password is empty.']);
  });

  it('reports weak password security notes', () => {
    const parsed = parseBasicAuth('Basic YWRtaW46cGFzc3dvcmQ=');

    expect(parsed).toMatchObject({
      username: 'admin',
      password: 'password',
      passwordLength: 8,
      normalizedToken: 'YWRtaW46cGFzc3dvcmQ=',
    });
    expect(parsed.securityNotes).toEqual([
      'Basic authentication sends reusable credentials with every request; use HTTPS and prefer short-lived tokens when possible.',
      'Password matches a common weak password.',
    ]);
  });

  it('rejects invalid base64 input', () => {
    expect(() => parseBasicAuth('Basic not-base64')).toThrow('Incorrect base64 string');
  });

  it('rejects credentials without a separator', () => {
    expect(() => parseBasicAuth('bm9zZXBhcmF0b3I=')).toThrow('Decoded credentials must contain');
  });

  it('rejects empty input', () => {
    expect(() => parseBasicAuth('')).toThrow('Basic auth value is empty.');
  });
});
