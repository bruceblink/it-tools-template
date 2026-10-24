import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type {
  GitBridgeResult,
  GitDiff,
  GitLog,
  GitRepositoryInfo,
  GitStatus,
} from '../../src/shared/desktop-services/git';
import {
  GIT_DEFAULT_TIMEOUT_MS,
  GIT_MAX_OUTPUT_BYTES,
} from '../../src/shared/desktop-services/git';
import { isTrustedDesktopSender } from '../plugin-ipc-security';
import {
  parseGitDiff,
  parseGitLog,
  parseGitRepositoryId,
  parseGitRepositoryRequest,
  parseGitRequestId,
  parseGitStatus,
} from './git-protocol';

const SELECT_CHANNEL = 'desktop:git:select-repository';
const STATUS_CHANNEL = 'desktop:git:status';
const LOG_CHANNEL = 'desktop:git:log';
const DIFF_CHANNEL = 'desktop:git:diff';
const CANCEL_CHANNEL = 'desktop:git:cancel';
const CLOSE_CHANNEL = 'desktop:git:close';

interface GitIpcDependencies {
  trustedRendererUrl: () => string;
}

interface OwnedRepository {
  rendererId: number;
  repositoryId: string;
  rootPath: string;
}

interface ActiveGitRequest {
  rendererId: number;
  requestId: string;
  child: ChildProcess;
  timer: NodeJS.Timeout;
  reason: 'cancelled' | 'timeout' | 'output-too-large' | null;
}

interface GitCommandSuccess {
  ok: true;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

interface GitCommandFailure {
  ok: false;
  error: 'cancelled' | 'timeout' | 'git-failed' | 'service-unavailable';
}

type GitCommandResult = GitCommandSuccess | GitCommandFailure;

/** Keep repository paths in the main process and expose only bounded Git read operations. */
export function registerGitIpc(dependencies: GitIpcDependencies) {
  const repositories = new Map<string, OwnedRepository>();
  const rendererRepositories = new Map<number, string>();
  const activeRequests = new Map<string, ActiveGitRequest>();

  ipcMain.handle(SELECT_CHANNEL, async (event): Promise<GitBridgeResult<GitRepositoryInfo | null>> => {
    const senderError = getTrustedSenderError(event, dependencies.trustedRendererUrl());
    if (senderError) {
      return { ok: false, error: senderError };
    }

    let selection: Electron.OpenDialogReturnValue;
    try {
      const options: Electron.OpenDialogOptions = {
        title: 'Open Git repository',
        properties: ['openDirectory'],
      };
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      selection = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options);
    }
    catch {
      return { ok: false, error: 'service-unavailable' };
    }
    if (selection.canceled) {
      return { ok: true, value: null };
    }

    const selectedPath = selection.filePaths[0];
    const canonicalPath = await getDirectoryPath(selectedPath);
    if (!canonicalPath) {
      return { ok: false, error: 'repository-not-found' };
    }

    const probeRequestId = randomUUID();
    const rootResult = await runGitCommand(event.sender.id, probeRequestId, canonicalPath, [
      'rev-parse',
      '--show-toplevel',
    ]);
    if (!rootResult.ok) {
      return { ok: false, error: rootResult.error === 'git-failed' ? 'not-repository' : rootResult.error };
    }
    const rootPath = await getDirectoryPath(rootResult.stdout.trim().split(/\r?\n/, 1)[0]);
    if (!rootPath) {
      return { ok: false, error: 'not-repository' };
    }

    const branchResult = await runGitCommand(event.sender.id, randomUUID(), rootPath, [
      'branch',
      '--show-current',
    ]);
    if (!branchResult.ok) {
      return { ok: false, error: branchResult.error };
    }

    closeRenderer(event.sender.id);
    const repositoryId = randomUUID();
    const repository: OwnedRepository = { rendererId: event.sender.id, repositoryId, rootPath };
    repositories.set(repositoryId, repository);
    rendererRepositories.set(event.sender.id, repositoryId);
    return {
      ok: true,
      value: {
        repositoryId,
        name: basename(rootPath) || rootPath,
        rootPath,
        branch: branchResult.stdout.trim() || '(detached HEAD)',
      },
    };
  });

