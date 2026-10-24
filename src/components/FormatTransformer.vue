<script setup lang="ts">
import _ from 'lodash';
import { tryOnBeforeUnmount } from '@vueuse/core';
import type { UseValidationRule } from '@/composable/validation';
import CInputText from '@/ui/c-input-text/c-input-text.vue';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';
import { useI18n } from 'vue-i18n';
import type { CsvToJsonOptions } from '@/tools/csv-to-json/csv-to-json.service';
import type { CsvToMarkdownTableOptions } from '@/tools/csv-to-markdown-table/csv-to-markdown-table.service';
import type { JsonKeySorterOptions } from '@/tools/json-key-sorter/json-key-sorter.service';
import type { JsonLinesSummary } from '@/tools/json-lines-converter/json-lines-converter.service';
import { createDefaultConvertOptions, type ConvertOptions } from '@/tools/list-converter/list-converter.types';
import type { JsonLinesTaskOptions, WorkerTask, XmlFormatTaskOptions } from '@/task-runner/task-runner.types';

const props = withDefaults(
  defineProps<{
    transformer?: (v: string) => string
    inputValidationRules?: UseValidationRule<string>[]
    inputLabel?: string
    inputPlaceholder?: string
    inputDefault?: string
    outputLabel?: string
    outputLanguage?: string
    workerTaskKind?: 'list-convert' | 'json-key-sorter' | 'json-minify' | 'csv-to-json' | 'csv-to-markdown' | 'json-to-csv' | 'json-lines' | 'xml-format' | 'xml-to-json' | 'json-to-xml' | 'yaml-to-json' | 'toml-to-json' | 'json-to-yaml' | 'toml-to-yaml' | 'json-to-toml' | 'yaml-to-toml'
    workerTaskOptions?: ConvertOptions | CsvToJsonOptions | CsvToMarkdownTableOptions | JsonKeySorterOptions | JsonLinesTaskOptions | XmlFormatTaskOptions
    workerInvalidMessage?: string
  }>(),
  {
    transformer: _.identity,
    inputValidationRules: () => [],
    inputLabel: 'Input',
    inputDefault: '',
    inputPlaceholder: 'Input...',
    outputLabel: 'Output',
    outputLanguage: '',
    workerTaskKind: undefined,
    workerTaskOptions: undefined,
    workerInvalidMessage: undefined,
  },
);

const { transformer, inputValidationRules, inputLabel, outputLabel, outputLanguage, inputPlaceholder, inputDefault, workerTaskKind, workerTaskOptions, workerInvalidMessage }
  = toRefs(props);
const { t } = useI18n();

const inputElement = ref<typeof CInputText>();

const input = ref(inputDefault.value);
const workerOutput = ref('');
const workerSummary = shallowRef<JsonLinesSummary | null>(null);
const workerErrorMessage = ref('');
const taskStatus = ref<'idle' | 'running' | 'input-limit' | 'output-limit' | 'timeout' | 'error'>('idle');
const synchronousOutput = computed(() => transformer.value(input.value));
const output = computed(() => workerTaskKind.value ? workerOutput.value : synchronousOutput.value);
const taskMessage = computed(() => {
  if (taskStatus.value === 'running') { return t('taskStatus.calculating'); }
  if (taskStatus.value === 'input-limit' || taskStatus.value === 'output-limit') { return t('taskStatus.limit'); }
  if (taskStatus.value === 'timeout') { return t('taskStatus.timeout'); }
  if (taskStatus.value === 'error') { return workerErrorMessage.value || workerInvalidMessage.value || t('taskStatus.error'); }
  return '';
});

let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;

