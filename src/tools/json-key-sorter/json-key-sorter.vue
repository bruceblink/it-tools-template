<script setup lang="ts">
import JSON5 from 'json5';
import { useStorage } from '@vueuse/core';
import { sortJsonText } from './json-key-sorter.service';
import type { UseValidationRule } from '@/composable/validation';
import { withDefaultOnError } from '@/utils/defaults';

const recursive = useStorage('json-key-sorter:recursive', true);
const descending = useStorage('json-key-sorter:descending', false);
const indentSize = useStorage('json-key-sorter:indent-size', 2);

const sampleJson = JSON.stringify({
  z: 1,
  a: {
    c: 3,
    b: 2,
  },
  items: [
    { name: 'Alice', id: 1 },
    { name: 'Bob', id: 2 },
  ],
}, null, 2);

function transformer(value: string) {
  return withDefaultOnError(() => sortJsonText(value, {
    recursive: recursive.value,
    descending: descending.value,
    indentSize: indentSize.value,
  }), '');
}

const rules: UseValidationRule<string>[] = [
  {
    validator: value => value === '' || JSON5.parse(value),
    message: 'Provided JSON is not valid.',
  },
];
</script>

<template>
  <div mb-4 grid grid-cols-1 gap-3 md:grid-cols-3>
    <n-form-item label="Recursive" label-placement="left" :show-feedback="false">
      <n-switch v-model:value="recursive" />
    </n-form-item>

    <n-form-item label="Descending" label-placement="left" :show-feedback="false">
      <n-switch v-model:value="descending" />
    </n-form-item>

    <n-form-item label="Indent size" label-placement="left" :show-feedback="false">
      <n-input-number v-model:value="indentSize" min="0" max="10" />
    </n-form-item>
  </div>

  <format-transformer
    input-label="Your JSON"
    :input-default="sampleJson"
    input-placeholder="Paste your JSON here..."
    output-label="Sorted JSON"
    output-language="json"
    :input-validation-rules="rules"
    :transformer="transformer"
  />
</template>
