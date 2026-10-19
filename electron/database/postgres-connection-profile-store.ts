import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  DatabaseBridgeResult,
  PostgresConnectionProfile,
  PostgresConnectionProfileInput,
} from '../../src/shared/desktop-services/database';

const PROFILE_FILE_VERSION = 1;
const MAX_PROFILE_COUNT = 20;
const MAX_PROFILE_FILE_BYTES = 64 * 1024;
const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StoredProfiles {
  version: typeof PROFILE_FILE_VERSION;
  profiles: PostgresConnectionProfile[];
}

/** Store only non-secret PostgreSQL connection metadata in Electron's application data directory. */
export class PostgresConnectionProfileStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  list(): Promise<DatabaseBridgeResult<PostgresConnectionProfile[]>> {
    return this.runExclusive(async () => {
      const stored = await this.readProfiles();
      return stored.ok
        ? { ok: true, value: stored.value.profiles.map(profile => ({ ...profile })) }
        : stored;
    });
  }

  save(value: unknown): Promise<DatabaseBridgeResult<PostgresConnectionProfile>> {
    if (!isValidPostgresConnectionProfileInput(value)) {
      return Promise.resolve({ ok: false, error: 'invalid-request' });
    }

    return this.runExclusive(async () => {
      const stored = await this.readProfiles();
      if (!stored.ok) {
        return stored;
      }

      const current = stored.value.profiles;
      const profileId = value.id ?? randomUUID();
      const profile: PostgresConnectionProfile = {
        id: profileId,
        name: value.name.trim(),
        host: value.host,
        port: value.port,
        database: value.database,
        username: value.username,
        tlsMode: value.tlsMode,
      };
      const existingIndex = current.findIndex(item => item.id === profileId);
      if (existingIndex < 0 && current.length >= MAX_PROFILE_COUNT) {
        return { ok: false, error: 'profile-limit-reached' };
      }

      const profiles = current.slice();
      if (existingIndex < 0) {
        profiles.push(profile);
      }
      else {
        profiles[existingIndex] = profile;
      }

      if (!await this.writeProfiles(profiles)) {
        return { ok: false, error: 'profile-storage-failed' };
      }
      return { ok: true, value: { ...profile } };
    });
  }

  delete(id: unknown): Promise<DatabaseBridgeResult<boolean>> {
    if (typeof id !== 'string' || !PROFILE_ID_PATTERN.test(id)) {
      return Promise.resolve({ ok: false, error: 'invalid-request' });
    }

    return this.runExclusive(async () => {
      const stored = await this.readProfiles();
      if (!stored.ok) {
        return stored;
      }

      const profiles = stored.value.profiles.filter(profile => profile.id !== id);
      if (profiles.length === stored.value.profiles.length) {
        return { ok: true, value: false };
      }
      if (!await this.writeProfiles(profiles)) {
        return { ok: false, error: 'profile-storage-failed' };
      }
      return { ok: true, value: true };
    });
  }

  /** Serialize file operations so concurrent renderer requests cannot overwrite each other. */
  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readProfiles(): Promise<DatabaseBridgeResult<StoredProfiles>> {
    let fileInfo;
    try {
      fileInfo = await lstat(this.filePath);
    }
    catch (error) {
      if (isFileMissingError(error)) {
        return { ok: true, value: { version: PROFILE_FILE_VERSION, profiles: [] } };
      }
      return { ok: false, error: 'profile-storage-failed' };
    }

    if (!fileInfo.isFile() || fileInfo.size > MAX_PROFILE_FILE_BYTES) {
      return { ok: false, error: 'profile-storage-failed' };
    }
    try {
      const text = await readFile(this.filePath, 'utf8');
      const value: unknown = JSON.parse(text);
      return isStoredProfiles(value)
        ? { ok: true, value }
        : { ok: false, error: 'profile-storage-failed' };
    }
    catch {
      return { ok: false, error: 'profile-storage-failed' };
    }
  }

  /** Replace the profile file atomically; temporary files contain no credentials. */
  private async writeProfiles(profiles: PostgresConnectionProfile[]): Promise<boolean> {
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      const contents = JSON.stringify({ version: PROFILE_FILE_VERSION, profiles }, null, 2);
      if (Buffer.byteLength(contents, 'utf8') > MAX_PROFILE_FILE_BYTES) {
        return false;
      }
      await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(temporaryPath, this.filePath);
      return true;
    }
    catch {
      return false;
    }
    finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

/** Accept only the explicit, bounded profile fields; password fields are rejected. */
export function isValidPostgresConnectionProfileInput(value: unknown): value is PostgresConnectionProfileInput {
  if (!isRecord(value)) {
    return false;
  }
  const allowedKeys = value.id === undefined
    ? ['name', 'host', 'port', 'database', 'username', 'tlsMode']
    : ['id', 'name', 'host', 'port', 'database', 'username', 'tlsMode'];
  if (!hasExactKeys(value, allowedKeys)) {
    return false;
  }
  return (value.id === undefined || (typeof value.id === 'string' && PROFILE_ID_PATTERN.test(value.id)))
    && typeof value.name === 'string'
    && value.name.trim().length > 0
    && value.name.trim() === value.name
    && value.name.length <= 80
    && !hasControlCharacters(value.name)
    && typeof value.host === 'string'
    && value.host.length > 0
    && value.host.trim() === value.host
    && value.host.length <= 253
    && !/[\u0000-\u0020]/.test(value.host)
    && typeof value.port === 'number'
    && Number.isInteger(value.port)
    && value.port >= 1
    && value.port <= 65_535
    && typeof value.database === 'string'
    && value.database.length > 0
    && value.database.length <= 63
    && !value.database.includes('\u0000')
    && typeof value.username === 'string'
    && value.username.length > 0
    && value.username.length <= 128
    && !value.username.includes('\u0000')
    && (value.tlsMode === 'verify' || value.tlsMode === 'disable');
}

function isStoredProfiles(value: unknown): value is StoredProfiles {
  return isRecord(value)
    && hasExactKeys(value, ['version', 'profiles'])
    && value.version === PROFILE_FILE_VERSION
    && Array.isArray(value.profiles)
    && value.profiles.length <= MAX_PROFILE_COUNT
    && value.profiles.every(isStoredProfile)
    && new Set(value.profiles.map(profile => profile.id)).size === value.profiles.length;
}

function isStoredProfile(value: unknown): value is PostgresConnectionProfile {
  if (!isRecord(value)
    || !hasExactKeys(value, ['id', 'name', 'host', 'port', 'database', 'username', 'tlsMode'])) {
    return false;
  }
  const { id, name, host, port, database, username, tlsMode } = value;
  return typeof id === 'string'
    && PROFILE_ID_PATTERN.test(id)
    && isValidPostgresConnectionProfileInput({ id, name, host, port, database, username, tlsMode });
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function isFileMissingError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}
