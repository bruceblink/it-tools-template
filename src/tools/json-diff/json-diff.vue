<script setup lang="ts">
import { tryOnBeforeUnmount } from '@vueuse/core';
import DiffsViewer from './diff-viewer/diff-viewer.vue';
import type { Difference } from './json-diff.types';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';
import CInputText from '@/ui/c-input-text/c-input-text.vue';

type JsonDiffTaskStatus = 'idle' | 'running' | 'input-limit' | 'output-limit' | 'timeout' | 'error';

const leftJson = ref('');
const rightJson = ref('');
const onlyShowDifferences = ref(false);
const leftJsonValid = ref(true);
const rightJsonValid = ref(true);
const diffResult = shallowRef<Difference>();
const taskStatus = ref<JsonDiffTaskStatus>('idle');
const { t } = useI18n();

const leftFeedback = computed(() => leftJsonValid.value ? '' : 'Invalid JSON format');
const rightFeedback = computed(() => rightJsonValid.value ? '' : 'Invalid JSON format');
const leftValidationStatus = computed(() => leftFeedback.value ? 'error' : undefined);
const rightValidationStatus = computed(() => rightFeedback.value ? 'error' : undefined);
const taskMessage = computed(() => {
  if (taskStatus.value === 'input-limit' || taskStatus.value === 'output-limit') { return t('taskStatus.limit'); }
  if (taskStatus.value === 'timeout') { return t('taskStatus.timeout'); }
  if (taskStatus.value === 'error') { return t('taskStatus.error'); }
  return '';
});
const showDiffControls = computed(() => leftJson.value !== '' && rightJson.value !== '' && leftJsonValid.value && rightJsonValid.value);

const taskKey = 'json-diff:compare';
let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;

watch([leftJson, rightJson, onlyShowDifferences], () => {
  const version = ++taskVersion;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
  diffResult.value = undefined;
  leftJsonValid.value = true;
  rightJsonValid.value = true;
  taskStatus.value = leftJson.value === '' || rightJson.value === '' ? 'idle' : 'running';
  if (leftJson.value === '' || rightJson.value === '') { return; }

  // Recompute large diffs off the renderer thread and ignore any result from an older input version.
  taskTimer = setTimeout(async () => {
    const outcome = await taskRunner.run(taskKey, version, {
      kind: 'json-diff',
      leftValue: leftJson.value,
      rightValue: rightJson.value,
      onlyShowDifferences: onlyShowDifferences.value,
    }, taskLimits.jsonDiff);
    if (version !== taskVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === 'json-diff') {
      leftJsonValid.value = outcome.result.leftValid;
      rightJsonValid.value = outcome.result.rightValid;
      diffResult.value = outcome.result.result;
      taskStatus.value = 'idle';
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
  <n-form-item
    label="Your first JSON"
    :feedback="leftFeedback"
    :validation-status="leftValidationStatus"
  >
    <CInputText
      v-model:value="leftJson"
      placeholder="Paste your first JSON here..."
      rows="20"
      multiline
      test-id="leftJson"
      raw-text
      monospace
    />
  </n-form-item>

  <n-form-item
    label="Your JSON to compare"
    :feedback="rightFeedback"
    :validation-status="rightValidationStatus"
  >
    <CInputText
      v-model:value="rightJson"
      placeholder="Paste your JSON to compare here..."
      rows="20"
      multiline
      test-id="rightJson"
      raw-text
      monospace
    />
  </n-form-item>

  <div v-if="showDiffControls" flex justify-center>
    <n-form-item label="Only show differences" label-placement="left">
      <n-switch v-model:value="onlyShowDifferences" />
    </n-form-item>
  </div>

  <div v-if="taskStatus === 'running'" mb-2 text-center op-70>
    {{ t('taskStatus.calculating') }}
  </div>
  <c-alert v-else-if="taskMessage" mb-2>
    {{ taskMessage }}
  </c-alert>

  <DiffsViewer
    v-if="diffResult"
    :diff="diffResult"
    :json-are-the-same="diffResult.status === 'unchanged'"
  />
</template>
