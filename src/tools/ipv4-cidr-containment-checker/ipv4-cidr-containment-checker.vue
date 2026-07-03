<script setup lang="ts">
import { useStorage } from '@vueuse/core';
import {
  analyzeIpv4CidrContainment,
  type Ipv4CidrContainmentStatus,
} from './ipv4-cidr-containment-checker.service';
import type { UseValidationRule } from '@/composable/validation';
import { withDefaultOnError } from '@/utils/defaults';

const sampleRules = [
  '10.0.0.0/24',
  '10.0.1.0/25',
  '192.168.0.0/16',
].join('\n');

const sampleTargets = [
  '10.0.0.42',
  '10.0.1.0/24',
  '172.16.0.1',
  '192.168.10.0/24',
].join('\n');

const rulesInput = useStorage('ipv4-cidr-containment-checker:rules', sampleRules);
const targetsInput = useStorage('ipv4-cidr-containment-checker:targets', sampleTargets);
const emptyAnalysis = analyzeIpv4CidrContainment('', '');
const analysis = computed(() => withDefaultOnError(() => analyzeIpv4CidrContainment(rulesInput.value, targetsInput.value), emptyAnalysis));

const targetRows = computed<Record<string, unknown>[]>(() => analysis.value.targets.map(check => ({
  line: check.target.line,
  target: check.target.cidr,
  kind: check.target.kind,
  status: check.status,
  matchedRules: check.matches.length
    ? check.matches.map(match => `L${match.rule.line}: ${match.rule.cidr}`).join(', ')
    : '-',
  coveredAddressCount: check.coveredAddressCount.toLocaleString(),
  uncoveredAddressCount: check.uncoveredAddressCount.toLocaleString(),
})));

const matchRows = computed<Record<string, unknown>[]>(() => analysis.value.targets.flatMap(check =>
  check.matches.map(match => ({
    target: `L${check.target.line}: ${check.target.cidr}`,
    rule: `L${match.rule.line}: ${match.rule.cidr}`,
    relationship: match.relationship,
    overlapCidr: match.overlapCidr,
    overlapRange: `${match.overlapStart} - ${match.overlapEnd}`,
    overlapAddressCount: match.overlapAddressCount.toLocaleString(),
  })),
));

const ruleRows = computed<Record<string, unknown>[]>(() => analysis.value.rules.map(rule => ({
  line: rule.line,
  cidr: rule.cidr,
  networkAddress: rule.networkAddress,
  broadcastAddress: rule.broadcastAddress,
  addressCount: rule.addressCount.toLocaleString(),
})));

function validateRules(value: string) {
  analyzeIpv4CidrContainment(value, targetsInput.value);

  return true;
}

function validateTargets(value: string) {
  analyzeIpv4CidrContainment(rulesInput.value, value);

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

const ruleValidationRules: UseValidationRule<string>[] = [
  {
    validator: validateRules,
    message: 'Provided IPv4 CIDR rules are not valid: {0}',
    getErrorMessage: value => getValidationMessage(() => validateRules(value)),
  },
];

const targetValidationRules: UseValidationRule<string>[] = [
  {
    validator: validateTargets,
    message: 'Provided IPv4 targets are not valid: {0}',
    getErrorMessage: value => getValidationMessage(() => validateTargets(value)),
  },
];

function statusTagType(status: Ipv4CidrContainmentStatus) {
  if (status === 'covered') {
    return 'success';
  }

  if (status === 'partial') {
    return 'warning';
  }

  return 'error';
}
</script>

<template>
  <div flex flex-col gap-5>
    <div grid grid-cols-1 gap-4 md:grid-cols-2>
      <c-input-text
        v-model:value="rulesInput"
        label="Containing CIDR rules"
        placeholder="Paste one containing IPv4 CIDR block per line..."
        rows="9"
        multiline
        raw-text
        monospace
        autofocus
        :validation-rules="ruleValidationRules"
      />

      <c-input-text
        v-model:value="targetsInput"
        label="Targets to check"
        placeholder="Paste one IPv4 address or CIDR block per line..."
        rows="9"
        multiline
        raw-text
        monospace
        :validation-rules="targetValidationRules"
      />
    </div>

    <div grid grid-cols-1 gap-3 md:grid-cols-5>
      <n-statistic label="Rules" :value="analysis.summary.ruleCount" />
      <n-statistic label="Targets" :value="analysis.summary.targetCount" />
      <n-statistic label="Covered" :value="analysis.summary.coveredCount" />
      <n-statistic label="Partial" :value="analysis.summary.partialCount" />
      <n-statistic label="Unmatched" :value="analysis.summary.unmatchedCount" />
    </div>

    <c-table
      v-if="targetRows.length"
      :data="targetRows"
      :headers="[
        { key: 'line', label: 'Line' },
        { key: 'target', label: 'Target' },
        { key: 'kind', label: 'Type' },
        { key: 'status', label: 'Status' },
        { key: 'matchedRules', label: 'Matched rules' },
        { key: 'coveredAddressCount', label: 'Covered addresses' },
        { key: 'uncoveredAddressCount', label: 'Uncovered addresses' },
      ]"
      description="Target containment results"
    >
      <template #target="{ value }">
        <span-copyable :value="String(value)" />
      </template>
      <template #status="{ value }">
        <n-tag :type="statusTagType(value as Ipv4CidrContainmentStatus)">
          {{ value }}
        </n-tag>
      </template>
    </c-table>

    <c-card v-else title="Containment results">
      <n-empty description="Add targets to check them against the containing CIDR rules." />
    </c-card>

    <c-table
      v-if="matchRows.length"
      :data="matchRows"
      :headers="[
        { key: 'target', label: 'Target' },
        { key: 'rule', label: 'Rule' },
        { key: 'relationship', label: 'Relationship' },
        { key: 'overlapCidr', label: 'Overlap CIDR' },
        { key: 'overlapRange', label: 'Overlap range' },
        { key: 'overlapAddressCount', label: 'Addresses' },
      ]"
      description="Matching CIDR rule details"
    >
      <template #overlapCidr="{ value }">
        <span-copyable :value="String(value)" />
      </template>
      <template #overlapRange="{ value }">
        <span-copyable :value="String(value)" />
      </template>
    </c-table>

    <c-table
      v-if="ruleRows.length"
      :data="ruleRows"
      :headers="[
        { key: 'line', label: 'Line' },
        { key: 'cidr', label: 'Normalized rule' },
        { key: 'networkAddress', label: 'Network' },
        { key: 'broadcastAddress', label: 'Broadcast' },
        { key: 'addressCount', label: 'Addresses' },
      ]"
      description="Normalized containing CIDR rules"
    >
      <template #cidr="{ value }">
        <span-copyable :value="String(value)" />
      </template>
    </c-table>
  </div>
</template>
