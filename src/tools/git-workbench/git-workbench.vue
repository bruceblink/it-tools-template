<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type {
  GitCommit,
  GitDiff,
  GitErrorCode,
  GitLog,
  GitRepositoryInfo,
  GitStatus,
  GitStatusEntry,
} from '@/shared/desktop-services/git';
import {
  cancelGitRequest,
  closeGitRepository,
  getGitDiff,
  getGitLog,
  getGitStatus,
  selectGitRepository,
  type GitOperation,
} from '@/platform-adapter/git';

const { locale } = useI18n();
const isChinese = computed(() => locale.value.toLowerCase().startsWith('zh'));
const repository = ref<GitRepositoryInfo | null>(null);
const statusEntries = ref<GitStatusEntry[]>([]);
const branch = ref('');
const upstream = ref<string | null>(null);
const ahead = ref(0);
const behind = ref(0);
const commits = ref<GitCommit[]>([]);
const diff = ref('');
const statusTruncated = ref(false);
const logTruncated = ref(false);
const diffTruncated = ref(false);
const isLoading = ref(false);
const error = ref<GitErrorCode | null>(null);
const activeRequestIds = new Set<string>();
let refreshToken = 0;
let disposed = false;

const errorText = computed(() => {
  if (!error.value) {
    return '';
  }
  const labels: Record<GitErrorCode, string> = isChinese.value
    ? {
        'invalid-request': '请求参数无效。',
        'untrusted-renderer': '请求来源不受信任。',
        cancelled: 'Git 请求已取消。',
        timeout: 'Git 请求超时。',
        'repository-not-found': '仓库不存在或已关闭。',
        'not-repository': '所选目录不是 Git 仓库。',
        'git-failed': 'Git 命令执行失败。',
        'output-too-large': 'Git 输出超过安全上限。',
        'service-unavailable': 'Git 服务不可用。',
      }
    : {
        'invalid-request': 'The request parameters are invalid.',
        'untrusted-renderer': 'The request source is not trusted.',
        cancelled: 'The Git request was cancelled.',
        timeout: 'The Git request timed out.',
        'repository-not-found': 'The repository is missing or closed.',
        'not-repository': 'The selected directory is not a Git repository.',
        'git-failed': 'The Git command failed.',
        'output-too-large': 'Git output exceeded the safety limit.',
        'service-unavailable': 'The Git service is unavailable.',
      };
  return labels[error.value];
});

const statusSummary = computed(() => {
  if (!repository.value) {
    return '';
  }
  if (statusEntries.value.length === 0) {
    return isChinese.value ? '工作树干净。' : 'Working tree clean.';
  }
  return isChinese.value
    ? `${statusEntries.value.length} 个变更`
    : `${statusEntries.value.length} change${statusEntries.value.length === 1 ? '' : 's'}`;
});

async function chooseRepository(): Promise<void> {
  cancelActiveRequests();
  error.value = null;
  const result = await selectGitRepository();
  if (result.status === 'unsupported') {
    error.value = 'service-unavailable';
    return;
  }
  if (result.status === 'failed') {
    error.value = result.error;
    return;
  }
  if (!result.value) {
    return;
  }
  repository.value = result.value;
  await refreshRepository();
}

async function refreshRepository(): Promise<void> {
  const current = repository.value;
  if (!current || isLoading.value) {
    return;
  }
  const token = ++refreshToken;
  const requestIds: [string, string, string] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  requestIds.forEach(requestId => activeRequestIds.add(requestId));
  isLoading.value = true;
  error.value = null;
  const results = await Promise.all([
    getGitStatus(current.repositoryId, requestIds[0]),
    getGitLog(current.repositoryId, requestIds[1]),
    getGitDiff(current.repositoryId, requestIds[2]),
  ]);
  requestIds.forEach(requestId => activeRequestIds.delete(requestId));
  if (disposed || token !== refreshToken) {
    return;
  }
  isLoading.value = false;
  applyStatusResult(results[0]);
  applyLogResult(results[1]);
  applyDiffResult(results[2]);
  if (results.some(result => result.status === 'failed')) {
    const failed = results.find(result => result.status === 'failed');
    error.value = failed?.status === 'failed' ? failed.error : null;
  }
}