  ipcMain.handle(STATUS_CHANNEL, async (event, value: unknown): Promise<GitBridgeResult<GitStatus>> => {
    return runRepositoryOperation(event, value, dependencies, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'], result =>
      parseGitStatus(result.stdout, result.truncated));
  });

  ipcMain.handle(LOG_CHANNEL, async (event, value: unknown): Promise<GitBridgeResult<GitLog>> => {
    return runRepositoryOperation(event, value, dependencies, [
      '--no-pager',
      'log',
      '--no-color',
      '-n',
      '50',
      '--date=iso-strict',
      '--format=%H%x00%h%x00%an%x00%aI%x00%s%x1e',
    ], result => parseGitLog(result.stdout, result.truncated));
  });

  ipcMain.handle(DIFF_CHANNEL, async (event, value: unknown): Promise<GitBridgeResult<GitDiff>> => {
    return runRepositoryOperation(event, value, dependencies, [
      '--no-pager',
      'diff',
      '--no-ext-diff',
      '--no-color',
      '--text',
    ], result => parseGitDiff(result.stdout, result.truncated));
  });

  ipcMain.handle(CANCEL_CHANNEL, (event, value: unknown): GitBridgeResult<boolean> => {
    const senderError = getTrustedSenderError(event, dependencies.trustedRendererUrl());
    if (senderError) {
      return { ok: false, error: senderError };
    }
    const requestId = parseGitRequestId(value);
    if (!requestId) {
      return { ok: false, error: 'invalid-request' };
    }
    const active = [...activeRequests.values()].find(request =>
      request.rendererId === event.sender.id && request.requestId === requestId);
    if (!active) {
      return { ok: true, value: false };
    }
    active.reason = 'cancelled';
    active.child.kill();
    return { ok: true, value: true };
  });

  ipcMain.handle(CLOSE_CHANNEL, (event, value: unknown): GitBridgeResult<boolean> => {
    const senderError = getTrustedSenderError(event, dependencies.trustedRendererUrl());
    if (senderError) {
      return { ok: false, error: senderError };
    }
    const repositoryId = parseGitRepositoryId(value);
    if (!repositoryId) {
      return { ok: false, error: 'invalid-request' };
    }
    const repository = repositories.get(repositoryId);
    if (!repository || repository.rendererId !== event.sender.id) {
      return { ok: false, error: 'repository-not-found' };
    }
    removeRepository(repositoryId);
    return { ok: true, value: true };
  });

  function closeRenderer(rendererId: number): void {
    for (const [key, request] of activeRequests) {
      if (request.rendererId === rendererId) {
        request.reason = 'cancelled';
        request.child.kill();
        activeRequests.delete(key);
      }
    }
    const repositoryId = rendererRepositories.get(rendererId);
    if (repositoryId) {
      removeRepository(repositoryId);
    }
    rendererRepositories.delete(rendererId);
  }

  function shutdown(): void {
    for (const request of activeRequests.values()) {
      request.reason = 'cancelled';
      clearTimeout(request.timer);
      request.child.kill();
    }
    activeRequests.clear();
    repositories.clear();
    rendererRepositories.clear();
    ipcMain.removeHandler(SELECT_CHANNEL);
    ipcMain.removeHandler(STATUS_CHANNEL);
    ipcMain.removeHandler(LOG_CHANNEL);
    ipcMain.removeHandler(DIFF_CHANNEL);
    ipcMain.removeHandler(CANCEL_CHANNEL);
    ipcMain.removeHandler(CLOSE_CHANNEL);
  }

  function removeRepository(repositoryId: string): void {
    const repository = repositories.get(repositoryId);
    if (!repository) {
      return;
    }
    for (const [key, request] of activeRequests) {
      if (request.rendererId === repository.rendererId) {
        request.reason = 'cancelled';
        request.child.kill();
        activeRequests.delete(key);
      }
    }
    repositories.delete(repositoryId);
    if (rendererRepositories.get(repository.rendererId) === repositoryId) {
      rendererRepositories.delete(repository.rendererId);
    }
  }

