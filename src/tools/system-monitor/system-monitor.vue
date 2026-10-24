<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  refreshSystemMonitor,
  setSystemMonitorPaused,
  startSystemMonitor,
  stopSystemMonitor,
  subscribeSystemMonitor,
} from '@/platform-adapter/system-monitor';
import type {
  SystemMonitorMetric,
  SystemMonitorSample,
} from '@/shared/desktop-services/system-monitor';
import {
  SYSTEM_MONITOR_DEFAULT_INTERVAL_MS,
  SYSTEM_MONITOR_MAX_HISTORY_POINTS,
} from '@/shared/desktop-services/system-monitor';

type MonitorState = 'starting' | 'running' | 'sampling' | 'paused' | 'unsupported' | 'failed';

const monitorMessages = {
  en: {
    localMachine: 'This computer',
    refresh: 'Refresh',
    pause: 'Pause',
    resume: 'Resume',
    sampleFailed: 'The latest system sample could not be read.',
    gap: 'Gap detected; the trend continues from a new baseline.',
    systemCpu: 'Whole-system CPU usage',
    memoryUsed: 'Memory in use',
    disk: 'Disk',
    diskUsed: 'Disk usage',
    diskRead: 'Read',
    diskWrite: 'Write',
    diskFilesystems: (count: number) => `${count} filesystems`,
    network: 'Network',
    networkReceived: 'Received',
    networkTransmitted: 'Sent',
    networkInterfaces: (count: number) => `${count} interfaces`,
    processes: 'Processes',
    processSearch: 'Search process name',
    processSort: 'Sort by',
    processSortCpu: 'CPU',
    processSortMemory: 'Memory',
    processCount: (visible: number, total: number) => `${visible} shown · ${total} total`,
    processPage: (page: number, pages: number) => `Page ${page} / ${pages}`,
    processStarted: 'Started',
    processCpu: 'IT Tools process CPU',
    processMemory: 'IT Tools process memory',
    availableMemory: 'Available memory',
    historyPoints: (count: number) => `${count} samples retained`,
    status: {
      starting: 'Starting sampler…',
      running: 'Sampling',
      sampling: 'Warming up',
      paused: 'Sampling paused',
      unsupported: 'Desktop sampling is unavailable',
      failed: 'Sampling failed',
    },
    metrics: {
      cpu: 'CPU',
      memory: 'Memory',
      process: 'IT Tools process',
      availability: 'Available memory',
    },
  },
  zh: {
    localMachine: '本机',
    refresh: '刷新',
    pause: '暂停',
    resume: '恢复',
    sampleFailed: '最近一次系统采样失败。',
    gap: '检测到采样断档，曲线已从新基线继续。',
    systemCpu: '全机 CPU 使用率',
    memoryUsed: '内存使用率',
    disk: '磁盘',
    diskUsed: '磁盘使用率',
    diskRead: '读取',
    diskWrite: '写入',
    diskFilesystems: (count: number) => `${count} 个文件系统`,
    network: '网络',
    networkReceived: '接收',
    networkTransmitted: '发送',
    networkInterfaces: (count: number) => `${count} 个接口`,
    processes: '进程列表',
    processSearch: '搜索进程名称',
    processSort: '排序方式',
    processSortCpu: 'CPU',
    processSortMemory: '内存',
    processCount: (visible: number, total: number) => `显示 ${visible} 条 · 共 ${total} 条`,
    processPage: (page: number, pages: number) => `第 ${page} / ${pages} 页`,
    processStarted: '启动时间',
    processCpu: 'IT Tools 进程 CPU',
    processMemory: 'IT Tools 进程内存',
    availableMemory: '可用内存',
    historyPoints: (count: number) => `保留 ${count} 个样本`,
    status: {
      starting: '正在启动采集器…',
      running: '正在采样',
      sampling: '正在建立采样基线',
      paused: '已暂停采样',
      unsupported: '桌面采样不可用',
      failed: '采样失败',
    },
    metrics: {
      cpu: 'CPU',
      memory: '内存',
      process: 'IT Tools 进程',
      availability: '可用内存',
    },
  },
} as const;

