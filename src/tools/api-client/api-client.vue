<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { ApiHttpMethod, ApiResponse } from '@/shared/desktop-services/api';
import { API_DEFAULT_TIMEOUT_MS, API_MAX_BODY_BYTES, API_MAX_HEADERS, API_MAX_RESPONSE_BYTES } from '@/shared/desktop-services/api';
import { cancelApiRequest, runApiRequest, type ApiOperation } from '@/platform-adapter/api';

interface RequestHistoryEntry {
  id: string;
  method: ApiHttpMethod;
  url: string;
  status: number | null;
  elapsedMs: number | null;
}

const { locale } = useI18n();
const isChinese = computed(() => locale.value.toLowerCase().startsWith('zh'));
const method = ref<ApiHttpMethod>('GET');
const url = ref('https://example.com/');
const headersText = ref('{\n  "Accept": "application/json"\n}');
const body = ref('');
const timeoutMs = ref(API_DEFAULT_TIMEOUT_MS);
const response = ref<ApiResponse | null>(null);
const status = ref<'idle' | 'running' | 'success' | 'failed'>('idle');
const error = ref<string | null>(null);
const history = ref<RequestHistoryEntry[]>([]);
let activeRequestId: string | null = null;

const methodOptions = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
  .map(value => ({ label: value, value }));
const canSendBody = computed(() => !['GET', 'HEAD'].includes(method.value));
const responseBodyLabel = computed(() => isChinese.value ? '响应正文' : 'Response body');
const requestLabel = computed(() => isChinese.value ? '发送请求' : 'Send request');
const cancelLabel = computed(() => isChinese.value ? '取消请求' : 'Cancel request');
const idleText = computed(() => isChinese.value
  ? '请求只在 Electron 主进程中执行。请求头、正文和响应均受大小限制。'
  : 'Requests run in the Electron main process. Headers, bodies, and responses are size limited.');
const errorText = computed(() => {
  if (!error.value) {
    return '';
  }
  const labels: Record<string, string> = isChinese.value
    ? {
        'invalid-request': '请求参数无效。',
        'untrusted-renderer': '请求来源不受信任。',
        cancelled: '请求已取消。',
        timeout: '请求超时。',
        'network-error': '网络请求失败。',
        'service-unavailable': 'API 服务不可用。',
      }
    : {
        'invalid-request': 'The request parameters are invalid.',
        'untrusted-renderer': 'The request source is not trusted.',
        cancelled: 'The request was cancelled.',
        timeout: 'The request timed out.',
        'network-error': 'The network request failed.',
        'service-unavailable': 'The API service is unavailable.',
      };
  return labels[error.value] ?? error.value;
});

async function sendRequest(): Promise<void> {
  if (status.value === 'running') {
    return;
  }
  let headers: Record<string, string>;
  try {
    const parsed: unknown = JSON.parse(headersText.value || '{}');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('headers');
    }
    headers = Object.fromEntries(Object.entries(parsed).map(([name, value]) => {
      if (typeof value !== 'string') {
        throw new Error('headers');
      }
      return [name, value];
    }));
  }
  catch {
    status.value = 'failed';
    error.value = 'invalid-request';
    response.value = null;
    return;
  }

  const requestId = crypto.randomUUID();
  activeRequestId = requestId;
  status.value = 'running';
  error.value = null;
  response.value = null;
  const result = await runApiRequest({
    requestId,
    method: method.value,
    url: url.value.trim(),
    headers,
    body: canSendBody.value && body.value.length > 0 ? body.value : null,
    timeoutMs: timeoutMs.value,
  });
  if (activeRequestId !== requestId) {
    return;
  }
  activeRequestId = null;
  recordHistory(requestId, result);
  if (result.status === 'success') {
    response.value = result.value;
    status.value = 'success';
    return;
  }
  status.value = 'failed';
  error.value = result.status === 'unsupported' ? 'service-unavailable' : result.error;
}

async function cancelRequest(): Promise<void> {
  const requestId = activeRequestId;
  if (!requestId) {
    return;
  }
  await cancelApiRequest(requestId);
}

function recordHistory(requestId: string, result: ApiOperation<ApiResponse>): void {
  const entry: RequestHistoryEntry = {
    id: requestId,
    method: method.value,
    url: url.value.trim(),
    status: result.status === 'success' ? result.value.status : null,
    elapsedMs: result.status === 'success' ? result.value.elapsedMs : null,
  };
  history.value = [entry, ...history.value].slice(0, 20);
}

function restoreHistory(entry: RequestHistoryEntry): void {
  method.value = entry.method;
  url.value = entry.url;
  response.value = null;
  error.value = null;
  status.value = 'idle';
}

onBeforeUnmount(() => {
  if (activeRequestId) {
    void cancelApiRequest(activeRequestId);
  }
});
</script>

