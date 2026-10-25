<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui';
import { h, onMounted, onUnmounted, reactive, ref } from 'vue';
import type {
  DatabaseBatchDeleteRow,
  DatabaseBatchMutationResult,
  DatabaseColumnInfo,
  DatabaseAccessMode,
  DatabaseCellUpdateInput,
  DatabaseDataFilter,
  DatabaseDataFilterOperator,
  DatabaseDataSort,
  DatabaseEngine,
  DatabaseErrorCode,
  DatabaseIndexInfo,
  DatabaseSchemaInfo,
  DatabaseSessionInfo,
  DatabaseQueryPage,
  DatabaseStatementResult,
  DatabaseTableInfo,
  DatabaseTlsMode,
  PostgresDataCell,
  PostgresDataPage,
  PostgresDataPageInput,
  PostgresConnectionProfile,
  PostgresConnectionProfileInput,
} from '@/shared/desktop-services/database';
import {
  connectMySql,
  connectSQLite,
  connectPostgres,
  applyDatabaseBatchMutation,
  cancelDatabaseDataPage,
  cancelDatabaseQuery,
  deletePostgresProfile,
  disconnectDatabase,
  getDatabaseDataPage,
  getDatabaseStructure,
  listPostgresProfiles,
  listDatabaseSchemas,
  listDatabaseTables,
  runDatabaseQuery,
  updateDatabaseCell,
  savePostgresProfile,
  type DatabaseOperation,
} from '@/platform-adapter/database';
import { saveFileContent } from '@/platform-adapter';
import { normalizeDatabaseStatement } from '@/shared/desktop-services/sql-query';
import { serializeDatabasePage, type DatabaseExportFormat } from './database-export';

const { t, locale } = useI18n();
const isChineseLocale = computed(() => locale.value.toLowerCase().startsWith('zh'));
const sqlEditorTitle = computed(() => isChineseLocale.value ? 'SQL 编辑器' : 'SQL editor');
const sqlRunLabel = computed(() => isChineseLocale.value ? '运行 SQL' : 'Run SQL');
const sqlEditorNotice = computed(() => isChineseLocale.value
  ? '支持单条 SELECT、INSERT、UPDATE、DELETE。DDL、事务控制、多条语句、参数占位符以及文件或锁操作会被拒绝。查询最多显示 25 行、16 列和每格 256 个字符；写入最多变更 1,000 行。'
  : 'Run one SELECT, INSERT, UPDATE, or DELETE statement. DDL, transaction control, multiple statements, parameters, file access, and lock commands are rejected. Queries show up to 25 rows, 16 columns, and 256 characters per cell; writes affect at most 1,000 rows.');
const writeAccessLabel = computed(() => isChineseLocale.value ? '启用读写连接' : 'Enable read-write access');
const writeAccessWarning = computed(() => isChineseLocale.value
  ? '此连接将允许 SQL 写入数据库。每条写语句都需要再次确认，单条语句最多变更 1,000 行；优先使用权限受限的数据库账号。'
  : 'This connection allows SQL writes to the database. Each write needs a second confirmation and is limited to 1,000 changed rows; use a least-privilege database account.');
const sqlMutationSummary = computed(() => {
  const result = sqlMutation.value;
  if (!result) {
    return '';
  }
  const statement = result.statement.toUpperCase();
  return isChineseLocale.value
    ? `${statement} 已影响 ${result.affectedRows} 行 · ${result.elapsedMilliseconds} 毫秒`
    : `${statement} affected ${result.affectedRows} ${result.affectedRows === 1 ? 'row' : 'rows'} · ${result.elapsedMilliseconds} ms`;
});
const cellEditorTitle = computed(() => {
  const edit = pendingCellEdit.value;
  if (!edit) {
    return isChineseLocale.value ? '编辑单元格' : 'Edit cell';
  }
  return `${isChineseLocale.value ? '编辑' : 'Edit'} ${edit.input.schema}.${edit.input.table}.${edit.input.column}`;
});
const cellEditHint = computed(() => isChineseLocale.value
  ? '编辑仅在单元格仍保持原值时提交；发生并发修改时会提示刷新。'
  : 'The edit saves only if the cell still has its original value. Refresh if another change conflicts.');
const sqlColumnsTruncatedNotice = computed(() => isChineseLocale.value
  ? '查询返回的列超过 16 列。这里只显示前 16 列。'
  : 'The query returned more than 16 columns. Only the first 16 are shown.');
const sqlLimitReachedNotice = computed(() => isChineseLocale.value
  ? '查询结果达到安全分页上限，无法继续查看后续行。'
  : 'The query reached its safe paging limit. Later rows are not available.');
const sqlNoRowsNotice = computed(() => isChineseLocale.value ? '查询没有返回数据行。' : 'The query returned no rows.');
const resultToolsText = computed(() => isChineseLocale.value
  ? {
      columns: '列显示',
      exportCsv: '导出 CSV',
      exportJsonl: '导出 JSONL',
      currentPage: '仅导出当前页',
      exportStarted: '导出已开始。',
      exportUnsupported: '当前环境不支持文件保存。',
      exportFailed: '导出失败。',
    }
  : {
      columns: 'Columns',
      exportCsv: 'Export CSV',
      exportJsonl: 'Export JSONL',
      currentPage: 'Current page only',
      exportStarted: 'Export started.',
      exportUnsupported: 'File saving is not supported in this environment.',
      exportFailed: 'The export failed.',
    });
const sqlControlText = computed(() => isChineseLocale.value
  ? {
      cancel: '取消查询',
      cancelling: '正在取消查询…',
      cancelled: '查询已取消。连接仍可使用。',
      finishedBeforeCancel: '查询已完成，没有执行取消。',
      history: '查询历史（本次连接）',
      noHistory: '暂无查询历史',
    }
  : {
      cancel: 'Cancel query',
      cancelling: 'Cancelling query…',
      cancelled: 'Query cancelled. The connection is still available.',
      finishedBeforeCancel: 'The query finished before cancellation took effect.',
      history: 'Query history (this connection)',
      noHistory: 'No query history',
    });
const dataViewText = computed(() => isChineseLocale.value
  ? {
      filter: '筛选',
      filterColumn: '筛选列',
      filterOperator: '条件',
      filterValue: '值',
      addFilter: '添加筛选',
      clearFilters: '清除筛选',
      sort: '排序',
      sortColumn: '排序列',
      sortDirection: '顺序',
      applySort: '应用排序',
      clearSort: '清除排序',
      ascending: '升序',
      descending: '降序',
      equals: '等于',
      notEquals: '不等于',
      contains: '包含',
      startsWith: '开头为',
      endsWith: '结尾为',
      isNull: '为 NULL',
      isNotNull: '不为 NULL',
      noFilters: '未设置筛选',
      noSort: '未设置排序',
      filterLimit: '最多添加 3 个筛选条件。',
    }
  : {
      filter: 'Filter',
      filterColumn: 'Filter column',
      filterOperator: 'Condition',
      filterValue: 'Value',
      addFilter: 'Add filter',
      clearFilters: 'Clear filters',
      sort: 'Sort',
      sortColumn: 'Sort column',
      sortDirection: 'Direction',
      applySort: 'Apply sort',
      clearSort: 'Clear sort',
      ascending: 'Ascending',
      descending: 'Descending',
      equals: 'Equals',
      notEquals: 'Not equals',
      contains: 'Contains',
      startsWith: 'Starts with',
      endsWith: 'Ends with',
      isNull: 'Is NULL',
      isNotNull: 'Is not NULL',
      noFilters: 'No filters',
      noSort: 'No sort',
      filterLimit: 'You can add up to 3 filters.',
    });
const stageNotice = computed(() => isChineseLocale.value
  ? '浏览 PostgreSQL、MySQL 和 SQLite 数据库。连接默认只读；可在连接前显式启用 SQL 写入。'
  : 'Browse PostgreSQL, MySQL, and SQLite databases. Connections are read-only by default; enable SQL writes before connecting when needed.');
const engineHeading = computed(() => isChineseLocale.value ? '数据库引擎' : 'Database engine');
const connectDatabaseLabel = computed(() => isChineseLocale.value ? '连接数据库' : 'Connect to a database');
const mysqlNotice = computed(() => isChineseLocale.value
  ? '密码仅用于当前连接，不会保存。'
  : 'The password is used only for this connection and is never saved.');
