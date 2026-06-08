<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import { convertCsvToJson } from './csv-to-json.service';
import type { UseValidationRule } from '@/composable/validation';
import { parseCsv } from '@/utils/csv';
import { withDefaultOnError } from '@/utils/defaults';

const delimiter = useStorage('csv-to-json:delimiter', ',');
const hasHeader = useStorage('csv-to-json:has-header', true);
const inferTypes = useStorage('csv-to-json:infer-types', false);

const delimiterOptions = [
  { label: 'Comma (,)', value: ',' },
  { label: 'Semicolon (;)', value: ';' },
  { label: 'Tab', value: '\t' },
  { label: 'Pipe (|)', value: '|' },
];

const sampleCsv = 'name,age,active\nAlice,30,true\nBob,25,false';

function transformer(value: string) {
  return withDefaultOnError(() => convertCsvToJson(value, {
    delimiter: delimiter.value,
    hasHeader: hasHeader.value,
    inferTypes: inferTypes.value,
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
  <div mb-4 grid grid-cols-1 gap-3 md:grid-cols-3>
    <c-select
      v-model:value="delimiter"
      label="Delimiter"
      :options="delimiterOptions"
    />

    <n-form-item label="First row is header" label-placement="left" :show-feedback="false">
      <n-switch v-model:value="hasHeader" />
    </n-form-item>

    <n-form-item label="Infer JSON values" label-placement="left" :show-feedback="false">
      <n-switch v-model:value="inferTypes" />
    </n-form-item>
  </div>

  <format-transformer
    input-label="Your CSV"
    :input-default="sampleCsv"
    input-placeholder="Paste your CSV here..."
    output-label="JSON output"
    output-language="json"
    :input-validation-rules="rules"
    :transformer="transformer"
  />
</template>
