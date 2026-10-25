<script setup lang="ts">
import { tryOnBeforeUnmount, useStorage } from '@vueuse/core';
import type { CurlCodeOutput, CurlRequest } from './curl-code-generator.service';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';

const sampleCurl = `curl 'https://api.example.com/users' \\
  -X POST \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer token' \\
  --data-raw '{"name":"Ada"}'`;

const outputOptions: { label: string, value: CurlCodeOutput }[] = [
  { label: 'fetch', value: 'fetch' },
  { label: 'axios', value: 'axios' },
  { label: 'HTTPie', value: 'httpie' },
];

const MAX_VISIBLE_CURL_ROWS = 500;
const rawCurl = ref(sampleCurl);
const outputFormat = useStorage<CurlCodeOutput>('curl-code-generator:output', 'fetch');
const request = shallowRef<CurlRequest | null>(null);
const generatedCode = ref('');
const parseErrorMessage = ref('');
const outputErrorMessage = ref('');
const taskStatus = ref<'idle' | 'running' | 'input-limit' | 'output-limit' | 'timeout' | 'error'>('idle');
const { t } = useI18n();
const taskKey = 'curl-code-generator:generate';
let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;
let lastTaskInput: string | undefined;

const parseError = computed(() => {
  if (taskStatus.value === 'input-limit') { return 'cURL command exceeds 256 KiB.'; }
  if (taskStatus.value === 'output-limit') { return 'Generated cURL task exceeded its transfer limit.'; }
  if (taskStatus.value === 'timeout') { return t('taskStatus.timeout'); }
  if (taskStatus.value === 'error') { return t('taskStatus.error'); }
  return parseErrorMessage.value;
});
const summary = computed(() => request.value
  ? {
      method: request.value.method,
      headerCount: request.value.headers.length,
      hasBody: request.value.data !== '',
      warningCount: request.value.warnings.length,
    }
  : null);
const outputResult = computed(() => {
  if (!request.value) {
    return { code: '', error: null };
  }
  return { code: generatedCode.value, error: outputErrorMessage.value || null };
});
const outputLanguage = computed(() => outputFormat.value === 'httpie' ? 'bash' : 'javascript');

const headerRows = computed<Record<string, unknown>[]>(() => (request.value?.headers ?? []).slice(0, MAX_VISIBLE_CURL_ROWS).map(header => ({
  name: header.name,
  value: header.value,
})));
const headerRowsTruncated = computed(() => (request.value?.headers.length ?? 0) > MAX_VISIBLE_CURL_ROWS);

const warningRows = computed<Record<string, unknown>[]>(() => (request.value?.warnings ?? []).slice(0, MAX_VISIBLE_CURL_ROWS).map((warning, index) => ({
  index: index + 1,
  warning,
})));
const warningRowsTruncated = computed(() => (request.value?.warnings.length ?? 0) > MAX_VISIBLE_CURL_ROWS);

watch([rawCurl, outputFormat], () => {
  const version = ++taskVersion;
  const inputChanged = lastTaskInput !== rawCurl.value;
  lastTaskInput = rawCurl.value;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
  if (inputChanged) {
    request.value = null;
    parseErrorMessage.value = '';
  }
  generatedCode.value = '';
  outputErrorMessage.value = '';
  taskStatus.value = 'running';

  // Parse and format the current command away from the renderer thread; replace work after edits.
  taskTimer = setTimeout(async () => {
    const outcome = await taskRunner.run(taskKey, version, {
      kind: 'curl-code-generator',
      value: rawCurl.value,
      outputFormat: outputFormat.value,
    }, taskLimits.curlCodeGenerator);
    if (version !== taskVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === 'curl-code-generator') {
      if (!outcome.result.valid) {
        parseErrorMessage.value = outcome.result.errorMessage;
        taskStatus.value = 'idle';
        return;
      }
      request.value = outcome.result.request;
      generatedCode.value = outcome.result.output;
      outputErrorMessage.value = outcome.result.outputErrorMessage ?? '';
      taskStatus.value = 'idle';
      return;
    }
    if (outcome.status === 'cancelled') { return; }
    taskStatus.value = outcome.status === 'success' ? 'error' : outcome.status;
  }, 150);
}, { immediate: true });

tryOnBeforeUnmount(() => {
  taskVersion++;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
});
</script>

<template>
  <div flex flex-col gap-5>
    <c-input-text
      v-model:value="rawCurl"
      label="cURL command"
      placeholder="Paste a cURL command..."
      rows="8"
      multiline
      raw-text
      monospace
      autofocus
      test-id="curl-command-input"
    />

    <n-alert v-if="parseError" type="error" :show-icon="false">
      {{ parseError }}
    </n-alert>

    <div v-else-if="taskStatus === 'running' && !request" role="status" data-test-id="curl-generation-status" mb-2 text-center op-70>
      {{ t('taskStatus.calculating') }}
    </div>

    <template v-else-if="request && summary">
      <div grid grid-cols-1 gap-3 md:grid-cols-5>
        <n-statistic label="Method" :value="summary.method" />
        <n-statistic label="Headers" :value="summary.headerCount" />
        <n-statistic label="Body" :value="summary.hasBody ? 'yes' : 'no'" />
        <n-statistic label="Compressed" :value="request.compressed ? 'yes' : 'no'" />
        <n-statistic label="Warnings" :value="summary.warningCount" />
      </div>

      <n-form-item label="URL">
        <span-copyable :value="request.url" />
      </n-form-item>

      <div>
        <c-buttons-select
          v-model:value="outputFormat"
          :options="outputOptions"
          label="Output"
          label-width="75px"
          mb-3
        />
        <div v-if="taskStatus === 'running'" role="status" data-test-id="curl-generation-status" mb-3 text-center op-70>
          {{ t('taskStatus.calculating') }}
        </div>
        <n-alert v-else-if="outputResult.error" type="error" :show-icon="false" mb-3>
          {{ outputResult.error }}
        </n-alert>
        <div v-else data-test-id="curl-generated-output">
          <textarea-copyable :value="outputResult.code" :language="outputLanguage" />
        </div>
      </div>

      <div v-if="request.data">
        <div mb-2 font-bold>
          Request body
        </div>
        <textarea-copyable :value="request.data" language="json" />
      </div>

      <n-alert v-if="headerRowsTruncated" type="info" :show-icon="false">
        Showing the first {{ MAX_VISIBLE_CURL_ROWS }} of {{ request.headers.length }} headers. Generated code includes every header.
      </n-alert>
      <c-table
        v-if="headerRows.length"
        data-test-id="curl-header-table"
        :data="headerRows"
        :headers="[
          { key: 'name', label: 'Header' },
          { key: 'value', label: 'Value' },
        ]"
        description="Parsed request headers"
      >
        <template #name="{ value }">
          <span-copyable :value="String(value)" />
        </template>
        <template #value="{ value }">
          <span-copyable :value="String(value)" />
        </template>
      </c-table>

      <n-alert v-if="warningRowsTruncated" type="info" :show-icon="false">
        Showing the first {{ MAX_VISIBLE_CURL_ROWS }} of {{ request.warnings.length }} warnings.
      </n-alert>
      <c-table
        v-if="warningRows.length"
        data-test-id="curl-warning-table"
        :data="warningRows"
        :headers="[
          { key: 'index', label: '#' },
          { key: 'warning', label: 'Warning' },
        ]"
        description="Ignored or unsupported cURL options"
      >
        <template #warning="{ value }">
          <n-tag type="warning">
            {{ value }}
          </n-tag>
        </template>
      </c-table>
    </template>
  </div>
</template>
