<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui';
import { onUnmounted, reactive, ref } from 'vue';
import type {
  DatabaseErrorCode,
  DatabaseTlsMode,
  PostgresColumnInfo,
  PostgresSchemaInfo,
  PostgresSessionInfo,
  PostgresTableInfo,
} from '@/shared/desktop-services/database';
import {
  connectPostgres,
  disconnectDatabase,
  getDatabaseStructure,
  listDatabaseSchemas,
  listDatabaseTables,
  type DatabaseOperation,
} from '@/platform-adapter/database';

const { t } = useI18n();
const connectionForm = reactive({
  host: '127.0.0.1',
  port: 5432,
  database: 'postgres',
  username: 'postgres',
  password: '',
  tlsMode: 'verify' as DatabaseTlsMode,
});
const activeSession = ref<PostgresSessionInfo | null>(null);
const schemas = ref<PostgresSchemaInfo[]>([]);
const tables = ref<PostgresTableInfo[]>([]);
const structure = ref<PostgresColumnInfo[]>([]);
const columnsTruncated = ref(false);
const selectedSchema = ref<string | null>(null);
const selectedTable = ref<string | null>(null);
const isConnecting = ref(false);
const isLoadingSchemas = ref(false);
const isLoadingTables = ref(false);
const isLoadingStructure = ref(false);
const connectionError = ref<DatabaseErrorCode | null>(null);

const schemaOptions = computed(() => schemas.value.map(({ name }) => ({ label: name, value: name })));
const tableOptions = computed(() => tables.value.map(({ name, kind }) => ({ label: `${name} (${kind})`, value: name })));
const tlsOptions = computed(() => [
  { label: t('tools.database-manager.verifyTls'), value: 'verify' },
  { label: t('tools.database-manager.disableTls'), value: 'disable' },
]);
const structureColumns = computed<DataTableColumns<PostgresColumnInfo>>(() => [
  { title: t('tools.database-manager.columnName'), key: 'name', minWidth: 180 },
  { title: t('tools.database-manager.dataType'), key: 'dataType', minWidth: 140 },
  {
    title: t('tools.database-manager.nullable'),
    key: 'nullable',
    render: row => row.nullable ? t('tools.database-manager.yes') : t('tools.database-manager.no'),
  },
  {
    title: t('tools.database-manager.defaultValue'),
    key: 'defaultValue',
    render: row => row.defaultValue ?? '—',
  },
  {
    title: t('tools.database-manager.primaryKey'),
    key: 'primaryKey',
    render: row => row.primaryKey ? t('tools.database-manager.yes') : t('tools.database-manager.no'),
  },
]);
const errorMessage = computed(() => connectionError.value
  ? t(`tools.database-manager.errors.${connectionError.value}`)
  : '');

function getStructureRowKey(row: PostgresColumnInfo): string {
  return row.name;
}

/** Send the password once, clear the visible input, and keep the session id only in page memory. */
async function connect() {
  if (isConnecting.value) {
    return;
  }

  connectionError.value = null;
  isConnecting.value = true;
  const input = { ...connectionForm };
  const connection = connectPostgres(input);
  input.password = '';
  connectionForm.password = '';
  try {
    const result = await connection;
    if (result.status !== 'success') {
      setOperationError(result);
      return;
    }
    activeSession.value = result.value;
    await refreshSchemas(result.value.sessionId);
  }
  finally {
    isConnecting.value = false;
  }
}

async function refreshSchemas(sessionId: string) {
  isLoadingSchemas.value = true;
  connectionError.value = null;
  schemas.value = [];
  tables.value = [];
  structure.value = [];
  selectedSchema.value = null;
  selectedTable.value = null;
  try {
    const result = await listDatabaseSchemas(sessionId);
    if (result.status !== 'success') {
      setOperationError(result);
      return;
    }
    schemas.value = result.value;
    const firstSchema = result.value[0]?.name;
    if (firstSchema) {
      await selectSchema(firstSchema);
    }
  }
  finally {
    isLoadingSchemas.value = false;
  }
}

async function selectSchema(schema: string | null) {
  selectedSchema.value = schema;
  selectedTable.value = null;
  tables.value = [];
  structure.value = [];
  columnsTruncated.value = false;
  const sessionId = activeSession.value?.sessionId;
  if (!schema || !sessionId) {
    return;
  }

  isLoadingTables.value = true;
  connectionError.value = null;
  try {
    const result = await listDatabaseTables(sessionId, schema);
    if (result.status !== 'success') {
      setOperationError(result);
      return;
    }
    tables.value = result.value;
    const firstTable = result.value[0]?.name;
    if (firstTable) {
      await selectTable(firstTable);
    }
  }
  finally {
    isLoadingTables.value = false;
  }
}

async function selectTable(table: string | null) {
  selectedTable.value = table;
  structure.value = [];
  columnsTruncated.value = false;
  const sessionId = activeSession.value?.sessionId;
  const schema = selectedSchema.value;
  if (!table || !schema || !sessionId) {
    return;
  }

  isLoadingStructure.value = true;
  connectionError.value = null;
  try {
    const result = await getDatabaseStructure(sessionId, schema, table);
    if (result.status !== 'success') {
      setOperationError(result);
      return;
    }
    structure.value = result.value.columns;
    columnsTruncated.value = result.value.columnsTruncated;
  }
  finally {
    isLoadingStructure.value = false;
  }
}

