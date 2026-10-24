<script setup lang="ts">
import { tryOnBeforeUnmount } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import TextareaCopyable from '@/components/TextareaCopyable.vue';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';
import { sanitizeHtmlForRender } from '@/utils/sanitizeHtml';

const inputMarkdown = ref('');
const outputHtml = ref('');
const taskStatus = ref<'idle' | 'running' | 'limit' | 'timeout' | 'error'>('idle');
const { t } = useI18n();

const taskKey = 'markdown-to-html:render';
let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;

watch(inputMarkdown, () => {
  const version = ++taskVersion;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
  outputHtml.value = '';
  taskStatus.value = inputMarkdown.value === '' ? 'idle' : 'running';
  if (inputMarkdown.value === '') { return; }

  // Replace stale renders and keep parsing work away from the page thread.
  taskTimer = setTimeout(async () => {
    const outcome = await taskRunner.run(taskKey, version, {
      kind: 'markdown-render',
      value: inputMarkdown.value,
    }, taskLimits.markdownRender);
    if (version !== taskVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === 'markdown-render') {
      outputHtml.value = outcome.result.output;
      taskStatus.value = 'idle';
      return;
    }
    if (outcome.status === 'cancelled') { return; }
    if (outcome.status === 'success') {
      taskStatus.value = 'error';
      return;
    }
    taskStatus.value = outcome.status === 'input-limit' || outcome.status === 'output-limit'
      ? 'limit'
      : outcome.status;
  }, 150);
}, { immediate: true });

const taskFeedback = computed(() => {
  if (taskStatus.value === 'limit') { return t('taskStatus.limit'); }
  if (taskStatus.value === 'timeout') { return t('taskStatus.timeout'); }
  if (taskStatus.value === 'error') { return t('taskStatus.error'); }
  return '';
});

tryOnBeforeUnmount(() => {
  taskVersion++;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
});

// Isolate the printable document and sanitize only its DOM; copied HTML stays unchanged.
function printHtml() {
  const w = window.open('', '_blank');
  if (w === null) {
    return;
  }
  w.opener = null;
  w.document.body.innerHTML = sanitizeHtmlForRender(outputHtml.value);
  w.print();
}
</script>

<template>
  <div>
    <c-input-text
      v-model:value="inputMarkdown"
      multiline
      raw-text
      placeholder="Your Markdown content..."
      rows="8"
      autofocus
      label="Your Markdown to convert:"
      test-id="markdown-input"
    />

    <div v-if="taskStatus === 'running'" mt-2 text-center op-70>
      {{ t('taskStatus.calculating') }}
    </div>
    <div v-else-if="taskFeedback" mt-2 role="alert" text-center text-red-500>
      {{ taskFeedback }}
    </div>

    <n-divider />

    <n-form-item label="Output HTML:">
      <TextareaCopyable :value="outputHtml" :word-wrap="true" language="html" />
    </n-form-item>

    <div flex justify-center>
      <n-button :disabled="taskStatus === 'running'" @click="printHtml"> Print as PDF </n-button>
    </div>
  </div>
</template>
