import { describe, expect, it } from 'vitest';
import { parseStorageCancel, parseStorageConnect, parseStorageList, parseStoragePreview } from './storage-protocol';

const input = {
  requestId: 'request-1',
  endpoint: 'https://s3.example.test',
  region: 'us-east-1',
  bucket: 'sample-bucket',
  accessKeyId: 'test-access',
  secretAccessKey: 'test-secret',
};

describe('object storage protocol', () => {
  it('accepts explicit HTTPS origins and loopback HTTP endpoints', () => {
    for (const endpoint of [
      'https://s3.example.test',
      'http://127.0.0.1:9000',
      'http://localhost:9000',
      'http://[::1]:9000',
    ]) {
      expect(parseStorageConnect({ ...input, endpoint })?.endpoint).toBe(endpoint);
    }
  });

  it('rejects remote plaintext, embedded credentials, paths, query strings and extra fields', () => {
    for (const endpoint of [
      'http://s3.example.test',
      'file:///tmp',
      'https://user:secret@s3.example.test',
      'https://s3.example.test/path',
      'https://s3.example.test/?token=secret',
      'https://s3.example.test/#fragment',
    ]) {
      expect(parseStorageConnect({ ...input, endpoint })).toBeNull();
    }
    expect(parseStorageConnect({ ...input, savePassword: true })).toBeNull();
  });

  it('bounds credentials, bucket names, request identifiers and region', () => {
    for (const patch of [
      { secretAccessKey: '' },
      { secretAccessKey: 'x'.repeat(4097) },
      { accessKeyId: 'line\nbreak' },
      { sessionToken: 'x'.repeat(16385) },
      { region: '../region' },
      { bucket: '127.0.0.1' },
      { bucket: 'invalid..bucket' },
      { requestId: 'x'.repeat(65) },
    ]) {
      expect(parseStorageConnect({ ...input, ...patch })).toBeNull();
    }
  });

  it('validates object keys in bytes and opaque continuation tokens', () => {
    const request = { sessionId: 'session-1', requestId: 'request-1' };
    expect(parseStorageList({ ...request, prefix: '', continuationToken: null })).not.toBeNull();
    expect(parseStorageList({ ...request, prefix: '', continuationToken: 'opaque+/=' })).not.toBeNull();
    expect(parseStorageList({ ...request, prefix: '中'.repeat(342), continuationToken: null })).toBeNull();
    expect(parseStorageList({ ...request, prefix: '', continuationToken: 'x'.repeat(8193) })).toBeNull();
    expect(parseStoragePreview({ ...request, key: '../literal-object-key' })?.key).toBe('../literal-object-key');
    expect(parseStoragePreview({ ...request, key: 'nul\0key' })).toBeNull();
    expect(parseStorageCancel({ requestId: request.requestId })).toBe(request.requestId);
    expect(parseStorageCancel({ requestId: request.requestId, endpoint: 'unexpected' })).toBeNull();
  });
});
