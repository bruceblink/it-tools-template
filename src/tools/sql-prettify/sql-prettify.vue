<script setup lang="ts">
import { tryOnBeforeUnmount } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import TextareaCopyable from '@/components/TextareaCopyable.vue';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';
import type { FormatOptionsWithLanguage } from 'sql-formatter';
import CInputText from '@/ui/c-input-text/c-input-text.vue';
import { useStyleStore } from '@/stores/style.store';

type SqlFormatterStatus = 'idle' | 'running' | 'input-limit' | 'output-limit' | 'timeout' | 'error';

const inputElement = ref<InstanceType<typeof CInputText>>();
const styleStore = useStyleStore();
const { t } = useI18n();
const config = reactive<FormatOptionsWithLanguage>({
  keywordCase: 'upper',
  useTabs: false,
  language: 'sql',
  indentStyle: 'standard',
});

const rawSQL = ref('select field1,field2,field3 from my_table where my_condition;');
const prettySQL = ref('');
const taskStatus = ref<SqlFormatterStatus>('idle');
const taskOptions = computed<FormatOptionsWithLanguage>(() => ({
  keywordCase: config.keywordCase,
  useTabs: config.useTabs,
  language: config.language,
  indentStyle: config.indentStyle,
}));

const taskKey = 'sql-prettify:format';
let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;

const inputFeedback = computed(() => {
  if (taskStatus.value === 'input-limit' || taskStatus.value === 'output-limit') { return t('taskStatus.limit'); }
  if (taskStatus.value === 'timeout') { return t('taskStatus.timeout'); }
  if (taskStatus.value === 'error') { return t('taskStatus.error'); }
  return '';
});

const validationStatus = computed(() => inputFeedback.value ? 'error' : undefined);

watch([rawSQL, () => config.language, () => config.keywordCase, () => config.indentStyle], () => {
  const version = ++taskVersion;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
  prettySQL.value = '';
  taskStatus.value = rawSQL.value === '' ? 'idle' : 'running';
  if (rawSQL.value === '') { return; }

  // Debounce edits, cancel obsolete formatting, and ignore results from older input versions.
  taskTimer = setTimeout(async () => {
    const outcome = await taskRunner.run(taskKey, version, {
      kind: 'sql-format',
      value: rawSQL.value,
      options: { ...taskOptions.value },
    }, taskLimits.sqlFormatter);
    if (version !== taskVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === 'sql-format') {
      prettySQL.value = outcome.result.output;
      taskStatus.value = 'idle';
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
</script>

<template>
  <div style="flex: 0 0 100%">
    <div style="max-width: 600px" :class="{ 'flex-col': styleStore.isSmallScreen }" mx-auto mb-5 flex gap-2>
      <c-select
        v-model:value="config.language"
        flex-1
        label="Dialect"
        :options="[
          { label: 'GCP BigQuery', value: 'bigquery' },
          { label: 'IBM DB2', value: 'db2' },
          { label: 'Apache Hive', value: 'hive' },
          { label: 'MariaDB', value: 'mariadb' },
          { label: 'MySQL', value: 'mysql' },
          { label: 'Couchbase N1QL', value: 'n1ql' },
          { label: 'Oracle PL/SQL', value: 'plsql' },
          { label: 'PostgreSQL', value: 'postgresql' },
          { label: 'Amazon Redshift', value: 'redshift' },
          { label: 'Spark', value: 'spark' },
          { label: 'Standard SQL', value: 'sql' },
          { label: 'sqlite', value: 'sqlite' },
          { label: 'SQL Server Transact-SQL', value: 'tsql' },
        ]"
      />
      <c-select
        v-model:value="config.keywordCase" label="Keyword case"
        flex-1
        :options="[
          { label: 'UPPERCASE', value: 'upper' },
          { label: 'lowercase', value: 'lower' },
          { label: 'Preserve', value: 'preserve' },
        ]"
      />
      <c-select
        v-model:value="config.indentStyle" label="Indent style"
        flex-1
        :options="[
          { label: 'Standard', value: 'standard' },
          { label: 'Tabular left', value: 'tabularLeft' },
          { label: 'Tabular right', value: 'tabularRight' },
        ]"
      />
    </div>
  </div>

  <n-form-item
    label="Your SQL query"
    :feedback="inputFeedback"
    :validation-status="validationStatus"
  >
    <CInputText
      ref="inputElement"
      v-model:value="rawSQL"
      placeholder="Put your SQL query here..."
      rows="20"
      multiline
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      spellcheck="false"
      monospace
      test-id="input"
    />
  </n-form-item>
  <n-form-item label="Prettify version of your query">
    <div v-if="taskStatus === 'running'" mb-2 text-center op-70>
      {{ t('taskStatus.calculating') }}
    </div>
    <TextareaCopyable :value="prettySQL" language="sql" :follow-height-of="inputElement?.inputWrapperRef" />
  </n-form-item>
</template>

<style lang="less" scoped>
.result-card {
  position: relative;
  .copy-button {
    position: absolute;
    top: 10px;
    right: 10px;
  }
}
</style>
