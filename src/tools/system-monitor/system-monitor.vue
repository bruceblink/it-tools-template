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

const intervalMs = ref(SYSTEM_MONITOR_DEFAULT_INTERVAL_MS);
const state = ref<MonitorState>('starting');
const subscriptionId = ref<string | null>(null);
const samples = ref<SystemMonitorSample[]>([]);
const lastError = ref<string | null>(null);
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
}
</style>
