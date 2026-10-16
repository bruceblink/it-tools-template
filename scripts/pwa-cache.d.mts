import type { Plugin } from 'vite';
import type { ManifestEntry, ManifestTransform } from 'workbox-build';

export const shellIcons: string[];
export const budgets: { precacheBytes: number; initialJavaScriptGzipBytes: number; toolJavaScriptGzipBytes: number };
export function assertBuildPath(path: string): string;
export function collectStaticFiles(manifest: import('vite').Manifest, entry: string): string[];
export function collectAppShellFiles(manifest: import('vite').Manifest): string[];
export function readBuildManifest(directory: string): Promise<import('vite').Manifest>;
export function getRuntimeAssets(directory: string): Promise<{ paths: string[]; buildId: string }>;
export function assertPrecacheBudget(bytes: number, limit?: number): void;
export function filterAppShell(directory: string, entries: ManifestEntry[], additionalEntries?: ManifestEntry[]): ReturnType<ManifestTransform>;
export function runtimeAssetsPlugin(directory: string): Plugin;
