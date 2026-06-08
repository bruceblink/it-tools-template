<script setup lang="ts">
import JSON5 from 'json5';
import { useStorage } from '@vueuse/core';
import { extractJsonPath, tokenizeJsonPath } from './json-path-extractor.service';
import { useValidation } from '@/composable/validation';
import TextareaCopyable from '@/components/TextareaCopyable.vue';
import { withDefaultOnError } from '@/utils/defaults';

const inputElement = ref<HTMLElement>();
const rawJson = useStorage('json-path-extractor:raw-json', JSON.stringify({
  users: [
    { name: 'Alice', active: true },
    { name: 'Bob', active: false },
  ],
  meta: {
    requestId: 'abc-123',
  },
}, null, 2));
const jsonPath = useStorage('json-path-extractor:path', '$.users[*].name');

const output = computed(() => withDefaultOnError(() => extractJsonPath(rawJson.value, jsonPath.value), ''));

const jsonValidation = useValidation({
  source: rawJson,
  rules: [
    {
      validator: value => value === '' || JSON5.parse(value),
      message: 'Provided JSON is not valid.',
    },
  ],
});

const pathValidation = useValidation({
  source: jsonPath,
  rules: [
    {
      validator: value => tokenizeJsonPath(value),
      message: 'Provided JSON path is not valid.',
    },
  ],
});
</script>

<template>
  <c-card>
    <c-input-text
      v-model:value="jsonPath"
      label="JSON path"
      placeholder="$.users[0].name"
      raw-text
      :validation="pathValidation"
      mb-4
    />

    <n-form-item
      label="Your JSON"
      :feedback="jsonValidation.message"
      :validation-status="jsonValidation.status"
    >
      <c-input-text
        ref="inputElement"
        v-model:value="rawJson"
        placeholder="Paste your JSON here..."
        rows="18"
        multiline
        raw-text
        monospace
      />
    </n-form-item>

    <n-form-item label="Extracted value">
      <TextareaCopyable :value="output" language="json" :follow-height-of="inputElement" />
    </n-form-item>
  </c-card>
</template>
