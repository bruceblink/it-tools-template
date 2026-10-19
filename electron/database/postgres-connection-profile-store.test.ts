import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PostgresConnectionProfileStore } from './postgres-connection-profile-store';

const validProfile = {
  name: 'Local PostgreSQL',
  host: '127.0.0.1',
  port: 5432,
  database: 'postgres',
  username: 'postgres',
  tlsMode: 'verify',
} as const;

describe('PostgreSQL connection profile store', () => {
  let testDirectory: string;
  let store: PostgresConnectionProfileStore;
  let profilePath: string;

  beforeEach(async () => {
    testDirectory = await mkdtemp(join(tmpdir(), 'it-tools-postgres-profiles-'));
    profilePath = join(testDirectory, 'database-manager', 'postgres-profiles.json');
    store = new PostgresConnectionProfileStore(profilePath);
  });

  afterEach(async () => {
    await rm(testDirectory, { recursive: true, force: true });
  });

  it('stores bounded connection metadata and never persists a password', async () => {
    const saved = await store.save(validProfile);
    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }

    expect(saved.value).toMatchObject(validProfile);
    expect(saved.value.id).toMatch(/^[0-9a-f-]{36}$/i);
    const fileText = await readFile(profilePath, 'utf8');
    expect(fileText).not.toContain('password');
    expect(JSON.parse(fileText)).toEqual({ version: 1, profiles: [saved.value] });
    expect(await readdir(join(testDirectory, 'database-manager'))).toEqual(['postgres-profiles.json']);
  });

  it('updates a selected profile without creating a duplicate', async () => {
    const first = await store.save(validProfile);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    const updated = await store.save({ ...validProfile, id: first.value.id, name: 'Renamed local' });
    expect(updated).toEqual({
      ok: true,
      value: { ...first.value, name: 'Renamed local' },
    });
    expect(await store.list()).toEqual({ ok: true, value: [{ ...first.value, name: 'Renamed local' }] });
  });

  it('rejects password fields, unknown properties, invalid TLS modes, and oversized values', async () => {
    expect(await store.save({ ...validProfile, password: 'must not persist' })).toEqual({ ok: false, error: 'invalid-request' });
    expect(await store.save({ ...validProfile, unexpected: true })).toEqual({ ok: false, error: 'invalid-request' });
    expect(await store.save({ ...validProfile, tlsMode: 'allow' })).toEqual({ ok: false, error: 'invalid-request' });
    expect(await store.save({ ...validProfile, name: 'x'.repeat(81) })).toEqual({ ok: false, error: 'invalid-request' });
    expect(await store.save({ ...validProfile, host: `db.${'x'.repeat(252)}` })).toEqual({ ok: false, error: 'invalid-request' });
  });

  it('serializes concurrent saves and enforces the profile count limit', async () => {
    const simultaneous = await Promise.all([
      store.save({ ...validProfile, name: 'first' }),
      store.save({ ...validProfile, name: 'second' }),
      store.save({ ...validProfile, name: 'third' }),
    ]);
    expect(simultaneous.every(result => result.ok)).toBe(true);

    for (let index = 3; index < 20; index += 1) {
      const result = await store.save({ ...validProfile, name: `profile ${index}` });
      expect(result.ok).toBe(true);
    }
    expect(await store.save({ ...validProfile, name: 'limit exceeded' })).toEqual({ ok: false, error: 'profile-limit-reached' });
    const listed = await store.list();
    expect(listed.ok && listed.value).toHaveLength(20);
  });

  it('deletes an existing profile and treats a missing profile as a normal result', async () => {
    const saved = await store.save(validProfile);
    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }

    expect(await store.delete(saved.value.id)).toEqual({ ok: true, value: true });
    expect(await store.delete(saved.value.id)).toEqual({ ok: true, value: false });
    expect(await store.list()).toEqual({ ok: true, value: [] });
    expect(await store.delete('not-a-profile-id')).toEqual({ ok: false, error: 'invalid-request' });
  });

  it('does not overwrite a malformed profile file', async () => {
    await mkdir(join(testDirectory, 'database-manager'), { recursive: true });
    await writeFile(profilePath, '{broken json', 'utf8');

    expect(await store.list()).toEqual({ ok: false, error: 'profile-storage-failed' });
    expect(await store.save(validProfile)).toEqual({ ok: false, error: 'profile-storage-failed' });
    expect(await readFile(profilePath, 'utf8')).toBe('{broken json');
  });
});
