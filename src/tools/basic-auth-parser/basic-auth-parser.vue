<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import { parseBasicAuth } from './basic-auth-parser.service';
import type { UseValidationRule } from '../../composable/validation';
import { withDefaultOnError } from '../../utils/defaults';

const sampleHeader = 'Authorization: Basic YWxpY2U6czNjcmV0';

const input = useStorage('basic-auth-parser:input', sampleHeader);
const emptyParsed = parseBasicAuth(sampleHeader);
const parsed = computed(() => withDefaultOnError(() => parseBasicAuth(input.value), emptyParsed));
const rows = computed<Record<string, unknown>[]>(() => [
  { name: 'Username', value: parsed.value.username },
  { name: 'Password', value: parsed.value.password },
  { name: 'Password length', value: parsed.value.passwordLength },
  { name: 'Credential pair', value: parsed.value.credential },
  { name: 'Base64 token', value: parsed.value.token },
  { name: 'Normalized token', value: parsed.value.normalizedToken },
  { name: 'Authorization header', value: parsed.value.header },
]);

const rules: UseValidationRule<string>[] = [
  {
    validator: value => value.trim() !== '' && parseBasicAuth(value),
    message: 'Provide a valid Basic authorization header or token.',
  },
];
</script>

<template>
  <div flex flex-col gap-5>
    <c-input-text
      v-model:value="input"
      label="Basic authorization value"
      placeholder="Authorization: Basic dXNlcjpwYXNz"
      rows="4"
      multiline
      raw-text
      monospace
      autofocus
      :validation-rules="rules"
    />

    <div grid grid-cols-1 gap-3 md:grid-cols-4>
      <n-statistic label="Scheme" :value="parsed.scheme" />
      <n-statistic label="Warnings" :value="parsed.warnings.length" />
      <n-statistic label="Security notes" :value="parsed.securityNotes.length" />
      <n-statistic label="Token length" :value="parsed.token.length" />
    </div>

    <c-alert v-if="parsed.warnings.length" type="warning">
      {{ parsed.warnings.join(' ') }}
    </c-alert>

    <c-alert v-if="parsed.securityNotes.length" type="warning">
      {{ parsed.securityNotes.join(' ') }}
    </c-alert>

    <c-table
      :data="rows"
      :headers="[
        { key: 'name', label: 'Field' },
        { key: 'value', label: 'Value' },
      ]"
      description="Parsed Basic authentication credentials"
    >
      <template #value="{ value }">
        <span-copyable :value="String(value)" />
      </template>
    </c-table>
  </div>
</template>
