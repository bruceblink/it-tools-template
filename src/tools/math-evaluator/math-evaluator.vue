<script setup lang="ts">
import { tryOnBeforeUnmount } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';

type MathTaskStatus = 'idle' | 'running' | 'invalid' | 'input-limit' | 'output-limit' | 'timeout' | 'error';

const expression = ref('');
const result = ref('');
const taskStatus = ref<MathTaskStatus>('idle');
const errorCode = ref<'limit' | 'invalid'>('invalid');
const { t } = useI18n();

const taskKey = 'math-evaluator:calculate';
let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;

const taskFeedback = computed(() => {
  if (taskStatus.value === 'invalid') {
    return errorCode.value === 'limit'
      ? t('tools.math-evaluator.calculationLimit')
      : t('tools.math-evaluator.invalidExpression');
  }
  if (taskStatus.value === 'input-limit' || taskStatus.value === 'output-limit') { return t('taskStatus.limit'); }
  if (taskStatus.value === 'timeout') { return t('taskStatus.timeout'); }
  if (taskStatus.value === 'error') { return t('taskStatus.error'); }
  return '';
});

watch(expression, () => {
  const version = ++taskVersion;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
  result.value = '';
  taskStatus.value = expression.value === '' ? 'idle' : 'running';
  if (expression.value === '') { return; }

  // Run math parsing and evaluation off the renderer thread, and discard results for replaced input.
  taskTimer = setTimeout(async () => {
    const outcome = await taskRunner.run(taskKey, version, {
      kind: 'math-evaluate',
      value: expression.value,
    }, taskLimits.mathEvaluator);
    if (version !== taskVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === 'math-evaluate') {
      result.value = outcome.result.output;
      taskStatus.value = outcome.result.valid ? 'idle' : 'invalid';
      errorCode.value = outcome.result.errorCode ?? 'invalid';
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
  <div>
    <c-input-text
      v-model:value="expression"
      rows="1"
      multiline
      placeholder="Your math expression (ex: 2*sqrt(6) )..."
      raw-text
      monospace
      autofocus
      autosize
      test-id="math-expression"
    />

    <div v-if="taskStatus === 'running'" mt-2 text-center op-70>
      {{ t('taskStatus.calculating') }}
    </div>
    <div v-else-if="taskFeedback" mt-2 role="alert" text-center text-red-500>
      {{ taskFeedback }}
    </div>

    <c-card v-if="result !== ''" title="Result " mt-5>
      <div data-test-id="math-result">
        {{ result }}
      </div>
    </c-card>
  </div>
</template>
