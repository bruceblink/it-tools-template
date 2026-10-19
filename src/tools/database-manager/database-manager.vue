<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui';
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import type {
  DatabaseErrorCode,
  DatabaseTlsMode,
  PostgresColumnInfo,
  PostgresDataCell,
  PostgresDataPage,
  PostgresDataPageInput,
  PostgresConnectionProfile,
  PostgresConnectionProfileInput,
  PostgresSchemaInfo,
  PostgresSessionInfo,
  PostgresTableInfo,
} from '@/shared/desktop-services/database';
import {
  connectPostgres,
  cancelDatabaseDataPage,
  deletePostgresProfile,
  disconnectDatabase,
  getDatabaseDataPage,
  getDatabaseStructure,
  listPostgresProfiles,
  listDatabaseSchemas,
  listDatabaseTables,
  savePostgresProfile,
  type DatabaseOperation,
} from '@/platform-adapter/database';

const { t, locale } = useI18n();
const isChineseLocale = computed(() => locale.value.toLowerCase().startsWith('zh'));
const previewText = computed(() => isChineseLocale.value
  ? {
      data: '数据',
      nullValue: 'NULL',
      emptyValue: '空字符串',
      noPrimaryKey: '此表没有主键。当前使用偏移分页；数据变化时，页面可能重复或遗漏行。',
      unsupportedPrimaryKey: '此主键类型不支持稳定游标。当前使用偏移分页；数据变化时，页面可能重复或遗漏行。',
      columnsTruncated: '此表超过 16 列。预览只显示前 16 列。',
      limitReached: '预览已达到安全偏移上限。无法继续查看后续行。',
      noRows: '此表没有数据行。',
      previous: '上一页',
      next: '下一页',
      loading: '正在读取预览…',
      cancel: '取消预览',
      cancelling: '正在取消…',
      cancelled: '预览已取消。连接仍可使用。',
      finishedBeforeCancel: '当前页已完成，没有执行取消。',
    }
  : {
      data: 'Data',
      nullValue: 'NULL',
      emptyValue: 'Empty string',
      noPrimaryKey: 'This table has no primary key. Pages use offset pagination and can shift while rows change.',
      unsupportedPrimaryKey: 'This primary key type does not support a stable cursor. Pages use offset pagination and can shift while rows change.',
      columnsTruncated: 'The table has more than 16 columns. Only the first 16 are shown in the preview.',
      limitReached: 'The preview reached its safe offset limit. Some later rows are not available.',
      noRows: 'This table has no rows.',
      previous: 'Previous',
      next: 'Next',
      loading: 'Loading preview…',
      cancel: 'Cancel preview',
      cancelling: 'Cancelling…',
      cancelled: 'Preview cancelled. The connection is still available.',
      finishedBeforeCancel: 'The page finished before cancellation took effect.',
    });
const profileText = computed(() => isChineseLocale.value
  ? {
      title: '已保存的连接',
      select: '选择连接资料',
      noSavedProfiles: '还没有已保存的连接资料。',
      name: '连接名称',
      namePlaceholder: '例如：本机开发数据库',
      passwordNotSaved: '连接资料不会保存密码。每次连接时都需要输入密码。',
      save: '保存资料',
      delete: '删除资料',
      saved: '连接资料已保存。',
      deleted: '连接资料已删除。',
      storageError: '无法读取或保存连接资料。请检查应用数据目录后重试。',
      limitError: '最多保存 20 个连接资料。请先删除一个资料。',
    }
  : {
      title: 'Saved connections',
      select: 'Choose a connection profile',
      noSavedProfiles: 'No connection profiles have been saved.',
      name: 'Profile name',
      namePlaceholder: 'For example: Local development database',
      passwordNotSaved: 'Connection profiles never save passwords. Enter the password each time you connect.',
      save: 'Save profile',
      delete: 'Delete profile',
      saved: 'Connection profile saved.',
      deleted: 'Connection profile deleted.',
      storageError: 'Could not read or save connection profiles. Check the application data directory and try again.',
      limitError: 'You can save up to 20 connection profiles. Delete one profile before adding another.',
    });