  async function runRepositoryOperation<T>(
    event: IpcMainInvokeEvent,
    value: unknown,
    operationDependencies: GitIpcDependencies,
    args: string[],
    parse: (result: GitCommandSuccess) => T,
  ): Promise<GitBridgeResult<T>> {
    const senderError = getTrustedSenderError(event, operationDependencies.trustedRendererUrl());
    if (senderError) {
      return { ok: false, error: senderError };
    }
    const request = parseGitRepositoryRequest(value);
    if (!request) {
      return { ok: false, error: 'invalid-request' };
    }
    const repository = repositories.get(request.repositoryId);
    if (!repository || repository.rendererId !== event.sender.id) {
      return { ok: false, error: 'repository-not-found' };
    }
    const key = requestKey(event.sender.id, request.requestId);
    if (activeRequests.has(key)) {
      return { ok: false, error: 'invalid-request' };
    }
    const result = await runGitCommand(event.sender.id, request.requestId, repository.rootPath, args);
    return result.ok ? { ok: true, value: parse(result) } : { ok: false, error: result.error };
  }

  return { closeRenderer, shutdown };

  async function getDirectoryPath(candidate: string | undefined): Promise<string | null> {
    if (!candidate) {
      return null;
    }
    try {
      const details = await stat(candidate);
      if (!details.isDirectory()) {
        return null;
      }
      return await realpath(candidate);
    }
    catch {
      return null;
    }
  }

  function requestKey(rendererId: number, requestId: string): string {
    return `${rendererId}:${requestId}`;
  }

  function runGitCommand(
    rendererId: number,
    requestId: string,
    cwd: string,
    args: string[],
  ): Promise<GitCommandResult> {
    const key = requestKey(rendererId, requestId);
    let child: ChildProcess;
    try {
      child = spawn('git', args, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
    catch {
      return Promise.resolve({ ok: false, error: 'service-unavailable' });
    }

    return new Promise(resolve => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      const active: ActiveGitRequest = {
        rendererId,
        requestId,
        child,
        timer: setTimeout(() => {
          active.reason = 'timeout';
          child.kill();
        }, GIT_DEFAULT_TIMEOUT_MS),
        reason: null,
      };
      activeRequests.set(key, active);

      const finish = (result: GitCommandResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(active.timer);
        activeRequests.delete(key);
        resolve(result);
      };
      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdoutBytes >= GIT_MAX_OUTPUT_BYTES) {
          return;
        }
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = GIT_MAX_OUTPUT_BYTES - stdoutBytes;
        stdout.push(value.subarray(0, remaining));
        stdoutBytes += Math.min(value.length, remaining);
        if (value.length > remaining && active.reason === null) {
          active.reason = 'output-too-large';
          child.kill();
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderrBytes >= 16 * 1024) {
          return;
        }
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = 16 * 1024 - stderrBytes;
        stderr.push(value.subarray(0, remaining));
        stderrBytes += Math.min(value.length, remaining);
      });
      child.once('error', () => finish({ ok: false, error: 'service-unavailable' }));
      child.once('close', (code: number | null) => {
        if (active.reason === 'cancelled') {
          finish({ ok: false, error: 'cancelled' });
          return;
        }
        if (active.reason === 'timeout') {
          finish({ ok: false, error: 'timeout' });
          return;
        }
        const output = {
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        };
        if (active.reason === 'output-too-large') {
          finish({ ok: true, ...output, truncated: true });
        }
        else if (code !== 0) {
          finish({ ok: false, error: 'git-failed' });
        }
        else {
          finish({ ok: true, ...output, truncated: false });
        }
      });
    });
  }
}

function getTrustedSenderError(
  event: IpcMainInvokeEvent,
  trustedRendererUrl: string,
): 'untrusted-renderer' | null {
  return isTrustedDesktopSender(event, trustedRendererUrl) ? null : 'untrusted-renderer';
}
