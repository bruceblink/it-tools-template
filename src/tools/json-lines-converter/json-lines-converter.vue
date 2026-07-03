<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import type { JsonLinesDirection } from './json-lines-converter.service';
import { convertJsonLines } from './json-lines-converter.service';
import type { UseValidationRule } from '@/composable/validation';
import { withDefaultOnError } from '@/utils/defaults';

const direction = useStorage<JsonLinesDirection>('json-lines-converter:direction', 'jsonl-to-json');
const indentSize = useStorage('json-lines-converter:indent-size', 2);
const ignoreEmptyLines = useStorage('json-lines-converter:ignore-empty-lines', true);

const directionOptions: Array<{ label: string; value: JsonLinesDirection }> = [
  { label: 'JSON Lines to JSON array', value: 'jsonl-to-json' },
  { label: 'JSON array/object to JSON Lines', value: 'json-to-jsonl' },
];

const sampleJsonLines = '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}';
const sampleJson = JSON.stringify([
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
], null, 2);

const inputDefault = computed(() => direction.value === 'jsonl-to-json' ? sampleJsonLines : sampleJson);
const outputLanguage = computed(() => direction.value === 'jsonl-to-json' ? 'json' : 'txt');
const inputLabel = computed(() => direction.value === 'jsonl-to-json' ? 'Your JSON Lines' : 'Your JSON');
const outputLabel = computed(() => direction.value === 'jsonl-to-json' ? 'JSON array' : 'JSON Lines');
const inputPlaceholder = computed(() =>
  direction.value === 'jsonl-to-json'
    ? 'Paste one JSON value per line...'
    : 'Paste a JSON array or object here...',
);

function transformer(value: string) {
  return withDefaultOnError(() => convertJsonLines(value, direction.value, {
    ignoreEmptyLines: ignoreEmptyLines.value,
    indentSize: indentSize.value,
  }), '');
}

function validateJsonLines(value: string) {
  if (value === '') {
    return true;
  }

  convertJsonLines(value, direction.value, {
    ignoreEmptyLines: ignoreEmptyLines.value,
    indentSize: indentSize.value,
  });

  return true;
}

const rules: UseValidationRule<string>[] = [
  {
    validator: validateJsonLines,
    message: 'Provided input is not valid for the selected conversion: {0}',
    getErrorMessage: (value) => {
      try {
        validateJsonLines(value);
        return '';
      }
      catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  },
];
</script>

<template>
  <div mb-4 grid grid-cols-1 gap-3 md:grid-cols-3>
    <c-select
      v-model:value="direction"
      label="Conversion"
      :options="directionOptions"
    />

    <n-form-item label="Indent size" label-placement="left" :show-feedback="false">
      <n-input-number v-model:value="indentSize" min="0" max="10" :disabled="direction === 'json-to-jsonl'" />
    </n-form-item>

    <n-form-item label="Ignore empty lines" label-placement="left" :show-feedback="false">
      <n-switch v-model:value="ignoreEmptyLines" :disabled="direction === 'json-to-jsonl'" />
    </n-form-item>
  </div>

  <format-transformer
    :key="direction"
    :input-label="inputLabel"
    :input-default="inputDefault"
    :input-placeholder="inputPlaceholder"
    :output-label="outputLabel"
    :output-language="outputLanguage"
    :input-validation-rules="rules"
    :transformer="transformer"
  />
</template>
