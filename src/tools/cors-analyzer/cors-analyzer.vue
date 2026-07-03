<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import {
  analyzeCors,
  type CorsCheckStatus,
} from './cors-analyzer.service';
import type { UseValidationRule } from '../../composable/validation';
import { withDefaultOnError } from '../../utils/defaults';

const sampleHeaders = `HTTP/2 204
access-control-allow-origin: https://app.example.com
access-control-allow-methods: GET, POST
access-control-allow-headers: content-type, authorization
access-control-expose-headers: x-request-id
access-control-max-age: 3600
vary: Origin`;

const rawHeaders = useStorage('cors-analyzer:headers', sampleHeaders);
const emptyAnalysis = analyzeCors('');
const analysis = computed(() => withDefaultOnError(() => analyzeCors(rawHeaders.value), emptyAnalysis));
const rows = computed(() => analysis.value.checks.map(check => ({
  ...check,
  value: check.value || '-',
})));

const rules: UseValidationRule<string>[] = [
  {
    validator: value => value.trim() === '' || analyzeCors(value),
    message: 'Provided HTTP headers are not valid.',
  },
];

function statusTagType(status: CorsCheckStatus) {
  if (status === 'pass') {
    return 'success';
  }
  if (status === 'warning') {
    return 'warning';
  }
  return 'error';
}
</script>

<template>
  <div flex flex-col gap-5>
    <c-input-text
      v-model:value="rawHeaders"
      label="HTTP response headers"
      placeholder="Paste response headers with Access-Control-* and Vary..."
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
      <n-statistic label="Allowed origin" :value="analysis.allowOrigin || '-'" />
      <n-statistic label="Credentials" :value="analysis.allowCredentials ? 'enabled' : 'disabled'" />
      <n-statistic label="Preflight cache" :value="analysis.maxAge" />
      <n-statistic label="Issues" :value="analysis.warnings + analysis.failed" />
    </div>

    <div flex flex-wrap gap-2>
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

    <c-table
      :data="rows"
      :headers="[
        { key: 'name', label: 'Check' },
        { key: 'status', label: 'Status' },
        { key: 'value', label: 'Value' },
        { key: 'summary', label: 'Result' },
        { key: 'recommendation', label: 'Recommendation' },
      ]"
      description="CORS policy checks"
    >
      <template #status="{ value }">
        <n-tag :type="statusTagType(value as CorsCheckStatus)">
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

    <div grid grid-cols-1 gap-5 lg:grid-cols-3>
      <n-form-item label="Allowed methods">
        <textarea-copyable :value="analysis.allowMethods.join('\n')" language="txt" />
      </n-form-item>

      <n-form-item label="Allowed headers">
        <textarea-copyable :value="analysis.allowHeaders.join('\n')" language="txt" />
      </n-form-item>

      <n-form-item label="Exposed headers">
        <textarea-copyable :value="analysis.exposeHeaders.join('\n')" language="txt" />
      </n-form-item>
    </div>
  </div>
</template>