const { locale } = useI18n();
const copy = computed(() => locale.value.startsWith('zh') ? monitorMessages.zh : monitorMessages.en);
const isChineseLocale = computed(() => locale.value.startsWith('zh'));

const intervalMs = ref(SYSTEM_MONITOR_DEFAULT_INTERVAL_MS);
const state = ref<MonitorState>('starting');
const subscriptionId = ref<string | null>(null);
const samples = ref<SystemMonitorSample[]>([]);
const lastError = ref<string | null>(null);
const processFilter = ref('');
const processSort = ref<'cpu' | 'memory'>('cpu');
const processPage = ref(0);
const processSortOptions = computed(() => [
  { label: copy.value.processSortCpu, value: 'cpu' as const },
  { label: copy.value.processSortMemory, value: 'memory' as const },
]);
const PROCESS_PAGE_SIZE = 100;
const intervalOptions = [
  { label: '1 s', value: 1_000 },
  { label: '2 s', value: 2_000 },
  { label: '5 s', value: 5_000 },
];
let unsubscribe: (() => void) | null = null;

const latestSample = computed(() => samples.value.at(-1) ?? null);
const isPaused = computed(() => state.value === 'paused');
const cpuTrend = computed(() => samples.value.slice(-60).map(sample => sample.cpu.system.value ?? 0));
const memoryTrend = computed(() => samples.value.slice(-60).map(sample => sample.memory.usedPercent.value ?? 0));
const diskUsagePercent = computed(() => {
  const filesystems = latestSample.value?.disk.filesystems ?? [];
  const totalBytes = filesystems.reduce((total, filesystem) => total + (filesystem.sizeBytes ?? 0), 0);
  const usedBytes = filesystems.reduce((total, filesystem) => total + (filesystem.usedBytes ?? 0), 0);
  return totalBytes > 0 ? Math.min(100, Math.max(0, (usedBytes / totalBytes) * 100)) : null;
});
const filteredProcesses = computed(() => {
  const query = processFilter.value.trim().toLowerCase();
  return [...(latestSample.value?.processes.processes ?? [])]
    .filter(process => query.length === 0 || process.name.toLowerCase().includes(query))
    .sort((left, right) => {
      const leftValue = processSort.value === 'cpu' ? left.cpuPercent.value : left.memoryBytes.value;
      const rightValue = processSort.value === 'cpu' ? right.cpuPercent.value : right.memoryBytes.value;
      if (leftValue === null && rightValue === null) {
        return left.name.localeCompare(right.name);
      }
      if (leftValue === null) {
        return 1;
      }
      if (rightValue === null) {
        return -1;
      }
      return rightValue - leftValue;
    });
});
const processPageCount = computed(() => Math.max(1, Math.ceil(filteredProcesses.value.length / PROCESS_PAGE_SIZE)));
const processPageIndex = computed(() => Math.min(processPage.value, processPageCount.value - 1));
const visibleProcesses = computed(() => filteredProcesses.value.slice(
  processPageIndex.value * PROCESS_PAGE_SIZE,
  (processPageIndex.value + 1) * PROCESS_PAGE_SIZE,
));
const processPageLabel = computed(() => copy.value.processPage(processPageIndex.value + 1, processPageCount.value));
const processCountLabel = computed(() => copy.value.processCount(
  filteredProcesses.value.length,
  latestSample.value?.processes.total ?? 0,
));

onMounted(() => {
  unsubscribe = subscribeSystemMonitor(handleSample);
  if (!unsubscribe) {
    state.value = 'unsupported';
    return;
  }
  void startSampler();
});

onBeforeUnmount(() => {
  unsubscribe?.();
  unsubscribe = null;
  if (subscriptionId.value) {
    void stopSystemMonitor(subscriptionId.value);
  }
  subscriptionId.value = null;
});

async function startSampler(): Promise<void> {
  state.value = 'starting';
  lastError.value = null;
  const result = await startSystemMonitor(intervalMs.value);
  if (result.status === 'success') {
    subscriptionId.value = result.value.subscriptionId;
    state.value = result.value.state === 'paused' ? 'paused' : 'sampling';
    return;
  }
  state.value = result.status === 'unsupported' ? 'unsupported' : 'failed';
  lastError.value = result.status === 'failed' ? result.error : null;
}

