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
  warnings: cookie.warnings.join('\n') || '-',
})));
const cookiesJson = computed(() => JSON.stringify(parsedCookies.value.json, null, 2));

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

    <div grid grid-cols-1 gap-3 md:grid-cols-4>
      <n-statistic label="Total cookies" :value="parsedCookies.cookies.length" />
      <n-statistic label="Cookie headers" :value="parsedCookies.requestCookies.length" />
      <n-statistic label="Set-Cookie headers" :value="parsedCookies.responseCookies.length" />
      <n-statistic label="Warnings" :value="parsedCookies.cookies.reduce((total, cookie) => total + cookie.warnings.length, 0)" />
    </div>

    <c-table
      :data="rows"
      :headers="[
        { key: 'source', label: 'Source' },
        { key: 'name', label: 'Name' },
        { key: 'value', label: 'Decoded value' },
        { key: 'attributes', label: 'Attributes' },
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

    <n-form-item label="JSON">
      <textarea-copyable :value="cookiesJson" language="json" />
    </n-form-item>
  </div>
</template>