const connectionForm = reactive({
  host: '127.0.0.1',
  port: 5432,
  database: 'postgres',
  username: 'postgres',
  password: '',
  tlsMode: 'verify' as DatabaseTlsMode,
});
const savedProfiles = ref<PostgresConnectionProfile[]>([]);
const selectedProfileId = ref<string | null>(null);
const profileName = ref('');
const profileError = ref<DatabaseErrorCode | null>(null);
const profileNotice = ref<'saved' | 'deleted' | null>(null);
const isLoadingProfiles = ref(false);
const isSavingProfile = ref(false);
const isDeletingProfile = ref(false);
const activeSession = ref<PostgresSessionInfo | null>(null);
const schemas = ref<PostgresSchemaInfo[]>([]);
const tables = ref<PostgresTableInfo[]>([]);
const structure = ref<PostgresColumnInfo[]>([]);
const columnsTruncated = ref(false);
const dataPage = ref<PostgresDataPage | null>(null);
const pageRequests = ref<PostgresDataPageInput[]>([{ cursor: null, offset: 0 }]);
const currentPageIndex = ref(0);
const activeTableTab = ref<'data' | 'structure'>('data');
const selectedSchema = ref<string | null>(null);
const selectedTable = ref<string | null>(null);
const isConnecting = ref(false);
const isLoadingSchemas = ref(false);
const isLoadingTables = ref(false);
const isLoadingStructure = ref(false);
const isLoadingData = ref(false);
const isCancellingData = ref(false);
const activePageRequestId = ref<string | null>(null);
const dataNotice = ref<'cancelled' | 'finished-before-cancel' | null>(null);
const connectionError = ref<DatabaseErrorCode | null>(null);
let tableRequestSequence = 0;
let dataRequestSequence = 0;
const pendingPageCancellations = new Map<string, Promise<DatabaseOperation<boolean>>>();
const confirmedCancelledPageRequests = new Set<string>();

interface DatabaseDataTableRow {
  rowId: string;
  cells: PostgresDataCell[];
}

const schemaOptions = computed(() => schemas.value.map(({ name }) => ({ label: name, value: name })));
const tableOptions = computed(() => tables.value.map(({ name, kind }) => ({ label: `${name} (${kind})`, value: name })));
const tlsOptions = computed(() => [
  { label: t('tools.database-manager.verifyTls'), value: 'verify' },
  { label: t('tools.database-manager.disableTls'), value: 'disable' },
]);
const savedProfileOptions = computed(() => savedProfiles.value.map(profile => ({
  label: `${profile.name} · ${profile.host}/${profile.database}`,
  value: profile.id,
})));
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
const dataColumns = computed<DataTableColumns<DatabaseDataTableRow>>(() => (dataPage.value?.columns ?? []).map((column, index) => ({
  title: `${column.name} · ${column.dataType}`,
  key: `column-${index}`,
  minWidth: 200,
  ellipsis: { tooltip: true },
  render: (row) => {
    const cell = row.cells[index];
    if (!cell) {
      return '—';
    }
    if (cell.value === null) {
      return previewText.value.nullValue;
    }
    if (cell.value === '') {
      return previewText.value.emptyValue;
    }
    return cell.truncated ? `${cell.value}…` : cell.value;
  },
})));
const dataRows = computed<DatabaseDataTableRow[]>(() => (dataPage.value?.rows ?? []).map((row, index) => ({
  rowId: `${currentPageIndex.value}:${index}`,
  cells: row.cells,
})));
const dataTableScrollWidth = computed(() => Math.max(800, (dataPage.value?.columns.length ?? 1) * 200));
const pageLabel = computed(() => isChineseLocale.value
  ? `第 ${currentPageIndex.value + 1} 页 · ${dataPage.value?.rows.length ?? 0} 行`
  : `Page ${currentPageIndex.value + 1} · ${dataPage.value?.rows.length ?? 0} rows`);
