<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { Refresh, PlayerStop } from '@vicons/tabler';
import type {
  ContainerWorkbenchError,
  DockerContainer,
} from '@/shared/desktop-services/container-workbench';
import { cancelDockerContainerRequest, listDockerContainers } from '@/platform-adapter/container-workbench';

const { locale } = useI18n();
const isChinese = computed(() => locale.value.startsWith('zh'));
const label = (english: string, chinese: string) => (isChinese.value ? chinese : english);
const filter = ref('');
const containers = ref<DockerContainer[]>([]);
const loaded = ref(false);
const busy = ref(false);
const error = ref<ContainerWorkbenchError | null>(null);
const lastUpdated = ref<string | null>(null);
let activeRequest: string | null = null;
let disposed = false;

const errorText = computed(() => {
  const messages: Record<ContainerWorkbenchError, [string, string]> = {
    'invalid-request': ['The container request is invalid.', '容器请求无效。'],
    'untrusted-renderer': ['The request source is not trusted.', '请求来源不受信任。'],
    busy: ['Another Docker request is running.', '已有 Docker 请求正在运行。'],
    cancelled: ['The Docker request was cancelled.', 'Docker 请求已取消。'],
    timeout: ['Docker did not respond within 10 seconds.', 'Docker 在 10 秒内没有响应。'],
    'response-too-large': ['Docker returned too much container data.', 'Docker 返回的容器数据超过上限。'],
    'docker-unavailable': ['Docker CLI is not available on PATH.', 'PATH 中找不到 Docker CLI。'],
    'docker-error': ['Docker could not list containers. Check the local daemon.', 'Docker 无法列出容器，请检查本机服务。'],
    'invalid-response': ['Docker returned invalid or excessive container data.', 'Docker 返回的容器数据无效或过多。'],
    'service-unavailable': ['Container workbench is unavailable.', '容器工作台不可用。'],
  };
  return error.value ? label(...messages[error.value]) : '';
});

const visibleContainers = computed(() => {
  const query = filter.value.trim().toLocaleLowerCase();
  if (!query) {
    return containers.value;
  }
  return containers.value.filter((container) =>
    [container.id, container.name, container.image, container.state, container.status, container.ports].some((value) =>
      value.toLocaleLowerCase().includes(query),
    ),
  );
});

async function refresh(): Promise<void> {
  if (busy.value || disposed) {
    return;
  }
  const requestId = crypto.randomUUID();
  activeRequest = requestId;
  busy.value = true;
  error.value = null;
  const result = await listDockerContainers({ requestId });
  if (disposed || activeRequest !== requestId) {
    return;
  }
  activeRequest = null;
  busy.value = false;
  loaded.value = true;
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  containers.value = result.value;
  lastUpdated.value = new Date().toLocaleTimeString();
}

function cancel(): void {
  if (activeRequest) {
    void cancelDockerContainerRequest({ requestId: activeRequest });
  }
}

onBeforeUnmount(() => {
  disposed = true;
  cancel();
});
</script>

<template>
  <div class="container-workspace" data-test-id="container-workspace" :aria-busy="busy">
    <p class="container-note">
      {{
        label(
          'Reads up to 100 containers from the Docker CLI. Labels, environment variables, mounts and logs are not loaded.',
          '通过 Docker CLI 最多读取 100 个容器。工作台不读取标签、环境变量、挂载和日志。',
        )
      }}
    </p>
    <div class="container-toolbar">
      <n-input
        v-model:value="filter"
        :disabled="busy || !loaded"
        :placeholder="label('Filter containers', '筛选容器')"
        data-test-id="container-filter"
      />
      <n-button :disabled="busy" :loading="busy" data-test-id="container-refresh" @click="refresh">
        <template #icon><n-icon :component="Refresh" /></template>
        {{ loaded ? label('Refresh', '刷新') : label('Load containers', '读取容器') }}
      </n-button>
      <n-button v-if="busy" data-test-id="container-cancel" @click="cancel">
        <template #icon><n-icon :component="PlayerStop" /></template>{{ label('Cancel', '取消') }}
      </n-button>
    </div>
    <n-alert v-if="errorText" type="error" :show-icon="false" role="alert" data-test-id="container-error">
      {{ errorText }}
    </n-alert>
    <div v-if="loaded" class="container-summary" role="status" data-test-id="container-summary">
      <span>{{ visibleContainers.length }} {{ label('containers', '个容器') }}</span>
      <span v-if="lastUpdated">{{ label('Updated', '更新时间') }} {{ lastUpdated }}</span>
    </div>
    <div v-if="loaded && !busy && visibleContainers.length === 0" class="container-empty" data-test-id="container-empty">
      {{ filter ? label('No matching containers.', '没有匹配的容器。') : label('No containers found.', '没有容器。') }}
    </div>
    <div v-if="visibleContainers.length > 0" class="container-table-wrap">
      <table class="container-table">
        <thead>
          <tr>
            <th>{{ label('ID', 'ID') }}</th>
            <th>{{ label('Name', '名称') }}</th>
            <th>{{ label('Image', '镜像') }}</th>
            <th>{{ label('State', '状态') }}</th>
            <th>{{ label('Status', '运行状态') }}</th>
            <th>{{ label('Ports', '端口') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="container in visibleContainers" :key="container.id" data-test-id="container-row">
            <td><code>{{ container.id }}</code></td>
            <td>{{ container.name }}</td>
            <td>{{ container.image }}</td>
            <td>
              <n-tag :type="container.state === 'running' ? 'success' : 'default'" size="small">
                {{ container.state }}
              </n-tag>
            </td>
            <td>{{ container.status || '-' }}</td>
            <td>{{ container.ports || '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped lang="less">
.container-workspace {
  display: grid;
  gap: 14px;
  min-width: 0;
}
.container-note {
  margin: 0;
  opacity: 0.75;
  overflow-wrap: anywhere;
}
.container-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.container-toolbar .n-input {
  flex: 1;
  min-width: 180px;
}
.container-summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  opacity: 0.8;
}
.container-table-wrap {
  max-height: 560px;
  overflow: auto;
  min-width: 0;
}
.container-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.container-table th,
.container-table td {
  padding: 8px;
  border-bottom: 1px solid #8884;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}
.container-table th:first-child {
  width: 110px;
}
.container-table th:nth-child(2) {
  width: 16%;
}
.container-table th:nth-child(4) {
  width: 96px;
}
.container-table th:nth-child(5) {
  width: 180px;
}
.container-table th:nth-child(6) {
  width: 18%;
}
.container-table code {
  font-size: 0.9em;
  overflow-wrap: anywhere;
}
@media (max-width: 760px) {
  .container-toolbar .n-input {
    flex-basis: 100%;
  }
}
@media (max-width: 600px) {
  .container-table th:first-child,
  .container-table td:first-child,
  .container-table th:nth-child(5),
  .container-table td:nth-child(5) {
    display: none;
  }
  .container-table th:nth-child(2) {
    width: 30%;
  }
  .container-table th:nth-child(4) {
    width: 72px;
    white-space: nowrap;
  }
  .container-table th:nth-child(6) {
    width: 25%;
  }
  .container-table th,
  .container-table td {
    padding: 6px 4px;
  }
}
</style>
