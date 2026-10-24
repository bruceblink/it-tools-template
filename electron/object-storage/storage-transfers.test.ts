import { mkdtemp, readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';
import {
  downloadStorageObject,
  uploadStorageObject,
  deleteStorageObject,
  type StorageTransferDependencies,
} from './storage-transfers';
import { STORAGE_TRANSFER_BYTES } from '../../src/shared/desktop-services/object-storage';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'it-tools-storage-transfer-'));
  directories.push(directory);
  const path = join(directory, 'selected.bin');
  const send = vi.fn();
  const dependencies: StorageTransferDependencies = {
    selectUpload: vi.fn(async () => path),
    selectDownload: vi.fn(async () => path),
    confirm: vi.fn(async () => true),
    progress: vi.fn(),
  };
  const controller = new AbortController();
  const context = {
    client: { send } as unknown as S3Client,
    bucket: 'sample-bucket',
    key: 'docs/object',
    requestId: 'transfer-1',
    renderer: 1,
    signal: controller.signal,
    dependencies,
  };
  return { directory, path, send, dependencies, controller, context };
}

describe('S3 file transfers', () => {
  it('streams the selected file with conditional creation and reports bounded progress', async () => {
    const { path, send, dependencies, context } = await setup();
    const expected = Buffer.from([0, 1, 255, 10, 42]);
    await writeFile(path, expected);
    send.mockImplementation(async (command) => {
      expect(command.input.IfNoneMatch).toBe('*');
      expect(command.input.ContentLength).toBe(expected.length);
      const chunks = [];
      for await (const chunk of command.input.Body) {
        chunks.push(chunk);
      }
      expect(Buffer.concat(chunks)).toEqual(expected);
      return {};
    });
    expect(await uploadStorageObject(context, false)).toEqual({ key: context.key, bytes: expected.length });
    expect(dependencies.confirm).not.toHaveBeenCalled();
    expect(dependencies.progress).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ transferredBytes: expected.length, totalBytes: expected.length }),
    );
  });

  it('does not replace or delete when the native confirmation is rejected', async () => {
    const { context, dependencies, send } = await setup();
    vi.mocked(dependencies.confirm).mockResolvedValue(false);
    expect(await uploadStorageObject(context, true)).toBeNull();
    expect(await deleteStorageObject(context)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('atomically replaces an existing download target only after the full object arrives', async () => {
    const { directory, path, send, context } = await setup();
    await writeFile(path, 'original file');
    send.mockResolvedValue({ Body: Readable.from([Buffer.from('new '), Buffer.from('content')]), ContentLength: 11 });
    expect(await downloadStorageObject(context)).toEqual({ key: context.key, bytes: 11 });
    expect(await readFile(path, 'utf8')).toBe('new content');
    expect(await readdir(directory)).toEqual(['selected.bin']);
  });

  it('preserves the original target and removes partial data after a cancelled download', async () => {
    const { directory, path, send, context, controller, dependencies } = await setup();
    await writeFile(path, 'original file');
    const source = new Readable({
      read() {
        this.push(Buffer.alloc(1024));
      },
    });
    send.mockResolvedValue({ Body: source });
    vi.mocked(dependencies.progress).mockImplementation((_renderer, progress) => {
      if (progress.transferredBytes > 0) {
        controller.abort();
      }
    });
    await expect(downloadStorageObject(context)).rejects.toMatchObject({ name: 'AbortError' });
    expect(source.destroyed).toBe(true);
    expect(await readFile(path, 'utf8')).toBe('original file');
    expect(await readdir(directory)).toEqual(['selected.bin']);
  });

  it('rejects an oversized or incomplete object without replacing a local file', async () => {
    const { directory, path, send, context } = await setup();
    await writeFile(path, 'original file');
    send.mockResolvedValue({ Body: Readable.from([Buffer.from('x')]), ContentLength: 1024 * 1024 * 1024 + 1 });
    await expect(downloadStorageObject(context)).rejects.toMatchObject({ code: 'file-too-large' });
    send.mockResolvedValue({ Body: Readable.from([Buffer.from('x')]), ContentLength: 100 });
    await expect(downloadStorageObject(context)).rejects.toMatchObject({ code: 'network-error' });
    expect(await readFile(path, 'utf8')).toBe('original file');
    expect(await readdir(directory)).toEqual(['selected.bin']);
  });

  it('rejects oversized uploads before sending and maps local read failures to a fixed error', async () => {
    const { path, send, context } = await setup();
    await writeFile(path, '');
    await truncate(path, STORAGE_TRANSFER_BYTES + 1);
    await expect(uploadStorageObject(context, false)).rejects.toMatchObject({ code: 'file-too-large' });
    expect(send).not.toHaveBeenCalled();

    await writeFile(path, 'selected content');
    send.mockRejectedValue({ cause: { code: 'EIO' } });
    await expect(uploadStorageObject(context, false)).rejects.toMatchObject({ code: 'local-file-error' });
  });

  it('does not open or write any object when the native file dialog is cancelled', async () => {
    const { send, context, dependencies } = await setup();
    vi.mocked(dependencies.selectUpload).mockResolvedValue(null);
    vi.mocked(dependencies.selectDownload).mockResolvedValue(null);
    expect(await uploadStorageObject(context, false)).toBeNull();
    expect(await downloadStorageObject(context)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
