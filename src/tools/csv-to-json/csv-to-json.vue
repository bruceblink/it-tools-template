<script setup lang="ts">
import { useStorage } from '@vueuse/core';

const delimiter = useStorage('csv-to-json:delimiter', ',');
const hasHeader = useStorage('csv-to-json:has-header', true);
const inferTypes = useStorage('csv-to-json:infer-types', false);
const expandDotNotation = useStorage('csv-to-json:expand-dot-notation', false);

const delimiterOptions = [
  { label: 'Comma (,)', value: ',' },
  { label: 'Semicolon (;)', value: ';' },
  { label: 'Tab', value: '\t' },
  { label: 'Pipe (|)', value: '|' },
];

const sampleCsv = 'name,age,active\nAlice,30,true\nBob,25,false';

const workerTaskOptions = computed(() => ({
  delimiter: delimiter.value,
  expandDotNotation: expandDotNotation.value,
  hasHeader: hasHeader.value,
  inferTypes: inferTypes.value,
}));
</script>

<template>
  <div mb-4 grid grid-cols-1 gap-3 md:grid-cols-4>
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

    <n-form-item label="Expand dotted headers" label-placement="left" :show-feedback="false">
      <n-switch v-model:value="expandDotNotation" />
    </n-form-item>
  </div>

  <format-transformer
    input-label="Your CSV"
    :input-default="sampleCsv"
    input-placeholder="Paste your CSV here..."
    output-label="JSON output"
    output-language="json"
    worker-task-kind="csv-to-json"
    :worker-task-options="workerTaskOptions"
  />
</template>
