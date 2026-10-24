<script setup lang="ts">
import { tryOnBeforeUnmount } from '@vueuse/core';
import { MessageType } from 'composerize-ts';
import type { Message } from 'composerize-ts';
import { useI18n } from 'vue-i18n';
import { useDownloadFileFromBase64 } from '@/composable/downloadBase64';
import { textToBase64 } from '@/utils/base64';
import TextareaCopyable from '@/components/TextareaCopyable.vue';
import { taskRunner } from '@/task-runner/task-runner';
import { taskLimits } from '@/task-runner/task-runner.types';

type DockerComposeTaskStatus = 'idle' | 'running' | 'input-limit' | 'output-limit' | 'timeout' | 'error';

interface DockerComposeTaskResult {
  yaml: string
  messages: Message[]
}

const dockerRun = ref(
  'docker run -p 80:80 -v /var/run/docker.sock:/tmp/docker.sock:ro --restart always --log-opt max-size=1g nginx',
);

const { t } = useI18n();
const conversionResult = ref<DockerComposeTaskResult>({ yaml: '', messages: [] });
const taskStatus = ref<DockerComposeTaskStatus>('idle');
const dockerCompose = computed(() => conversionResult.value.yaml);
const notImplemented = computed(() =>
  conversionResult.value.messages.filter(msg => msg.type === MessageType.notImplemented).map(msg => msg.value),
);
const notComposable = computed(() =>
  conversionResult.value.messages.filter(msg => msg.type === MessageType.notTranslatable).map(msg => msg.value),
);
const errors = computed(() =>
  conversionResult.value.messages
    .filter(msg => msg.type === MessageType.errorDuringConversion)
    .map(msg => msg.value),
);
const taskStatusMessage = computed(() => {
  if (taskStatus.value === 'running') { return t('taskStatus.calculating'); }
  if (taskStatus.value === 'input-limit' || taskStatus.value === 'output-limit') { return t('taskStatus.limit'); }
  if (taskStatus.value === 'timeout') { return t('taskStatus.timeout'); }
  if (taskStatus.value === 'error') { return t('taskStatus.error'); }
  return '';
});

const taskKey = 'docker-run-to-docker-compose:convert';
let taskVersion = 0;
let taskTimer: ReturnType<typeof setTimeout> | undefined;
const dockerComposeBase64 = computed(() => `data:application/yaml;base64,${textToBase64(dockerCompose.value)}`);
const { download } = useDownloadFileFromBase64({ source: dockerComposeBase64, filename: 'docker-compose.yml' });

watch(dockerRun, () => {
  const version = ++taskVersion;
  if (taskTimer) { clearTimeout(taskTimer); }
  taskRunner.cancel(taskKey);
  conversionResult.value = { yaml: '', messages: [] };

  const value = dockerRun.value.trim();
  taskStatus.value = value === '' ? 'idle' : 'running';
  if (value === '') { return; }

  // Debounce edits, terminate obsolete conversions, and ignore results from an older input version.
  taskTimer = setTimeout(async () => {
    const outcome = await taskRunner.run(taskKey, version, {
      kind: 'docker-run-to-compose',
      value,
    }, taskLimits.dockerRunToCompose);
    if (version !== taskVersion) { return; }
    if (outcome.status === 'success' && outcome.result.kind === 'docker-run-to-compose') {
      conversionResult.value = { yaml: outcome.result.yaml, messages: outcome.result.messages };
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
  <div>
    <c-input-text
      v-model:value="dockerRun"
      label="Your docker run command:"
      style="font-family: monospace"
      multiline
      raw-text
      monospace
      placeholder="Your docker run command to convert..."
      test-id="docker-run-command"
      rows="3"
    />

    <div v-if="taskStatus === 'running'" mb-2 text-center op-70 data-test-id="docker-compose-task-status">
      {{ taskStatusMessage }}
    </div>
    <c-alert v-else-if="taskStatus !== 'idle'" mb-2 data-test-id="docker-compose-task-status">
      {{ taskStatusMessage }}
    </c-alert>

    <n-divider />

    <TextareaCopyable :value="dockerCompose" language="yaml" />

    <div mt-5 flex justify-center>
      <c-button :disabled="dockerCompose === ''" secondary @click="download">
        Download docker-compose.yml
      </c-button>
    </div>

    <div v-if="notComposable.length > 0">
      <n-alert title="This options are not translatable to docker-compose" type="info" mt-5>
        <ul>
          <li v-for="(message, index) of notComposable" :key="index">
            {{ message }}
          </li>
        </ul>
      </n-alert>
    </div>

    <div v-if="notImplemented.length > 0">
      <n-alert
        title="This options are not yet implemented and therefore haven't been translated to docker-compose"
        type="warning"
        mt-5
      >
        <ul>
          <li v-for="(message, index) of notImplemented" :key="index">
            {{ message }}
          </li>
        </ul>
      </n-alert>
    </div>

    <div v-if="errors.length > 0">
      <n-alert title="The following errors occured" type="error" mt-5>
        <ul>
          <li v-for="(message, index) of errors" :key="index">
            {{ message }}
          </li>
        </ul>
      </n-alert>
    </div>
  </div>
</template>
