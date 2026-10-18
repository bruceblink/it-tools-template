// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRuntimeInfo,
  isElectronRuntime,
  readSelectedFileAsArrayBuffer,
  readSelectedFileAsDataUrl,
  saveFileContent,
  writeTextToClipboard,
} from './index';

const originalBridge = Object.getOwnPropertyDescriptor(window, 'itToolsDesktop');
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

function restoreProperty(target: object, key: PropertyKey, descriptor?: PropertyDescriptor): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
  }
  else {
    Reflect.deleteProperty(target, key);
  }
}

describe('platform adapter', () => {
  beforeEach(() => {
    delete window.itToolsDesktop;
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  afterEach(() => {
    restoreProperty(window, 'itToolsDesktop', originalBridge);
    restoreProperty(navigator, 'clipboard', originalClipboard);
    restoreProperty(URL, 'createObjectURL', originalCreateObjectUrl);
    restoreProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reports web runtime facts and detects a failed desktop bridge call', async () => {
    await expect(getRuntimeInfo()).resolves.toMatchObject({
      status: 'success',
      value: { runtime: 'web', version: 'browser' },
    });
    expect(isElectronRuntime()).toBe(false);

    window.itToolsDesktop = { getRuntimeInfo: async () => ({ platform: 'win32', version: 'test-version' }) };
    await expect(getRuntimeInfo()).resolves.toEqual({
      status: 'success',
      value: { runtime: 'electron', platform: 'win32', version: 'test-version' },
    });
    expect(isElectronRuntime()).toBe(true);

    window.itToolsDesktop = { getRuntimeInfo: async () => { throw new Error('bridge failed'); } };
    await expect(getRuntimeInfo()).resolves.toEqual({ status: 'failed' });
    expect(isElectronRuntime()).toBe(true);
  });

  it('returns clipboard success, unsupported, denied, and failure states', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await expect(writeTextToClipboard('sample')).resolves.toEqual({ status: 'success', value: undefined });
    expect(writeText).toHaveBeenCalledWith('sample');

    Reflect.deleteProperty(navigator, 'clipboard');
    await expect(writeTextToClipboard('sample')).resolves.toEqual({ status: 'unsupported' });

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) },
    });
    await expect(writeTextToClipboard('sample')).resolves.toEqual({ status: 'denied' });

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard failed')) },
    });
    await expect(writeTextToClipboard('sample')).resolves.toEqual({ status: 'failed' });
  });

  it('reads only the user-selected File and exposes bytes or a data URL', async () => {
    const file = new File(['local content'], 'selected.txt', { type: 'text/plain' });
    const bytes = await readSelectedFileAsArrayBuffer(file);
    expect(bytes.status).toBe('success');
    if (bytes.status === 'success') {
      expect(new TextDecoder().decode(bytes.value)).toBe('local content');
    }

    await expect(readSelectedFileAsDataUrl(file)).resolves.toEqual({
      status: 'success',
      value: 'data:text/plain;base64,bG9jYWwgY29udGVudA==',
    });
  });

  it('starts a sanitized browser-managed download and releases its temporary object URL', () => {
    const createObjectURL = vi.fn(() => 'blob:it-tools/test-download');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    let clickedLink: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clickedLink = this; });
    vi.useFakeTimers();

    expect(saveFileContent(new Blob(['sample']), 'folder\\output.txt', 'text/plain')).toEqual({ status: 'started' });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickedLink?.download).toBe('folder_output.txt');
    expect(clickedLink?.isConnected).toBe(false);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:it-tools/test-download');
  });

  it('converts data URLs to Blob URLs before starting a download', () => {
    let savedBlob: Blob | undefined;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        savedBlob = blob;
        return 'blob:it-tools/data-url';
      }),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.href).toBe('blob:it-tools/data-url');
    });

    const payload = 'local file bytes';
    const dataUrl = `data:text/plain;base64,${Buffer.from(payload).toString('base64')}`;
    expect(saveFileContent(dataUrl, 'selected.txt')).toEqual({ status: 'started' });
    expect(savedBlob?.type).toBe('text/plain');
    expect(savedBlob?.size).toBe(new TextEncoder().encode(payload).byteLength);
  });
});