const errorMessage = computed(() => connectionError.value
  ? t(`tools.database-manager.errors.${connectionError.value}`)
  : '');
const profileErrorMessage = computed(() => {
  if (profileError.value === 'profile-storage-failed') {
    return profileText.value.storageError;
  }
  if (profileError.value === 'profile-limit-reached') {
    return profileText.value.limitError;
  }
  return profileError.value ? t(`tools.database-manager.errors.${profileError.value}`) : '';
});
const profileNoticeMessage = computed(() => profileNotice.value === 'saved'
  ? profileText.value.saved
  : profileNotice.value === 'deleted' ? profileText.value.deleted : '');

function getStructureRowKey(row: PostgresColumnInfo): string {
  return row.name;
}

function getDataRowKey(row: DatabaseDataTableRow): string {
  return row.rowId;
}

async function refreshSavedProfiles() {
  isLoadingProfiles.value = true;
  profileError.value = null;
  try {
    const result = await listPostgresProfiles();
    if (result.status !== 'success') {
      profileError.value = result.status === 'failed' ? result.error : 'service-unavailable';
      return;
    }
    savedProfiles.value = result.value;
  }
  finally {
    isLoadingProfiles.value = false;
  }
}

function selectSavedProfile(profileId: string | null) {
  selectedProfileId.value = profileId;
  profileError.value = null;
  profileNotice.value = null;
  if (!profileId) {
    profileName.value = '';
    return;
  }

  const profile = savedProfiles.value.find(item => item.id === profileId);
  if (!profile) {
    return;
  }
  profileName.value = profile.name;
  connectionForm.host = profile.host;
  connectionForm.port = profile.port;
  connectionForm.database = profile.database;
  connectionForm.username = profile.username;
  connectionForm.tlsMode = profile.tlsMode;
  connectionForm.password = '';
}

async function saveCurrentProfile() {
  if (isSavingProfile.value) {
    return;
  }
  isSavingProfile.value = true;
  profileError.value = null;
  profileNotice.value = null;
  const input: PostgresConnectionProfileInput = {
    ...(selectedProfileId.value ? { id: selectedProfileId.value } : {}),
    name: profileName.value.trim(),
    host: connectionForm.host,
    port: connectionForm.port,
    database: connectionForm.database,
    username: connectionForm.username,
    tlsMode: connectionForm.tlsMode,
  };
  try {
    const result = await savePostgresProfile(input);
    if (result.status !== 'success') {
      profileError.value = result.status === 'failed' ? result.error : 'service-unavailable';
      return;
    }
    selectedProfileId.value = result.value.id;
    profileName.value = result.value.name;
    await refreshSavedProfiles();
    profileNotice.value = 'saved';
  }
  finally {
    isSavingProfile.value = false;
  }
}

