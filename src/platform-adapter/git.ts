import type {
  GitBridgeResult,
  GitDiff,
  GitErrorCode,
  GitLog,
  GitRepositoryInfo,
  GitStatus,
} from '@/shared/desktop-services/git';

export type GitOperation<T> =
  | { status: 'success'; value: T }
  | { status: 'unsupported' }
  | { status: 'failed'; error: GitErrorCode };

async function callGit<T>(
  operation: ((bridge: NonNullable<Window['itToolsDesktop']>) => Promise<GitBridgeResult<T>> | undefined) | undefined,
): Promise<GitOperation<T>> {
  const bridge = typeof window === 'undefined' ? undefined : window.itToolsDesktop;
  if (!bridge || !operation) {
    return { status: 'unsupported' };
  }
  try {
    const result = await operation(bridge);
    if (!result) {
      return { status: 'unsupported' };
    }
    return result.ok ? { status: 'success', value: result.value } : { status: 'failed', error: result.error };
  }
  catch {
    return { status: 'failed', error: 'service-unavailable' };
  }
}

export function selectGitRepository(): Promise<GitOperation<GitRepositoryInfo | null>> {
  return callGit(bridge => bridge.selectGitRepository?.());
}

export function getGitStatus(repositoryId: string, requestId: string): Promise<GitOperation<GitStatus>> {
  return callGit(bridge => bridge.getGitStatus?.(repositoryId, requestId));
}

export function getGitLog(repositoryId: string, requestId: string): Promise<GitOperation<GitLog>> {
  return callGit(bridge => bridge.getGitLog?.(repositoryId, requestId));
}

export function getGitDiff(repositoryId: string, requestId: string): Promise<GitOperation<GitDiff>> {
  return callGit(bridge => bridge.getGitDiff?.(repositoryId, requestId));
}

export function cancelGitRequest(requestId: string): Promise<GitOperation<boolean>> {
  return callGit(bridge => bridge.cancelGitRequest?.(requestId));
}

export function closeGitRepository(repositoryId: string): Promise<GitOperation<boolean>> {
  return callGit(bridge => bridge.closeGitRepository?.(repositoryId));
}
