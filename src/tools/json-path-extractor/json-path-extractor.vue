<script setup lang="ts">
import { tryOnBeforeUnmount } from '@vueuse/core';
import { useValidation } from '@/composable/validation';
import TextareaCopyable from '@/components/TextareaCopyable.vue';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';
import CInputText from '@/ui/c-input-text/c-input-text.vue';
import { tokenizeJsonPath } from './json-path-extractor.service';

type JsonPathTaskStatus = 'idle' | 'running' | 'invalid-json' | 'input-limit' | 'output-limit' | 'timeout' | 'error';

const inputElement = ref<InstanceType<typeof CInputText>>();
const rawJson = ref(JSON.stringify({
  users: [
    { name: 'Alice', active: true },
    { name: 'Bob', active: false },
  ],
  meta: {
    requestId: 'abc-123',
  },
}, null, 2));
const jsonPath = ref('$.users[*].name');
const output = ref('');
const taskStatus = ref<JsonPathTaskStatus>('idle');
const pathValidation = useValidation({
  source: jsonPath,
  rules: [
    {
      validator: value => typeof value === 'string' && tokenizeJsonPath(value),
      message: 'Provided JSON path is not valid.',
    },
  ],
});
const { t } = useI18n();

const jsonFeedback = computed(() => {
  if (taskStatus.value === 'invalid-json') { return 'Provided JSON is not valid.'; }
  if (taskStatus.value === 'input-limit' || taskStatus.value === 'output-limit') { return t('taskStatus.limit'); }
  if (taskStatus.value === 'timeout') { return t('taskStatus.timeout'); }
  if (taskStatus.value === 'error') { return t('taskStatus.error'); }
  return '';
});
const jsonValidationStatus = computed(() => jsonFeedback.value ? 'error' : undefined);

const taskKey = 'json-path-extractor:extract';
let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;

watch([rawJson, jsonPath], () => {
  const version = ++taskVersion;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
  output.value = '';
  taskStatus.value = rawJson.value === '' || !pathValidation.isValid ? 'idle' : 'running';
  if (rawJson.value === '' || !pathValidation.isValid) { return; }

  // Debounce JSON edits and cancel stale work before parsing the current document in a worker.
  taskTimer = setTimeout(async () => {
    const outcome = await taskRunner.run(taskKey, version, {
      kind: 'json-path-extractor',
      value: rawJson.value,
      path: jsonPath.value,
    }, taskLimits.jsonPathExtractor);
    if (version !== taskVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === 'json-path-extractor') {
      output.value = outcome.result.output;
      taskStatus.value = outcome.result.valid ? 'idle' : 'invalid-json';
      return;
    }
    if (outcome.status === 'cancelled') { return; }
    taskStatus.value = outcome.status === 'success' ? 'error' : outcome.status;
  }, 150);
}, { immediate: true });

tryOnBeforeUnmount(() => {
  taskVersion++;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
});
</script>

<template>
  <c-card>
    <CInputText
      v-model:value="jsonPath"
      label="JSON path"
      placeholder="$.users[0].name"
      raw-text
      :validation="pathValidation"
      test-id="path"
      mb-4
    />

    <n-form-item
      label="Your JSON"
      :feedback="jsonFeedback"
      :validation-status="jsonValidationStatus"
    >
      <CInputText
        ref="inputElement"
        v-model:value="rawJson"
        placeholder="Paste your JSON here..."
        rows="18"
        multiline
        raw-text
        monospace
        test-id="input"
      />
    </n-form-item>

    <n-form-item label="Extracted value">
      <div v-if="taskStatus === 'running'" mb-2 text-center op-70>
        {{ t('taskStatus.calculating') }}
      </div>
      <TextareaCopyable :value="output" language="json" :follow-height-of="inputElement?.inputWrapperRef" />
    </n-form-item>
  </c-card>
</template>
