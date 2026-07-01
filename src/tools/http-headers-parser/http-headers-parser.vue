<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import { parseHttpHeaders } from './http-headers-parser.service';
import type { UseValidationRule } from '../../composable/validation';
import { withDefaultOnError } from '../../utils/defaults';

const sampleHeaders = `HTTP/2 200
content-type: application/json; charset=utf-8
cache-control: no-cache
set-cookie: session=abc; HttpOnly; Secure
set-cookie: theme=dark
x-request-id: req-123`;

const rawHeaders = useStorage('http-headers-parser:headers', sampleHeaders);

const emptyParsedHeaders = parseHttpHeaders('');
const parsedHeaders = computed(() => withDefaultOnError(() => parseHttpHeaders(rawHeaders.value), emptyParsedHeaders));
const headerRows = computed(() => parsedHeaders.value.headers.map(({ normalizedName, value }) => ({
  name: normalizedName,
  value,
})));
const duplicateRows = computed(() => parsedHeaders.value.duplicates.map(({ name, values }) => ({
  name,
  count: values.length,
  values: values.join('\n'),
})));
const headersJson = computed(() => JSON.stringify(parsedHeaders.value.json, null, 2));

const rules: UseValidationRule<string>[] = [
  {
    validator: value => value.trim() === '' || parseHttpHeaders(value),
    message: 'Provided HTTP headers are not valid.',
  },
];
</script>

<template>
  <div flex flex-col gap-5>
    <c-input-text
      v-model:value="rawHeaders"
      label="HTTP headers"
      placeholder="Paste request or response headers..."
      rows="10"
      multiline
      raw-text
      monospace
      autofocus
      :validation-rules="rules"
    />

    <div grid grid-cols-1 gap-3 md:grid-cols-3>
      <n-statistic label="Header count" :value="parsedHeaders.headers.length" />
      <n-statistic label="Duplicate names" :value="parsedHeaders.duplicates.length" />
      <n-statistic label="Start line" :value="parsedHeaders.startLine || '-'" />
    </div>

    <c-table
      :data="headerRows"
      :headers="[
        { key: 'name', label: 'Name' },
        { key: 'value', label: 'Value' },
      ]"
      description="Parsed HTTP headers"
    >
      <template #value="{ value }">
        <span-copyable :value="String(value)" />
      </template>
    </c-table>

    <c-table
      v-if="duplicateRows.length"
      :data="duplicateRows"
      :headers="[
        { key: 'name', label: 'Duplicate name' },
        { key: 'count', label: 'Count' },
        { key: 'values', label: 'Values' },
      ]"
      description="Duplicate HTTP headers"
    />

    <div grid grid-cols-1 gap-5 lg:grid-cols-3>
      <n-form-item label="JSON">
        <textarea-copyable :value="headersJson" language="json" />
      </n-form-item>

      <n-form-item label="Normalized headers">
        <textarea-copyable :value="parsedHeaders.normalizedText" language="txt" />
      </n-form-item>

      <n-form-item label="cURL headers">
        <textarea-copyable :value="parsedHeaders.curlHeaders" language="txt" />
      </n-form-item>
    </div>
  </div>
</template>