async function deleteSelectedProfile() {
  const profileId = selectedProfileId.value;
  if (!profileId || isDeletingProfile.value) {
    return;
  }
  isDeletingProfile.value = true;
  profileError.value = null;
  profileNotice.value = null;
  try {
    const result = await deletePostgresProfile(profileId);
    if (result.status !== 'success') {
      profileError.value = result.status === 'failed' ? result.error : 'service-unavailable';
      return;
    }
    selectedProfileId.value = null;
    profileName.value = '';
    await refreshSavedProfiles();
    profileNotice.value = 'deleted';
  }
  finally {
    isDeletingProfile.value = false;
  }
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
  const sessionId = activeSession.value?.sessionId;
  const previousPageRequestId = activePageRequestId.value;
  tableRequestSequence += 1;
  dataRequestSequence += 1;
  selectedSchema.value = schema;
  selectedTable.value = null;
  tables.value = [];
  structure.value = [];
  dataPage.value = null;
  dataNotice.value = null;
  activePageRequestId.value = null;
  isLoadingData.value = false;
  columnsTruncated.value = false;
  if (sessionId && previousPageRequestId
    && !await cancelPageBeforeTransition(sessionId, previousPageRequestId)) {
    return;
  }
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
  const sessionId = activeSession.value?.sessionId;
  const previousPageRequestId = activePageRequestId.value;
  const requestSequence = ++tableRequestSequence;
  dataRequestSequence += 1;
  selectedTable.value = table;
  structure.value = [];
  dataPage.value = null;
  pageRequests.value = [{ cursor: null, offset: 0 }];
  currentPageIndex.value = 0;
  activeTableTab.value = 'data';
  columnsTruncated.value = false;
  isLoadingData.value = false;
  dataNotice.value = null;
  activePageRequestId.value = null;
  if (sessionId && previousPageRequestId
    && !await cancelPageBeforeTransition(sessionId, previousPageRequestId)) {
    return;
  }
  const schema = selectedSchema.value;
  if (!table || !schema || !sessionId) {
    return;
  }

  isLoadingStructure.value = true;
  connectionError.value = null;
  try {
    const result = await getDatabaseStructure(sessionId, schema, table);
    if (requestSequence !== tableRequestSequence) {
      return;
    }
    if (result.status !== 'success') {
      setOperationError(result);
      return;
    }
    structure.value = result.value.columns;
    columnsTruncated.value = result.value.columnsTruncated;
    await loadDataPage(0, requestSequence);
  }
  finally {
    isLoadingStructure.value = false;
  }
}

/** Replace stale rows and ignore late responses after a table or page change. */
async function loadDataPage(pageIndex: number, tableSequence: number) {
  const sessionId = activeSession.value?.sessionId;
  const schema = selectedSchema.value;
  const table = selectedTable.value;
  const page = pageRequests.value[pageIndex];
  if (!sessionId || !schema || !table || !page) {
    return;
  }

  const requestSequence = ++dataRequestSequence;
  const requestId = crypto.randomUUID();
  activePageRequestId.value = requestId;
  dataPage.value = null;
  dataNotice.value = null;
  isLoadingData.value = true;
  isCancellingData.value = false;
  connectionError.value = null;
  try {
    const result = await getDatabaseDataPage(sessionId, requestId, schema, table, {
      cursor: page.cursor,
      offset: page.offset,
    });
    const pendingCancellation = pendingPageCancellations.get(requestId);
    if (pendingCancellation) {
      const cancelResult = await pendingCancellation;
      if (cancelResult.status === 'success' && cancelResult.value) {
        confirmedCancelledPageRequests.add(requestId);
      }
    }
    if (tableSequence !== tableRequestSequence || requestSequence !== dataRequestSequence) {
      confirmedCancelledPageRequests.delete(requestId);
      return;
    }
    if (confirmedCancelledPageRequests.delete(requestId)) {
      dataPage.value = null;
      dataNotice.value = 'cancelled';
      return;
    }
    if (result.status !== 'success') {
      setOperationError(result);
      return;
    }
    dataPage.value = result.value;
  }
  finally {
    if (requestSequence === dataRequestSequence) {
      if (activePageRequestId.value === requestId) {
        activePageRequestId.value = null;
      }
      isLoadingData.value = false;
    }
  }
}

function requestPageCancellation(sessionId: string, requestId: string): Promise<DatabaseOperation<boolean>> {
  const pending = pendingPageCancellations.get(requestId);
  if (pending) {
    return pending;
  }
  const cancellation = cancelDatabaseDataPage(sessionId, requestId);
  pendingPageCancellations.set(requestId, cancellation);
  const clearPendingCancellation = () => {
    if (pendingPageCancellations.get(requestId) === cancellation) {
      pendingPageCancellations.delete(requestId);
    }
  };
  void cancellation.then(clearPendingCancellation, clearPendingCancellation);
  return cancellation;
}

