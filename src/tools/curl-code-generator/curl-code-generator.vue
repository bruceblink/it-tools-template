<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import {
  formatCurlCode,
  generateCurlCode,
  type CurlCodeOutput,
} from './curl-code-generator.service';
import type { UseValidationRule } from '@/composable/validation';
import { withDefaultOnError } from '@/utils/defaults';

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

const rawCurl = useStorage('curl-code-generator:curl', sampleCurl);
const outputFormat = useStorage<CurlCodeOutput>('curl-code-generator:output', 'fetch');
const emptyGeneration = generateCurlCode('curl https://example.com');
const generation = computed(() => withDefaultOnError(() => generateCurlCode(rawCurl.value), emptyGeneration));
const output = computed(() => withDefaultOnError(() => formatCurlCode(rawCurl.value, outputFormat.value), ''));
const outputLanguage = computed(() => outputFormat.value === 'httpie' ? 'bash' : 'javascript');

const headerRows = computed<Record<string, unknown>[]>(() => generation.value.request.headers.map(header => ({
  name: header.name,
  value: header.value,
})));

const warningRows = computed<Record<string, unknown>[]>(() => generation.value.request.warnings.map((warning, index) => ({
  index: index + 1,
  warning,
})));

const rules: UseValidationRule<string>[] = [
  {
    validator: value => generateCurlCode(value),
    message: 'Provided cURL command is not valid.',
  },
];
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
      :validation-rules="rules"
    />

    <div grid grid-cols-1 gap-3 md:grid-cols-5>
      <n-statistic label="Method" :value="generation.summary.method" />
      <n-statistic label="Headers" :value="generation.summary.headerCount" />
      <n-statistic label="Body" :value="generation.summary.hasBody ? 'yes' : 'no'" />
      <n-statistic label="Compressed" :value="generation.request.compressed ? 'yes' : 'no'" />
      <n-statistic label="Warnings" :value="generation.summary.warningCount" />
    </div>

    <n-form-item label="URL">
      <span-copyable :value="generation.request.url" />
    </n-form-item>

    <div>
      <c-buttons-select
        v-model:value="outputFormat"
        :options="outputOptions"
        label="Output"
        label-width="75px"
        mb-3
      />
      <textarea-copyable :value="output" :language="outputLanguage" />
    </div>

    <div v-if="generation.request.data">
      <div mb-2 font-bold>
        Request body
      </div>
      <textarea-copyable :value="generation.request.data" language="json" />
    </div>

    <c-table
      v-if="headerRows.length"
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

    <c-table
      v-if="warningRows.length"
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
  </div>
</template>
