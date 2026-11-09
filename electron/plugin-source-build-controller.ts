import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  DesktopPluginErrorCode,
  DesktopPluginSourceBuildInput,
  DesktopPluginSourceBuildProgress,
  DesktopPluginSourceBuildResult,
  DesktopPluginSourceSnapshotInstallSource,
} from '../src/shared/desktop-services/plugins';
import {
  buildPluginSourceSnapshot,
  type PluginSourceBuildInput,
  type PluginSourceBuildResult,
} from './plugin-source-build';
import { PluginSourceArchiveError } from './plugin-source-archive';
import { PluginSourceSnapshotError } from './plugin-source-snapshot';

const requestIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const repositoryPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const commitPattern = /^[a-f0-9]{40}$/i;
const keyIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export type PluginSourceBuildControllerErrorCode = Extract<
  DesktopPluginErrorCode,
  `source-build-${string}`
>;

export class PluginSourceBuildControllerError extends Error {
  constructor(
    readonly code: PluginSourceBuildControllerErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PluginSourceBuildControllerError';
  }
}

export interface PluginSourceBuildControllerDependencies<TSnapshot> {
  readonly tempRoot: string;
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Selects a private key in the trusted main process. */
  readonly selectPrivateKey: (signal: AbortSignal) => Promise<string | null>;
  readonly buildSnapshot?: typeof buildPluginSourceSnapshot;
  readonly installPackage: (
    packagePath: string,
    source: DesktopPluginSourceSnapshotInstallSource,
    signal: AbortSignal,
  ) => Promise<TSnapshot>;
}

interface ActiveBuild<TSnapshot> {
  readonly requestId: string;
  readonly controller: AbortController;
  readonly operation: Promise<PluginSourceBuildControllerResult<TSnapshot>>;
  phase: DesktopPluginSourceBuildProgress['phase'];
}

export type PluginSourceBuildControllerResult<TSnapshot> = DesktopPluginSourceBuildResult<TSnapshot> & {
  readonly build: PluginSourceBuildResult;
};

/** Owns one fixed-commit source build and install at a time. */
export class PluginSourceBuildController<TSnapshot> {
  private active: ActiveBuild<TSnapshot> | undefined;

  constructor(private readonly dependencies: PluginSourceBuildControllerDependencies<TSnapshot>) {}

  start(
    input: DesktopPluginSourceBuildInput,
    onProgress: (progress: DesktopPluginSourceBuildProgress) => void,
  ): Promise<PluginSourceBuildControllerResult<TSnapshot>> {
    validateInput(input);
    if (this.active) {
      throw new PluginSourceBuildControllerError(
        'source-build-busy',
        'Another plugin source build is already running.',
      );
    }

    const controller = new AbortController();
    let tracked: ActiveBuild<TSnapshot> | undefined;
    const emit = (progress: Omit<DesktopPluginSourceBuildProgress, 'requestId'>): void => {
      if (tracked) {
        tracked.phase = progress.phase;
      }
      try {
        onProgress({ requestId: input.requestId, ...progress });
      }
      catch {
        // Renderer notification failure must not cancel a valid build.
      }
    };
    const buildSnapshot = this.dependencies.buildSnapshot ?? buildPluginSourceSnapshot;
    const operation = this.run(input, controller, buildSnapshot, emit);
    tracked = {
      requestId: input.requestId,
      controller,
      phase: 'selecting-key',
      operation: operation.finally(() => {
        if (this.active === tracked) {
          this.active = undefined;
        }
      }),
    };
    this.active = tracked;
    return tracked.operation;
  }

  cancel(requestId: string): boolean {
    if (!this.active || this.active.requestId !== requestId) {
      return false;
    }
    if (this.active.phase === 'installing' || this.active.phase === 'completed' || this.active.phase === 'cancelled') {
      return false;
    }
    this.active.controller.abort();
    return true;
  }

  async dispose(): Promise<void> {
    const active = this.active;
    if (!active) {
      return;
    }
    if (active.phase !== 'installing') {
      active.controller.abort();
    }
    await active.operation.catch(() => undefined);
  }

