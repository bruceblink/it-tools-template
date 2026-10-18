export interface StoredZipEntry {
  path: string;
  contents: Buffer | string;
}

export function createStoredZip(entries: readonly StoredZipEntry[]): Buffer;
export function crc32(bytes: Buffer): number;
