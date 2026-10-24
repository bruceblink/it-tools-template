export type GitErrorCode =
  | 'invalid-request'
  | 'untrusted-renderer'
  | 'cancelled'
  | 'timeout'
  | 'repository-not-found'
  | 'not-repository'
  | 'git-failed'
  | 'output-too-large'
  | 'service-unavailable';

export type GitBridgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: GitErrorCode };

export interface GitRepositoryInfo {
  repositoryId: string;
  name: string;
  rootPath: string;
  branch: string;
}

export interface GitStatusEntry {
  index: string;
  worktree: string;
  path: string;
  originalPath: string | null;
}

export interface GitStatus {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  entries: GitStatusEntry[];
  truncated: boolean;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  authoredAt: string;
  subject: string;
}

export interface GitLog {
  commits: GitCommit[];
  truncated: boolean;
}

export interface GitDiff {
  patch: string;
  truncated: boolean;
}

export interface GitRepositoryRequest {
  repositoryId: string;
  requestId: string;
}

export const GIT_DEFAULT_TIMEOUT_MS = 10_000;
export const GIT_MAX_OUTPUT_BYTES = 512 * 1024;
export const GIT_MAX_STATUS_ENTRIES = 500;
export const GIT_MAX_LOG_ENTRIES = 50;
export const GIT_MAX_REQUEST_ID_LENGTH = 64;
export const GIT_MAX_REPOSITORY_ID_LENGTH = 64;