function applyStatusResult(result: GitOperation<GitStatus>): void {
  if (result.status !== 'success') {
    return;
  }
  branch.value = result.value.branch;
  upstream.value = result.value.upstream;
  ahead.value = result.value.ahead;
  behind.value = result.value.behind;
  statusEntries.value = result.value.entries;
  statusTruncated.value = result.value.truncated;
}

function applyLogResult(result: GitOperation<GitLog>): void {
  if (result.status !== 'success') {
    return;
  }
  commits.value = result.value.commits;
  logTruncated.value = result.value.truncated;
}

function applyDiffResult(result: GitOperation<GitDiff>): void {
  if (result.status !== 'success') {
    return;
  }
  diff.value = result.value.patch;
  diffTruncated.value = result.value.truncated;
}

function cancelActiveRequests(): void {
  refreshToken += 1;
  for (const requestId of activeRequestIds) {
    void cancelGitRequest(requestId);
  }
  activeRequestIds.clear();
  isLoading.value = false;
}

function closeRepository(): void {
  const current = repository.value;
  if (current) {
    void closeGitRepository(current.repositoryId);
  }
  repository.value = null;
  statusEntries.value = [];
  commits.value = [];
  diff.value = '';
  branch.value = '';
  upstream.value = null;
  ahead.value = 0;
  behind.value = 0;
}

function statusCode(entry: GitStatusEntry): string {
  return `${entry.index}${entry.worktree}`;
}

onBeforeUnmount(() => {
  disposed = true;
  cancelActiveRequests();
  closeRepository();
});
</script>

