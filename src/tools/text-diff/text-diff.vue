<script setup lang="ts">
import { tryOnBeforeUnmount } from '@vueuse/core';
import type { TextDiffRow } from './text-diff.service';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const originalText = ref('original text');
const modifiedText = ref('modified text');
const renderSideBySide = ref(true);
const ignoreTrimWhitespace = ref(false);
const diffRows = shallowRef<TextDiffRow[]>([]);
const taskStatus = ref<'idle' | 'running' | 'input-limit' | 'output-limit' | 'timeout' | 'error'>('running');

const hasDifferences = computed(() => diffRows.value.some(row => row.kind !== 'equal'));
const taskMessage = computed(() => {
  if (taskStatus.value === 'running') { return t('taskStatus.calculating'); }
  if (taskStatus.value === 'input-limit' || taskStatus.value === 'output-limit') { return t('taskStatus.limit'); }
  if (taskStatus.value === 'timeout') { return t('taskStatus.timeout'); }
  if (taskStatus.value === 'error') { return t('taskStatus.error'); }
  return '';
});

let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;

watch([originalText, modifiedText, ignoreTrimWhitespace], () => {
  const version = ++taskVersion;
  if (taskTimer) {clearTimeout(taskTimer);}
  taskRunner.cancel('text-diff');
  diffRows.value = [];
  taskStatus.value = 'running';

  taskTimer = setTimeout(async () => {
    const outcome = await taskRunner.run('text-diff', version, {
      kind: 'text-diff',
      originalText: originalText.value,
      modifiedText: modifiedText.value,
      ignoreWhitespace: ignoreTrimWhitespace.value,
    }, taskLimits.textDiff);
    if (version !== taskVersion) {return;}
    if (outcome.status === 'success' && outcome.result.kind === 'text-diff') {
      diffRows.value = outcome.result.rows;
      taskStatus.value = 'idle';
      return;
    }
    if (outcome.status === 'cancelled') {return;}
    taskStatus.value = outcome.status === 'success' ? 'error' : outcome.status;
  }, 150);
}, { immediate: true });

tryOnBeforeUnmount(() => {
  taskVersion++;
  if (taskTimer) {clearTimeout(taskTimer);}
  taskRunner.cancel('text-diff');
});

function sideClass(kind: 'original' | 'modified', rowKind: string) {
  if ((kind === 'original' && (rowKind === 'removed' || rowKind === 'changed'))
    || (kind === 'modified' && (rowKind === 'added' || rowKind === 'changed'))) {
    return kind === 'original' ? 'diff-removed bg-red-500/10 text-red-800 dark:text-red-200' : 'diff-added bg-green-500/10 text-green-800 dark:text-green-200';
  }
  return '';
}
</script>

<template>
  <div flex flex-col min-w-0 w-full>
    <div grid grid-cols-1 md:grid-cols-2 gap-4 mb-4>
      <n-form-item :label="t('tools.text-diff.originalText')" :show-feedback="false">
        <n-input
          v-model:value="originalText"
          type="textarea"
          :autosize="{ minRows: 10, maxRows: 16 }"
          :input-props="{ 'aria-label': t('tools.text-diff.originalText') }"
          font-mono
        />
      </n-form-item>

      <n-form-item :label="t('tools.text-diff.modifiedText')" :show-feedback="false">
        <n-input
          v-model:value="modifiedText"
          type="textarea"
          :autosize="{ minRows: 10, maxRows: 16 }"
          :input-props="{ 'aria-label': t('tools.text-diff.modifiedText') }"
          font-mono
        />
      </n-form-item>
    </div>

    <div flex items-center gap-4 mb-2>
      <n-switch v-model:value="renderSideBySide" />
      <span>{{ t('tools.text-diff.sideBySide') }}</span>
      <n-switch v-model:value="ignoreTrimWhitespace" />
      <span>{{ t('tools.text-diff.ignoreWhitespace') }}</span>
    </div>

    <c-card w-full important:flex-1 important:pa-0>
      <div v-if="taskStatus === 'running'" p-4 text-center op-70>
        {{ taskMessage }}
      </div>
      <c-alert v-else-if="taskStatus !== 'idle'" mt-3>
        {{ taskMessage }}
      </c-alert>
      <div v-else-if="!hasDifferences" p-4 italic op-60>
        {{ t('tools.text-diff.noDifferences') }}
      </div>

      <div v-else-if="renderSideBySide" data-test-id="diff-output" w-full max-h-450px overflow-auto>
        <div grid grid-cols-2 sticky top-0 z-1 bg-[var(--card-color)] font-semibold border-b>
          <div px-3 py-2>{{ t('tools.text-diff.originalText') }}</div>
          <div px-3 py-2>{{ t('tools.text-diff.modifiedText') }}</div>
        </div>
        <div v-for="row in diffRows" :key="row.id" grid grid-cols-2 font-mono text-sm>
          <div :class="sideClass('original', row.kind)" grid grid-cols-[3rem_minmax(0,1fr)] gap-2 px-2 py-1>
            <span text-right op-60>{{ row.original?.lineNumber ?? '' }}</span>
            <span whitespace-pre-wrap break-all>{{ row.original?.text ?? '' }}</span>
          </div>
          <div :class="sideClass('modified', row.kind)" grid grid-cols-[3rem_minmax(0,1fr)] gap-2 px-2 py-1>
            <span text-right op-60>{{ row.modified?.lineNumber ?? '' }}</span>
            <span whitespace-pre-wrap break-all>{{ row.modified?.text ?? '' }}</span>
          </div>
        </div>
      </div>

      <div v-else data-test-id="diff-output" w-full max-h-450px overflow-auto p-3 font-mono text-sm>
        <template v-for="row in diffRows" :key="row.id">
          <div v-if="row.kind === 'changed'" class="diff-removed bg-red-500/10 text-red-800 dark:text-red-200" whitespace-pre-wrap break-all>
            - {{ row.original?.text }}
          </div>
          <div v-if="row.kind === 'changed'" class="diff-added bg-green-500/10 text-green-800 dark:text-green-200" whitespace-pre-wrap break-all>
            + {{ row.modified?.text }}
          </div>
          <div v-else :class="row.kind === 'removed' ? 'diff-removed bg-red-500/10 text-red-800 dark:text-red-200' : row.kind === 'added' ? 'diff-added bg-green-500/10 text-green-800 dark:text-green-200' : ''" whitespace-pre-wrap break-all>
            <span op-60>{{ row.kind === 'removed' ? '-' : row.kind === 'added' ? '+' : ' ' }}</span>
            {{ row.original?.text ?? row.modified?.text }}
          </div>
        </template>
      </div>
    </c-card>
  </div>
</template>
