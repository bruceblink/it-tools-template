import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  downloadPluginSourceSnapshot,
  PluginSourceSnapshotError,
  type PluginSourceSnapshotInput,
  type PluginSourceSnapshotSource,
} from './plugin-source-snapshot.ts';
import {
  extractPluginSourceArchive,
  type PluginSourceArchiveResult,
} from './plugin-source-archive.ts';
import {
  buildPluginWorkflow,
} from '../scripts/plugin-build.mjs';

/** The bounded build report returned by the repository plugin build workflow. */
export interface PluginSourceBuildPackageReport {
  readonly pluginId: string;
  readonly version: string;
  readonly fileCount: number;
  readonly expandedBytes: number;
  readonly typecheck: {
    readonly status: 'passed' | 'skipped';
    readonly configPath?: string;
    readonly reason?: string;
  };
  readonly package: {
    readonly outputPath: string;
    readonly pluginId: string;
    readonly version: string;
    readonly archiveBytes: number;
  };
}

type PluginSourceBuildWorkflowReport = PluginSourceBuildPackageReport & {
  readonly sourceDirectory?: string;
};

export interface PluginSourceBuildResult {
  readonly build: PluginSourceBuildPackageReport;
  readonly source: PluginSourceSnapshotSource;
  /** Extraction counts. The temporary source directory is removed before return. */
  readonly extraction: Omit<PluginSourceArchiveResult, 'sourceDirectory'>;
}

export interface PluginSourceBuildInput extends PluginSourceSnapshotInput {
  /** A private Ed25519 key stored outside the repository. */
  readonly privateKeyPath: string;
  /** The explicit signer ID written into the package manifest. */
  readonly keyId: string;
  /** A new `.itxs` path. Existing files are never overwritten. */
  readonly outputPath: string;
  /** Optional TypeScript project configuration inside or beside the snapshot. */
  readonly tsconfigPath?: string;
}

export interface PluginSourceBuildDependencies {
  readonly tempRoot: string;
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  readonly signal?: AbortSignal;
  readonly downloadSnapshot?: typeof downloadPluginSourceSnapshot;
  readonly extractArchive?: typeof extractPluginSourceArchive;
  readonly buildWorkflow?: (input: {
    readonly sourceDirectory: string;
    readonly privateKeyPath: string;
    readonly keyId: string;
    readonly outputPath: string;
    readonly tsconfigPath?: string;
  }) => Promise<PluginSourceBuildWorkflowReport>;
}

/**
 * Build a fixed GitHub source snapshot into a signed package.
 *
 * This workflow only validates and packages static plugin files. It does not
 * run repository scripts, install dependencies, or load source in Electron.
 */
export async function buildPluginSourceSnapshot(
  input: PluginSourceBuildInput,
  dependencies: PluginSourceBuildDependencies,
): Promise<PluginSourceBuildResult> {
  throwIfAborted(dependencies.signal);
  const downloadSnapshot = dependencies.downloadSnapshot ?? downloadPluginSourceSnapshot;
  const extractArchive = dependencies.extractArchive ?? extractPluginSourceArchive;
  const runBuild: NonNullable<PluginSourceBuildDependencies['buildWorkflow']> =
    dependencies.buildWorkflow ?? (value => buildPluginWorkflow(value));

  const result = await downloadSnapshot(input, {
    tempRoot: dependencies.tempRoot,
    fetch: dependencies.fetch,
    signal: dependencies.signal,
    processArchive: async (archivePath, source) => {
      throwIfAborted(dependencies.signal);
      const extractionRoot = await mkdtemp(join(dependencies.tempRoot, '.it-tools-plugin-source-build-'));
      let buildCompleted = false;
      try {
        const extraction = await extractArchive(archivePath, extractionRoot, { signal: dependencies.signal });
        throwIfAborted(dependencies.signal);
        const build = await runBuild({
          sourceDirectory: extraction.sourceDirectory,
          privateKeyPath: input.privateKeyPath,
          keyId: input.keyId,
          outputPath: input.outputPath,
          ...(input.tsconfigPath === undefined ? {} : { tsconfigPath: input.tsconfigPath }),
        });
        buildCompleted = true;
        throwIfAborted(dependencies.signal);
        return { build: stripSourceDirectory(build), extraction, source };
      }
      catch (error) {
        if (buildCompleted && dependencies.signal?.aborted) {
          await rm(input.outputPath, { force: true });
        }
        throw error;
      }
      finally {
        await rm(extractionRoot, { recursive: true, force: true });
      }
    },
  });

  return {
    build: result.value.build,
    extraction: {
      entryCount: result.value.extraction.entryCount,
      fileCount: result.value.extraction.fileCount,
      expandedBytes: result.value.extraction.expandedBytes,
      rootDirectory: result.value.extraction.rootDirectory,
    },
    source: result.source,
  };
}

function stripSourceDirectory(report: PluginSourceBuildWorkflowReport): PluginSourceBuildPackageReport {
  const { sourceDirectory, ...sanitized } = report;
  void sourceDirectory;
  return sanitized;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PluginSourceSnapshotError('source-cancelled', 'The source snapshot build was cancelled.');
  }
}