async function cancelPageBeforeTransition(sessionId: string, requestId: string): Promise<boolean> {
  const result = await requestPageCancellation(sessionId, requestId);
  if (result.status === 'success') {
    if (result.value) {
      confirmedCancelledPageRequests.add(requestId);
    }
    return true;
  }
  setOperationError(result);
  await disconnect();
  return false;
}

async function cancelCurrentDataPage() {
  const requestId = activePageRequestId.value;
  const sessionId = activeSession.value?.sessionId;
  if (!requestId
    || !sessionId
    || !isLoadingData.value
    || isCancellingData.value
    || confirmedCancelledPageRequests.has(requestId)) {
    return;
  }

  isCancellingData.value = true;
  try {
    const result = await requestPageCancellation(sessionId, requestId);
    if (result.status !== 'success') {
      setOperationError(result);
      void disconnect();
      return;
    }
    if (result.value) {
      confirmedCancelledPageRequests.add(requestId);
      dataPage.value = null;
      dataNotice.value = 'cancelled';
    }
    else {
      dataNotice.value = 'finished-before-cancel';
    }
  }
  finally {
    isCancellingData.value = false;
  }
}

async function previousDataPage() {
  if (isLoadingData.value || currentPageIndex.value === 0) {
    return;
  }
  currentPageIndex.value -= 1;
  await loadDataPage(currentPageIndex.value, tableRequestSequence);
}

async function nextDataPage() {
  if (isLoadingData.value || !dataPage.value?.hasNext) {
    return;
  }
  const nextIndex = currentPageIndex.value + 1;
  if (!pageRequests.value[nextIndex]) {
    const nextRequest: PostgresDataPageInput | null = dataPage.value.pagingMode === 'keyset'
      ? dataPage.value.nextCursor ? { cursor: dataPage.value.nextCursor, offset: 0 } : null
      : dataPage.value.nextOffset !== null ? { cursor: null, offset: dataPage.value.nextOffset } : null;
    if (!nextRequest) {
      return;
    }
    pageRequests.value.splice(nextIndex, pageRequests.value.length - nextIndex, nextRequest);
  }
  currentPageIndex.value = nextIndex;
  await loadDataPage(nextIndex, tableRequestSequence);
}

