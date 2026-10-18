import type { KeyObject } from 'node:crypto';

export interface PluginSourceManifest {
  formatVersion: 1;
  id: string;
  name: string;
  version: string;
  apiVersion: { minInclusive: string; maxExclusive: string };
  entrypoint: string;
  requestedCapabilities: string[];
}

export interface SignedPluginPackageManifest extends PluginSourceManifest {
  files: Array<{ path: string; sha256: string }>;
  signature: { algorithm: 'Ed25519'; keyId: string; value: string };
}

export function getPluginPackageSigningPayload(manifest: PluginSourceManifest & {
  files: Array<{ path: string; sha256: string }>;
}): string;
export function buildPluginPackage(input: {
  sourceDirectory: string;
  signingKey: KeyObject;
  keyId: string;
}): Promise<{ archive: Buffer; manifest: SignedPluginPackageManifest }>;
export function packPluginPackage(input: {
  sourceDirectory: string;
  privateKeyPath: string;
  keyId: string;
  outputPath: string;
}): Promise<{ outputPath: string; pluginId: string; version: string; archiveBytes: number }>;
export function generatePluginSigningKey(input: {
  outputDirectory: string;
  keyId: string;
  appRoot?: string;
}): Promise<{ keyId: string; privateKeyPath: string; publicKeyPath: string; fingerprint: string }>;
