<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import { classifyIpv4Address } from './ipv4-address-classifier.service';
import type { UseValidationRule } from '@/composable/validation';
import { withDefaultOnError } from '@/utils/defaults';

const ip = useStorage('ipv4-address-classifier:ip', '192.168.1.1');

const classification = computed(() => withDefaultOnError(() => classifyIpv4Address(ip.value), undefined));

const rules: UseValidationRule<string>[] = [
  {
    validator: value => value === '' || classifyIpv4Address(value),
    message: 'Invalid IPv4 address.',
  },
];

const rows = computed(() => {
  if (!classification.value) {
    return [];
  }

  return [
    { label: 'Category', value: classification.value.rule.label },
    { label: 'Scope', value: classification.value.rule.scope },
    { label: 'Matched range', value: classification.value.rule.cidr },
    { label: 'Description', value: classification.value.rule.description },
    { label: 'IP class', value: classification.value.ipClass ?? 'Unknown' },
    { label: 'Integer', value: String(classification.value.integer) },
    { label: 'Hex', value: classification.value.hex },
    { label: 'Binary', value: classification.value.binary },
  ];
});
</script>

<template>
  <div>
    <c-input-text
      v-model:value="ip"
      label="IPv4 address"
      placeholder="Enter an IPv4 address..."
      :validation-rules="rules"
      mb-4
      clearable
    />

    <n-table v-if="classification">
      <tbody>
        <tr v-for="{ label, value } in rows" :key="label">
          <td font-bold>
            {{ label }}
          </td>
          <td>
            <span-copyable :value="value" />
          </td>
        </tr>
      </tbody>
    </n-table>
  </div>
</template>
