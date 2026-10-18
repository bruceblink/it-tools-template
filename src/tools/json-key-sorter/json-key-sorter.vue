<script setup lang="ts">
import { useStorage } from '@vueuse/core';

const recursive = useStorage('json-key-sorter:recursive', true);
const descending = useStorage('json-key-sorter:descending', false);
const indentSize = useStorage('json-key-sorter:indent-size', 2);
const workerTaskOptions = computed(() => ({
  recursive: recursive.value,
  descending: descending.value,
  indentSize: indentSize.value,
}));

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
    worker-task-kind="json-key-sorter"
    :worker-task-options="workerTaskOptions"
    worker-invalid-message="Provided JSON is not valid."
  />
</template>
