<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import { calculateIpv4Wildcard, type Ipv4WildcardInputMode } from './ipv4-wildcard-mask.service';
import type { UseValidationRule } from '@/composable/validation';
import { withDefaultOnError } from '@/utils/defaults';

const mode = useStorage<Ipv4WildcardInputMode>('ipv4-wildcard-mask:mode', 'cidr');
const input = useStorage('ipv4-wildcard-mask:input', '192.168.1.42/24');

const modeOptions: Array<{ label: string; value: Ipv4WildcardInputMode }> = [
  { label: 'CIDR', value: 'cidr' },
  { label: 'IP + netmask', value: 'netmask' },
  { label: 'IP + wildcard', value: 'wildcard' },
];

const placeholders: Record<Ipv4WildcardInputMode, string> = {
  cidr: '192.168.1.42/24',
  netmask: '192.168.1.42 255.255.255.0',
  wildcard: '192.168.1.42 0.0.0.255',
};

const calculation = computed(() =>
  withDefaultOnError(() => calculateIpv4Wildcard(input.value, mode.value), undefined),
);

function validateInput(value: string) {
  calculateIpv4Wildcard(value, mode.value);

  return true;
}

const rules: UseValidationRule<string>[] = [
  {
    validator: validateInput,
    message: 'Invalid IPv4 wildcard mask input: {0}',
    getErrorMessage: (value) => {
      try {
        validateInput(value);
        return '';
      }
      catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  },
];

const rows = computed(() => {
  if (!calculation.value) {
    return [];
  }

  return [
    { label: 'Normalized CIDR', value: calculation.value.cidr },
    { label: 'Network address', value: calculation.value.networkAddress },
    { label: 'Broadcast address', value: calculation.value.broadcastAddress },
    { label: 'First address', value: calculation.value.firstAddress },
    { label: 'Last address', value: calculation.value.lastAddress },
    { label: 'Subnet mask', value: calculation.value.subnetMask },
    { label: 'Wildcard mask', value: calculation.value.wildcardMask },
    { label: 'Binary subnet mask', value: calculation.value.binarySubnetMask },
    { label: 'Binary wildcard mask', value: calculation.value.binaryWildcardMask },
    { label: 'Address count', value: String(calculation.value.addressCount) },
    { label: 'Usable host count', value: String(calculation.value.usableHostCount) },
    { label: 'ACL source', value: calculation.value.aclSource },
    { label: 'Standard ACL', value: calculation.value.standardAclLine },
    { label: 'Extended ACL', value: calculation.value.extendedAclLine },
  ];
});
</script>

<template>
  <div>
    <n-form-item label="Input format" label-placement="left" :show-feedback="false">
      <n-radio-group v-model:value="mode" name="ipv4-wildcard-mask-mode">
        <n-radio-button
          v-for="option in modeOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </n-radio-button>
      </n-radio-group>
    </n-form-item>

    <c-input-text
      v-model:value="input"
      label="IPv4 network"
      :placeholder="placeholders[mode]"
      :validation-rules="rules"
      mb-4
      clearable
    />

    <n-table v-if="calculation">
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
