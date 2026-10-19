<template>
  <section class="system-monitor-workspace" data-test-id="system-monitor-workspace">
    <n-alert type="info" :show-icon="false" mb-4>
      {{ $t('tools.system-monitor.stageNotice') }}
    </n-alert>

    <div class="system-monitor-grid">
      <n-card v-for="metric in ['cpu', 'memory', 'disk', 'network']" :key="metric" :title="$t(`tools.system-monitor.metrics.${metric}`)">
        <div class="metric-unavailable" aria-live="polite">
          {{ $t('tools.system-monitor.waitingForSampler') }}
        </div>
      </n-card>
    </div>
  </section>
</template>

<style scoped>
.system-monitor-workspace {
  width: 100%;
}

.system-monitor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.metric-unavailable {
  min-height: 96px;
  display: grid;
  place-items: center;
  color: var(--text-color-3);
}

@media (max-width: 760px) {
  .system-monitor-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