async function disconnect() {
  const sessionId = activeSession.value?.sessionId;
  activeSession.value = null;
  schemas.value = [];
  tables.value = [];
  structure.value = [];
  selectedSchema.value = null;
  selectedTable.value = null;
  connectionError.value = null;
  if (sessionId) {
    const result = await disconnectDatabase(sessionId);
    if (result.status !== 'success') {
      setOperationError(result);
    }
  }
}

function setOperationError(result: Exclude<DatabaseOperation<unknown>, { status: 'success' }>) {
  connectionError.value = result.status === 'failed' ? result.error : 'service-unavailable';
}

onUnmounted(() => {
  const sessionId = activeSession.value?.sessionId;
  if (sessionId) {
    activeSession.value = null;
    void disconnectDatabase(sessionId);
  }
});
</script>

<template>
  <section class="database-manager-workspace" data-test-id="database-manager-workspace">
    <n-alert type="info" :show-icon="false" mb-4>
      {{ $t('tools.database-manager.stageNotice') }}
    </n-alert>

    <n-alert v-if="errorMessage" type="error" :show-icon="false" mb-4 role="alert">
      {{ errorMessage }}
    </n-alert>

    <div v-if="!activeSession" class="database-manager-grid">
      <n-card :title="$t('tools.database-manager.connectPostgres')">
        <div class="connection-form">
          <n-form-item data-test-id="postgres-host-field" :label="$t('tools.database-manager.host')">
            <n-input v-model:value="connectionForm.host" autocomplete="off" />
          </n-form-item>
          <n-form-item data-test-id="postgres-port-field" :label="$t('tools.database-manager.port')">
            <n-input-number v-model:value="connectionForm.port" :min="1" :max="65535" class="full-width" />
          </n-form-item>
          <n-form-item data-test-id="postgres-database-field" :label="$t('tools.database-manager.database')">
            <n-input v-model:value="connectionForm.database" autocomplete="off" />
          </n-form-item>
          <n-form-item data-test-id="postgres-username-field" :label="$t('tools.database-manager.username')">
            <n-input v-model:value="connectionForm.username" autocomplete="off" />
          </n-form-item>
          <n-form-item data-test-id="postgres-password-field" :label="$t('tools.database-manager.password')">
            <n-input v-model:value="connectionForm.password" type="password" show-password-on="click" autocomplete="new-password" />
          </n-form-item>
          <n-form-item :label="$t('tools.database-manager.tlsMode')">
            <n-select data-test-id="postgres-tls-mode" v-model:value="connectionForm.tlsMode" :options="tlsOptions" />
          </n-form-item>
        </div>

        <n-alert v-if="connectionForm.tlsMode === 'disable'" type="warning" :show-icon="false" mb-3>
          {{ $t('tools.database-manager.disableTlsWarning') }}
        </n-alert>

        <div flex justify-end>
          <n-button type="primary" :loading="isConnecting" @click="connect">
            {{ isConnecting ? $t('tools.database-manager.connecting') : $t('tools.database-manager.connect') }}
          </n-button>
        </div>
      </n-card>

      <n-card :title="$t('tools.database-manager.supportedEngines')">
        <div class="database-engine-list">
          <span>PostgreSQL</span>
          <span>MySQL</span>
          <span>SQLite</span>
        </div>
      </n-card>
    </div>

    <div v-else class="database-manager-browser">
      <n-card mb-4>
        <div class="connection-summary">
          <span>{{ $t('tools.database-manager.activeConnection', { version: activeSession.serverVersion }) }}</span>
          <n-button size="small" @click="disconnect">
            {{ $t('tools.database-manager.disconnect') }}
          </n-button>
        </div>
      </n-card>

      <div class="database-manager-grid">
        <n-card :title="$t('tools.database-manager.schemas')">
          <n-select
            :value="selectedSchema"
            :options="schemaOptions"
            :loading="isLoadingSchemas"
            :placeholder="$t('tools.database-manager.schemas')"
            @update:value="selectSchema"
          />
          <n-empty v-if="!isLoadingSchemas && schemas.length === 0" :description="$t('tools.database-manager.noSchemas')" mt-4 />
        </n-card>

        <n-card :title="$t('tools.database-manager.tables')">
          <n-select
            :value="selectedTable"
            :options="tableOptions"
            :loading="isLoadingTables"
            :disabled="!selectedSchema"
            :placeholder="$t('tools.database-manager.tables')"
            @update:value="selectTable"
          />
          <n-empty v-if="!isLoadingTables && selectedSchema && tables.length === 0" :description="$t('tools.database-manager.noTables')" mt-4 />
        </n-card>
      </div>

      <n-card v-if="selectedTable" :title="$t('tools.database-manager.structure')" mt-4>
        <n-alert v-if="columnsTruncated" type="warning" :show-icon="false" mb-3>
          {{ $t('tools.database-manager.columnsTruncated') }}
        </n-alert>
        <n-data-table
          :columns="structureColumns"
          :data="structure"
          :loading="isLoadingStructure"
          :row-key="getStructureRowKey"
          :pagination="false"
          :scroll-x="820"
        />
        <n-empty v-if="!isLoadingStructure && structure.length === 0" :description="$t('tools.database-manager.noColumns')" mt-4 />
      </n-card>
    </div>
  </section>
</template>

<style scoped>
.database-manager-workspace,
.database-manager-browser {
  width: 100%;
}

.database-manager-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.connection-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}

.connection-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.full-width {
  width: 100%;
}

@media (max-width: 760px) {
  .database-manager-grid,
  .connection-form {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
