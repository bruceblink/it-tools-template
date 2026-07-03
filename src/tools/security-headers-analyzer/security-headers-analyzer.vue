<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import {
  analyzeSecurityHeaders,
  type SecurityHeaderStatus,
} from './security-headers-analyzer.service';
import type { UseValidationRule } from '../../composable/validation';
import { withDefaultOnError } from '../../utils/defaults';

const sampleHeaders = `HTTP/2 200
strict-transport-security: max-age=31536000; includeSubDomains
content-security-policy: default-src 'self'; object-src 'none'; frame-ancestors 'none'
x-content-type-options: nosniff
x-frame-options: DENY
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(), microphone=(), geolocation=()
cross-origin-opener-policy: same-origin
cross-origin-embedder-policy: require-corp
cross-origin-resource-policy: same-origin`;

const rawHeaders = useStorage('security-headers-analyzer:headers', sampleHeaders);
const emptyAnalysis = analyzeSecurityHeaders('');
const analysis = computed(() =>
  withDefaultOnError(() => analyzeSecurityHeaders(rawHeaders.value), emptyAnalysis),
);
const rows = computed(() => analysis.value.checks.map(check => ({
  ...check,
  value: check.value || 'Missing',
})));

const rules: UseValidationRule<string>[] = [
  {
    validator: value => value.trim() === '' || analyzeSecurityHeaders(value),
    message: 'Provided HTTP headers are not valid.',
  },
];

function statusTagType(status: SecurityHeaderStatus) {
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
      v-model:value="rawHeaders"
      label="HTTP response headers"
      placeholder="Paste HTTP response headers..."
      rows="11"
      multiline
      raw-text
      monospace
      autofocus
      :validation-rules="rules"
    />

    <div grid grid-cols-1 gap-3 md:grid-cols-4>
      <n-statistic label="Score" :value="`${analysis.score}/100`" />
      <n-statistic label="Grade" :value="analysis.grade" />
      <n-statistic label="Warnings" :value="analysis.warnings" />
      <n-statistic label="Failures" :value="analysis.failed" />
    </div>

    <c-card title="Header score">
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
      :data="rows"
      :headers="[
        { key: 'name', label: 'Header' },
        { key: 'status', label: 'Status' },
        { key: 'value', label: 'Value' },
        { key: 'summary', label: 'Result' },
        { key: 'recommendation', label: 'Recommendation' },
      ]"
      description="Security response header checks"
    >
      <template #status="{ value }">
        <n-tag :type="statusTagType(value as SecurityHeaderStatus)">
          {{ value }}
        </n-tag>
      </template>

      <template #value="{ value, row }">
        <span v-if="row.value === 'Missing'" op-60>
          Missing
        </span>
        <span-copyable v-else :value="String(value)" />
      </template>
    </c-table>
  </div>
</template>