async function changeInterval(value: number): Promise<void> {
  intervalMs.value = value;
  if (subscriptionId.value) {
    await stopSystemMonitor(subscriptionId.value);
    subscriptionId.value = null;
    await startSampler();
  }
}

async function togglePause(): Promise<void> {
  if (!subscriptionId.value) {
    return;
  }
  const nextPaused = !isPaused.value;
  const result = await setSystemMonitorPaused(subscriptionId.value, nextPaused);
  if (result.status === 'success') {
    state.value = nextPaused ? 'paused' : 'sampling';
    lastError.value = null;
  }
  else if (result.status === 'failed') {
    state.value = 'failed';
    lastError.value = result.error;
  }
}

async function refresh(): Promise<void> {
  if (!subscriptionId.value) {
    return;
  }
  const result = await refreshSystemMonitor(subscriptionId.value);
  if (result.status === 'failed') {
    state.value = 'failed';
    lastError.value = result.error;
  }
}

function handleSample(sample: SystemMonitorSample): void {
  samples.value = [...samples.value, sample].slice(-SYSTEM_MONITOR_MAX_HISTORY_POINTS);
  if (isPaused.value) {
    return;
  }
  if (sample.error) {
    state.value = 'failed';
    lastError.value = sample.error;
  }
  else {
    state.value = sample.cpu.system.status === 'sampling' ? 'sampling' : 'running';
    lastError.value = null;
  }
}

function formatMetric(metric: SystemMonitorMetric | undefined): string {
  if (!metric || metric.value === null) {
    return '—';
  }
  if (metric.unit === 'percent') {
    return `${metric.value.toFixed(1)}%`;
  }
  return formatBytes(metric.value);
}

function formatRate(metric: SystemMonitorMetric | undefined): string {
  const value = formatMetric(metric);
  return value === '—' ? value : `${value}/s`;
}

function setProcessFilter(value: string): void {
  processFilter.value = value;
  processPage.value = 0;
}

function setProcessSort(value: 'cpu' | 'memory'): void {
  processSort.value = value;
  processPage.value = 0;
}

function previousProcessPage(): void {
  processPage.value = Math.max(0, processPageIndex.value - 1);
}