<template>
  <div class="git-workbench" data-test-id="git-workbench">
    <n-card :title="isChinese ? 'Git 工作台' : 'Git workbench'" size="small">
      <div class="git-workbench-toolbar">
        <n-button type="primary" data-test-id="git-workbench-select" @click="chooseRepository">
          {{ isChinese ? '选择仓库' : 'Select repository' }}
        </n-button>
        <n-button :disabled="!repository || isLoading" data-test-id="git-workbench-refresh" @click="refreshRepository">
          {{ isChinese ? '刷新' : 'Refresh' }}
        </n-button>
        <n-button v-if="isLoading" data-test-id="git-workbench-cancel" @click="cancelActiveRequests">
          {{ isChinese ? '取消' : 'Cancel' }}
        </n-button>
        <n-button v-if="repository" :disabled="isLoading" data-test-id="git-workbench-close" @click="closeRepository">
          {{ isChinese ? '关闭仓库' : 'Close repository' }}
        </n-button>
      </div>
      <n-alert type="info" :show-icon="false" data-test-id="git-workbench-notice">
        {{ isChinese ? '只读查看本地仓库。Git 命令在主进程中运行，并限制输出和执行时间。' : 'Read-only view of a local repository. Git commands run in the main process with bounded output and execution time.' }}
      </n-alert>
      <n-alert v-if="errorText" type="error" :show-icon="false" data-test-id="git-workbench-error">
        {{ errorText }}
      </n-alert>

      <div v-if="repository" class="git-workbench-repository" data-test-id="git-workbench-repository">
        <strong>{{ repository.name }}</strong>
        <code>{{ repository.rootPath }}</code>
        <span>{{ isChinese ? '分支' : 'Branch' }}: {{ branch || repository.branch }}</span>
        <span v-if="upstream">{{ upstream }} · ↑{{ ahead }} ↓{{ behind }}</span>
      </div>
      <p v-else class="git-workbench-empty" data-test-id="git-workbench-empty">
        {{ isChinese ? '选择一个 Git 仓库开始。' : 'Select a Git repository to begin.' }}
      </p>

      <div v-if="repository" class="git-workbench-grid">
        <section class="git-workbench-panel" data-test-id="git-workbench-status">
          <div class="git-workbench-panel-heading">
            <h2>{{ isChinese ? '工作树状态' : 'Working tree' }}</h2>
            <span>{{ statusSummary }}</span>
          </div>
          <p v-if="statusTruncated" class="git-workbench-limit">{{ isChinese ? '状态列表已达到显示上限。' : 'The status list reached its display limit.' }}</p>
          <table v-if="statusEntries.length" class="git-workbench-table">
            <thead><tr><th>{{ isChinese ? '状态' : 'Status' }}</th><th>{{ isChinese ? '路径' : 'Path' }}</th></tr></thead>
            <tbody>
              <tr v-for="entry in statusEntries" :key="`${statusCode(entry)}:${entry.path}`">
                <td><code>{{ statusCode(entry) }}</code></td>
                <td><code>{{ entry.path }}</code><small v-if="entry.originalPath"> ← {{ entry.originalPath }}</small></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="git-workbench-muted">{{ isChinese ? '没有未提交变更。' : 'No uncommitted changes.' }}</p>
        </section>

        <section class="git-workbench-panel" data-test-id="git-workbench-log">
          <div class="git-workbench-panel-heading">
            <h2>{{ isChinese ? '提交历史' : 'Commit history' }}</h2>
            <span>{{ commits.length }}</span>
          </div>
          <p v-if="logTruncated" class="git-workbench-limit">{{ isChinese ? '历史记录已达到显示上限。' : 'The commit history reached its display limit.' }}</p>
          <div v-for="commit in commits" :key="commit.hash" class="git-workbench-commit">
            <code>{{ commit.shortHash }}</code>
            <strong>{{ commit.subject }}</strong>
            <span>{{ commit.author }} · {{ commit.authoredAt }}</span>
          </div>
          <p v-if="commits.length === 0" class="git-workbench-muted">{{ isChinese ? '没有提交记录。' : 'No commits found.' }}</p>
        </section>

        <section class="git-workbench-panel git-workbench-diff" data-test-id="git-workbench-diff">
          <div class="git-workbench-panel-heading">
            <h2>{{ isChinese ? '未提交差异' : 'Uncommitted diff' }}</h2>
            <span v-if="diffTruncated">{{ isChinese ? '已截断' : 'Truncated' }}</span>
          </div>
          <pre v-if="diff" data-test-id="git-workbench-diff-body">{{ diff }}</pre>
          <p v-else class="git-workbench-muted">{{ isChinese ? '没有未提交差异。' : 'No uncommitted diff.' }}</p>
        </section>
      </div>
    </n-card>
  </div>
</template>

<style scoped>
.git-workbench { display: grid; gap: 16px; }
.git-workbench-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.git-workbench-repository { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 16px 0; }
.git-workbench-repository code { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-color-3, #64748b); }
.git-workbench-empty, .git-workbench-muted, .git-workbench-limit { color: var(--text-color-3, #64748b); }
.git-workbench-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 16px; }
.git-workbench-panel { min-width: 0; padding: 12px; border: 1px solid var(--border-color, #e5e7eb); border-radius: 8px; }
.git-workbench-panel-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.git-workbench-panel-heading h2 { margin: 0; font-size: 15px; }
.git-workbench-panel-heading span { color: var(--text-color-3, #64748b); font-size: 12px; }
.git-workbench-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.git-workbench-table th, .git-workbench-table td { padding: 7px 4px; border-bottom: 1px solid var(--border-color, #e5e7eb); text-align: left; vertical-align: top; }
.git-workbench-table th:first-child, .git-workbench-table td:first-child { width: 64px; }
.git-workbench-table small { color: var(--text-color-3, #64748b); }
.git-workbench-commit { display: grid; grid-template-columns: 54px minmax(0, 1fr); gap: 5px 8px; padding: 8px 0; border-bottom: 1px solid var(--border-color, #e5e7eb); font-size: 12px; }
.git-workbench-commit span { grid-column: 2; color: var(--text-color-3, #64748b); }
.git-workbench-diff { grid-column: 1 / -1; }
.git-workbench-diff pre { max-height: 480px; margin: 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
@media (max-width: 900px) { .git-workbench-grid { grid-template-columns: 1fr; } .git-workbench-diff { grid-column: auto; } }
</style>
