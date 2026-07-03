<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import {
  formatEnvVars,
  parseEnvVars,
  type EnvDiagnosticSeverity,
  type EnvOutputFormat,
} from './env-vars-parser.service';
import type { UseValidationRule } from '@/composable/validation';
import { withDefaultOnError } from '@/utils/defaults';

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

const rawEnv = useStorage('env-vars-parser:env', sampleEnv);
const outputFormat = useStorage<EnvOutputFormat>('env-vars-parser:output-format', 'json');
const emptyResult = parseEnvVars('');
const result = computed(() => withDefaultOnError(() => parseEnvVars(rawEnv.value), emptyResult));
const output = computed(() => withDefaultOnError(() => formatEnvVars(rawEnv.value, outputFormat.value), ''));
const outputLanguage = computed(() => {
  if (outputFormat.value === 'json') {
    return 'json';
  }
  if (outputFormat.value === 'docker-compose') {
    return 'yaml';
  }
  return 'bash';
});

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

const rules: UseValidationRule<string>[] = [
  {
    validator: value => parseEnvVars(value).summary.errorCount === 0,
    message: 'Provided environment variables contain syntax errors.',
  },
];

function diagnosticTagType(severity: EnvDiagnosticSeverity) {
  return severity === 'error' ? 'error' : 'warning';
}
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
      :validation-rules="rules"
    />

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