function nextProcessPage(): void {
  processPage.value = Math.min(processPageCount.value - 1, processPageIndex.value + 1);
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${Math.round(value)} B`;
  }
  if (value < 1024 ** 2) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }
  if (value < 1024 ** 3) {
    return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  }
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}

function barStyle(value: number): { height: string } {
  return { height: `${Math.max(4, Math.min(100, value))}%` };
}

function statusKey(): string {
  return copy.value.status[state.value];
}
</script>

<template>
  <section class="system-monitor-workspace" data-test-id="system-monitor-workspace">
    <div class="monitor-toolbar">
      <div class="monitor-heading">
        <div class="monitor-title">{{ copy.localMachine }}</div>
        <div class="monitor-subtitle" data-test-id="system-monitor-status" aria-live="polite">
          {{ statusKey() }}
          <span v-if="latestSample"> · {{ new Date(latestSample.sampledAt).toLocaleTimeString() }}</span>
          <span v-if="latestSample?.gapBefore" data-test-id="system-monitor-gap"> · {{ copy.gap }}</span>
        </div>
      </div>
      <div class="monitor-actions">
        <n-select
          data-test-id="system-monitor-interval"
          :value="intervalMs"
          :options="intervalOptions"
          size="small"
          @update:value="changeInterval"
        />
        <n-button
          data-test-id="system-monitor-refresh"
          size="small"
          :disabled="!subscriptionId"
          @click="refresh"
        >
          {{ copy.refresh }}
        </n-button>
        <n-button
          data-test-id="system-monitor-pause"
          size="small"
          :disabled="!subscriptionId"
          @click="togglePause"
        >
          {{ isPaused ? copy.resume : copy.pause }}
        </n-button>
      </div>
    </div>

    <n-alert v-if="lastError" type="warning" :show-icon="false" mb-4 data-test-id="system-monitor-error">
      {{ copy.sampleFailed }}
    </n-alert>

    <div class="system-monitor-grid">
      <n-card :title="copy.metrics.cpu" data-test-id="system-monitor-cpu-card">
        <div class="metric-value">{{ formatMetric(latestSample?.cpu.system) }}</div>
        <div class="metric-label">{{ copy.systemCpu }}</div>
        <div class="sparkline" data-test-id="system-monitor-cpu-trend" aria-hidden="true">
          <span v-for="(value, index) in cpuTrend" :key="`${index}-${value}`" :style="barStyle(value)" />
        </div>
      </n-card>

      <n-card :title="copy.metrics.memory" data-test-id="system-monitor-memory-card">
        <div class="metric-value">{{ formatMetric(latestSample?.memory.usedPercent) }}</div>
        <div class="metric-label">{{ copy.memoryUsed }}</div>
        <div class="metric-detail">
          {{ formatMetric(latestSample?.memory.used) }} / {{ formatMetric(latestSample?.memory.total) }}
        </div>
        <div class="sparkline" data-test-id="system-monitor-memory-trend" aria-hidden="true">
          <span v-for="(value, index) in memoryTrend" :key="`${index}-${value}`" :style="barStyle(value)" />
        </div>
      </n-card>

      <n-card :title="copy.disk" data-test-id="system-monitor-disk-card">
        <div class="metric-value">{{ diskUsagePercent === null ? '—' : `${diskUsagePercent.toFixed(1)}%` }}</div>
        <div class="metric-label">{{ copy.diskUsed }}</div>
        <div class="metric-detail">
          {{ copy.diskFilesystems(latestSample?.disk.filesystems.length ?? 0) }} · {{ copy.diskRead }} {{ formatRate(latestSample?.disk.readBytesPerSecond) }} · {{ copy.diskWrite }} {{ formatRate(latestSample?.disk.writeBytesPerSecond) }}
        </div>
        <div class="monitor-compact-list">
          <div v-for="filesystem in latestSample?.disk.filesystems.slice(0, 4)" :key="filesystem.id" class="monitor-compact-row">
            <span>{{ filesystem.mount }}</span>
            <span>{{ formatMetric(filesystem.usedPercent) }}</span>
          </div>
        </div>
      </n-card>

      <n-card :title="copy.network" data-test-id="system-monitor-network-card">
        <div class="metric-value">{{ formatRate(latestSample?.network.receivedBytesPerSecond) }}</div>
        <div class="metric-label">{{ copy.networkReceived }}</div>
        <div class="metric-detail">
          {{ copy.networkTransmitted }} {{ formatRate(latestSample?.network.transmittedBytesPerSecond) }} · {{ copy.networkInterfaces(latestSample?.network.interfaces.length ?? 0) }}
        </div>
        <div class="monitor-compact-list">
          <div v-for="networkInterface in latestSample?.network.interfaces.slice(0, 4)" :key="networkInterface.id" class="monitor-compact-row">
            <span>{{ networkInterface.id }}</span>
            <span>{{ networkInterface.operstate }}</span>
          </div>
        </div>
      </n-card>

      <n-card :title="copy.metrics.process" data-test-id="system-monitor-process-card">
        <div class="metric-value">{{ formatMetric(latestSample?.cpu.process) }}</div>
        <div class="metric-label">{{ copy.processCpu }}</div>
        <div class="metric-detail">
          {{ copy.processMemory }}: {{ formatMetric(latestSample?.memory.process) }}
        </div>
      </n-card>

      <n-card :title="copy.metrics.availability" data-test-id="system-monitor-availability-card">
        <div class="metric-value">{{ formatMetric(latestSample?.memory.available) }}</div>
        <div class="metric-label">{{ copy.availableMemory }}</div>
        <div class="metric-detail">
          {{ copy.historyPoints(samples.length) }}
        </div>
      </n-card>
    </div>

    <n-card :title="copy.processes" mt-4 data-test-id="system-monitor-process-list-card">
      <div class="process-toolbar">
        <n-input
          data-test-id="system-monitor-process-search"
          :value="processFilter"
          :placeholder="copy.processSearch"
          clearable
          @update:value="setProcessFilter"
        />
        <n-select
          data-test-id="system-monitor-process-sort"
          :value="processSort"
          :options="processSortOptions"
          :placeholder="copy.processSort"
          @update:value="setProcessSort"
        />
      </div>
      <div class="process-summary" data-test-id="system-monitor-process-summary">
        {{ processCountLabel }} · {{ processPageLabel }}
        <span v-if="latestSample?.processes.truncated"> · {{ isChineseLocale ? '结果已截断' : 'Results truncated' }}</span>
      </div>
      <div v-if="visibleProcesses.length > 0" class="process-table" role="table" data-test-id="system-monitor-process-table">
        <div class="process-table-row process-table-heading" role="row">
          <span role="columnheader">PID</span>
          <span role="columnheader">{{ isChineseLocale ? '名称' : 'Name' }}</span>
          <span role="columnheader">{{ copy.processSortCpu }}</span>
          <span role="columnheader">{{ copy.processSortMemory }}</span>
          <span role="columnheader">{{ copy.processStarted }}</span>
        </div>
        <div v-for="process in visibleProcesses" :key="process.key" class="process-table-row" role="row" data-test-id="system-monitor-process-row">
          <span role="cell">{{ process.pid }}</span>
          <span role="cell" class="process-name" :title="process.name">{{ process.name }}</span>
          <span role="cell">{{ formatMetric(process.cpuPercent) }}</span>
          <span role="cell">{{ formatMetric(process.memoryBytes) }}</span>
          <span role="cell" class="process-started">{{ process.startTime ?? '—' }}</span>
        </div>
      </div>
      <n-empty v-else :description="isChineseLocale ? '暂无进程数据' : 'No process data'" />
      <div class="process-pagination">
        <span>{{ processPageLabel }}</span>
        <div flex gap-2>
          <n-button data-test-id="system-monitor-process-previous" size="small" :disabled="processPageIndex === 0" @click="previousProcessPage">
            {{ isChineseLocale ? '上一页' : 'Previous' }}
          </n-button>
          <n-button data-test-id="system-monitor-process-next" size="small" :disabled="processPageIndex >= processPageCount - 1" @click="nextProcessPage">
            {{ isChineseLocale ? '下一页' : 'Next' }}
          </n-button>
        </div>
      </div>
    </n-card>
  </section>
</template>

<style scoped>
.system-monitor-workspace {
  width: 100%;
}

.monitor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--card-color);
}

.monitor-title {
  font-size: 18px;
  font-weight: 600;
}

.monitor-subtitle,
.metric-label,
.metric-detail {
  color: var(--text-color-3);
  font-size: 12px;
}

.monitor-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.monitor-actions :deep(.n-base-selection) {
  min-width: 84px;
}

.system-monitor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.metric-value {
  font-size: 28px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.metric-detail {
  margin-top: 8px;
  font-variant-numeric: tabular-nums;
}

.monitor-compact-list {
  display: grid;
  gap: 4px;
  margin-top: 12px;
  color: var(--text-color-3);
  font-size: 12px;
}

.monitor-compact-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  overflow: hidden;
  font-variant-numeric: tabular-nums;
}

.monitor-compact-row span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.process-toolbar :deep(.n-input) {
  flex: 1 1 260px;
}

.process-toolbar :deep(.n-select) {
  flex: 0 1 160px;
}

.process-summary,
.process-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-color-3);
  font-size: 12px;
}

.process-summary {
  margin-bottom: 8px;
}

.process-table {
  overflow-x: auto;
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.process-table-row {
  display: grid;
  grid-template-columns: 72px minmax(160px, 1.8fr) 100px 120px minmax(160px, 1.2fr);
  min-width: 680px;
  gap: 12px;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.process-table-row:last-child {
  border-bottom: 0;
}

.process-table-heading {
  color: var(--text-color-3);
  font-weight: 600;
}

.process-name,
.process-started {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-pagination {
  margin-top: 12px;
}

.sparkline {
  display: flex;
  align-items: end;
  gap: 2px;
  height: 52px;
  margin-top: 14px;
  overflow: hidden;
  border-bottom: 1px solid var(--border-color);
}

.sparkline span {
  flex: 1 1 0;
  min-width: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--primary-color);
  opacity: 0.72;
}

@media (max-width: 760px) {
  .monitor-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .monitor-actions {
    flex-wrap: wrap;
  }

  .system-monitor-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .process-summary,
  .process-pagination {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
