export interface RuntimeInfo {
  runtime: 'web' | 'electron'
  platform: string
  version: string
}

export type PlatformOperation<T> =
  | { status: 'success'; value: T }
  | { status: 'unsupported' | 'denied' | 'failed' };

export type FileSaveResult =
  | { status: 'started' }
  | { status: 'unsupported' | 'denied' | 'failed' };

function isPermissionError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
}

function getDesktopBridge(): Window['itToolsDesktop'] | undefined {
  return typeof window === 'undefined' ? undefined : window.itToolsDesktop;
}

/** Return only runtime facts exposed through the narrow, trusted Electron preload bridge. */
export async function getRuntimeInfo(): Promise<PlatformOperation<RuntimeInfo>> {
  const bridge = getDesktopBridge();
  if (bridge) {
    try {
      const info = await bridge.getRuntimeInfo();
      return { status: 'success', value: { runtime: 'electron', ...info } };
    }
    catch {
      return { status: 'failed' };
    }
  }

  if (typeof navigator === 'undefined') {
    return { status: 'unsupported' };
  }
  return {
    status: 'success',
    value: { runtime: 'web', platform: navigator.platform || 'unknown', version: 'browser' },
  };
}

export function isElectronRuntime(): boolean {
  return getDesktopBridge() !== undefined;
}

export async function writeTextToClipboard(value: string): Promise<PlatformOperation<void>> {
  if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
    return { status: 'unsupported' };
  }
  try {
    await navigator.clipboard.writeText(value);
    return { status: 'success', value: undefined };
  }
  catch (error) {
    return { status: isPermissionError(error) ? 'denied' : 'failed' };
  }
}

export async function readSelectedFileAsArrayBuffer(file: File): Promise<PlatformOperation<ArrayBuffer>> {
  if (!file) {
    return { status: 'unsupported' };
  }
  if (typeof file.arrayBuffer === 'function') {
    try {
      return { status: 'success', value: await file.arrayBuffer() };
    }
    catch (error) {
      return { status: isPermissionError(error) ? 'denied' : 'failed' };
    }
  }
  if (typeof FileReader === 'undefined') {
    return { status: 'unsupported' };
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result instanceof ArrayBuffer
      ? { status: 'success', value: reader.result }
      : { status: 'failed' });
    reader.onerror = () => resolve({ status: isPermissionError(reader.error) ? 'denied' : 'failed' });
    reader.onabort = () => resolve({ status: 'failed' });
    try {
      reader.readAsArrayBuffer(file);
    }
    catch (error) {
      resolve({ status: isPermissionError(error) ? 'denied' : 'failed' });
    }
  });
}

export function readSelectedFileAsDataUrl(file: File): Promise<PlatformOperation<string>> {
  if (typeof FileReader === 'undefined') {
    return Promise.resolve({ status: 'unsupported' });
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string'
      ? { status: 'success', value: reader.result }
      : { status: 'failed' });
    reader.onerror = () => resolve({ status: isPermissionError(reader.error) ? 'denied' : 'failed' });
    reader.onabort = () => resolve({ status: 'failed' });
    try {
      reader.readAsDataURL(file);
    }
    catch (error) {
      resolve({ status: isPermissionError(error) ? 'denied' : 'failed' });
    }
  });
}

function safeFilename(filename: string): string {
  return filename.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').trim() || 'download';
}

function dataUrlToBlob(value: string): Blob {
  const commaIndex = value.indexOf(',');
  if (!/^data:/i.test(value) || commaIndex < 0) {
    throw new TypeError('Invalid data URL.');
  }

  const metadata = value.slice(5, commaIndex);
  const mimeType = metadata.split(';', 1)[0] || 'text/plain;charset=US-ASCII';
  const payload = value.slice(commaIndex + 1);
  if (metadata.split(';').some(parameter => parameter.toLowerCase() === 'base64')) {
    const binary = atob(payload.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  }
  return new Blob([decodeURIComponent(payload)], { type: mimeType });
}

/** Start a browser-managed download without exposing filesystem paths to renderer code. */
export function saveFileContent(content: Blob | string, filename: string, mimeType = 'application/octet-stream'): FileSaveResult {
  if (typeof document === 'undefined') {
    return { status: 'unsupported' };
  }

  let objectUrl: string | undefined;
  let link: HTMLAnchorElement | undefined;
  try {
    let href: string;
    if (typeof content === 'string' && /^blob:/i.test(content)) {
      href = content;
    }
    else {
      if (typeof URL.createObjectURL !== 'function') {
        return { status: 'unsupported' };
      }
      const blob = typeof content === 'string' && /^data:/i.test(content)
        ? dataUrlToBlob(content)
        : content instanceof Blob
          ? content
          : new Blob([content], { type: mimeType });
      objectUrl = URL.createObjectURL(blob);
      href = objectUrl;
    }

    link = document.createElement('a');
    link.href = href;
    link.download = safeFilename(filename);
    link.style.display = 'none';
    link.click();
    return { status: 'started' };
  }
  catch (error) {
    return { status: isPermissionError(error) ? 'denied' : 'failed' };
  }
  finally {
    link?.remove();
    const urlToRevoke = objectUrl;
    if (urlToRevoke && typeof URL.revokeObjectURL === 'function') {
      globalThis.setTimeout(() => URL.revokeObjectURL(urlToRevoke), 1_000);
    }
  }
}
