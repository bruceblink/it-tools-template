<script setup lang="ts">
import { mergeIpv4Cidrs } from './ipv4-cidr-merge.service';
import type { UseValidationRule } from '@/composable/validation';
import { withDefaultOnError } from '@/utils/defaults';

const sampleInput = [
  '192.168.1.0/25',
  '192.168.1.128-192.168.1.255',
  '10.0.0.1',
  '10.0.0.2',
].join('\n');

function transformer(value: string) {
  return withDefaultOnError(() => mergeIpv4Cidrs(value), '');
}

function validateInput(value: string) {
  if (value === '') {
    return true;
  }

  mergeIpv4Cidrs(value);

  return true;
}

const rules: UseValidationRule<string>[] = [
  {
    validator: validateInput,
    message: 'Provided IPv4 ranges are not valid: {0}',
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
</script>

<template>
  <format-transformer
    input-label="IPv4 addresses, ranges, or CIDR blocks"
    :input-default="sampleInput"
    input-placeholder="Paste one IPv4 address, range, or CIDR block per line..."
    output-label="Merged CIDR blocks"
    output-language="txt"
    :input-validation-rules="rules"
    :transformer="transformer"
  />
</template>
