<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import { analyzeIpv4CidrOverlaps } from './ipv4-cidr-overlap-checker.service';
import type { UseValidationRule } from '@/composable/validation';
import { withDefaultOnError } from '@/utils/defaults';

const sampleInput = [
  '10.0.0.0/24',
  '10.0.0.128/25',
  '10.0.1.0/24',
  '192.168.1.0/24',
  '192.168.1.128/25',
].join('\n');

const cidrs = useStorage('ipv4-cidr-overlap-checker:cidrs', sampleInput);
const emptyAnalysis = analyzeIpv4CidrOverlaps('');
const analysis = computed(() => withDefaultOnError(() => analyzeIpv4CidrOverlaps(cidrs.value), emptyAnalysis));

const blockRows = computed<Record<string, unknown>[]>(() => analysis.value.blocks.map(block => ({
  line: block.line,
  cidr: block.cidr,
  networkAddress: block.networkAddress,
  broadcastAddress: block.broadcastAddress,
  addressCount: block.addressCount.toLocaleString(),
})));

const overlapRows = computed<Record<string, unknown>[]>(() => analysis.value.overlaps.map(overlap => ({
  first: `L${overlap.first.line}: ${overlap.first.cidr}`,
  second: `L${overlap.second.line}: ${overlap.second.cidr}`,
  overlapCidr: overlap.overlapCidr,
  overlapRange: `${overlap.overlapStart} - ${overlap.overlapEnd}`,
  relationship: overlap.relationship,
  overlapAddressCount: overlap.overlapAddressCount.toLocaleString(),
})));

function validateInput(value: string) {
  analyzeIpv4CidrOverlaps(value);

  return true;
}

function getValidationMessage(value: string) {
  try {
    validateInput(value);
    return '';
  }
  catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const rules: UseValidationRule<string>[] = [
  {
    validator: validateInput,
    message: 'Provided IPv4 CIDR list is not valid: {0}',
    getErrorMessage: getValidationMessage,
  },
];

const summaryType = computed(() => (analysis.value.hasOverlaps ? 'warning' : 'success'));

function relationshipTagType(relationship: unknown) {
  if (relationship === 'duplicate') {
    return 'error';
  }
  if (relationship === 'partial') {
    return 'warning';
  }
  return 'info';
}
</script>

<template>
  <div flex flex-col gap-5>
    <c-input-text
      v-model:value="cidrs"
      label="IPv4 CIDR blocks"
      placeholder="Paste one IPv4 CIDR block per line..."
      rows="9"
      multiline
      raw-text
      monospace
      autofocus
      :validation-rules="rules"
    />

    <div grid grid-cols-1 gap-3 md:grid-cols-4>
      <n-statistic label="CIDR blocks" :value="analysis.summary.totalBlocks" />
      <n-statistic label="Overlaps" :value="analysis.summary.overlapCount" />
      <n-statistic label="Covered addresses" :value="analysis.summary.coveredAddressCount.toLocaleString()" />
      <div flex items-end>
        <n-tag :type="summaryType">
          {{ analysis.hasOverlaps ? 'Overlaps found' : 'No overlaps' }}
        </n-tag>
      </div>
    </div>

    <c-table
      v-if="overlapRows.length"
      :data="overlapRows"
      :headers="[
        { key: 'first', label: 'First block' },
        { key: 'second', label: 'Second block' },
        { key: 'relationship', label: 'Relationship' },
        { key: 'overlapCidr', label: 'Overlap CIDR' },
        { key: 'overlapRange', label: 'Overlap range' },
        { key: 'overlapAddressCount', label: 'Addresses' },
      ]"
      description="Overlapping CIDR pairs"
    >
      <template #relationship="{ value }">
        <n-tag :type="relationshipTagType(value)">
          {{ value }}
        </n-tag>
      </template>
      <template #overlapCidr="{ value }">
        <span-copyable :value="String(value)" />
      </template>
      <template #overlapRange="{ value }">
        <span-copyable :value="String(value)" />
      </template>
    </c-table>

    <c-card v-else title="Overlap report">
      <n-empty description="No overlapping IPv4 CIDR blocks found." />
    </c-card>

    <c-table
      v-if="blockRows.length"
      :data="blockRows"
      :headers="[
        { key: 'line', label: 'Line' },
        { key: 'cidr', label: 'Normalized CIDR' },
        { key: 'networkAddress', label: 'Network' },
        { key: 'broadcastAddress', label: 'Broadcast' },
        { key: 'addressCount', label: 'Addresses' },
      ]"
      description="Normalized input blocks"
    >
      <template #cidr="{ value }">
        <span-copyable :value="String(value)" />
      </template>
    </c-table>
  </div>
</template>
