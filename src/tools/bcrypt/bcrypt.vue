<script setup lang="ts">
import { tryOnBeforeUnmount } from '@vueuse/core';
import { useThemeVars } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { useCopy } from '@/composable/copy';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';
import { maxBcryptSaltRounds, minBcryptSaltRounds } from './bcrypt.constants';

type BcryptTaskStatus = 'idle' | 'running' | 'input-limit' | 'output-limit' | 'timeout' | 'error';

const themeVars = useThemeVars();
const { t } = useI18n();

const input = ref('');
const saltCount = ref(10);
const hashed = ref('');
const hashStatus = ref<BcryptTaskStatus>('idle');
const { copy } = useCopy({ source: hashed, text: 'Hashed string copied to the clipboard' });

const compareString = ref('');
const compareHash = ref('');
const compareMatch = ref(false);
const compareStatus = ref<BcryptTaskStatus>('idle');

const hashTaskKey = 'bcrypt:hash';
const compareTaskKey = 'bcrypt:compare';
let hashVersion = 0;
let compareVersion = 0;
let hashTimer: ReturnType<typeof setTimeout> | undefined;
let compareTimer: ReturnType<typeof setTimeout> | undefined;

function taskMessage(status: BcryptTaskStatus): string {
  if (status === 'input-limit' || status === 'output-limit') { return t('taskStatus.limit'); }
  if (status === 'timeout') { return t('taskStatus.timeout'); }
  if (status === 'error') { return t('taskStatus.error'); }
  return '';
}

const hashFeedback = computed(() => taskMessage(hashStatus.value));
const compareFeedback = computed(() => taskMessage(compareStatus.value));

watch([input, saltCount], () => {
  const version = ++hashVersion;
  if (hashTimer) { clearTimeout(hashTimer); }
  taskRunner.cancel(hashTaskKey);
  hashed.value = '';
  hashStatus.value = 'running';

  // Debounce edits and terminate obsolete CPU-heavy hash tasks in the dedicated worker.
  hashTimer = setTimeout(async () => {
    const outcome = await taskRunner.run(hashTaskKey, version, {
      kind: 'bcrypt-hash',
      value: input.value,
      saltRounds: saltCount.value,
    }, taskLimits.bcryptHash);
    if (version !== hashVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === 'bcrypt-hash') {
      hashed.value = outcome.result.hash;
      hashStatus.value = 'idle';
      return;
    }
    if (outcome.status === 'cancelled') { return; }
    hashStatus.value = outcome.status === 'success' ? 'error' : outcome.status;
  }, 150);
}, { immediate: true });

watch([compareString, compareHash], () => {
  const version = ++compareVersion;
  if (compareTimer) { clearTimeout(compareTimer); }
  taskRunner.cancel(compareTaskKey);
  compareMatch.value = false;
  if (compareHash.value === '') {
    compareStatus.value = 'idle';
    return;
  }
  compareStatus.value = 'running';

  // Compare externally supplied hashes in the same bounded worker pool as hashing.
  compareTimer = setTimeout(async () => {
    const outcome = await taskRunner.run(compareTaskKey, version, {
      kind: 'bcrypt-compare',
      value: compareString.value,
      hash: compareHash.value,
    }, taskLimits.bcryptCompare);
    if (version !== compareVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === 'bcrypt-compare') {
      compareMatch.value = outcome.result.matches;
      compareStatus.value = 'idle';
      return;
    }
    if (outcome.status === 'cancelled') { return; }
    compareStatus.value = outcome.status === 'success' ? 'error' : outcome.status;
  }, 150);
});

tryOnBeforeUnmount(() => {
  hashVersion++;
  compareVersion++;
  if (hashTimer) { clearTimeout(hashTimer); }
  if (compareTimer) { clearTimeout(compareTimer); }
  taskRunner.cancel(hashTaskKey);
  taskRunner.cancel(compareTaskKey);
});
</script>

<template>
  <c-card title="Hash">
    <c-input-text
      v-model:value="input"
      placeholder="Your string to bcrypt..."
      raw-text
      label="Your string: "
      label-position="left"
      label-align="right"
      label-width="120px"
      test-id="bcrypt-input"
      mb-2
    />
    <n-form-item label="Salt count: " label-placement="left" label-width="120">
      <n-input-number
        v-model:value="saltCount"
        placeholder="Salt rounds..."
        :max="maxBcryptSaltRounds"
        :min="minBcryptSaltRounds"
        :precision="0"
        w-full
      />
    </n-form-item>

    <div v-if="hashStatus === 'running'" mb-2 text-center op-70>
      {{ t('taskStatus.calculating') }}
    </div>
    <div v-else-if="hashFeedback" mb-2 role="alert" text-center text-red-500>
      {{ hashFeedback }}
    </div>
    <c-input-text :value="hashed" readonly text-center test-id="bcrypt-hash" />

    <div mt-5 flex justify-center>
      <c-button :disabled="hashed === ''" @click="copy()">
        Copy hash
      </c-button>
    </div>
  </c-card>

  <c-card title="Compare string with hash">
    <n-form label-width="140">
      <n-form-item label="Your string: " label-placement="left">
        <c-input-text v-model:value="compareString" placeholder="Your string to compare..." raw-text test-id="bcrypt-compare-input" />
      </n-form-item>
      <n-form-item label="Your hash: " label-placement="left">
        <c-input-text v-model:value="compareHash" placeholder="Your hash to compare..." raw-text test-id="bcrypt-compare-hash" />
      </n-form-item>
      <n-form-item label="Do they match ? " label-placement="left" :show-feedback="false">
        <div>
          <div class="compare-result" :class="{ positive: compareMatch }" data-test-id="bcrypt-compare-result">
            {{ compareStatus === 'running' ? t('taskStatus.calculating') : compareMatch ? 'Yes' : 'No' }}
          </div>
          <div v-if="compareFeedback" role="alert" text-sm text-red-500>
            {{ compareFeedback }}
          </div>
        </div>
      </n-form-item>
    </n-form>
  </c-card>
</template>

<style lang="less" scoped>
.compare-result {
  color: v-bind('themeVars.errorColor');

  &.positive {
    color: v-bind('themeVars.successColor');
  }
}
</style>
