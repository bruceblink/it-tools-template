import { describe, expect, it } from 'vitest';
import { parseGitDiff, parseGitLog, parseGitRepositoryRequest, parseGitStatus } from './git-protocol';

const repositoryId = '11111111-1111-4111-8111-111111111111';

describe('Git workbench protocol', () => {
  it('accepts only UUID-scoped repository requests', () => {
    expect(parseGitRepositoryRequest({ repositoryId, requestId: 'request-1' })).toEqual({
      repositoryId,
      requestId: 'request-1',
    });
    expect(parseGitRepositoryRequest({ repositoryId: 'repo', requestId: 'request-1' })).toBeNull();
    expect(parseGitRepositoryRequest({ repositoryId, requestId: 'request-1', extra: true })).toBeNull();
  });

  it('parses branch tracking and bounded porcelain status entries', () => {
    const status = parseGitStatus('## main...origin/main [ahead 2, behind 1]\0 M README.md\0?? notes.txt\0', false);
    expect(status).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1 });
    expect(status.entries).toEqual([
      { index: ' ', worktree: 'M', path: 'README.md', originalPath: null },
      { index: '?', worktree: '?', path: 'notes.txt', originalPath: null },
    ]);
  });

  it('parses bounded log records and marks truncated output', () => {
    const record = ['a', 'a1', 'Ada', '2026-10-24T10:00:00+08:00', 'first commit'].join('\0');
    const log = parseGitLog(`${record}\x1e`, true);
    expect(log).toEqual({
      commits: [{ hash: 'a', shortHash: 'a1', author: 'Ada', authoredAt: '2026-10-24T10:00:00+08:00', subject: 'first commit' }],
      truncated: true,
    });
  });

  it('keeps diff output and its truncation marker', () => {
    expect(parseGitDiff('diff --git a/a b/a\n', true)).toEqual({
      patch: 'diff --git a/a b/a\n',
      truncated: true,
    });
  });
});
