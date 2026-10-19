<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import {
  CurlCodeGeneratorError,
  formatCurlRequest,
  parseCurlCommand,
  type CurlRequest,
  type CurlCodeOutput,
} from './curl-code-generator.service';

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
const parsedCommand = computed<{ request: CurlRequest, error: null } | { request: null, error: string }>(() => {
  try {
    return { request: parseCurlCommand(rawCurl.value), error: null };
  }
  catch (error) {
    return {
      request: null,
      error: error instanceof CurlCodeGeneratorError ? error.message : 'Could not parse this cURL command.',
    };
  }
});
const request = computed(() => parsedCommand.value.request);
const parseError = computed(() => parsedCommand.value.error);
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

  try {
    return { code: formatCurlRequest(request.value, outputFormat.value), error: null };
  }
  catch (error) {
    return {
      code: '',
      error: error instanceof CurlCodeGeneratorError ? error.message : 'Could not generate cURL code.',
    };
  }
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
        <n-alert v-if="outputResult.error" type="error" :show-icon="false" mb-3>
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
