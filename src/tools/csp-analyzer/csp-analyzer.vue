<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import {
  analyzeCsp,
  type CspCheckStatus,
} from './csp-analyzer.service';
import type { UseValidationRule } from '../../composable/validation';
import { withDefaultOnError } from '../../utils/defaults';

const samplePolicy = `Content-Security-Policy: default-src 'self'; script-src 'nonce-abc123' 'strict-dynamic'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests; report-to csp-endpoint`;

const rawPolicy = useStorage('csp-analyzer:policy', samplePolicy);
const emptyAnalysis = analyzeCsp('');
const analysis = computed(() => withDefaultOnError(() => analyzeCsp(rawPolicy.value), emptyAnalysis));
const directiveRows = computed<Record<string, unknown>[]>(() => analysis.value.directives.map(({ name, values }) => ({
  name,
  values: values.length ? values.join(' ') : '(no value)',
})));
const checkRows = computed<Record<string, unknown>[]>(() => analysis.value.checks.map(check => ({
  ...check,
  value: check.value || '-',
})));

const rules: UseValidationRule<string>[] = [
  {
    validator: value => value.trim() === '' || analyzeCsp(value),
    message: 'Provided Content-Security-Policy is not valid.',
  },
];

function statusTagType(status: CspCheckStatus) {
  if (status === 'pass') {
    return 'success';
  }
  if (status === 'warning') {
    return 'warning';
  }
  return 'error';
}

const progressStatus = computed(() => {
  if (analysis.value.failed > 0) {
    return 'error';
  }
  if (analysis.value.warnings > 0) {
    return 'warning';
  }
  return 'success';
});
</script>

<template>
  <div flex flex-col gap-5>
    <c-input-text
      v-model:value="rawPolicy"
      label="Content-Security-Policy"
      placeholder="default-src 'self'; script-src 'nonce-...'; object-src 'none'"
      rows="9"
      multiline
      raw-text
      monospace
      autofocus
      :validation-rules="rules"
    />

    <div grid grid-cols-1 gap-3 md:grid-cols-4>
      <n-statistic label="Score" :value="`${analysis.score}/100`" />
      <n-statistic label="Grade" :value="analysis.grade" />
      <n-statistic label="Directives" :value="analysis.directives.length" />
      <n-statistic label="Failures" :value="analysis.failed" />
    </div>

    <c-card title="Policy score">
      <n-progress
        type="line"
        :percentage="analysis.score"
        :status="progressStatus"
        :indicator-placement="'inside'"
      />

      <div mt-4 flex flex-wrap gap-2>
        <n-tag type="success">
          {{ analysis.passed }} pass
        </n-tag>
        <n-tag type="warning">
          {{ analysis.warnings }} warning
        </n-tag>
        <n-tag type="error">
          {{ analysis.failed }} fail
        </n-tag>
      </div>
    </c-card>

    <c-table
      :data="checkRows"
      :headers="[
        { key: 'name', label: 'Check' },
        { key: 'status', label: 'Status' },
        { key: 'value', label: 'Value' },
        { key: 'summary', label: 'Result' },
        { key: 'recommendation', label: 'Recommendation' },
      ]"
      description="Content Security Policy checks"
    >
      <template #status="{ value }">
        <n-tag :type="statusTagType(value as CspCheckStatus)">
          {{ value }}
        </n-tag>
      </template>

      <template #value="{ value }">
        <span v-if="value === '-'" op-60>
          -
        </span>
        <span-copyable v-else :value="String(value)" />
      </template>
    </c-table>

    <c-table
      v-if="directiveRows.length"
      :data="directiveRows"
      :headers="[
        { key: 'name', label: 'Directive' },
        { key: 'values', label: 'Values' },
      ]"
      description="Parsed Content Security Policy directives"
    >
      <template #values="{ value }">
        <span-copyable :value="String(value)" />
      </template>
    </c-table>
  </div>
</template>
