<script setup lang="ts">
import { useStorage } from '@vueuse/core';

const delimiter = useStorage('csv-to-markdown-table:delimiter', ',');
const hasHeader = useStorage('csv-to-markdown-table:has-header', true);

const delimiterOptions = [
  { label: 'Comma (,)', value: ',' },
  { label: 'Semicolon (;)', value: ';' },
  { label: 'Tab', value: '\t' },
  { label: 'Pipe (|)', value: '|' },
];

const sampleCsv = 'name,role,team\nAlice,Developer,Platform\nBob,Designer,Product';
const workerTaskOptions = computed(() => ({ delimiter: delimiter.value, hasHeader: hasHeader.value }));
</script>

<template>
  <div mb-4 grid grid-cols-1 gap-3 md:grid-cols-2>
    <c-select
      v-model:value="delimiter"
      label="Delimiter"
      :options="delimiterOptions"
    />

    <n-form-item label="First row is header" label-placement="left" :show-feedback="false">
      <n-switch v-model:value="hasHeader" />
    </n-form-item>
  </div>

  <format-transformer
    input-label="Your CSV"
    :input-default="sampleCsv"
    input-placeholder="Paste your CSV here..."
    output-label="Markdown table"
    output-language="markdown"
    worker-task-kind="csv-to-markdown"
    :worker-task-options="workerTaskOptions"
    worker-invalid-message="Provided CSV is not valid."
  />
</template>
