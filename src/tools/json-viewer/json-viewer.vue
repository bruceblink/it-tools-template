<script setup lang="ts">
import { tryOnBeforeUnmount } from '@vueuse/core';
import { useStorage } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import TextareaCopyable from '@/components/TextareaCopyable.vue';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';
import CInputText from '@/ui/c-input-text/c-input-text.vue';

type JsonViewerStatus = 'idle' | 'running' | 'invalid' | 'input-limit' | 'output-limit' | 'timeout' | 'error';

const inputElement = ref<InstanceType<typeof CInputText>>();
const rawJson = ref('{"hello": "world", "foo": "bar"}');
const indentSize = useStorage('json-prettify:indent-size', 3);
const sortKeys = useStorage('json-prettify:sort-keys', true);
const cleanJson = ref('');
const taskStatus = ref<JsonViewerStatus>('idle');
const { t } = useI18n();

const taskKey = 'json-viewer:format';
let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;

const inputFeedback = computed(() => {
  if (taskStatus.value === 'invalid') { return 'Provided JSON is not valid.'; }
  if (taskStatus.value === 'input-limit' || taskStatus.value === 'output-limit') { return t('taskStatus.limit'); }
  if (taskStatus.value === 'timeout') { return t('taskStatus.timeout'); }
  if (taskStatus.value === 'error') { return t('taskStatus.error'); }
  return '';
});

const validationStatus = computed(() => inputFeedback.value ? 'error' : undefined);

watch([rawJson, indentSize, sortKeys], () => {
  const version = ++taskVersion;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
  cleanJson.value = '';
  taskStatus.value = rawJson.value === '' ? 'idle' : 'running';
  if (rawJson.value === '') { return; }

  // Debounce edits, cancel the previous worker, and ignore any result from an older input version.
  taskTimer = setTimeout(async () => {
    const outcome = await taskRunner.run(taskKey, version, {
      kind: 'json-viewer',
      value: rawJson.value,
      sortKeys: sortKeys.value,
      indentSize: indentSize.value,
    }, taskLimits.jsonViewer);
    if (version !== taskVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === 'json-viewer') {
      cleanJson.value = outcome.result.output;
      taskStatus.value = outcome.result.valid ? 'idle' : 'invalid';
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
  <div style="flex: 0 0 100%">
    <div style="margin: 0 auto; max-width: 600px" flex justify-center gap-3>
      <n-form-item label="Sort keys :" label-placement="left" label-width="100">
        <n-switch v-model:value="sortKeys" />
      </n-form-item>
      <n-form-item label="Indent size :" label-placement="left" label-width="100" :show-feedback="false">
        <n-input-number v-model:value="indentSize" min="0" max="10" style="width: 100px" />
      </n-form-item>
    </div>
  </div>

  <n-form-item
    label="Your raw JSON"
    :feedback="inputFeedback"
    :validation-status="validationStatus"
  >
    <CInputText
      ref="inputElement"
      v-model:value="rawJson"
      placeholder="Paste your raw JSON here..."
      rows="20"
      multiline
      autosize
      :autosize-max-height="600"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      spellcheck="false"
      monospace
      test-id="input"
    />
  </n-form-item>
  <n-form-item label="Prettified version of your JSON">
    <div v-if="taskStatus === 'running'" mb-2 text-center op-70>
      {{ t('taskStatus.calculating') }}
    </div>
    <TextareaCopyable :value="cleanJson" language="json" :follow-height-of="inputElement?.inputWrapperRef" />
  </n-form-item>
</template>
