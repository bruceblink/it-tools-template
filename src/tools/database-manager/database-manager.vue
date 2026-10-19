<template>
  <section class="database-manager-workspace" data-test-id="database-manager-workspace">
    <n-alert type="info" :show-icon="false" mb-4>
      {{ $t('tools.database-manager.stageNotice') }}
    </n-alert>

    <div class="database-manager-grid">
      <n-card :title="$t('tools.database-manager.connections')">
        <n-empty :description="$t('tools.database-manager.noConnections')" />
      </n-card>

      <n-card :title="$t('tools.database-manager.supportedEngines')">
        <div class="database-engine-list">
          <span>PostgreSQL</span>
          <span>MySQL</span>
          <span>SQLite</span>
        </div>
      </n-card>
    </div>
  </section>
</template>

<style scoped>
.database-manager-workspace {
  width: 100%;
}

.database-manager-grid {
  display: grid;
  grid-template-columns: minmax(240px, 0.8fr) minmax(320px, 1.2fr);
  gap: 16px;
}

.database-engine-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.database-engine-list span {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 6px 10px;
}

@media (max-width: 760px) {
  .database-manager-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
