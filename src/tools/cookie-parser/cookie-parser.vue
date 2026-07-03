<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import { parseCookies } from './cookie-parser.service';
import type { UseValidationRule } from '../../composable/validation';
import { withDefaultOnError } from '../../utils/defaults';

const sampleCookies = `Cookie: session=abc123; theme=dark; encoded=hello%20world
Set-Cookie: session=abc123; Path=/; HttpOnly; Secure; SameSite=Lax
Set-Cookie: tracking=1; Path=/; SameSite=None`;

const rawCookies = useStorage('cookie-parser:cookies', sampleCookies);
const emptyResult = parseCookies('');
const parsedCookies = computed(() => withDefaultOnError(() => parseCookies(rawCookies.value), emptyResult));
const rows = computed(() => parsedCookies.value.cookies.map(cookie => ({
  source: cookie.source === 'request' ? 'Cookie' : 'Set-Cookie',
  name: cookie.name,
  value: cookie.decodedValue,
  rawValue: cookie.value,
  attributes: cookie.attributes.map(({ name, value }) => value === true ? name : `${name}=${value}`).join('; ') || '-',
  expires: cookie.expiresAt ? `${cookie.expired ? 'Expired' : 'Active'}\n${cookie.expiresAt}` : '-',
  warnings: cookie.warnings.join('\n') || '-',
})));
const cookiesJson = computed(() => JSON.stringify(parsedCookies.value.json, null, 2));
const requestHeader = computed(() => parsedCookies.value.requestHeader || 'No request cookies found.');
const responseHeaders = computed(() => parsedCookies.value.responseHeaders || 'No Set-Cookie headers found.');

const rules: UseValidationRule<string>[] = [
  {
    validator: value => value.trim() === '' || parseCookies(value),
    message: 'Provided cookie data is not valid.',
  },
];

function sourceTagType(source: unknown) {
  return source === 'Set-Cookie' ? 'success' : 'info';
}
</script>

<template>
  <div flex flex-col gap-5>
    <c-input-text
      v-model:value="rawCookies"
      label="Cookie headers"
      placeholder="Paste Cookie or Set-Cookie headers..."
      rows="9"
      multiline
      raw-text
      monospace
      autofocus
      :validation-rules="rules"
    />

    <div grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6>
      <n-statistic label="Total cookies" :value="parsedCookies.summary.totalCookies" />
      <n-statistic label="Cookie headers" :value="parsedCookies.summary.requestCookies" />
      <n-statistic label="Set-Cookie headers" :value="parsedCookies.summary.responseCookies" />
      <n-statistic label="Expired" :value="parsedCookies.summary.expiredCookies" />
      <n-statistic label="Warnings" :value="parsedCookies.summary.warningCount" />
      <n-statistic label="Duplicate names" :value="parsedCookies.summary.duplicateNames.length ? parsedCookies.summary.duplicateNames.join(', ') : '-'" />
    </div>

    <c-table
      :data="rows"
      :headers="[
        { key: 'source', label: 'Source' },
        { key: 'name', label: 'Name' },
        { key: 'value', label: 'Decoded value' },
        { key: 'attributes', label: 'Attributes' },
        { key: 'expires', label: 'Expires' },
        { key: 'warnings', label: 'Warnings' },
      ]"
      description="Parsed cookies"
    >
      <template #source="{ value }">
        <n-tag :type="sourceTagType(value)">
          {{ value }}
        </n-tag>
      </template>

      <template #name="{ value }">
        <span-copyable :value="String(value)" />
      </template>

      <template #value="{ value, row }">
        <div flex flex-col gap-1>
          <span-copyable :value="String(value)" />
          <span v-if="row.rawValue !== value" text-xs op-60>
            Raw: {{ row.rawValue }}
          </span>
        </div>
      </template>

      <template #expires="{ value }">
        <span v-if="value === '-'" op-60>
          -
        </span>
        <div v-else flex flex-col gap-1>
          <n-tag :type="String(value).startsWith('Expired') ? 'warning' : 'success'">
            {{ String(value).split('\n')[0] }}
          </n-tag>
          <span-copyable :value="String(value).split('\n')[1] ?? ''" />
        </div>
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

    <div grid grid-cols-1 gap-4 md:grid-cols-2>
      <n-form-item label="Request Cookie header">
        <textarea-copyable :value="requestHeader" />
      </n-form-item>

      <n-form-item label="Response Set-Cookie headers">
        <textarea-copyable :value="responseHeaders" />
      </n-form-item>
    </div>

    <n-form-item label="JSON">
      <textarea-copyable :value="cookiesJson" language="json" />
    </n-form-item>
  </div>
</template>
