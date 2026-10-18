import { extension as getExtensionFromMimeType, types as mimeTypes } from 'mime-types';
import { useMessage } from 'naive-ui';
import type { Ref } from 'vue';
import _ from 'lodash';
import { saveFileContent, type FileSaveResult } from '@/platform-adapter';

export {
  getMimeTypeFromBase64,
  getMimeTypeFromExtension, getExtensionFromMimeType,
  useDownloadFileFromBase64, useDownloadFileFromBase64Refs,
  previewImageFromBase64,
};

const commonMimeTypesSignatures = {
  'JVBERi0': 'application/pdf',
  'R0lGODdh': 'image/gif',
  'R0lGODlh': 'image/gif',
  'iVBORw0KGgo': 'image/png',
  '/9j/': 'image/jpg',
};

function getMimeTypeFromBase64({ base64String }: { base64String: string }) {
  const [,mimeTypeFromBase64] = base64String.match(/data:(.*?);base64/i) ?? [];

  if (mimeTypeFromBase64) {
    return { mimeType: mimeTypeFromBase64 };
  }

  const inferredMimeType = _.find(commonMimeTypesSignatures, (_mimeType, signature) => base64String.startsWith(signature));

  if (inferredMimeType) {
    return { mimeType: inferredMimeType };
  }

  return { mimeType: undefined };
}

function getFileExtensionFromMimeType({
  mimeType,
  defaultExtension = 'txt',
}: {
  mimeType: string | undefined
  defaultExtension?: string
}) {
  if (mimeType) {
    const inferredExtension = getExtensionFromMimeType(mimeType);
    return typeof inferredExtension === 'string' ? inferredExtension : defaultExtension;
  }

  return defaultExtension;
}

/** Resolve MIME types from extensions without calling the Node path module in browsers. */
function getMimeTypeFromExtension(filenameOrExtension: string): string | false {
  const value = filenameOrExtension.trim().split(/[?#]/, 1)[0] ?? '';
  const filename = value.split(/[\\/]/).pop() ?? '';
  const dotIndex = filename.lastIndexOf('.');
  const extension = (dotIndex >= 0 ? filename.slice(dotIndex + 1) : filename.replace(/^\./, '')).toLowerCase();
  return extension ? mimeTypes[extension] ?? false : false;
}

function downloadFromBase64({ sourceValue, filename, extension, fileMimeType }:
{ sourceValue: string; filename?: string; extension?: string; fileMimeType?: string }) {
  if (sourceValue === '') {
    throw new Error('Base64 string is empty');
  }

  const defaultExtension = extension ?? 'txt';
  const { mimeType } = getMimeTypeFromBase64({ base64String: sourceValue });
  let base64String = sourceValue;
  if (!mimeType) {
    const targetMimeType = fileMimeType ?? getMimeTypeFromExtension(defaultExtension);
    base64String = `data:${targetMimeType};base64,${sourceValue}`;
  }

  const cleanExtension = extension ?? getFileExtensionFromMimeType(
    { mimeType, defaultExtension });
  let cleanFileName = filename ?? `file.${cleanExtension}`;
  if (extension && !cleanFileName.endsWith(`.${extension}`)) {
    cleanFileName = `${cleanFileName}.${cleanExtension}`;
  }

  const extensionMimeType = getMimeTypeFromExtension(cleanExtension);
  const downloadMimeType = fileMimeType ?? (typeof extensionMimeType === 'string' ? extensionMimeType : 'application/octet-stream');
  return saveFileContent(base64String, cleanFileName, downloadMimeType);
}

function notifyDownloadFailure(status: Exclude<FileSaveResult['status'], 'started'>, message: ReturnType<typeof useMessage>): void {
  const errorMessage = status === 'unsupported'
    ? 'File downloads are not supported in this context.'
    : status === 'denied'
      ? 'Permission to save the file was denied.'
      : 'Could not start the file download.';
  message.error(errorMessage);
}

function useDownloadFileFromBase64(
  { source, filename, extension, fileMimeType }:
  { source: Ref<string>; filename?: string; extension?: string; fileMimeType?: string }) {
  const message = useMessage();
  return {
    download() {
      const result = downloadFromBase64({ sourceValue: source.value, filename, extension, fileMimeType });
      if (result.status !== 'started') {
        notifyDownloadFailure(result.status, message);
      }
    },
  };
}

function useDownloadFileFromBase64Refs(
  { source, filename, extension }:
  { source: Ref<string>; filename?: Ref<string>; extension?: Ref<string> }) {
  const message = useMessage();
  return {
    download() {
      const result = downloadFromBase64({ sourceValue: source.value, filename: filename?.value, extension: extension?.value });
      if (result.status !== 'started') {
        notifyDownloadFailure(result.status, message);
      }
    },
  };
}

function previewImageFromBase64(base64String: string): HTMLImageElement {
  if (base64String === '') {
    throw new Error('Base64 string is empty');
  }

  const img = document.createElement('img');
  img.src = base64String;

  const container = document.createElement('div');
  container.appendChild(img);

  const previewContainer = document.getElementById('previewContainer');
  if (previewContainer) {
    previewContainer.innerHTML = '';
    previewContainer.appendChild(container);
  }
  else {
    throw new Error('Preview container element not found');
  }

  return img;
}
