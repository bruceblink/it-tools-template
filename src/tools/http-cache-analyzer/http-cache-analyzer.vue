<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import {
  analyzeHttpCache,
  type CacheCheckStatus,
} from './http-cache-analyzer.service';
import type { UseValidationRule } from '../../composable/validation';
import { withDefaultOnError } from '../../utils/defaults';

const sampleHeaders = `HTTP/2 200
cache-control: public, max-age=31536000, stale-while-revalidate=86400, stale-if-error=604800, immutable
age: 86400
etag: "asset-v1"
vary: Accept-Encoding`;

const rawHeaders = useStorage('http-cache-analyzer:headers', sampleHeaders);
const emptyAnalysis = analyzeHttpCache('');
const analysis = computed(() => withDefaultOnError(() => analyzeHttpCache(rawHeaders.value), emptyAnalysis));
const directiveRows = computed(() => analysis.value.directives.map(({ name, value }) => ({
  name,
  value: value === true ? 'enabled' : value,
})));
const checkRows = computed<Record<string, unknown>[]>(() => analysis.value.checks.map(check => ({
  ...check,
})));

const rules: UseValidationRule<string>[] = [
  {
    validator: value => value.trim() === '' || analyzeHttpCache(value),
    message: 'Provided HTTP headers are not valid.',
  },
];

function statusTagType(status: CacheCheckStatus) {
  if (status === 'pass') {
    return 'success';
  }
  if (status === 'warning') {
    return 'warning';
  }
  return 'error';
}

const cacheabilityTagType = computed(() => {
  if (analysis.value.cacheability === 'cacheable') {
    return 'success';
  }
  if (analysis.value.cacheability === 'not-cacheable') {
    return 'warning';
  }
  return 'info';
});

const freshnessStateTagType = computed(() => {
  if (analysis.value.freshnessState === 'fresh') {
    return 'success';
  }
  if (analysis.value.freshnessState === 'stale') {
    return 'warning';
  }
  return 'info';
});
</script>

<template>
  <div flex flex-col gap-5>
    <c-input-text
      v-model:value="rawHeaders"
      label="HTTP response headers"
      placeholder="Paste response headers with Cache-Control, Expires, ETag, Vary..."
      rows="9"
      multiline
      raw-text
      monospace
      autofocus
      :validation-rules="rules"
    />

    <div grid grid-cols-1 gap-3 md:grid-cols-4>
      <n-statistic label="Freshness" :value="analysis.freshness" />
      <n-statistic label="Shared freshness" :value="analysis.sharedFreshness" />
      <n-statistic label="Response age" :value="analysis.responseAge" />
      <n-statistic label="Remaining freshness" :value="analysis.remainingFreshness" />
      <n-statistic label="Expires" :value="analysis.expiresAt || '-'" />
      <n-statistic label="Validators" :value="analysis.validators.length ? analysis.validators.join(', ') : '-'" />
      <n-statistic label="Warnings" :value="analysis.warnings.length" />
      <n-statistic label="Stale while revalidate" :value="analysis.staleWhileRevalidate" />
      <n-statistic label="Stale if error" :value="analysis.staleIfError" />
    </div>

    <c-card title="Cacheability">
      <div flex flex-wrap items-center gap-3>
        <n-tag :type="cacheabilityTagType">
          {{ analysis.cacheability }}
        </n-tag>
        <n-tag :type="freshnessStateTagType">
          {{ analysis.freshnessState }}
        </n-tag>
        <span op-70>
          {{ analysis.cacheControl || 'No Cache-Control header' }}
        </span>
      </div>
    </c-card>

    <c-table
      :data="checkRows"
      :headers="[
        { key: 'name', label: 'Check' },
        { key: 'status', label: 'Status' },
        { key: 'summary', label: 'Result' },
        { key: 'recommendation', label: 'Recommendation' },
      ]"
      description="HTTP cache policy checks"
    >
      <template #status="{ value }">
        <n-tag :type="statusTagType(value as CacheCheckStatus)">
          {{ value }}
        </n-tag>
      </template>
    </c-table>

    <c-table
      v-if="directiveRows.length"
      :data="directiveRows"
      :headers="[
        { key: 'name', label: 'Directive' },
        { key: 'value', label: 'Value' },
      ]"
      description="Cache-Control directives"
    >
      <template #value="{ value }">
        <span-copyable :value="String(value)" />
      </template>
    </c-table>
  </div>
</template>
