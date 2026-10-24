<script setup lang="ts">
import { tryOnBeforeUnmount } from '@vueuse/core';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';
import type { Ipv4CidrOverlapAnalysis } from './ipv4-cidr-overlap-checker.service';
import { useI18n } from 'vue-i18n';

const sampleInput = [
  '10.0.0.0/24',
  '10.0.0.128/25',
  '10.0.1.0/24',
  '192.168.1.0/24',
  '192.168.1.128/25',
].join('\n');

const emptyAnalysis: Ipv4CidrOverlapAnalysis = {
  blocks: [],
  overlaps: [],
  hasOverlaps: false,
  summary: { totalBlocks: 0, overlapCount: 0, coveredAddressCount: 0 },
};

const { t } = useI18n();
const cidrs = ref(sampleInput);
const analysis = shallowRef<Ipv4CidrOverlapAnalysis | null>(emptyAnalysis);
const workerErrorMessage = ref('');
const taskStatus = ref<'idle' | 'running' | 'input-limit' | 'output-limit' | 'timeout' | 'error'>('idle');
const taskMessage = computed(() => {
  if (taskStatus.value === 'running') { return t('taskStatus.calculating'); }
  if (taskStatus.value === 'input-limit' || taskStatus.value === 'output-limit') { return t('taskStatus.limit'); }
  if (taskStatus.value === 'timeout') { return t('taskStatus.timeout'); }
  if (taskStatus.value === 'error') { return workerErrorMessage.value || t('taskStatus.error'); }
  return '';
});

const taskKey = 'ipv4-cidr-overlap-checker';
let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;

// Keep only the newest report active and clear stale tables before another analysis starts.
watch(cidrs, () => {
  const version = ++taskVersion;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
  workerErrorMessage.value = '';
  analysis.value = null;
  taskStatus.value = cidrs.value === '' ? 'idle' : 'running';
  if (cidrs.value === '') {
    analysis.value = emptyAnalysis;
    return;
  }

  taskTimer = setTimeout(async () => {
    const outcome = await taskRunner.run(taskKey, version, {
      kind: 'ipv4-cidr-overlap',
      value: cidrs.value,
    }, taskLimits.ipv4CidrOverlap);
    if (version !== taskVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === 'ipv4-cidr-overlap') {
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

const blockRows = computed<Record<string, unknown>[]>(() => (analysis.value?.blocks ?? []).map(block => ({
  line: block.line,
  cidr: block.cidr,
  networkAddress: block.networkAddress,
  broadcastAddress: block.broadcastAddress,
  addressCount: block.addressCount.toLocaleString(),
})));

const overlapRows = computed<Record<string, unknown>[]>(() => (analysis.value?.overlaps ?? []).map(overlap => ({
  first: `L${overlap.first.line}: ${overlap.first.cidr}`,
  second: `L${overlap.second.line}: ${overlap.second.cidr}`,
  overlapCidr: overlap.overlapCidr,
  overlapRange: `${overlap.overlapStart} - ${overlap.overlapEnd}`,
  relationship: overlap.relationship,
  overlapAddressCount: overlap.overlapAddressCount.toLocaleString(),
})));

const summaryType = computed(() => (analysis.value?.hasOverlaps ? 'warning' : 'success'));

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
  <div w-full min-w-0 flex flex-col gap-5>
    <c-input-text
      v-model:value="cidrs"
      label="IPv4 CIDR blocks"
      placeholder="Paste one IPv4 CIDR block per line..."
      rows="9"
      multiline
      raw-text
      monospace
      autofocus
      test-id="input"
    />

    <div v-if="taskStatus === 'running'" text-center op-70 data-test-id="ipv4-cidr-overlap-task-status">
      {{ taskMessage }}
    </div>
    <c-alert v-else-if="taskStatus !== 'idle'" type="error" data-test-id="ipv4-cidr-overlap-task-status">
      {{ taskMessage }}
    </c-alert>

    <div v-if="analysis" flex flex-col gap-5>
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
  </div>
</template>
