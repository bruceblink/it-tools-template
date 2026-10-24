import type {
  GitCommit,
  GitDiff,
  GitLog,
  GitRepositoryRequest,
  GitStatus,
  GitStatusEntry,
} from '../../src/shared/desktop-services/git';
import {
  GIT_MAX_LOG_ENTRIES,
  GIT_MAX_REQUEST_ID_LENGTH,
  GIT_MAX_REPOSITORY_ID_LENGTH,
  GIT_MAX_STATUS_ENTRIES,
} from '../../src/shared/desktop-services/git';

const requestKeys = ['repositoryId', 'requestId'] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseGitRepositoryRequest(value: unknown): GitRepositoryRequest | null {
  if (!isRecord(value) || !hasOnlyKeys(value, requestKeys)) {
    return null;
  }
  const repositoryId = parseUuid(value.repositoryId, GIT_MAX_REPOSITORY_ID_LENGTH);
  const requestId = parseBoundedString(value.requestId, GIT_MAX_REQUEST_ID_LENGTH);
  return repositoryId && requestId ? { repositoryId, requestId } : null;
}

export function parseGitRepositoryId(value: unknown): string | null {
  return isRecord(value) && hasOnlyKeys(value, ['repositoryId'])
    ? parseUuid(value.repositoryId, GIT_MAX_REPOSITORY_ID_LENGTH)
    : null;
}

export function parseGitRequestId(value: unknown): string | null {
  return isRecord(value) && hasOnlyKeys(value, ['requestId'])
    ? parseBoundedString(value.requestId, GIT_MAX_REQUEST_ID_LENGTH)
    : null;
}

export function parseGitStatus(output: string, truncated: boolean): GitStatus {
  const tokens = output.split('\0');
  const branchToken = tokens.shift() ?? '';
  const branchDetails = parseBranchToken(branchToken);
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < tokens.length && entries.length < GIT_MAX_STATUS_ENTRIES; index += 1) {
    const token = tokens[index];
    if (!token || token.length < 3 || token[0] === '#') {
      continue;
    }
    const status = token.slice(0, 2);
    const path = token.slice(3);
    if (!path) {
      continue;
    }
    const isRename = status.includes('R') || status.includes('C');
    const originalPath = isRename ? tokens[++index] || null : null;
    entries.push({
      index: status[0] ?? ' ',
      worktree: status[1] ?? ' ',
      path,
      originalPath,
    });
  }
  return {
    branch: branchDetails.branch,
    upstream: branchDetails.upstream,
    ahead: branchDetails.ahead,
    behind: branchDetails.behind,
    entries,
    truncated: truncated || entries.length >= GIT_MAX_STATUS_ENTRIES,
  };
}

export function parseGitLog(output: string, truncated: boolean): GitLog {
  const commits: GitCommit[] = [];
  for (const record of output.split('\x1e')) {
    if (!record || commits.length >= GIT_MAX_LOG_ENTRIES) {
      continue;
    }
    const fields = record.split('\0');
    if (fields.length < 5 || !fields[0] || !fields[1]) {
      continue;
    }
    commits.push({
      hash: fields[0],
      shortHash: fields[1],
      author: fields[2] ?? '',
      authoredAt: fields[3] ?? '',
      subject: fields[4] ?? '',
    });
  }
  return { commits, truncated: truncated || commits.length >= GIT_MAX_LOG_ENTRIES };
}

export function parseGitDiff(output: string, truncated: boolean): GitDiff {
  return { patch: output, truncated };
}

function parseBranchToken(token: string): {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
} {
  const value = token.startsWith('## ') ? token.slice(3) : token;
  const [branchPart, trackingPart] = value.split('...', 2);
  const branch = branchPart?.trim() || '(detached HEAD)';
  const upstream = trackingPart?.split(' [', 1)[0]?.trim() || null;
  const ahead = Number.parseInt(/ahead (\d+)/.exec(value)?.[1] ?? '0', 10);
  const behind = Number.parseInt(/behind (\d+)/.exec(value)?.[1] ?? '0', 10);
  return {
    branch,
    upstream,
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
  };
}

function parseUuid(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length <= maximum && uuidPattern.test(value) ? value : null;
}

function parseBoundedString(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}
