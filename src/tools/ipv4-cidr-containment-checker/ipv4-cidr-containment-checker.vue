<script setup lang="ts">
import { tryOnBeforeUnmount } from '@vueuse/core';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';
import type { Ipv4CidrContainmentAnalysis, Ipv4CidrContainmentStatus } from './ipv4-cidr-containment-checker.service';
import { useI18n } from 'vue-i18n';

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

const rulesInput = ref(sampleRules);
const targetsInput = ref(sampleTargets);
const { t } = useI18n();
const analysis = shallowRef<Ipv4CidrContainmentAnalysis | null>(null);
const workerErrorMessage = ref('');
const taskStatus = ref<'idle' | 'running' | 'input-limit' | 'output-limit' | 'timeout' | 'error'>('idle');
const taskMessage = computed(() => {
  if (taskStatus.value === 'running') { return t('taskStatus.calculating'); }
  if (taskStatus.value === 'input-limit' || taskStatus.value === 'output-limit') { return t('taskStatus.limit'); }
  if (taskStatus.value === 'timeout') { return t('taskStatus.timeout'); }
  if (taskStatus.value === 'error') { return workerErrorMessage.value || t('taskStatus.error'); }
  return '';
});

const taskKey = 'ipv4-cidr-containment-checker';
let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;

// Cancel stale analyses and publish a complete report only for the current pair of inputs.
watch([rulesInput, targetsInput], () => {
  const version = ++taskVersion;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
  analysis.value = null;
  workerErrorMessage.value = '';
  taskStatus.value = rulesInput.value === '' && targetsInput.value === '' ? 'idle' : 'running';
  if (taskStatus.value === 'idle') { return; }

  taskTimer = setTimeout(async () => {
    const outcome = await taskRunner.run(taskKey, version, {
      kind: 'ipv4-cidr-containment',
      rules: rulesInput.value,
      targets: targetsInput.value,
    }, taskLimits.ipv4CidrContainment);
    if (version !== taskVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === 'ipv4-cidr-containment') {
      if (outcome.result.valid && outcome.result.analysis) {
        analysis.value = outcome.result.analysis;
        taskStatus.value = 'idle';
      }
      else {
        workerErrorMessage.value = outcome.result.errorMessage ?? '';
        taskStatus.value = 'error';
      }
      return;
    }
    if (outcome.status === 'cancelled') { return; }
    taskStatus.value = outcome.status === 'success' ? 'error' : outcome.status;
  }, 150);
}, { immediate: true });

tryOnBeforeUnmount(() => {
  taskVersion++;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
});

const targetRows = computed<Record<string, unknown>[]>(() => (analysis.value?.targets ?? []).map(check => ({
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

const matchRows = computed<Record<string, unknown>[]>(() => (analysis.value?.targets ?? []).flatMap(check =>
  check.matches.map(match => ({
    target: `L${check.target.line}: ${check.target.cidr}`,
    rule: `L${match.rule.line}: ${match.rule.cidr}`,
    relationship: match.relationship,
    overlapCidr: match.overlapCidr,
    overlapRange: `${match.overlapStart} - ${match.overlapEnd}`,
    overlapAddressCount: match.overlapAddressCount.toLocaleString(),
  })),
));

const ruleRows = computed<Record<string, unknown>[]>(() => (analysis.value?.rules ?? []).map(rule => ({
  line: rule.line,
  cidr: rule.cidr,
  networkAddress: rule.networkAddress,
  broadcastAddress: rule.broadcastAddress,
  addressCount: rule.addressCount.toLocaleString(),
})));

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
  <div w-full min-w-0 flex flex-col gap-5>
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
        test-id="ipv4-cidr-rules-input"
      />

      <c-input-text
        v-model:value="targetsInput"
        label="Targets to check"
        placeholder="Paste one IPv4 address or CIDR block per line..."
        rows="9"
        multiline
        raw-text
        monospace
        test-id="ipv4-cidr-targets-input"
      />
    </div>

    <div v-if="taskStatus === 'running'" text-center op-70 data-test-id="ipv4-cidr-containment-task-status">
      {{ taskMessage }}
    </div>
    <c-alert v-else-if="taskStatus !== 'idle'" type="error" data-test-id="ipv4-cidr-containment-task-status">
      {{ taskMessage }}
    </c-alert>

    <div v-if="analysis" flex flex-col gap-5>
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
  </div>
</template>
