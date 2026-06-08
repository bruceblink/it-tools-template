<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import { convertCsvToMarkdownTable } from './csv-to-markdown-table.service';
import type { UseValidationRule } from '@/composable/validation';
import { parseCsv } from '@/utils/csv';
import { withDefaultOnError } from '@/utils/defaults';

const delimiter = useStorage('csv-to-markdown-table:delimiter', ',');
const hasHeader = useStorage('csv-to-markdown-table:has-header', true);

const delimiterOptions = [
  { label: 'Comma (,)', value: ',' },
  { label: 'Semicolon (;)', value: ';' },
  { label: 'Tab', value: '\t' },
  { label: 'Pipe (|)', value: '|' },
];

const sampleCsv = 'name,role,team\nAlice,Developer,Platform\nBob,Designer,Product';

function transformer(value: string) {
  return withDefaultOnError(() => convertCsvToMarkdownTable(value, {
    delimiter: delimiter.value,
    hasHeader: hasHeader.value,
  }), '');
}

const rules: UseValidationRule<string>[] = [
  {
    validator: value => value === '' || parseCsv(value, { delimiter: delimiter.value }),
    message: 'Provided CSV is not valid.',
  },
];
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
    :input-validation-rules="rules"
    :transformer="transformer"
  />
</template>
