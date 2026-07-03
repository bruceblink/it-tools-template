<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import { formatIpv4CidrSplit, splitIpv4Cidr } from './ipv4-cidr-splitter.service';
import type { UseValidationRule } from '@/composable/validation';
import { withDefaultOnError } from '@/utils/defaults';

const sourceCidr = useStorage('ipv4-cidr-splitter:source-cidr', '192.168.0.0/24');
const targetPrefix = useStorage('ipv4-cidr-splitter:target-prefix', 26);

const result = computed(() =>
  withDefaultOnError(() => splitIpv4Cidr(sourceCidr.value, targetPrefix.value), undefined),
);

const output = computed(() =>
  withDefaultOnError(() => formatIpv4CidrSplit(sourceCidr.value, targetPrefix.value), ''),
);

function validateSourceCidr(value: string) {
  splitIpv4Cidr(value, targetPrefix.value);

  return true;
}

function validateTargetPrefix(value: number | null) {
  if (value === null) {
    return false;
  }

  splitIpv4Cidr(sourceCidr.value, value);

  return true;
}

function getValidationMessage(validate: () => void) {
  try {
    validate();
    return '';
  }
  catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const sourceRules: UseValidationRule<string>[] = [
  {
    validator: validateSourceCidr,
    message: 'Invalid CIDR block: {0}',
    getErrorMessage: value => getValidationMessage(() => validateSourceCidr(value)),
  },
];

const targetPrefixRules: UseValidationRule<number | null>[] = [
  {
    validator: validateTargetPrefix,
    message: 'Invalid target prefix: {0}',
    getErrorMessage: value => getValidationMessage(() => validateTargetPrefix(value)),
  },
];

const summaryRows = computed(() => {
  if (!result.value) {
    return [];
  }

  return [
    { label: 'Source CIDR', value: result.value.sourceCidr },
    { label: 'Source network', value: result.value.sourceNetworkAddress },
    { label: 'Source broadcast', value: result.value.sourceBroadcastAddress },
    { label: 'Target prefix', value: `/${result.value.targetPrefix}` },
    { label: 'Subnet count', value: result.value.subnetCount.toLocaleString() },
    { label: 'Addresses per subnet', value: result.value.addressesPerSubnet.toLocaleString() },
  ];
});
</script>

<template>
  <div>
    <div mb-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px]>
      <c-input-text
        v-model:value="sourceCidr"
        label="Source CIDR"
        placeholder="192.168.0.0/24"
        :validation-rules="sourceRules"
        clearable
      />

      <n-form-item label="Target prefix" :show-feedback="false">
        <n-input-number
          v-model:value="targetPrefix"
          min="0"
          max="32"
          :validation-rules="targetPrefixRules"
        />
      </n-form-item>
    </div>

    <n-table v-if="result" mb-4>
      <tbody>
        <tr v-for="{ label, value } in summaryRows" :key="label">
          <td font-bold>
            {{ label }}
          </td>
          <td>
            <span-copyable :value="value" />
          </td>
        </tr>
      </tbody>
    </n-table>

    <textarea-copyable :value="output" language="txt" />
  </div>
</template>
