import type { lib } from 'crypto-js';
import { SHA256, SHA384, SHA512, enc } from 'crypto-js';

export type SriAlgorithm = 'sha256' | 'sha384' | 'sha512';
export type SriResourceType = 'script' | 'stylesheet';
export type SriCrossorigin = 'anonymous' | 'use-credentials' | 'none';

export interface SriHash {
  algorithm: SriAlgorithm
  digest: string
  integrity: string
}

export interface SriHtmlSnippetOptions {
  type: SriResourceType
  url: string
  integrity: string
  crossorigin?: SriCrossorigin
}

const hashers: Record<SriAlgorithm, (content: string) => lib.WordArray> = {
  sha256: SHA256,
  sha384: SHA384,
  sha512: SHA512,
};

function uniqueAlgorithms(algorithms: SriAlgorithm[]) {
  return [...new Set(algorithms)];
}

function getHasher(algorithm: SriAlgorithm) {
  const hasher = hashers[algorithm];
  if (!hasher) {
    throw new Error(`Unsupported SRI algorithm: ${algorithm}`);
  }

  return hasher;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function generateSriHashes(content: string, algorithms: SriAlgorithm[] = ['sha384']): SriHash[] {
  return uniqueAlgorithms(algorithms).map((algorithm) => {
    const digest = getHasher(algorithm)(content).toString(enc.Base64);

    return {
      algorithm,
      digest,
      integrity: `${algorithm}-${digest}`,
    };
  });
}

export function joinIntegrity(hashes: SriHash[]) {
  return hashes.map(({ integrity }) => integrity).join(' ');
}

export function generateSriHtmlSnippet({
  type,
  url,
  integrity,
  crossorigin = 'anonymous',
}: SriHtmlSnippetOptions) {
  const trimmedUrl = url.trim();
  const trimmedIntegrity = integrity.trim();
  if (!trimmedUrl || !trimmedIntegrity) {
    return '';
  }

  const escapedUrl = escapeHtmlAttribute(trimmedUrl);
  const escapedIntegrity = escapeHtmlAttribute(trimmedIntegrity);
  const crossoriginAttribute = crossorigin === 'none' ? '' : ` crossorigin="${escapeHtmlAttribute(crossorigin)}"`;

  if (type === 'stylesheet') {
    return `<link rel="stylesheet" href="${escapedUrl}" integrity="${escapedIntegrity}"${crossoriginAttribute}>`;
  }

  return `<script src="${escapedUrl}" integrity="${escapedIntegrity}"${crossoriginAttribute}></script>`;
}
