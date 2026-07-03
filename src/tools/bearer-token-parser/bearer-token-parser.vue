<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import { parseBearerToken } from './bearer-token-parser.service';
import type { UseValidationRule } from '../../composable/validation';
import { withDefaultOnError } from '../../utils/defaults';

const sampleToken = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

const input = useStorage('bearer-token-parser:input', sampleToken);
const emptyParsed = parseBearerToken(sampleToken);
const parsed = computed(() => withDefaultOnError(() => parseBearerToken(input.value), emptyParsed));
const metadataRows = computed<Record<string, unknown>[]>(() => [
  { name: 'Kind', value: parsed.value.kind.toUpperCase() },
  { name: 'Token preview', value: parsed.value.tokenPreview },
  { name: 'Token length', value: parsed.value.tokenLength },
  { name: 'Authorization header', value: parsed.value.header },
  { name: 'Expires at', value: parsed.value.expiresAt ?? '-' },
  { name: 'Time to expiry', value: parsed.value.timeToExpiry ?? '-' },
  { name: 'Issued at', value: parsed.value.issuedAt ?? '-' },
  { name: 'Not before', value: parsed.value.notBefore ?? '-' },
  { name: 'Time until active', value: parsed.value.timeUntilActive ?? '-' },
]);
const jwtHeaderRows = computed<Record<string, unknown>[]>(() => parsed.value.jwtHeader.map(row => ({
  ...row,
  friendlyValue: row.friendlyValue ?? '-',
})));
const jwtPayloadRows = computed<Record<string, unknown>[]>(() => parsed.value.jwtPayload.map(row => ({
  ...row,
  friendlyValue: row.friendlyValue ?? '-',
})));

const rules: UseValidationRule<string>[] = [
  {
    validator: value => value.trim() !== '' && parseBearerToken(value),
    message: 'Provide a valid Bearer token, Authorization header, or JWT.',
  },
];
</script>

<template>
  <div flex flex-col gap-5>
    <c-input-text
      v-model:value="input"
      label="Bearer authorization value"
      placeholder="Authorization: Bearer eyJ..."
      rows="5"
      multiline
      raw-text
      monospace
      autofocus
      :validation-rules="rules"
    />

    <div grid grid-cols-1 gap-3 md:grid-cols-4 xl:grid-cols-7>
      <n-statistic label="Kind" :value="parsed.kind.toUpperCase()" />
      <n-statistic label="Token length" :value="parsed.tokenLength" />
      <n-statistic label="Expired" :value="parsed.expired === undefined ? '-' : parsed.expired ? 'yes' : 'no'" />
      <n-statistic label="Active" :value="parsed.active === undefined ? '-' : parsed.active ? 'yes' : 'no'" />
      <n-statistic label="Time to expiry" :value="parsed.timeToExpiry ?? '-'" />
      <n-statistic label="Time until active" :value="parsed.timeUntilActive ?? '-'" />
      <n-statistic label="Warnings" :value="parsed.warnings.length" />
    </div>

    <c-alert v-if="parsed.warnings.length" type="warning">
      {{ parsed.warnings.join(' ') }}
    </c-alert>

    <c-table
      :data="metadataRows"
      :headers="[
        { key: 'name', label: 'Field' },
        { key: 'value', label: 'Value' },
      ]"
      description="Bearer token metadata"
    >
      <template #value="{ value }">
        <span v-if="value === '-'" op-60>
          -
        </span>
        <span-copyable v-else :value="String(value)" />
      </template>
    </c-table>

    <c-table
      v-if="jwtHeaderRows.length"
      :data="jwtHeaderRows"
      :headers="[
        { key: 'claim', label: 'Header claim' },
        { key: 'value', label: 'Value' },
      ]"
      description="JWT header claims"
    >
      <template #value="{ value }">
        <span-copyable :value="String(value)" />
      </template>
    </c-table>

    <c-table
      v-if="jwtPayloadRows.length"
      :data="jwtPayloadRows"
      :headers="[
        { key: 'claim', label: 'Payload claim' },
        { key: 'value', label: 'Value' },
        { key: 'friendlyValue', label: 'Friendly value' },
      ]"
      description="JWT payload claims"
    >
      <template #value="{ value }">
        <span-copyable :value="String(value)" />
      </template>

      <template #friendlyValue="{ value }">
        <span v-if="value === '-'" op-60>
          -
        </span>
        <span-copyable v-else :value="String(value)" />
      </template>
    </c-table>
  </div>
</template>