watch([input, workerTaskKind, workerTaskOptions], () => {
  const kind = workerTaskKind.value;
  if (!kind) { return; }
  const version = ++taskVersion;
  if (taskTimer) { clearTimeout(taskTimer); }
  const taskKey = `format-transformer:${kind}`;
  taskRunner.cancel(taskKey);
  workerOutput.value = '';
  workerSummary.value = null;
  workerErrorMessage.value = '';
  taskStatus.value = input.value === '' ? 'idle' : 'running';
  if (input.value === '') { return; }

  taskTimer = setTimeout(async () => {
    if (kind === 'list-convert') {
      const listTask = {
        kind,
        value: input.value,
        options: workerTaskOptions.value as ConvertOptions | undefined ?? createDefaultConvertOptions(),
      };
      const outcome = await taskRunner.run(taskKey, version, listTask, taskLimits.listConverter);
      if (version !== taskVersion) { return; }
      if (outcome.status === 'success' && outcome.result.kind === 'list-convert') {
        workerOutput.value = outcome.result.output;
        taskStatus.value = outcome.result.valid ? 'idle' : 'error';
        return;
      }
      if (outcome.status === 'cancelled') { return; }
      taskStatus.value = outcome.status === 'success' ? 'error' : outcome.status;
      return;
    }

    const task = (() => {
      if (kind === 'json-key-sorter') {
        return { kind, value: input.value, options: workerTaskOptions.value as JsonKeySorterOptions | undefined ?? {} };
      }
      if (kind === 'json-minify') {
        return { kind, value: input.value };
      }
      if (kind === 'csv-to-json') {
        return { kind, value: input.value, options: workerTaskOptions.value as CsvToJsonOptions | undefined ?? {} };
      }
      if (kind === 'csv-to-markdown') {
        return { kind, value: input.value, options: workerTaskOptions.value as CsvToMarkdownTableOptions | undefined ?? {} };
      }
      if (kind === 'json-to-csv') {
        return { kind, value: input.value };
      }
      if (kind === 'json-lines') {
        const options = workerTaskOptions.value as JsonLinesTaskOptions | undefined;
        return {
          kind,
          value: input.value,
          direction: options?.direction ?? 'jsonl-to-json',
          options: options ?? { direction: 'jsonl-to-json' },
        };
      }
      if (kind === 'xml-format') {
        return { kind, value: input.value, options: workerTaskOptions.value as XmlFormatTaskOptions ?? { indentSize: 2, collapseContent: true } };
      }
      return { kind, value: input.value };
    })() as Extract<WorkerTask, { kind: 'json-key-sorter' | 'json-minify' | 'csv-to-json' | 'csv-to-markdown' | 'json-to-csv' | 'json-lines' | 'xml-format' | 'xml-to-json' | 'json-to-xml' | 'yaml-to-json' | 'json-to-yaml' | 'toml-to-json' | 'toml-to-yaml' | 'json-to-toml' | 'yaml-to-toml' }>;
    const limits = kind.includes('toml')
      ? taskLimits.tomlConversion
      : kind === 'json-key-sorter'
        ? taskLimits.jsonKeySorter
      : kind === 'json-minify'
      ? taskLimits.jsonMinify
      : kind === 'csv-to-json'
        ? taskLimits.csvToJson
        : kind === 'csv-to-markdown'
          ? taskLimits.csvToMarkdown
        : kind === 'json-to-csv'
          ? taskLimits.jsonToCsv
            : kind === 'json-lines'
              ? taskLimits.jsonLines
              : taskLimits.formatConversion;
    const outcome = await taskRunner.run(taskKey, version, task, limits);
    if (version !== taskVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === kind) {
      workerOutput.value = outcome.result.output;
      workerSummary.value = outcome.result.kind === 'json-lines' ? outcome.result.summary : null;
      workerErrorMessage.value = outcome.result.valid ? '' : outcome.result.errorMessage ?? workerInvalidMessage.value ?? '';
      taskStatus.value = outcome.result.valid ? 'idle' : 'error';
      return;
    }
    if (outcome.status === 'cancelled') { return; }
    taskStatus.value = outcome.status === 'success' ? 'error' : outcome.status;
  }, 150);
}, { immediate: true });

tryOnBeforeUnmount(() => {
  taskVersion++;
  if (taskTimer) { clearTimeout(taskTimer); }
  if (workerTaskKind.value) { taskRunner.cancel(`format-transformer:${workerTaskKind.value}`); }
});
</script>

<template>
  <CInputText
    ref="inputElement"
    v-model:value="input"
    :placeholder="inputPlaceholder"
    :label="inputLabel"
    rows="20"
    autosize
    :autosize-max-height="600"
    raw-text
    multiline
    test-id="input"
    :validation-rules="inputValidationRules"
    monospace
  />

  <slot name="extra" :input="input" :output="output" :summary="workerSummary" />

  <div overflow-auto>
    <div mb-5px>
      {{ outputLabel }}
    </div>
    <div v-if="workerTaskKind && taskStatus === 'running'" mb-2 text-center op-70 data-test-id="format-transformer-task-status">
      {{ taskMessage }}
    </div>
    <c-alert v-else-if="workerTaskKind && taskStatus !== 'idle'" mb-2 data-test-id="format-transformer-task-status">
      {{ taskMessage }}
    </c-alert>
    <textarea-copyable :value="output" :language="outputLanguage" :follow-height-of="inputElement?.inputWrapperRef" />
  </div>
</template>
