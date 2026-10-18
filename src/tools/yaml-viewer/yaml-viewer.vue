<script setup lang="ts">
import { tryOnBeforeUnmount, useStorage } from '@vueuse/core';
import TextareaCopyable from '@/components/TextareaCopyable.vue';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';
import CInputText from '@/ui/c-input-text/c-input-text.vue';

type YamlViewerTaskStatus = 'idle' | 'running' | 'invalid' | 'input-limit' | 'output-limit' | 'timeout' | 'error';

const inputElement = ref<InstanceType<typeof CInputText>>();
const rawYaml = ref('');
const indentSize = useStorage('yaml-prettify:indent-size', 2);
const sortKeys = useStorage('yaml-prettify:sort-keys', false);
const cleanYaml = ref('');
const taskStatus = ref<YamlViewerTaskStatus>('idle');
const { t } = useI18n();

const inputFeedback = computed(() => {
  if (taskStatus.value === 'invalid') { return 'Provided YAML is not valid.'; }
  if (taskStatus.value === 'input-limit' || taskStatus.value === 'output-limit') { return t('taskStatus.limit'); }
  if (taskStatus.value === 'timeout') { return t('taskStatus.timeout'); }
  if (taskStatus.value === 'error') { return t('taskStatus.error'); }
  return '';
});
const validationStatus = computed(() => inputFeedback.value ? 'error' : undefined);

const taskKey = 'yaml-viewer:format';
let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;

watch([rawYaml, indentSize, sortKeys], () => {
  const version = ++taskVersion;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
  cleanYaml.value = '';
  taskStatus.value = rawYaml.value === '' ? 'idle' : 'running';
  if (rawYaml.value === '') { return; }

  // Debounce edits and run YAML parsing, key sorting, and formatting outside the renderer thread.
  taskTimer = setTimeout(async () => {
    const outcome = await taskRunner.run(taskKey, version, {
      kind: 'yaml-viewer',
      value: rawYaml.value,
      sortKeys: sortKeys.value,
      indentSize: indentSize.value,
    }, taskLimits.yamlViewer);
    if (version !== taskVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === 'yaml-viewer') {
      cleanYaml.value = outcome.result.output;
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
        <n-input-number v-model:value="indentSize" min="1" max="10" style="width: 100px" />
      </n-form-item>
    </div>
  </div>

  <n-form-item
    label="Your raw YAML"
    :feedback="inputFeedback"
    :validation-status="validationStatus"
  >
    <CInputText
      ref="inputElement"
      v-model:value="rawYaml"
      placeholder="Paste your raw YAML here..."
      rows="20"
      multiline
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      spellcheck="false"
      monospace
      test-id="input"
    />
  </n-form-item>

  <n-form-item label="Prettified version of your YAML">
    <div v-if="taskStatus === 'running'" mb-2 text-center op-70>
      {{ t('taskStatus.calculating') }}
    </div>
    <TextareaCopyable :value="cleanYaml" language="yaml" :follow-height-of="inputElement?.inputWrapperRef" />
  </n-form-item>
</template>