const previewText = computed(() => isChineseLocale.value
  ? {
      data: '数据',
      nullValue: 'NULL',
      emptyValue: '空字符串',
      noPrimaryKey: '此表没有主键，因此不能安全编辑行；数据变化时，偏移分页可能重复或遗漏行。',
      unsupportedPrimaryKey: '此主键类型不支持稳定游标，因此不能安全编辑行；数据变化时，偏移分页可能重复或遗漏行。',
      offsetPaging: '此引擎使用偏移分页；数据变化时，页面可能重复或遗漏行。',
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
      noPrimaryKey: 'This table has no primary key, so rows cannot be edited safely. Offset pages can shift as data changes.',
      unsupportedPrimaryKey: 'This primary-key type does not support stable cursors, so rows cannot be edited safely. Offset pages can shift as data changes.',
      offsetPaging: 'This engine uses offset pagination. Pages can shift as data changes.',
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
// Keep index labels inside this lazy desktop page so they do not increase the Web application shell.
const indexText = computed(() => isChineseLocale.value
  ? {
      title: '索引',
      name: '名称',
      primary: '主键',
      unique: '唯一',
      method: '方法',
      valid: '有效',
      definition: '定义',
      truncated: '索引超过 64 个，仅显示前 64 个。',
    }
  : {
      title: 'Indexes',
      name: 'Name',
      primary: 'Primary',
      unique: 'Unique',
      method: 'Method',
      valid: 'Valid',
      definition: 'Definition',
      truncated: '64+ indexes; showing 64.',
    });
const connectionForm = reactive({
  host: '127.0.0.1',
  port: 5432,
  database: 'postgres',
  username: 'postgres',
  password: '',
  tlsMode: 'verify' as DatabaseTlsMode,
});
const selectedEngine = ref<DatabaseEngine>('postgres');
const writeAccessEnabled = ref(false);
const lastNetworkEngine = ref<'postgres' | 'mysql'>('postgres');
const savedProfiles = ref<PostgresConnectionProfile[]>([]);
const selectedProfileId = ref<string | null>(null);
const profileName = ref('');
const profileError = ref<DatabaseErrorCode | null>(null);
const profileNotice = ref<'saved' | 'deleted' | null>(null);
const isLoadingProfiles = ref(false);
const isSavingProfile = ref(false);
const isDeletingProfile = ref(false);
const activeSession = ref<DatabaseSessionInfo | null>(null);
const activeEngine = ref<DatabaseEngine | null>(null);
const activeAccessMode = ref<DatabaseAccessMode>('read-only');
const schemas = ref<DatabaseSchemaInfo[]>([]);
const tables = ref<DatabaseTableInfo[]>([]);
const structure = ref<DatabaseColumnInfo[]>([]);
const columnsTruncated = ref(false);
const indexes = ref<DatabaseIndexInfo[]>([]);
const indexesTruncated = ref(false);
const dataPage = ref<PostgresDataPage | null>(null);
const sqlText = ref('SELECT 1');
const sqlPage = ref<DatabaseQueryPage | null>(null);
const sqlMutation = ref<Extract<DatabaseStatementResult, { kind: 'mutation' }> | null>(null);
const sqlPageOffset = ref(0);
const isRunningSql = ref(false);
const sqlError = ref<DatabaseErrorCode | null>(null);
const sqlNotice = ref<'cancelled' | 'finished-before-cancel' | null>(null);
const activeSqlRequestId = ref<string | null>(null);
const isCancellingSql = ref(false);
const sqlHistory = ref<Array<{ id: string; sql: string; offset: number }>>([]);
const selectedSqlHistoryId = ref<string | null>(null);
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
let sqlRequestSequence = 0;
const pendingPageCancellations = new Map<string, Promise<DatabaseOperation<boolean>>>();
const confirmedCancelledPageRequests = new Set<string>();

interface DatabaseDataTableRow {
  rowId: string;
  rowIndex: number;
  cells: PostgresDataCell[];
  primaryKeyValues: string[] | null;
  primaryKeyValuesTruncated: boolean;
}

interface PendingCellEdit {
  source: 'table' | 'query';
  input: Omit<DatabaseCellUpdateInput, 'newValue'>;
  rowIndex: number;
}

const isCellEditorOpen = ref(false);
const isSavingCell = ref(false);
const cellEditError = ref<DatabaseErrorCode | null>(null);
const cellEditValue = ref('');
const cellEditNull = ref(false);
const pendingCellEdit = ref<PendingCellEdit | null>(null);
const hiddenDataColumns = ref<number[]>([]);
const hiddenSqlColumns = ref<number[]>([]);
const exportStatus = ref<'started' | 'unsupported' | 'failed' | null>(null);
const exportStatusSource = ref<'table' | 'query' | null>(null);
const draftDataFilterColumn = ref<string | null>(null);
const draftDataFilterOperator = ref<DatabaseDataFilterOperator>('contains');
const draftDataFilterValue = ref('');
const appliedDataFilters = ref<DatabaseDataFilter[]>([]);
const draftDataSortColumn = ref<string | null>(null);
const draftDataSortDirection = ref<'asc' | 'desc'>('asc');
const appliedDataSort = ref<DatabaseDataSort[]>([]);
const batchInsertDrafts = ref<Array<{ id: string; values: Array<{ column: string; value: string | null }> }>>([]);
const batchDeleteDrafts = ref<DatabaseBatchDeleteRow[]>([]);
const isBatchInsertOpen = ref(false);
const isBatchReviewOpen = ref(false);
const isBatchCommitting = ref(false);
const batchError = ref<DatabaseErrorCode | null>(null);
const batchNotice = ref<DatabaseBatchMutationResult | null>(null);
const batchInsertValues = reactive<Record<string, string>>({});
const batchInsertNullColumns = ref<string[]>([]);

const schemaOptions = computed(() => schemas.value.map(({ name }) => ({ label: name, value: name })));
const tableOptions = computed(() => tables.value.map(({ name, kind }) => ({ label: `${name} (${kind})`, value: name })));
const engineOptions = computed(() => [
  { label: 'PostgreSQL', value: 'postgres' as const },
  { label: 'MySQL', value: 'mysql' as const },
  { label: 'SQLite', value: 'sqlite' as const },
]);
const activeEngineName = computed(() => activeEngine.value === 'mysql'
  ? 'MySQL'
  : activeEngine.value === 'sqlite'
    ? 'SQLite'
    : 'PostgreSQL');
const activeConnectionLabel = computed(() => {
  const session = activeSession.value;
  if (!session || !activeEngine.value) {
    return '';
  }
  if (activeEngine.value === 'sqlite' && 'fileName' in session) {
    return isChineseLocale.value
      ? `已连接 SQLite ${session.serverVersion} · ${session.fileName} · ${activeAccessMode.value === 'read-write' ? '读写' : '只读'}`
      : `Connected to SQLite ${session.serverVersion} · ${session.fileName} · ${activeAccessMode.value}`;
  }
  return isChineseLocale.value
    ? `已连接 ${activeEngineName.value} ${session.serverVersion} · ${activeAccessMode.value === 'read-write' ? '读写' : '只读'}`
    : `Connected to ${activeEngineName.value} ${session.serverVersion} · ${activeAccessMode.value}`;
});
const sqliteNotice = computed(() => isChineseLocale.value
  ? (writeAccessEnabled.value
      ? '所选 SQLite 文件将以读写模式打开；SQL 写入会修改原文件。'
      : '所选 SQLite 文件以只读模式打开。应用不会修改数据库文件。')
  : (writeAccessEnabled.value
      ? 'The selected SQLite file will open read-write; SQL writes change the original file.'
      : 'The selected SQLite file opens read-only. The database file will not be changed.'));
const tlsOptions = computed(() => [
  { label: t('tools.database-manager.verifyTls'), value: 'verify' },
  { label: t('tools.database-manager.disableTls'), value: 'disable' },
]);
const savedProfileOptions = computed(() => savedProfiles.value.map(profile => ({
  label: `${profile.name} · ${profile.host}/${profile.database}`,
  value: profile.id,
})));
const structureColumns = computed<DataTableColumns<DatabaseColumnInfo>>(() => [
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
const indexColumns = computed<DataTableColumns<DatabaseIndexInfo>>(() => [
  { title: indexText.value.name, key: 'name', minWidth: 180 },
  {
    title: indexText.value.primary,
    key: 'primary',
    render: row => row.primary ? t('tools.database-manager.yes') : t('tools.database-manager.no'),
  },
  {
    title: indexText.value.unique,
    key: 'unique',
    render: row => row.unique ? t('tools.database-manager.yes') : t('tools.database-manager.no'),
  },
  { title: indexText.value.method, key: 'method', minWidth: 100 },
  {
    title: indexText.value.valid,
    key: 'valid',
    render: row => row.valid === null ? '—' : row.valid ? t('tools.database-manager.yes') : t('tools.database-manager.no'),
  },
  {
    title: indexText.value.definition,
    key: 'definition',
    minWidth: 480,
    ellipsis: { tooltip: true },
    render: row => row.definitionTruncated ? `${row.definition}…` : row.definition,
  },
]);
const dataColumnOptions = computed(() => (dataPage.value?.columns ?? []).map((column, index) => ({
  index,
  label: `${column.name} · ${column.dataType}`,
})));
const sqlColumnOptions = computed(() => (sqlPage.value?.columns ?? []).map((column, index) => ({
  index,
  label: `${column.name} · ${column.dataType}`,
})));
const dataViewColumnOptions = computed(() => (dataPage.value?.columns ?? []).map(column => ({
  label: `${column.name} · ${column.dataType}`,
  value: column.name,
})));
const filterOperatorOptions = computed(() => [
  { label: dataViewText.value.equals, value: 'equals' as const },
  { label: dataViewText.value.notEquals, value: 'not-equals' as const },
  { label: dataViewText.value.contains, value: 'contains' as const },
  { label: dataViewText.value.startsWith, value: 'starts-with' as const },
  { label: dataViewText.value.endsWith, value: 'ends-with' as const },
  { label: dataViewText.value.isNull, value: 'is-null' as const },
  { label: dataViewText.value.isNotNull, value: 'is-not-null' as const },
]);
const sortDirectionOptions = computed(() => [
  { label: dataViewText.value.ascending, value: 'asc' as const },
  { label: dataViewText.value.descending, value: 'desc' as const },
]);
const isNullDataFilter = computed(() => draftDataFilterOperator.value === 'is-null'
  || draftDataFilterOperator.value === 'is-not-null');
const dataFilterSummary = computed(() => appliedDataFilters.value.length === 0
  ? dataViewText.value.noFilters
  : appliedDataFilters.value.map(formatDataFilter).join(' · '));
const dataSortSummary = computed(() => {
  const sort = appliedDataSort.value[0];
  if (!sort) {
    return dataViewText.value.noSort;
  }
  const direction = sort.direction === 'asc' ? dataViewText.value.ascending : dataViewText.value.descending;
  return `${sort.column} · ${direction}`;
});
const visibleDataColumnIndexes = computed(() => (dataPage.value?.columns ?? [])
  .map((_, index) => index)
  .filter(index => !hiddenDataColumns.value.includes(index)));
const visibleSqlColumnIndexes = computed(() => (sqlPage.value?.columns ?? [])
  .map((_, index) => index)
  .filter(index => !hiddenSqlColumns.value.includes(index)));
const batchEditableColumns = computed(() => activeEngine.value
  ? structure.value.filter(column => isEditableUiType(activeEngine.value!, column.dataType))
  : []);
const batchDeleteAvailable = computed(() => activeAccessMode.value === 'read-write'
  && dataPage.value?.editable === true
  && dataPage.value.columnsTruncated === false
  && structure.value.length === (dataPage.value?.columns.length ?? 0)
  && activeEngine.value !== null
  && structure.value.every(column => isEditableUiType(activeEngine.value!, column.dataType)));
const batchSummary = computed(() => {
  const inserts = batchInsertDrafts.value.length;
  const deletes = batchDeleteDrafts.value.length;
  return isChineseLocale.value
    ? `新增 ${inserts} · 删除 ${deletes}`
    : `${inserts} inserts · ${deletes} deletes`;
});
const batchNoticeMessage = computed(() => {
  const result = batchNotice.value;
  if (!result) {
    return '';
  }
  return isChineseLocale.value
    ? `已提交 ${result.insertedRows} 条新增和 ${result.deletedRows} 条删除。`
    : `Committed ${result.insertedRows} inserts and ${result.deletedRows} deletes.`;
});
const dataColumns = computed<DataTableColumns<DatabaseDataTableRow>>(() => [
  ...(batchDeleteAvailable.value ? [{
    title: isChineseLocale.value ? '批量' : 'Batch',
    key: 'batch-action',
    width: 100,
    render: (row: DatabaseDataTableRow) => h('button', {
      class: 'database-batch-row-action',
      type: 'button',
      'data-test-id': `database-batch-delete-${row.rowId}`,
      onClick: () => toggleBatchDelete(row),
    }, isBatchDeleteMarked(row) ? (isChineseLocale.value ? '取消删除' : 'Undo delete') : (isChineseLocale.value ? '标记删除' : 'Mark delete')),
  } satisfies DataTableColumns<DatabaseDataTableRow>[number]] : []),
  ...visibleDataColumnIndexes.value
  .map(index => {
    const column = dataPage.value?.columns[index];
    if (!column) {
      return null;
    }
    return {
    title: `${column.name} · ${column.dataType}`,
    key: `column-${index}`,
    minWidth: 200,
    ellipsis: { tooltip: true },
    render: (row: DatabaseDataTableRow) => renderEditableCell('table', row, index, column.name, column.dataType),
    };
  })
  .filter((column): column is NonNullable<typeof column> => column !== null)
]);
const dataRows = computed<DatabaseDataTableRow[]>(() => (dataPage.value?.rows ?? []).map((row, index) => ({
  rowId: `${currentPageIndex.value}:${index}`,
  rowIndex: index,
  cells: row.cells,
  primaryKeyValues: row.primaryKeyValues,
  primaryKeyValuesTruncated: row.primaryKeyValuesTruncated,
})));
const sqlResultColumns = computed<DataTableColumns<DatabaseDataTableRow>>(() => visibleSqlColumnIndexes.value
  .map(index => {
    const column = sqlPage.value?.columns[index];
    if (!column) {
      return null;
    }
    return {
    title: `${column.name} · ${column.dataType}`,
    key: `column-${index}`,
    minWidth: 200,
    ellipsis: { tooltip: true },
    render: (row: DatabaseDataTableRow) => renderEditableCell('query', row, index, column.name, column.dataType),
    };
  })
  .filter((column): column is NonNullable<typeof column> => column !== null));
const sqlResultRows = computed<DatabaseDataTableRow[]>(() => (sqlPage.value?.rows ?? []).map((row, index) => ({
  rowId: `${sqlPageOffset.value}:${index}`,
  rowIndex: index,
  cells: row.cells,
  primaryKeyValues: null,
  primaryKeyValuesTruncated: false,
})));
const sqlPageSummary = computed(() => isChineseLocale.value
  ? `第 ${Math.floor(sqlPageOffset.value / 25) + 1} 页 · ${sqlPage.value?.rows.length ?? 0} 行 · ${sqlPage.value?.elapsedMilliseconds ?? 0} 毫秒`
  : `Page ${Math.floor(sqlPageOffset.value / 25) + 1} · ${sqlPage.value?.rows.length ?? 0} ${sqlPage.value?.rows.length === 1 ? 'row' : 'rows'} · ${sqlPage.value?.elapsedMilliseconds ?? 0} ms`);
const sqlResultScrollWidth = computed(() => Math.max(800, visibleSqlColumnIndexes.value.length * 200));
const sqlErrorMessage = computed(() => sqlError.value
  ? databaseErrorText(sqlError.value)
  : '');
const sqlNoticeMessage = computed(() => sqlNotice.value === 'cancelled'
  ? sqlControlText.value.cancelled
  : sqlNotice.value === 'finished-before-cancel' ? sqlControlText.value.finishedBeforeCancel : '');
const sqlHistoryOptions = computed(() => sqlHistory.value.map(entry => ({
  label: `${entry.sql.slice(0, 96)}${entry.sql.length > 96 ? '…' : ''}${entry.offset > 0 ? ` · ${entry.offset}` : ''}`,
  value: entry.id,
})));
const dataTableScrollWidth = computed(() => Math.max(800, visibleDataColumnIndexes.value.length * 200));
const pageLabel = computed(() => isChineseLocale.value
  ? `第 ${currentPageIndex.value + 1} 页 · ${dataPage.value?.rows.length ?? 0} 行`
  : `Page ${currentPageIndex.value + 1} · ${dataPage.value?.rows.length ?? 0} rows`);
const errorMessage = computed(() => connectionError.value
  ? databaseErrorText(connectionError.value)
  : '');
const exportStatusMessage = computed(() => exportStatus.value === 'started'
  ? resultToolsText.value.exportStarted
  : exportStatus.value === 'unsupported'
    ? resultToolsText.value.exportUnsupported
    : exportStatus.value === 'failed' ? resultToolsText.value.exportFailed : '');
const exportStatusType = computed<'success' | 'error'>(() => exportStatus.value === 'started' ? 'success' : 'error');
const profileErrorMessage = computed(() => {
  if (profileError.value === 'profile-storage-failed') {
    return profileText.value.storageError;
  }
  if (profileError.value === 'profile-limit-reached') {
    return profileText.value.limitError;
  }
  return profileError.value ? databaseErrorText(profileError.value) : '';
});
const profileNoticeMessage = computed(() => profileNotice.value === 'saved'
  ? profileText.value.saved
  : profileNotice.value === 'deleted' ? profileText.value.deleted : '');

function getStructureRowKey(row: DatabaseColumnInfo): string {
  return row.name;
}

function databaseErrorText(error: DatabaseErrorCode): string {
  if (error === 'write-disabled') {
    return isChineseLocale.value
      ? '当前连接为只读模式。重新连接并启用读写权限后才能写入。'
      : 'This connection is read-only. Reconnect with read-write access to write data.';
  }
  if (error === 'write-limit-exceeded') {
    return isChineseLocale.value
      ? '此语句报告的直接变更行数超过 1,000，事务已回滚。'
      : 'The statement reports more than 1,000 directly affected rows and was rolled back.';
  }
  if (error === 'write-result-unknown') {
    return isChineseLocale.value
      ? '提交期间连接中断。请先重新读取当前数据，再决定是否重试。'
      : 'The connection was interrupted while committing. Read the current data before retrying.';
  }
  if (error === 'write-conflict') {
    return isChineseLocale.value
      ? '此行在读取后已发生变化。请刷新数据，再重新应用编辑。'
      : 'This row changed after it was loaded. Refresh the data and apply your edit again.';
  }
  return t(`tools.database-manager.errors.${error}`);
}

function getIndexRowKey(row: DatabaseIndexInfo): string {
  return row.name;
}

function getDataRowKey(row: DatabaseDataTableRow): string {
  return row.rowId;
}

/** Keep one visible column so the grid and export always have a usable shape. */
function setColumnVisibility(source: 'table' | 'query', index: number, visible: boolean) {
  const columns = source === 'table' ? dataPage.value?.columns ?? [] : sqlPage.value?.columns ?? [];
  const hidden = source === 'table' ? hiddenDataColumns : hiddenSqlColumns;
  if (!visible && columns.length - hidden.value.length <= 1) {
    return;
  }
  hidden.value = visible
    ? hidden.value.filter(columnIndex => columnIndex !== index)
    : hidden.value.includes(index) ? hidden.value : [...hidden.value, index];
}

/** Export the visible columns from the currently loaded bounded page. */
function exportCurrentPage(source: 'table' | 'query', format: DatabaseExportFormat) {
  const page = source === 'table' ? dataPage.value : sqlPage.value;
  if (!page || page.rows.length === 0) {
    return;
  }
  const visibleIndexes = source === 'table' ? visibleDataColumnIndexes.value : visibleSqlColumnIndexes.value;
  const columns = visibleIndexes.map(index => page.columns[index]).filter((column): column is { name: string; dataType: string } => column !== undefined);
  const rows = page.rows.map(row => ({
    cells: visibleIndexes.map(index => row.cells[index] ?? { value: null, truncated: false }),
  }));
  const content = serializeDatabasePage(columns, rows, format);
  const scope = source === 'table'
    ? `${selectedTable.value ?? 'table'}-page-${currentPageIndex.value + 1}`
    : `query-page-${Math.floor(sqlPageOffset.value / 25) + 1}`;
  const result = saveFileContent(
    content,
    `${scope}.${format}`,
    format === 'csv' ? 'text/csv;charset=utf-8' : 'application/x-ndjson;charset=utf-8',
  );
  exportStatusSource.value = source;
  exportStatus.value = result.status === 'denied' ? 'failed' : result.status;
}

function resetBatchDrafts() {
  batchInsertDrafts.value = [];
  batchDeleteDrafts.value = [];
  batchError.value = null;
  isBatchInsertOpen.value = false;
  isBatchReviewOpen.value = false;
  batchInsertNullColumns.value = [];
  for (const column of Object.keys(batchInsertValues)) {
    delete batchInsertValues[column];
  }
}

function openBatchInsert() {
  if (!activeSession.value || !selectedTable.value || batchEditableColumns.value.length === 0) {
    return;
  }
  for (const column of batchEditableColumns.value) {
    batchInsertValues[column.name] = '';
  }
  batchInsertNullColumns.value = [];
  batchError.value = null;
  isBatchInsertOpen.value = true;
}

function addBatchInsertDraft() {
  if (batchEditableColumns.value.length === 0) {
    return;
  }
  const values = batchEditableColumns.value.map(column => ({
    column: column.name,
    value: batchInsertNullColumns.value.includes(column.name) ? null : batchInsertValues[column.name] ?? '',
  }));
  batchInsertDrafts.value = [
    ...batchInsertDrafts.value,
    { id: crypto.randomUUID(), values },
  ];
  isBatchInsertOpen.value = false;
}

function removeBatchInsertDraft(id: string) {
  batchInsertDrafts.value = batchInsertDrafts.value.filter(draft => draft.id !== id);
}

function isBatchDeleteMarked(row: DatabaseDataTableRow): boolean {
  if (!row.primaryKeyValues) {
    return false;
  }
  return batchDeleteDrafts.value.some(draft => draft.primaryKeys.every((key, index) => key.value === row.primaryKeyValues?.[index]));
}

function toggleBatchDelete(row: DatabaseDataTableRow) {
  if (!batchDeleteAvailable.value
    || !dataPage.value
    || !row.primaryKeyValues
    || row.primaryKeyValuesTruncated
    || row.cells.length !== dataPage.value.columns.length
    || row.cells.some(cell => cell.truncated)) {
    return;
  }
  const existingIndex = batchDeleteDrafts.value.findIndex(draft => draft.primaryKeys.every((key, index) => key.value === row.primaryKeyValues?.[index]));
  if (existingIndex >= 0) {
    batchDeleteDrafts.value = batchDeleteDrafts.value.filter((_draft, index) => index !== existingIndex);
    return;
  }
  batchDeleteDrafts.value = [
    ...batchDeleteDrafts.value,
    {
      primaryKeys: dataPage.value.primaryKeyColumns.map((column, index) => ({
        column,
        value: row.primaryKeyValues![index]!,
      })),
      originalValues: dataPage.value.columns.map((column, index) => ({
        column: column.name,
        value: row.cells[index]?.value ?? null,
      })),
    },
  ];
}

function removeBatchDeleteDraft(index: number) {
  batchDeleteDrafts.value = batchDeleteDrafts.value.filter((_draft, draftIndex) => draftIndex !== index);
}

function reviewBatchDrafts() {
  if (batchInsertDrafts.value.length === 0 && batchDeleteDrafts.value.length === 0) {
    return;
  }
  batchError.value = null;
  isBatchReviewOpen.value = true;
}

async function commitBatchDrafts() {
  const sessionId = activeSession.value?.sessionId;
  const schema = selectedSchema.value;
  const table = selectedTable.value;
  if (!sessionId || !schema || !table || (batchInsertDrafts.value.length === 0 && batchDeleteDrafts.value.length === 0) || isBatchCommitting.value) {
    return;
  }
  isBatchCommitting.value = true;
  batchError.value = null;
  try {
    const result = await applyDatabaseBatchMutation(sessionId, {
      schema,
      table,
      inserts: batchInsertDrafts.value.map(draft => ({
        values: draft.values.map(value => ({ column: value.column, value: value.value })),
      })),
      deletes: batchDeleteDrafts.value.map(draft => ({
        primaryKeys: draft.primaryKeys.map(key => ({ column: key.column, value: key.value })),
        originalValues: draft.originalValues.map(value => ({ column: value.column, value: value.value })),
      })),
    });
    if (result.status !== 'success') {
      batchError.value = result.status === 'failed' ? result.error : 'service-unavailable';
      return;
    }
    if (result.value.kind === 'cancelled') {
      isBatchReviewOpen.value = false;
      return;
    }
    batchNotice.value = result.value;
    resetBatchDrafts();
    await loadDataPage(currentPageIndex.value, tableRequestSequence);
  }
  finally {
    isBatchCommitting.value = false;
  }
}

function formatDataFilter(filter: DatabaseDataFilter): string {
  const operator = filterOperatorOptions.value.find(option => option.value === filter.operator)?.label ?? filter.operator;
  const value = filter.value === null ? '' : ` ${filter.value}`;
  return `${filter.column} ${operator}${value}`;
}

function cloneDataFilters(filters: readonly DatabaseDataFilter[]): DatabaseDataFilter[] {
  return filters.map(filter => ({
    column: filter.column,
    operator: filter.operator,
    value: filter.value,
  }));
}

function cloneDataSort(filters: readonly DatabaseDataSort[]): DatabaseDataSort[] {
  return filters.map(sort => ({
    column: sort.column,
    direction: sort.direction,
  }));
}

function resetDataViewOptions() {
  draftDataFilterColumn.value = null;
  draftDataFilterOperator.value = 'contains';
  draftDataFilterValue.value = '';
  appliedDataFilters.value = [];
  draftDataSortColumn.value = null;
  draftDataSortDirection.value = 'asc';
  appliedDataSort.value = [];
}

/** Reload the first bounded page after changing server-side view options. */
async function applyDataViewOptions() {
  const sessionId = activeSession.value?.sessionId;
  const schema = selectedSchema.value;
  const table = selectedTable.value;
  if (!sessionId || !schema || !table) {
    return;
  }
  const previousPageRequestId = activePageRequestId.value;
  const requestSequence = ++tableRequestSequence;
  dataRequestSequence += 1;
  if (previousPageRequestId && !await cancelPageBeforeTransition(sessionId, previousPageRequestId)) {
    return;
  }
  const filters = cloneDataFilters(appliedDataFilters.value);
  const sort = cloneDataSort(appliedDataSort.value);
  pageRequests.value = [{
    cursor: null,
    offset: 0,
    ...(filters.length > 0 ? { filters } : {}),
    ...(sort.length > 0 ? { sort } : {}),
  }];
  currentPageIndex.value = 0;
  dataPage.value = null;
  dataNotice.value = null;
  activePageRequestId.value = null;
  isLoadingData.value = false;
  activeTableTab.value = 'data';
  await loadDataPage(0, requestSequence);
}

function addDataFilter() {
  const column = draftDataFilterColumn.value;
  if (!column || appliedDataFilters.value.length >= 3) {
    return;
  }
  const value = isNullDataFilter.value ? null : draftDataFilterValue.value;
  appliedDataFilters.value = [
    ...appliedDataFilters.value,
    { column, operator: draftDataFilterOperator.value, value },
  ];
  void applyDataViewOptions();
}

function removeDataFilter(index: number) {
  appliedDataFilters.value = appliedDataFilters.value.filter((_filter, filterIndex) => filterIndex !== index);
  void applyDataViewOptions();
}

function clearDataFilters() {
  if (appliedDataFilters.value.length === 0) {
    return;
  }
  appliedDataFilters.value = [];
  void applyDataViewOptions();
}

function applyDataSort() {
  const column = draftDataSortColumn.value;
  if (!column) {
    return;
  }
  appliedDataSort.value = [{ column, direction: draftDataSortDirection.value }];
  void applyDataViewOptions();
}

function clearDataSort() {
  if (appliedDataSort.value.length === 0) {
    return;
  }
  appliedDataSort.value = [];
  void applyDataViewOptions();
}

function displayDatabaseCell(cell: PostgresDataCell | undefined): string {
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
}

function renderEditableCell(
  source: 'table' | 'query',
  row: DatabaseDataTableRow,
  columnIndex: number,
  columnName: string,
  dataType: string,
) {
  const cell = row.cells[columnIndex];
  const label = displayDatabaseCell(cell);
  if (!cell || !isCellEditable(source, row, columnIndex, columnName, dataType)) {
    return label;
  }
  return h('button', {
    class: 'database-edit-cell',
    type: 'button',
    title: isChineseLocale.value ? '编辑单元格' : 'Edit cell',
    onClick: () => beginCellEdit(source, row, columnIndex, columnName),
  }, label);
}

function isCellEditable(
  source: 'table' | 'query',
  row: DatabaseDataTableRow,
  columnIndex: number,
  columnName: string,
  dataType: string,
): boolean {
  const engine = activeEngine.value;
  const cell = row.cells[columnIndex];
  if (!engine || activeAccessMode.value !== 'read-write' || !cell || cell.truncated
    || (cell.value?.startsWith('0x') ?? false) || !isEditableUiType(engine, dataType)) {
    return false;
  }
  if (source === 'table') {
    return dataPage.value?.editable === true
      && !row.primaryKeyValuesTruncated
      && row.primaryKeyValues !== null
      && row.primaryKeyValues.length === dataPage.value.primaryKeyColumns.length;
  }
  const target = sqlPage.value?.editableTarget;
  return target !== undefined
    && target.editableColumns.includes(columnName)
    && target.primaryKeyColumns.every(key => {
      const keyIndex = sqlPage.value?.columns.findIndex(column => column.name === key) ?? -1;
      const keyCell = keyIndex >= 0 ? row.cells[keyIndex] : undefined;
      return keyCell !== undefined && !keyCell.truncated && keyCell.value !== null;
    });
}

function isEditableUiType(engine: DatabaseEngine, type: string): boolean {
  const value = type.toLowerCase();
  if (engine === 'postgres') {
    return /^(?:smallint|integer|bigint|numeric|decimal|real|double precision|boolean|character varying|character|text|date|time(?: without time zone| with time zone)?|timestamp(?: without time zone| with time zone)?|uuid|json|jsonb|user-defined)$/.test(value);
  }
  if (engine === 'mysql') {
    return /^(?:tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|bit|bool|boolean|char|varchar|tinytext|text|mediumtext|longtext|date|datetime|timestamp|time|year|json|enum|set)(?:\b|\()/.test(value);
  }
  return !/(?:blob|binary|varbinary)/.test(value);
}

function beginCellEdit(source: 'table' | 'query', row: DatabaseDataTableRow, columnIndex: number, column: string) {
  if (!activeSession.value || !activeEngine.value || activeAccessMode.value !== 'read-write') {
    return;
  }
  const currentCell = row.cells[columnIndex];
  if (!currentCell || currentCell.truncated) {
    return;
  }
  let schema: string;
  let table: string;
  let keyValues: Array<{ column: string; value: string }>;
  if (source === 'table') {
    if (!dataPage.value?.editable || row.primaryKeyValuesTruncated || !selectedSchema.value || !selectedTable.value || !row.primaryKeyValues) {
      return;
    }
    schema = selectedSchema.value;
    table = selectedTable.value;
    keyValues = dataPage.value.primaryKeyColumns.map((key, index) => ({
      column: key,
      value: row.primaryKeyValues![index]!,
    }));
  }
  else {
    const target = sqlPage.value?.editableTarget;
    if (!target) {
      return;
    }
    schema = target.schema;
    table = target.table;
    keyValues = [];
    for (const key of target.primaryKeyColumns) {
      const keyIndex = sqlPage.value?.columns.findIndex(item => item.name === key) ?? -1;
      const keyCell = keyIndex >= 0 ? row.cells[keyIndex] : undefined;
      if (!keyCell || keyCell.truncated || keyCell.value === null) {
        return;
      }
      keyValues.push({ column: key, value: keyCell.value });
    }
  }
  if (keyValues.length === 0 || keyValues.some(key => key.value.length > 4096)) {
    return;
  }
  pendingCellEdit.value = {
    source,
    rowIndex: row.rowIndex,
    input: { schema, table, column, primaryKeys: keyValues, originalValue: currentCell.value },
  };
  cellEditValue.value = currentCell.value ?? '';
  cellEditNull.value = currentCell.value === null;
  cellEditError.value = null;
  isCellEditorOpen.value = true;
}

async function saveCellEdit() {
  const sessionId = activeSession.value?.sessionId;
  const edit = pendingCellEdit.value;
  if (!sessionId || !edit || isSavingCell.value) {
    return;
  }
  // Build a structured-clone-safe snapshot before crossing the Electron IPC boundary.
  const input: DatabaseCellUpdateInput = {
    schema: edit.input.schema,
    table: edit.input.table,
    column: edit.input.column,
    primaryKeys: edit.input.primaryKeys.map(key => ({ column: key.column, value: key.value })),
    originalValue: edit.input.originalValue,
    newValue: cellEditNull.value ? null : cellEditValue.value,
  };
  isSavingCell.value = true;
  cellEditError.value = null;
  try {
    const result = await updateDatabaseCell(sessionId, input);
    if (result.status !== 'success') {
      cellEditError.value = result.status === 'failed' ? result.error : 'service-unavailable';
      return;
    }
    isCellEditorOpen.value = false;
    pendingCellEdit.value = null;
    if (result.value && edit.source === 'table') {
      await loadDataPage(currentPageIndex.value, tableRequestSequence);
    }
    else if (result.value) {
      await executeSqlStatement(sqlText.value, sqlPageOffset.value);
    }
  }
  finally {
    isSavingCell.value = false;
  }
}

function closeCellEditor() {
  if (isSavingCell.value) {
    return;
  }
  isCellEditorOpen.value = false;
  pendingCellEdit.value = null;
  cellEditError.value = null;
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

/** Change only untouched network defaults and clear PostgreSQL profile state for non-PostgreSQL engines. */
function selectEngine(engine: DatabaseEngine) {
  const previousEngine = selectedEngine.value;
  if (engine === previousEngine) {
    return;
  }
  selectedEngine.value = engine;
  const previousNetworkEngine = previousEngine === 'sqlite' ? lastNetworkEngine.value : previousEngine;
  if (engine !== 'sqlite' && previousNetworkEngine !== engine) {
    const previousDefaultPort = previousNetworkEngine === 'mysql' ? 3306 : 5432;
    if (connectionForm.port === previousDefaultPort) {
      connectionForm.port = engine === 'mysql' ? 3306 : 5432;
    }
  }
  if (engine !== 'sqlite') {
    lastNetworkEngine.value = engine;
  }
  if (engine !== 'postgres') {
    selectedProfileId.value = null;
    profileName.value = '';
  }
  if (engine === 'mysql') {
    if (connectionForm.database === 'postgres') {
      connectionForm.database = '';
    }
    if (connectionForm.username === 'postgres') {
      connectionForm.username = '';
    }
  }
  else if (engine === 'postgres') {
    if (!connectionForm.database) {
      connectionForm.database = 'postgres';
    }
    if (!connectionForm.username) {
      connectionForm.username = 'postgres';
    }
  }
  connectionForm.password = '';
  profileError.value = null;
  profileNotice.value = null;
  connectionError.value = null;
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

/** Send the password only for the current connection, clear the field, and retain the session id in page memory. */
async function connect() {
  if (isConnecting.value) {
    return;
  }

  connectionError.value = null;
  sqlRequestSequence += 1;
  sqlPage.value = null;
  sqlMutation.value = null;
  sqlPageOffset.value = 0;
  sqlError.value = null;
  sqlNotice.value = null;
  sqlHistory.value = [];
  selectedSqlHistoryId.value = null;
  isConnecting.value = true;
  try {
    if (selectedEngine.value === 'sqlite') {
      const accessMode = writeAccessEnabled.value ? 'read-write' : 'read-only';
      const result = await connectSQLite(accessMode);
      if (result.status !== 'success') {
        setOperationError(result);
        return;
      }
      if (!result.value) {
        return;
      }
      activeSession.value = result.value;
      activeEngine.value = 'sqlite';
      activeAccessMode.value = result.value.accessMode ?? accessMode;
      await refreshSchemas(result.value.sessionId);
      return;
    }

    const input = {
      ...connectionForm,
      accessMode: writeAccessEnabled.value ? 'read-write' as const : 'read-only' as const,
    };
    const result = selectedEngine.value === 'mysql'
      ? await connectMySql(input)
      : await connectPostgres(input);
    input.password = '';
    connectionForm.password = '';
    if (result.status !== 'success') {
      setOperationError(result);
      return;
    }
    activeSession.value = result.value;
    activeEngine.value = selectedEngine.value;
    activeAccessMode.value = result.value.accessMode ?? input.accessMode;
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
  indexes.value = [];
  indexesTruncated.value = false;
  resetBatchDrafts();
  batchNotice.value = null;
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
  indexes.value = [];
  indexesTruncated.value = false;
  dataPage.value = null;
  dataNotice.value = null;
  resetBatchDrafts();
  batchNotice.value = null;
  activePageRequestId.value = null;
  isLoadingData.value = false;
  columnsTruncated.value = false;
  resetDataViewOptions();
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
  indexes.value = [];
  indexesTruncated.value = false;
  dataPage.value = null;
  resetBatchDrafts();
  batchNotice.value = null;
  hiddenDataColumns.value = [];
  resetDataViewOptions();
  exportStatusSource.value = null;
  exportStatus.value = null;
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
    indexes.value = result.value.indexes;
    indexesTruncated.value = result.value.indexesTruncated;
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
    const filters = page.filters ? cloneDataFilters(page.filters) : undefined;
    const sort = page.sort ? cloneDataSort(page.sort) : undefined;
    const result = await getDatabaseDataPage(sessionId, requestId, schema, table, {
      cursor: page.cursor,
      offset: page.offset,
      ...(filters && filters.length > 0 ? { filters } : {}),
      ...(sort && sort.length > 0 ? { sort } : {}),
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

function updateSqlText(value: string) {
  sqlText.value = value;
  sqlRequestSequence += 1;
  sqlPage.value = null;
  sqlMutation.value = null;
  sqlNotice.value = null;
  sqlHistory.value = [];
  selectedSqlHistoryId.value = null;
  activeSqlRequestId.value = null;
  isCancellingSql.value = false;
  sqlError.value = null;
  sqlNotice.value = null;
  selectedSqlHistoryId.value = null;
}

function addSqlHistory(sql: string, offset: number) {
  const existing = sqlHistory.value.find(entry => entry.sql === sql && entry.offset === offset);
  const entry = { id: crypto.randomUUID(), sql, offset };
  sqlHistory.value = [
    entry,
    ...sqlHistory.value.filter(item => item !== existing),
  ].slice(0, 20);
  selectedSqlHistoryId.value = entry.id;
}

function selectSqlHistory(entryId: string | null) {
  selectedSqlHistoryId.value = entryId;
  const entry = sqlHistory.value.find(item => item.id === entryId);
  if (!entry) {
    return;
  }
  sqlText.value = entry.sql;
  sqlPage.value = null;
  sqlMutation.value = null;
  sqlError.value = null;
  sqlNotice.value = null;
}

/** Require an explicit second action before submitting any SQL mutation. */
async function runSqlQuery(offset = 0) {
  const engine = activeEngine.value;
  const sessionId = activeSession.value?.sessionId;
  if (!sessionId || !engine || isRunningSql.value) {
    return;
  }

  const statement = normalizeDatabaseStatement(sqlText.value, engine);
  if (statement && statement.kind !== 'select') {
    if (activeAccessMode.value !== 'read-write') {
      sqlError.value = 'write-disabled';
      return;
    }
  }

  await executeSqlStatement(statement?.sql ?? sqlText.value, offset);
}

async function executeSqlStatement(sql: string, offset: number) {
  const sessionId = activeSession.value?.sessionId;
  if (!sessionId || isRunningSql.value) {
    return;
  }

  const requestSequence = ++sqlRequestSequence;
  const requestId = crypto.randomUUID();
  activeSqlRequestId.value = requestId;
  sqlPage.value = null;
  sqlMutation.value = null;
  sqlError.value = null;
  sqlNotice.value = null;
  if (offset === 0) {
    hiddenSqlColumns.value = [];
    exportStatusSource.value = null;
    exportStatus.value = null;
  }
  isRunningSql.value = true;
  try {
    const result = await runDatabaseQuery(sessionId, requestId, sql, offset);
    if (requestSequence !== sqlRequestSequence) {
      return;
    }
    if (result.status !== 'success') {
      sqlError.value = result.status === 'failed' ? result.error : 'service-unavailable';
      return;
    }
    addSqlHistory(sql, offset);
    if (result.value.kind === 'query') {
      sqlPage.value = result.value.page;
      sqlPageOffset.value = offset;
    }
    else if (result.value.kind === 'mutation') {
      sqlMutation.value = result.value;
      sqlPageOffset.value = 0;
    }
    else {
      sqlPage.value = null;
      sqlMutation.value = null;
    }
  }
  finally {
    if (activeSqlRequestId.value === requestId) {
      activeSqlRequestId.value = null;
    }
    isRunningSql.value = false;
  }
}

async function cancelCurrentSqlQuery() {
  const sessionId = activeSession.value?.sessionId;
  const requestId = activeSqlRequestId.value;
  if (!sessionId || !requestId || !isRunningSql.value || isCancellingSql.value || activeEngine.value !== 'postgres') {
    return;
  }

  isCancellingSql.value = true;
  sqlRequestSequence += 1;
  try {
    const result = await cancelDatabaseQuery(sessionId, requestId);
    if (result.status !== 'success') {
      sqlError.value = result.status === 'failed' ? result.error : 'service-unavailable';
      void disconnect();
      return;
    }
    sqlNotice.value = result.value ? 'cancelled' : 'finished-before-cancel';
  }
  finally {
    isCancellingSql.value = false;
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
    const filters = cloneDataFilters(appliedDataFilters.value);
    const sort = cloneDataSort(appliedDataSort.value);
    const nextRequest: PostgresDataPageInput | null = dataPage.value.pagingMode === 'keyset'
      ? dataPage.value.nextCursor ? {
          cursor: dataPage.value.nextCursor,
          offset: 0,
          ...(filters.length > 0 ? { filters } : {}),
          ...(sort.length > 0 ? { sort } : {}),
        } : null
      : dataPage.value.nextOffset !== null ? {
          cursor: null,
          offset: dataPage.value.nextOffset,
          ...(filters.length > 0 ? { filters } : {}),
          ...(sort.length > 0 ? { sort } : {}),
        } : null;
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
  activeEngine.value = null;
  activeAccessMode.value = 'read-only';
  sqlRequestSequence += 1;
  sqlPage.value = null;
  sqlMutation.value = null;
  schemas.value = [];
  tables.value = [];
  structure.value = [];
  indexes.value = [];
  indexesTruncated.value = false;
  dataPage.value = null;
  resetBatchDrafts();
  batchNotice.value = null;
  hiddenDataColumns.value = [];
  hiddenSqlColumns.value = [];
  resetDataViewOptions();
  exportStatus.value = null;
  exportStatusSource.value = null;
  sqlError.value = null;
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
  sqlRequestSequence += 1;
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
      {{ stageNotice }}
    </n-alert>

    <n-alert v-if="errorMessage" type="error" :show-icon="false" mb-4 role="alert">
      {{ errorMessage }}
    </n-alert>

    <div v-if="!activeSession" class="database-manager-grid">
      <n-card :title="connectDatabaseLabel">
        <n-form-item data-test-id="database-engine-field" :label="engineHeading">
          <n-select
            data-test-id="database-engine-select"
            :value="selectedEngine"
            :options="engineOptions"
            @update:value="selectEngine"
          />
        </n-form-item>

        <div v-if="selectedEngine === 'postgres'" class="saved-profile-section" data-test-id="postgres-profile-section">
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

        <n-alert v-if="selectedEngine === 'mysql'" type="info" :show-icon="false" mb-3>
          {{ mysqlNotice }}
        </n-alert>

        <n-alert v-if="selectedEngine === 'sqlite'" type="info" :show-icon="false" mb-3 data-test-id="sqlite-access-notice">
          {{ sqliteNotice }}
        </n-alert>

        <div mb-3>
          <n-checkbox data-test-id="database-write-access" v-model:checked="writeAccessEnabled">
            {{ writeAccessLabel }}
          </n-checkbox>
        </div>
        <n-alert v-if="writeAccessEnabled" type="warning" :show-icon="false" mb-3 data-test-id="database-write-access-warning">
          {{ writeAccessWarning }}
        </n-alert>

        <div v-if="selectedEngine !== 'sqlite'" class="connection-form">
          <n-form-item data-test-id="database-host-field" :label="$t('tools.database-manager.host')">
            <n-input v-model:value="connectionForm.host" autocomplete="off" />
          </n-form-item>
          <n-form-item data-test-id="database-port-field" :label="$t('tools.database-manager.port')">
            <n-input-number v-model:value="connectionForm.port" :min="1" :max="65535" class="full-width" />
          </n-form-item>
          <n-form-item data-test-id="database-database-field" :label="$t('tools.database-manager.database')">
            <n-input v-model:value="connectionForm.database" autocomplete="off" />
          </n-form-item>
          <n-form-item data-test-id="database-username-field" :label="$t('tools.database-manager.username')">
            <n-input v-model:value="connectionForm.username" autocomplete="off" />
          </n-form-item>
          <n-form-item data-test-id="database-password-field" :label="$t('tools.database-manager.password')">
            <n-input v-model:value="connectionForm.password" type="password" show-password-on="click" autocomplete="new-password" />
          </n-form-item>
          <n-form-item :label="$t('tools.database-manager.tlsMode')">
            <n-select data-test-id="database-tls-mode" v-model:value="connectionForm.tlsMode" :options="tlsOptions" />
          </n-form-item>
        </div>

        <n-alert v-if="selectedEngine !== 'sqlite' && connectionForm.tlsMode === 'disable'" type="warning" :show-icon="false" mb-3>
          {{ $t('tools.database-manager.disableTlsWarning') }}
        </n-alert>

        <div flex justify-end>
          <n-button type="primary" :loading="isConnecting" @click="connect">
            {{ isConnecting ? $t('tools.database-manager.connecting') : $t('tools.database-manager.connect') }}
          </n-button>
        </div>
      </n-card>

      <n-card :title="engineHeading">
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
          <span>{{ activeConnectionLabel }}</span>
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
            v-if="activeEngine === 'postgres'"
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
            <n-alert v-else-if="dataPage?.pagingNotice === 'offset-paging'" type="info" :show-icon="false" mb-3>
              {{ previewText.offsetPaging }}
            </n-alert>
            <n-alert v-if="dataPage?.editable" type="info" :show-icon="false" mb-3 data-test-id="database-table-edit-notice">
              {{ isChineseLocale ? '点击可编辑的单元格即可修改；每次保存前都会再次确认。' : 'Click an editable cell to change it. Each save asks for confirmation.' }}
            </n-alert>
            <n-alert v-if="dataPage?.columnsTruncated" type="info" :show-icon="false" mb-3>
              {{ previewText.columnsTruncated }}
            </n-alert>
            <n-alert v-if="dataPage?.limitReached" type="info" :show-icon="false" mb-3>
              {{ previewText.limitReached }}
            </n-alert>
            <div v-if="dataPage" class="database-result-toolbar" data-test-id="database-data-tools">
              <details class="database-column-menu" data-test-id="database-data-columns">
                <summary>{{ resultToolsText.columns }}</summary>
                <div class="database-column-options">
                  <n-checkbox
                    v-for="option in dataColumnOptions"
                    :key="option.index"
                    :checked="!hiddenDataColumns.includes(option.index)"
                    @update:checked="value => setColumnVisibility('table', option.index, value)"
                  >
                    {{ option.label }}
                  </n-checkbox>
                </div>
              </details>
              <span class="database-export-scope">{{ resultToolsText.currentPage }}</span>
              <n-button data-test-id="database-export-csv" size="small" @click="exportCurrentPage('table', 'csv')">
                {{ resultToolsText.exportCsv }}
              </n-button>
              <n-button data-test-id="database-export-jsonl" size="small" @click="exportCurrentPage('table', 'jsonl')">
                {{ resultToolsText.exportJsonl }}
              </n-button>
            </div>
            <div v-if="dataPage && activeAccessMode === 'read-write'" class="database-batch-toolbar" data-test-id="database-batch-toolbar">
              <n-button
                data-test-id="database-batch-add"
                size="small"
                :disabled="batchEditableColumns.length === 0 || batchInsertDrafts.length + batchDeleteDrafts.length >= 100"
                @click="openBatchInsert"
              >
                {{ isChineseLocale ? '新增草稿' : 'Add row draft' }}
              </n-button>
              <span class="database-export-scope">{{ batchSummary }}</span>
              <n-button
                data-test-id="database-batch-review"
                size="small"
                type="primary"
                :disabled="batchInsertDrafts.length + batchDeleteDrafts.length === 0"
                @click="reviewBatchDrafts"
              >
                {{ isChineseLocale ? '预览提交' : 'Review commit' }}
              </n-button>
              <n-button
                data-test-id="database-batch-clear"
                size="small"
                :disabled="batchInsertDrafts.length + batchDeleteDrafts.length === 0"
                @click="resetBatchDrafts"
              >
                {{ isChineseLocale ? '清空草稿' : 'Clear drafts' }}
              </n-button>
            </div>
            <n-alert v-if="batchNoticeMessage" type="success" :show-icon="false" mb-3 data-test-id="database-batch-notice">
              {{ batchNoticeMessage }}
            </n-alert>
            <n-alert v-if="batchDeleteAvailable === false && activeAccessMode === 'read-write'" type="info" :show-icon="false" mb-3 data-test-id="database-batch-delete-notice">
              {{ isChineseLocale ? '当前表包含无法安全回读的列，批量删除已停用。' : 'Batch delete is unavailable because this table has columns that cannot be read back safely.' }}
            </n-alert>
            <div v-if="dataPage" class="database-data-view-controls" data-test-id="database-data-view-controls">
              <div class="database-data-view-row">
                <strong>{{ dataViewText.filter }}</strong>
                <n-select
                  data-test-id="database-filter-column"
                  :value="draftDataFilterColumn"
                  :options="dataViewColumnOptions"
                  :placeholder="dataViewText.filterColumn"
                  clearable
                  @update:value="(value: string | null) => draftDataFilterColumn = value"
                />
                <n-select
                  data-test-id="database-filter-operator"
                  :value="draftDataFilterOperator"
                  :options="filterOperatorOptions"
                  :placeholder="dataViewText.filterOperator"
                  @update:value="(value: DatabaseDataFilterOperator) => draftDataFilterOperator = value"
                />
                <n-input
                  v-if="!isNullDataFilter"
                  data-test-id="database-filter-value"
                  :value="draftDataFilterValue"
                  :placeholder="dataViewText.filterValue"
                  maxlength="256"
                  @update:value="value => draftDataFilterValue = value"
                />
                <n-button
                  data-test-id="database-filter-add"
                  size="small"
                  :disabled="!draftDataFilterColumn || appliedDataFilters.length >= 3"
                  @click="addDataFilter"
                >
                  {{ dataViewText.addFilter }}
                </n-button>
                <n-button
                  data-test-id="database-filter-clear"
                  size="small"
                  :disabled="appliedDataFilters.length === 0"
                  @click="clearDataFilters"
                >
                  {{ dataViewText.clearFilters }}
                </n-button>
              </div>
              <div class="database-data-view-row">
                <strong>{{ dataViewText.sort }}</strong>
                <n-select
                  data-test-id="database-sort-column"
                  :value="draftDataSortColumn"
                  :options="dataViewColumnOptions"
                  :placeholder="dataViewText.sortColumn"
                  clearable
                  @update:value="(value: string | null) => draftDataSortColumn = value"
                />
                <n-select
                  data-test-id="database-sort-direction"
                  :value="draftDataSortDirection"
                  :options="sortDirectionOptions"
                  :placeholder="dataViewText.sortDirection"
                  @update:value="(value: 'asc' | 'desc') => draftDataSortDirection = value"
                />
                <n-button
                  data-test-id="database-sort-apply"
                  size="small"
                  :disabled="!draftDataSortColumn"
                  @click="applyDataSort"
                >
                  {{ dataViewText.applySort }}
                </n-button>
                <n-button
                  data-test-id="database-sort-clear"
                  size="small"
                  :disabled="appliedDataSort.length === 0"
                  @click="clearDataSort"
                >
                  {{ dataViewText.clearSort }}
                </n-button>
              </div>
              <div class="database-data-view-summary" data-test-id="database-filter-tags">
                <span>{{ dataFilterSummary }}</span>
                <span>{{ dataSortSummary }}</span>
                <n-tag
                  v-for="(filter, index) in appliedDataFilters"
                  :key="`${filter.column}-${filter.operator}-${index}`"
                  size="small"
                  closable
                  @close="removeDataFilter(index)"
                >
                  {{ formatDataFilter(filter) }}
                </n-tag>
              </div>
            </div>
            <n-alert v-if="exportStatusSource === 'table' && exportStatusMessage" :type="exportStatusType" :show-icon="false" mb-3 data-test-id="database-export-status">
              {{ exportStatusMessage }}
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
            <h3 class="database-structure-heading database-index-heading">
              {{ indexText.title }}
            </h3>
            <n-alert v-if="indexesTruncated" type="warning" :show-icon="false" mb-3>
              {{ indexText.truncated }}
            </n-alert>
            <n-data-table
              data-test-id="database-index-table"
              :columns="indexColumns"
              :data="indexes"
              :loading="isLoadingStructure"
              :row-key="getIndexRowKey"
              :pagination="false"
              :scroll-x="1250"
            />
          </n-tab-pane>
        </n-tabs>
      </n-card>

      <n-card v-if="activeSession" mt-4 :title="sqlEditorTitle" data-test-id="database-sql-editor-card">
        <n-alert type="info" :show-icon="false" mb-3 data-test-id="database-sql-statement-notice">
          {{ sqlEditorNotice }}
        </n-alert>
        <n-input
          data-test-id="database-sql-editor"
          :value="sqlText"
          type="textarea"
          :autosize="{ minRows: 6, maxRows: 16 }"
          spellcheck="false"
          @update:value="updateSqlText"
          @keydown.ctrl.enter.prevent="runSqlQuery(0)"
        />
        <div class="database-sql-history-row">
          <n-select
            data-test-id="database-sql-history"
            :value="selectedSqlHistoryId"
            :options="sqlHistoryOptions"
            :placeholder="sqlControlText.history"
            :loading="isRunningSql"
            clearable
            @update:value="selectSqlHistory"
          />
          <span v-if="sqlHistory.length === 0" class="database-export-scope">{{ sqlControlText.noHistory }}</span>
        </div>
        <div class="database-page-controls">
          <span>{{ isChineseLocale ? 'Ctrl + Enter 运行' : 'Ctrl + Enter to run' }}</span>
          <div flex gap-2>
            <n-button
              v-if="isRunningSql && activeEngine === 'postgres'"
              data-test-id="database-cancel-query"
              :loading="isCancellingSql"
              :disabled="isCancellingSql"
              @click="cancelCurrentSqlQuery"
            >
              {{ isCancellingSql ? sqlControlText.cancelling : sqlControlText.cancel }}
            </n-button>
            <n-button
              data-test-id="database-run-query"
              type="primary"
              :loading="isRunningSql"
              @click="runSqlQuery(0)"
            >
              {{ isRunningSql ? previewText.loading : sqlRunLabel }}
            </n-button>
          </div>
        </div>
        <n-alert v-if="sqlNoticeMessage" type="info" :show-icon="false" mt-3 data-test-id="database-sql-notice">
          {{ sqlNoticeMessage }}
        </n-alert>
        <n-alert v-if="sqlErrorMessage" type="error" :show-icon="false" mt-3 role="alert" data-test-id="database-sql-error">
          {{ sqlErrorMessage }}
        </n-alert>
        <n-alert v-if="sqlMutation" type="success" :show-icon="false" mt-3 data-test-id="database-sql-write-result">
          {{ sqlMutationSummary }}
        </n-alert>
        <div v-if="sqlPage" mt-4 data-test-id="database-sql-output">
          <n-alert v-if="sqlPage.editableTarget" type="info" :show-icon="false" mb-3 data-test-id="database-query-edit-notice">
            {{ isChineseLocale ? '此结果来自单表直列查询，点击可编辑的单元格即可修改。' : 'This result is a direct projection from one table. Click an editable cell to change it.' }}
          </n-alert>
          <n-alert v-if="sqlPage.columnsTruncated" type="warning" :show-icon="false" mb-3>
            {{ sqlColumnsTruncatedNotice }}
          </n-alert>
          <n-alert v-if="sqlPage.limitReached" type="warning" :show-icon="false" mb-3>
            {{ sqlLimitReachedNotice }}
          </n-alert>
          <div class="database-result-toolbar" data-test-id="database-sql-tools">
            <details class="database-column-menu" data-test-id="database-sql-columns">
              <summary>{{ resultToolsText.columns }}</summary>
              <div class="database-column-options">
                <n-checkbox
                  v-for="option in sqlColumnOptions"
                  :key="option.index"
                  :checked="!hiddenSqlColumns.includes(option.index)"
                  @update:checked="value => setColumnVisibility('query', option.index, value)"
                >
                  {{ option.label }}
                </n-checkbox>
              </div>
            </details>
            <span class="database-export-scope">{{ resultToolsText.currentPage }}</span>
            <n-button data-test-id="database-sql-export-csv" size="small" @click="exportCurrentPage('query', 'csv')">
              {{ resultToolsText.exportCsv }}
            </n-button>
            <n-button data-test-id="database-sql-export-jsonl" size="small" @click="exportCurrentPage('query', 'jsonl')">
              {{ resultToolsText.exportJsonl }}
            </n-button>
          </div>
          <n-alert v-if="exportStatusSource === 'query' && exportStatusMessage" :type="exportStatusType" :show-icon="false" mb-3 data-test-id="database-export-status">
            {{ exportStatusMessage }}
          </n-alert>
          <n-data-table
            data-test-id="database-sql-results"
            :columns="sqlResultColumns"
            :data="sqlResultRows"
            :loading="isRunningSql"
            :row-key="getDataRowKey"
            :pagination="false"
            :scroll-x="sqlResultScrollWidth"
          />
          <n-empty v-if="sqlPage.rows.length === 0" :description="sqlNoRowsNotice" mt-4 />
          <div class="database-page-controls">
            <span data-test-id="database-sql-page-summary">{{ sqlPageSummary }}</span>
            <div flex gap-2>
              <n-button
                data-test-id="database-sql-previous-page"
                :disabled="isRunningSql || sqlPageOffset === 0"
                @click="runSqlQuery(Math.max(0, sqlPageOffset - 25))"
              >
                {{ previewText.previous }}
              </n-button>
              <n-button
                data-test-id="database-sql-next-page"
                :disabled="isRunningSql || !sqlPage.hasNext || sqlPage.nextOffset === null"
                @click="runSqlQuery(sqlPage.nextOffset ?? 0)"
              >
                {{ previewText.next }}
              </n-button>
            </div>
          </div>
        </div>
      </n-card>

      <n-modal v-model:show="isCellEditorOpen" preset="card" :title="cellEditorTitle" style="max-width: 560px; width: calc(100vw - 32px)" :mask-closable="!isSavingCell" :closable="!isSavingCell">
        <p class="database-edit-hint">{{ cellEditHint }}</p>
        <n-checkbox v-model:checked="cellEditNull" mb-2>
          {{ isChineseLocale ? '设为 NULL' : 'Set to NULL' }}
        </n-checkbox>
        <n-input
          v-model:value="cellEditValue"
          data-test-id="database-cell-edit-input"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 10 }"
          :disabled="cellEditNull || isSavingCell"
          maxlength="4096"
          show-count
        />
        <n-alert v-if="cellEditError" type="error" :show-icon="false" mt-3 role="alert" data-test-id="database-cell-edit-error">
          {{ databaseErrorText(cellEditError) }}
        </n-alert>
        <div class="database-edit-actions">
          <n-button :disabled="isSavingCell" @click="closeCellEditor">
            {{ isChineseLocale ? '取消' : 'Cancel' }}
          </n-button>
          <n-button data-test-id="database-cell-edit-save" type="primary" :loading="isSavingCell" @click="saveCellEdit">
            {{ isChineseLocale ? '保存修改' : 'Save change' }}
          </n-button>
        </div>
      </n-modal>

      <n-modal v-model:show="isBatchInsertOpen" preset="card" :title="isChineseLocale ? '新增行草稿' : 'Add row draft'" style="max-width: 720px; width: calc(100vw - 32px)" data-test-id="database-batch-insert-modal">
        <p class="database-edit-hint">
          {{ isChineseLocale ? '空值按空字符串提交；勾选 NULL 可提交 NULL。草稿只在点击预览提交后写入数据库。' : 'Empty inputs are submitted as empty strings. Check NULL to submit NULL. Drafts are not written until you review and commit them.' }}
        </p>
        <div class="database-batch-form">
          <div v-for="column in batchEditableColumns" :key="column.name" class="database-batch-field">
            <label :for="`database-batch-${column.name}`">{{ column.name }} · {{ column.dataType }}</label>
            <n-input
              :id="`database-batch-${column.name}`"
              v-model:value="batchInsertValues[column.name]"
              :disabled="batchInsertNullColumns.includes(column.name)"
              maxlength="4096"
            />
            <n-checkbox
              :checked="batchInsertNullColumns.includes(column.name)"
              @update:checked="checked => batchInsertNullColumns = checked
                ? [...batchInsertNullColumns, column.name]
                : batchInsertNullColumns.filter(name => name !== column.name)"
            >
              NULL
            </n-checkbox>
          </div>
        </div>
        <div class="database-edit-actions">
          <n-button @click="isBatchInsertOpen = false">
            {{ isChineseLocale ? '取消' : 'Cancel' }}
          </n-button>
          <n-button data-test-id="database-batch-add-confirm" type="primary" @click="addBatchInsertDraft">
            {{ isChineseLocale ? '加入草稿' : 'Add draft' }}
          </n-button>
        </div>
      </n-modal>

      <n-modal v-model:show="isBatchReviewOpen" preset="card" :title="isChineseLocale ? '预览批量提交' : 'Review batch commit'" style="max-width: 720px; width: calc(100vw - 32px)" :mask-closable="!isBatchCommitting" :closable="!isBatchCommitting" data-test-id="database-batch-review-modal">
        <p class="database-edit-hint">
          {{ isChineseLocale ? `将新增 ${batchInsertDrafts.length} 行，删除 ${batchDeleteDrafts.length} 行。所有操作在一个事务中执行。` : `The commit will insert ${batchInsertDrafts.length} rows and delete ${batchDeleteDrafts.length} rows in one transaction.` }}
        </p>
        <div v-if="batchInsertDrafts.length > 0" class="database-batch-draft-list" data-test-id="database-batch-insert-list">
          <strong>{{ isChineseLocale ? '新增草稿' : 'Insert drafts' }}</strong>
          <div v-for="(draft, index) in batchInsertDrafts" :key="draft.id" class="database-batch-draft-row">
            <span>{{ index + 1 }} · {{ draft.values.map(value => `${value.column}=${value.value === null ? 'NULL' : value.value}`).join(', ') }}</span>
            <n-button size="small" @click="removeBatchInsertDraft(draft.id)">{{ isChineseLocale ? '移除' : 'Remove' }}</n-button>
          </div>
        </div>
        <div v-if="batchDeleteDrafts.length > 0" class="database-batch-draft-list" data-test-id="database-batch-delete-list">
          <strong>{{ isChineseLocale ? '删除草稿' : 'Delete drafts' }}</strong>
          <div v-for="(draft, index) in batchDeleteDrafts" :key="`${draft.primaryKeys.map(key => key.value).join('|')}-${index}`" class="database-batch-draft-row">
            <span>{{ index + 1 }} · {{ draft.primaryKeys.map(key => `${key.column}=${key.value}`).join(', ') }}</span>
            <n-button size="small" @click="removeBatchDeleteDraft(index)">{{ isChineseLocale ? '移除' : 'Remove' }}</n-button>
          </div>
        </div>
        <n-alert v-if="batchError" type="error" :show-icon="false" mt-3 role="alert" data-test-id="database-batch-error">
          {{ databaseErrorText(batchError) }}
        </n-alert>
        <div class="database-edit-actions">
          <n-button :disabled="isBatchCommitting" @click="isBatchReviewOpen = false">
            {{ isChineseLocale ? '取消' : 'Cancel' }}
          </n-button>
          <n-button data-test-id="database-batch-commit" type="primary" :loading="isBatchCommitting" @click="commitBatchDrafts">
            {{ isChineseLocale ? '确认提交' : 'Commit batch' }}
          </n-button>
        </div>
      </n-modal>
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

.database-structure-heading {
  margin: 0 0 12px;
  font-size: 1rem;
  font-weight: 600;
}

.database-index-heading {
  margin-top: 24px;
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

.database-sql-history-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.database-sql-history-row :deep(.n-select) {
  max-width: 720px;
  flex: 1 1 320px;
}

.database-result-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 12px;
}

.database-batch-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 12px;
}

.database-batch-form {
  display: grid;
  gap: 12px;
}

.database-batch-field {
  display: grid;
  gap: 6px;
}

.database-batch-field > label {
  color: var(--text-color-secondary);
  font-size: 0.8125rem;
  font-weight: 600;
}

.database-batch-draft-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.database-batch-draft-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-color-secondary);
  font-size: 0.8125rem;
}

.database-batch-draft-row > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.database-batch-row-action {
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: transparent;
  color: var(--text-color);
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.database-batch-row-action:hover,
.database-batch-row-action:focus-visible {
  border-color: var(--primary-color);
  color: var(--primary-color);
  outline: none;
}

.database-data-view-controls {
  display: grid;
  gap: 8px;
  margin: 0 0 12px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.database-data-view-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.database-data-view-row :deep(.n-select),
.database-data-view-row :deep(.n-input) {
  min-width: 150px;
  flex: 1 1 150px;
}

.database-data-view-row strong {
  min-width: 48px;
  color: var(--text-color-secondary);
  font-size: 0.875rem;
}

.database-data-view-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--text-color-secondary);
  font-size: 0.8125rem;
}

.database-column-menu {
  position: relative;
}

.database-column-menu summary {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-color);
  font-size: 0.875rem;
  cursor: pointer;
  list-style: none;
}

.database-column-menu summary::-webkit-details-marker {
  display: none;
}

.database-column-options {
  position: absolute;
  z-index: 10;
  top: calc(100% + 4px);
  left: 0;
  display: grid;
  min-width: 220px;
  max-height: 280px;
  gap: 8px;
  padding: 10px;
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--card-color);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
}

.database-export-scope {
  margin-right: auto;
  color: var(--text-color-secondary);
  font-size: 0.8125rem;
}

.database-edit-cell {
  max-width: 100%;
  padding: 2px 4px;
  overflow: hidden;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.database-edit-cell:hover,
.database-edit-cell:focus-visible {
  outline: 1px solid var(--primary-color);
}

.database-edit-hint {
  margin: 0 0 12px;
  color: var(--text-color-secondary);
}

.database-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
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

  .database-sql-history-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .database-sql-history-row :deep(.n-select) {
    width: 100%;
  }

  .database-result-toolbar {
    align-items: flex-start;
  }

  .database-batch-toolbar {
    align-items: flex-start;
  }

  .database-data-view-row {
    align-items: stretch;
    flex-direction: column;
  }

  .database-data-view-row :deep(.n-select),
  .database-data-view-row :deep(.n-input) {
    width: 100%;
  }

  .database-export-scope {
    width: 100%;
  }

  .database-batch-draft-row {
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
