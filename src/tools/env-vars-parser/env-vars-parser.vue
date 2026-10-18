<script setup lang="ts">
import { tryOnBeforeUnmount, useStorage } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { useValidation, type UseValidationRule } from '@/composable/validation';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';
import {
  parseEnvVars,
  type EnvDiagnosticSeverity,
  type EnvOutputFormat,
  type EnvParseResult,
} from './env-vars-parser.service';

type EnvVarsTaskStatus = 'idle' | 'running' | 'invalid' | 'input-limit' | 'output-limit' | 'timeout' | 'error';

const sampleEnv = [
  '# Application',
  'APP_ENV=production',
  'APP_NAME="IT Tools"',
  'API_URL=https://example.com/api',
  '',
  '# Database',
  'DATABASE_URL=postgres://user:pass@localhost:5432/app',
  'EMPTY_VALUE=',
  'export FEATURE_FLAG=true',
].join('\n');

const outputFormatOptions: { label: string, value: EnvOutputFormat }[] = [
  { label: 'JSON', value: 'json' },
  { label: '.env', value: 'dotenv' },
  { label: 'Shell', value: 'shell' },
  { label: 'Compose', value: 'docker-compose' },
];

const { t } = useI18n();
const rawEnv = ref(sampleEnv);
const outputFormat = useStorage<EnvOutputFormat>('env-vars-parser:output-format', 'json');
const emptyResult = parseEnvVars('');
const result = ref<EnvParseResult>(emptyResult);
const output = ref('');
const taskStatus = ref<EnvVarsTaskStatus>('idle');
const outputLanguage = computed(() => outputFormat.value === 'json'
  ? 'json'
  : outputFormat.value === 'docker-compose' ? 'yaml' : 'bash');

const taskKey = 'env-vars-parser:parse';
let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;
let lastInput: string | undefined;

const inputFeedback = computed(() => {
  if (taskStatus.value === 'invalid') { return 'Provided environment variables contain syntax errors.'; }
  if (taskStatus.value === 'input-limit' || taskStatus.value === 'output-limit') { return t('taskStatus.limit'); }
  if (taskStatus.value === 'timeout') { return t('taskStatus.timeout'); }
  if (taskStatus.value === 'error') { return t('taskStatus.error'); }
  return '';
});

const validationRules: UseValidationRule<string>[] = [{
  validator: () => inputFeedback.value === '',
  getErrorMessage: () => inputFeedback.value,
  message: '{0}',
}];
const validation = useValidation({ source: rawEnv, rules: validationRules, watch: [taskStatus] });

const variableRows = computed<Record<string, unknown>[]>(() => result.value.variables.map(variable => ({
  line: variable.line,
  key: variable.key,
  value: variable.value,
  quoted: variable.quoted ? 'yes' : 'no',
  exported: variable.exported ? 'yes' : 'no',
  warnings: variable.warnings.join('\n') || '-',
})));

const diagnosticRows = computed<Record<string, unknown>[]>(() => result.value.diagnostics.map(diagnostic => ({
  line: diagnostic.line,
  severity: diagnostic.severity,
  message: diagnostic.message,
})));

function diagnosticTagType(severity: EnvDiagnosticSeverity) {
  return severity === 'error' ? 'error' : 'warning';
}

watch([rawEnv, outputFormat], ([value, format]) => {
  const inputChanged = value !== lastInput;
  lastInput = value;
  const version = ++taskVersion;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
  output.value = '';
  if (inputChanged) { result.value = emptyResult; }
  taskStatus.value = value === '' ? 'idle' : 'running';
  if (value === '') { return; }

  // Parse once in a bounded worker and discard results from earlier input or output choices.
  taskTimer = setTimeout(async () => {
    const outcome = await taskRunner.run(taskKey, version, {
      kind: 'env-vars-parser',
      value,
      outputFormat: format,
    }, taskLimits.envVarsParser);
    if (version !== taskVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === 'env-vars-parser') {
      result.value = outcome.result.result;
      output.value = outcome.result.output;
      taskStatus.value = outcome.result.result.summary.errorCount > 0 ? 'invalid' : 'idle';
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
  <div flex flex-col gap-5>
    <c-input-text
      v-model:value="rawEnv"
      label="Environment variables"
      placeholder="Paste .env variables here..."
      rows="11"
      multiline
      raw-text
      monospace
      autofocus
      test-id="env-input"
      :validation="validation"
    />

    <div v-if="taskStatus === 'running'" text-center op-70>
      {{ t('taskStatus.calculating') }}
    </div>

    <div grid grid-cols-1 gap-3 md:grid-cols-5>
      <n-statistic label="Variables" :value="result.summary.totalVariables" />
      <n-statistic label="Warnings" :value="result.summary.warningCount" />
      <n-statistic label="Errors" :value="result.summary.errorCount" />
      <n-statistic label="Duplicate keys" :value="result.summary.duplicateKeys.length ? result.summary.duplicateKeys.join(', ') : '-'" />
      <n-statistic label="Empty values" :value="result.summary.emptyValues.length ? result.summary.emptyValues.join(', ') : '-'" />
    </div>

    <div>
      <c-buttons-select
        v-model:value="outputFormat"
        :options="outputFormatOptions"
        label="Output"
        label-width="75px"
        mb-3
      />
      <textarea-copyable :value="output" :language="outputLanguage" />
    </div>

    <c-table
      v-if="variableRows.length"
      :data="variableRows"
      :headers="[
        { key: 'line', label: 'Line' },
        { key: 'key', label: 'Key' },
        { key: 'value', label: 'Value' },
        { key: 'quoted', label: 'Quoted' },
        { key: 'exported', label: 'Exported' },
        { key: 'warnings', label: 'Warnings' },
      ]"
      description="Parsed environment variables"
    >
      <template #key="{ value }">
        <span-copyable :value="String(value)" />
      </template>
      <template #value="{ value }">
        <span-copyable :value="String(value)" />
      </template>
      <template #warnings="{ value }">
        <span v-if="value === '-'" op-60>
          -
        </span>
        <div v-else flex flex-col gap-1>
          <n-tag v-for="warning in String(value).split('\n')" :key="warning" type="warning">
            {{ warning }}
          </n-tag>
        </div>
      </template>
    </c-table>

    <c-table
      v-if="diagnosticRows.length"
      :data="diagnosticRows"
      :headers="[
        { key: 'line', label: 'Line' },
        { key: 'severity', label: 'Severity' },
        { key: 'message', label: 'Message' },
      ]"
      description="Diagnostics"
    >
      <template #severity="{ value }">
        <n-tag :type="diagnosticTagType(value as EnvDiagnosticSeverity)">
          {{ value }}
        </n-tag>
      </template>
    </c-table>
  </div>
</template>