  private async run(
    input: DesktopPluginSourceBuildInput,
    controller: AbortController,
    buildSnapshot: typeof buildPluginSourceSnapshot,
    emit: (progress: Omit<DesktopPluginSourceBuildProgress, 'requestId'>) => void,
  ): Promise<PluginSourceBuildControllerResult<TSnapshot>> {
    const signal = controller.signal;
    const repository = `${input.owner}/${input.name}`;
    emit({ phase: 'selecting-key', repository, commitSha: input.commitSha });
    throwIfAborted(signal);

    let privateKeyPath: string | null;
    try {
      privateKeyPath = await this.dependencies.selectPrivateKey(signal);
    }
    catch (error) {
      if (signal.aborted) {
        throw cancelledError(error);
      }
      throw new PluginSourceBuildControllerError(
        'source-build-failed',
        'The signing key could not be selected.',
        { cause: error },
      );
    }
    if (signal.aborted) {
      throw cancelledError();
    }
    if (privateKeyPath === null) {
      emit({ phase: 'cancelled', repository, commitSha: input.commitSha });
      throw new PluginSourceBuildControllerError(
        'source-build-key-cancelled',
        'The signing key selection was cancelled.',
      );
    }
    throwIfAborted(signal);

    await mkdir(this.dependencies.tempRoot, { recursive: true, mode: 0o700 });
    const requestRoot = await mkdtemp(join(this.dependencies.tempRoot, '.it-tools-plugin-source-install-'));
    const outputPath = join(requestRoot, 'plugin.itplugin');
    try {
      emit({ phase: 'building', repository, commitSha: input.commitSha });
      const buildInput: PluginSourceBuildInput = {
        owner: input.owner,
        name: input.name,
        commitSha: input.commitSha,
        privateKeyPath,
        keyId: input.keyId,
        outputPath,
      };
      let build: PluginSourceBuildResult;
      try {
        build = await buildSnapshot(buildInput, {
          tempRoot: requestRoot,
          fetch: this.dependencies.fetch,
          signal,
        });
      }
      catch (error) {
        if (signal.aborted) {
          throw cancelledError(error);
        }
        throw normalizeBuildError(error);
      }
      throwIfAborted(signal);

      const source: DesktopPluginSourceSnapshotInstallSource = {
        kind: 'source-snapshot',
        repository: build.source.repository,
        commitSha: build.source.commitSha,
        archiveUrl: build.source.archiveUrl,
        archiveBytes: build.source.archiveBytes,
        sha256: build.source.sha256,
      };
      emit({
        phase: 'installing',
        repository: source.repository,
        commitSha: source.commitSha,
        pluginId: build.build.pluginId,
        version: build.build.version,
      });
      let snapshot: TSnapshot;
      try {
        snapshot = await this.dependencies.installPackage(outputPath, source, signal);
      }
      catch (error) {
        if (signal.aborted) {
          throw cancelledError(error);
        }
        throw error;
      }
      emit({
        phase: 'completed',
        repository: source.repository,
        commitSha: source.commitSha,
        pluginId: build.build.pluginId,
        version: build.build.version,
      });
      return { snapshot, source, build };
    }
    catch (error) {
      if (error instanceof PluginSourceBuildControllerError && error.code === 'source-build-cancelled') {
        emit({ phase: 'cancelled', repository, commitSha: input.commitSha });
      }
      else if (signal.aborted) {
        emit({ phase: 'cancelled', repository, commitSha: input.commitSha });
      }
      throw error;
    }
    finally {
      await rm(requestRoot, { recursive: true, force: true });
    }
  }
}

function validateInput(input: DesktopPluginSourceBuildInput): void {
  if (
    !requestIdPattern.test(input.requestId)
    || !ownerPattern.test(input.owner)
    || !repositoryPattern.test(input.name)
    || !commitPattern.test(input.commitSha)
    || !keyIdPattern.test(input.keyId)
  ) {
    throw new PluginSourceBuildControllerError(
      'source-build-invalid-repository',
      'The plugin source build request is invalid.',
    );
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw cancelledError();
  }
}

function cancelledError(cause?: unknown): PluginSourceBuildControllerError {
  return new PluginSourceBuildControllerError(
    'source-build-cancelled',
    'The plugin source build was cancelled.',
    cause === undefined ? undefined : { cause },
  );
}

function normalizeBuildError(error: unknown): PluginSourceBuildControllerError | Error {
  if (error instanceof PluginSourceBuildControllerError) {
    return error;
  }
  if (error instanceof PluginSourceSnapshotError) {
    const code = error.code === 'source-invalid-repository'
      ? 'source-build-invalid-repository'
      : error.code === 'source-commit-not-found'
        ? 'source-build-commit-not-found'
        : error.code === 'source-download-failed' || error.code === 'source-unavailable'
          ? 'source-build-download-failed'
          : error.code === 'source-cancelled'
            ? 'source-build-cancelled'
            : 'source-build-failed';
    return new PluginSourceBuildControllerError(code, error.message, { cause: error });
  }
  if (error instanceof PluginSourceArchiveError) {
    const code = error.code === 'archive-resource-limit'
      ? 'source-build-resource-limit'
      : error.code === 'archive-cancelled'
        ? 'source-build-cancelled'
        : 'source-build-archive-invalid';
    return new PluginSourceBuildControllerError(code, error.message, { cause: error });
  }
  return error instanceof Error
    ? new PluginSourceBuildControllerError('source-build-failed', error.message, { cause: error })
    : new PluginSourceBuildControllerError('source-build-failed', 'The plugin source build failed.');
}