async function disconnect() {
  tableRequestSequence += 1;
  dataRequestSequence += 1;
  const sessionId = activeSession.value?.sessionId;
  activeSession.value = null;
  schemas.value = [];
  tables.value = [];
  structure.value = [];
  dataPage.value = null;
  selectedSchema.value = null;
  selectedTable.value = null;
  activePageRequestId.value = null;
  isLoadingData.value = false;
  isCancellingData.value = false;
  dataNotice.value = null;
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

onMounted(() => {
  void refreshSavedProfiles();
});

onUnmounted(() => {
  tableRequestSequence += 1;
  dataRequestSequence += 1;
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
        <div class="saved-profile-section" data-test-id="postgres-profile-section">
          <strong>{{ profileText.title }}</strong>
          <n-alert type="info" :show-icon="false">
            {{ profileText.passwordNotSaved }}
          </n-alert>
          <n-alert v-if="profileErrorMessage" type="error" :show-icon="false" role="alert">
            {{ profileErrorMessage }}
          </n-alert>
          <n-alert v-if="profileNoticeMessage" type="success" :show-icon="false">
            {{ profileNoticeMessage }}
          </n-alert>
          <n-form-item data-test-id="postgres-profile-select-field" :label="profileText.select">
            <n-select
              class="profile-select"
              :value="selectedProfileId"
              :options="savedProfileOptions"
              :loading="isLoadingProfiles"
              :placeholder="profileText.noSavedProfiles"
              clearable
              @update:value="selectSavedProfile"
            />
          </n-form-item>
          <div class="profile-form-grid">
            <n-form-item data-test-id="postgres-profile-name-field" :label="profileText.name">
              <n-input v-model:value="profileName" :placeholder="profileText.namePlaceholder" maxlength="80" autocomplete="off" />
            </n-form-item>
            <div class="profile-actions">
              <n-button type="primary" :loading="isSavingProfile" :disabled="isLoadingProfiles" @click="saveCurrentProfile">
                {{ profileText.save }}
              </n-button>
              <n-button :loading="isDeletingProfile" :disabled="!selectedProfileId || isLoadingProfiles" @click="deleteSelectedProfile">
                {{ profileText.delete }}
              </n-button>
            </div>
          </div>
        </div>

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

      <n-card :title="$t('tools.database-manager.availableEngines')">
        <div class="database-engine-list">
          <span>PostgreSQL</span>
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
            data-test-id="database-table-select"
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

      <n-card v-if="selectedTable" mt-4>
        <div v-if="isLoadingData" class="database-page-loading" data-test-id="database-page-loading">
          <span>{{ isCancellingData ? previewText.cancelling : previewText.loading }}</span>
          <n-button
            data-test-id="database-cancel-page"
            :loading="isCancellingData"
            :disabled="isCancellingData || (activePageRequestId !== null && confirmedCancelledPageRequests.has(activePageRequestId))"
            @click="cancelCurrentDataPage"
          >
            {{ previewText.cancel }}
          </n-button>
        </div>
        <n-alert v-if="dataNotice" type="info" :show-icon="false" mb-3 data-test-id="database-page-notice">
          {{ dataNotice === 'cancelled' ? previewText.cancelled : previewText.finishedBeforeCancel }}
        </n-alert>
        <n-tabs v-model:value="activeTableTab" type="line">
          <n-tab-pane name="data" :tab="previewText.data">
            <n-alert v-if="dataPage?.pagingNotice === 'no-primary-key'" type="warning" :show-icon="false" mb-3>
              {{ previewText.noPrimaryKey }}
            </n-alert>
            <n-alert v-else-if="dataPage?.pagingNotice === 'unsupported-primary-key'" type="warning" :show-icon="false" mb-3>
              {{ previewText.unsupportedPrimaryKey }}
            </n-alert>
            <n-alert v-if="dataPage?.columnsTruncated" type="info" :show-icon="false" mb-3>
              {{ previewText.columnsTruncated }}
            </n-alert>
            <n-alert v-if="dataPage?.limitReached" type="info" :show-icon="false" mb-3>
              {{ previewText.limitReached }}
            </n-alert>
            <n-data-table
              data-test-id="database-data-table"
              :columns="dataColumns"
              :data="dataRows"
              :loading="isLoadingData"
              :row-key="getDataRowKey"
              :pagination="false"
              :scroll-x="dataTableScrollWidth"
            />
            <n-empty v-if="!isLoadingData && dataPage?.rows.length === 0" :description="previewText.noRows" mt-4 />
            <div class="database-page-controls">
              <span data-test-id="database-page-summary">{{ pageLabel }}</span>
              <div flex gap-2>
                <n-button data-test-id="database-previous-page" :disabled="isLoadingData || currentPageIndex === 0" @click="previousDataPage">
                  {{ previewText.previous }}
                </n-button>
                <n-button data-test-id="database-next-page" :disabled="isLoadingData || !dataPage?.hasNext" @click="nextDataPage">
                  {{ previewText.next }}
                </n-button>
              </div>
            </div>
          </n-tab-pane>
          <n-tab-pane name="structure" :tab="$t('tools.database-manager.structure')">
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
          </n-tab-pane>
        </n-tabs>
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

.saved-profile-section {
  display: grid;
  gap: 8px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
}

.profile-form-grid {
  display: grid;
  align-items: end;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0 16px;
}

.profile-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-bottom: 24px;
}

.connection-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.database-page-loading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.database-page-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
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
  .connection-form,
  .profile-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .database-page-controls {
    align-items: flex-start;
    flex-direction: column;
  }

  .database-page-loading {
    align-items: flex-start;
    flex-direction: column;
  }

  .profile-actions {
    justify-content: flex-start;
    padding-bottom: 0;
  }
}
</style>