<template>
  <div class="api-client" data-test-id="api-client-workspace">
    <n-card :title="isChinese ? 'API 工作台' : 'API workbench'" size="small">
      <n-alert type="info" :show-icon="false" data-test-id="api-client-notice">
        {{ idleText }}
      </n-alert>
      <div class="api-client-grid">
        <section class="api-client-request" aria-label="API request">
          <div class="api-client-row">
            <select v-model="method" class="api-client-method" data-test-id="api-client-method">
              <option v-for="option in methodOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <n-input v-model:value="url" :placeholder="isChinese ? 'https://example.com/api' : 'https://example.com/api'" data-test-id="api-client-url" />
          </div>
          <n-input
            v-model:value="headersText"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 10 }"
            :placeholder="isChinese ? '请求头 JSON' : 'Request headers JSON'"
            data-test-id="api-client-headers"
          />
          <n-input
            v-if="canSendBody"
            v-model:value="body"
            type="textarea"
            :autosize="{ minRows: 5, maxRows: 14 }"
            :placeholder="isChinese ? '请求正文（最多 256 KiB）' : 'Request body (up to 256 KiB)'"
            data-test-id="api-client-body"
          />
          <div class="api-client-actions">
            <n-input-number v-model:value="timeoutMs" :min="1000" :max="30000" :step="1000" :disabled="status === 'running'" data-test-id="api-client-timeout" />
            <n-button type="primary" :loading="status === 'running'" :disabled="status === 'running'" data-test-id="api-client-send" @click="sendRequest">
              {{ requestLabel }}
            </n-button>
            <n-button v-if="status === 'running'" data-test-id="api-client-cancel" @click="cancelRequest">
              {{ cancelLabel }}
            </n-button>
          </div>
          <n-alert v-if="errorText" type="error" :show-icon="false" data-test-id="api-client-error">
            {{ errorText }}
          </n-alert>
        </section>

        <section class="api-client-response" aria-label="API response">
          <div v-if="response" class="api-client-response-meta" data-test-id="api-client-response-meta">
            <strong>{{ response.status }} {{ response.statusText }}</strong>
            <span>{{ response.elapsedMs }} ms</span>
            <span v-if="response.truncated">{{ isChinese ? '响应已截断' : 'Response truncated' }}</span>
          </div>
          <div v-if="response?.headers.length" class="api-client-headers">
            <div v-for="header in response.headers" :key="`${header.name}:${header.value}`">
              <strong>{{ header.name }}:</strong> {{ header.value }}
            </div>
          </div>
          <pre class="api-client-body" data-test-id="api-client-response-body">{{ response?.body ?? (status === 'idle' ? responseBodyLabel : '') }}</pre>
        </section>
      </div>
    </n-card>

    <n-card v-if="history.length" :title="isChinese ? '本次会话历史' : 'Session history'" size="small" class="api-client-history">
      <div v-for="entry in history" :key="entry.id" class="api-client-history-row" data-test-id="api-client-history-row" @click="restoreHistory(entry)">
        <strong>{{ entry.method }}</strong>
        <span class="api-client-history-url">{{ entry.url }}</span>
        <span>{{ entry.status ?? '—' }}</span>
        <span>{{ entry.elapsedMs === null ? '—' : `${entry.elapsedMs} ms` }}</span>
      </div>
    </n-card>

    <p class="api-client-limit">
      {{ isChinese ? `请求头最多 ${API_MAX_HEADERS} 项，正文最多 ${Math.round(API_MAX_BODY_BYTES / 1024)} KiB，响应最多 ${Math.round(API_MAX_RESPONSE_BYTES / 1024)} KiB。` : `Up to ${API_MAX_HEADERS} headers, a ${Math.round(API_MAX_BODY_BYTES / 1024)} KiB request body, and a ${Math.round(API_MAX_RESPONSE_BYTES / 1024)} KiB response.` }}
    </p>
  </div>
</template>

<style scoped>
.api-client { display: grid; gap: 16px; }
.api-client-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 16px; }
.api-client-request, .api-client-response { display: grid; gap: 12px; min-width: 0; }
.api-client-row { display: grid; grid-template-columns: 124px minmax(0, 1fr); gap: 8px; }
.api-client-method { min-width: 0; }
.api-client-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.api-client-response { min-height: 360px; padding: 12px; border: 1px solid var(--border-color, #e5e7eb); border-radius: 8px; background: var(--code-background, #f8fafc); }
.api-client-response-meta { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.api-client-headers { max-height: 160px; overflow: auto; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
.api-client-body { min-height: 260px; margin: 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
.api-client-history { margin-top: 0; }
.api-client-history-row { display: grid; grid-template-columns: 72px minmax(0, 1fr) 56px 80px; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border-color, #e5e7eb); cursor: pointer; align-items: center; }
.api-client-history-row:last-child { border-bottom: 0; }
.api-client-history-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.api-client-limit { margin: 0; color: var(--text-color-3, #64748b); font-size: 12px; }
@media (max-width: 900px) { .api-client-grid { grid-template-columns: 1fr; } }
</style>
