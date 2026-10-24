<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { ArrowLeft, ArrowRight, PlayerStop, PlugConnected, Unlink, Refresh, Search } from '@vicons/tabler';
import type {
  StorageConnection,
  StorageError,
  StoragePage,
  StoragePreview,
  StorageResult,
} from '@/shared/desktop-services/object-storage';
import {
  cancelStorageRequest,
  connectStorage,
  disconnectStorage,
  listStorageObjects,
  previewStorageObject,
} from '@/platform-adapter/object-storage';

const { locale } = useI18n();
const zh = computed(() => locale.value.startsWith('zh'));
const label = (english: string, chinese: string) => (zh.value ? chinese : english);
const endpoint = ref('https://s3.amazonaws.com');
const region = ref('us-east-1');
const bucket = ref('');
const accessKey = ref('');
const secretKey = ref('');
const sessionToken = ref('');
const prefix = ref('');
const activePrefix = ref('');
const connection = ref<StorageConnection | null>(null);
const page = ref<StoragePage | null>(null);
const preview = ref<StoragePreview | null>(null);
const error = ref<StorageError | null>(null);
const busy = ref(false);
let activeRequest: string | null = null;
let disposed = false;
let connectionVersion = 0;

const errorText = computed(() => {
  const messages: Record<StorageError, [string, string]> = {
    'invalid-request': ['Check the endpoint, region, bucket and credentials.', '请检查服务地址、区域、Bucket 和凭据。'],
    'untrusted-renderer': ['The request source is not trusted.', '请求来源不受信任。'],
    'not-connected': ['The connection is closed. Connect again.', '连接已关闭，请重新连接。'],
    busy: ['Another request is running.', '已有请求正在运行。'],
    cancelled: ['The request was cancelled.', '请求已取消。'],
    timeout: ['The request timed out.', '请求超时。'],
    'access-denied': [
      'Access denied. Check credentials and bucket permissions.',
      '访问被拒绝，请检查凭据和 Bucket 权限。',
    ],
    'not-found': ['The bucket or object was not found.', '未找到 Bucket 或对象。'],
    'response-too-large': ['The service response exceeds the size limit.', '服务响应超过大小限制。'],
    'network-error': ['Connection failed. Check the endpoint and region.', '连接失败，请检查服务地址和区域。'],
    'service-unavailable': ['Object storage is unavailable.', '对象存储服务不可用。'],
  };
  return error.value ? label(...messages[error.value]) : '';
});

/** Ignore late results after navigation or disconnect; the main process owns the request lifetime. */
async function run<T>(operation: (requestId: string) => Promise<StorageResult<T>>): Promise<T | null> {
  if (busy.value) {
    return null;
  }
  const requestId = crypto.randomUUID();
  activeRequest = requestId;
  busy.value = true;
  error.value = null;
  const result = await operation(requestId);
  if (disposed || activeRequest !== requestId) {
    return null;
  }
  activeRequest = null;
  busy.value = false;
  if (!result.ok) {
    error.value = result.error;
    return null;
  }
  return result.value;
}

async function connect(): Promise<void> {
  if (busy.value) {
    return;
  }
  const version = ++connectionVersion;
  connection.value = null;
  page.value = null;
  preview.value = null;
  const result = await run((requestId) =>
    connectStorage({
      requestId,
      endpoint: endpoint.value.trim(),
      region: region.value.trim(),
      bucket: bucket.value.trim(),
      accessKeyId: accessKey.value,
      secretAccessKey: secretKey.value,
      sessionToken: sessionToken.value || undefined,
    }),
  );
  if (disposed || version !== connectionVersion) {
    return;
  }
  secretKey.value = '';
  sessionToken.value = '';
  if (!result) {
    return;
  }
  connection.value = result;
  page.value = result.page;
  prefix.value = '';
  activePrefix.value = '';
}

async function list(nextToken: string | null = null): Promise<void> {
  if (!connection.value || busy.value) {
    return;
  }
  const sessionId = connection.value.sessionId;
  const queryPrefix = nextToken ? activePrefix.value : prefix.value;
  page.value = null;
  preview.value = null;
  const result = await run((requestId) =>
    listStorageObjects({ sessionId, requestId, prefix: queryPrefix, continuationToken: nextToken }),
  );
  if (disposed || connection.value?.sessionId !== sessionId) {
    return;
  }
  page.value = result;
  if (result) {
    activePrefix.value = queryPrefix;
  }
}

async function select(key: string): Promise<void> {
  if (!connection.value || busy.value) {
    return;
  }
  const sessionId = connection.value.sessionId;
  preview.value = null;
  const result = await run((requestId) => previewStorageObject({ sessionId, requestId, key }));
  if (!disposed && connection.value?.sessionId === sessionId) {
    preview.value = result;
  }
}

function disconnect(): void {
  connectionVersion += 1;
  if (activeRequest) {
    void cancelStorageRequest(activeRequest);
  }
  void disconnectStorage();
  activeRequest = null;
  connection.value = null;
  page.value = null;
  preview.value = null;
  busy.value = false;
  error.value = null;
  accessKey.value = '';
  secretKey.value = '';
  sessionToken.value = '';
}

onBeforeUnmount(() => {
  disposed = true;
  disconnect();
});
</script>

<template>
  <div class="storage-workspace" data-test-id="storage-workspace" :aria-busy="busy">
    <form v-if="!connection" class="storage-connect" @submit.prevent="connect">
      <label
        >{{ label('Endpoint', '服务地址')
        }}<n-input
          v-model:value="endpoint"
          :disabled="busy"
          placeholder="https://s3.example.com"
          data-test-id="storage-endpoint"
      /></label>
      <label
        >{{ label('Region', '区域') }}<n-input v-model:value="region" :disabled="busy" data-test-id="storage-region"
      /></label>
      <label>Bucket<n-input v-model:value="bucket" :disabled="busy" data-test-id="storage-bucket" /></label>
      <label
        >Access Key ID<n-input
          v-model:value="accessKey"
          :disabled="busy"
          :input-props="{ autocomplete: 'off' }"
          data-test-id="storage-access-key"
      /></label>
      <label
        >Secret Access Key<n-input
          v-model:value="secretKey"
          type="password"
          :disabled="busy"
          :input-props="{ autocomplete: 'off' }"
          data-test-id="storage-secret-key"
      /></label>
      <label
        >{{ label('Session token (optional)', '会话令牌（可选）')
        }}<n-input v-model:value="sessionToken" type="password" :disabled="busy" :input-props="{ autocomplete: 'off' }"
      /></label>
      <p class="storage-privacy">
        {{
          label(
            'Credentials are kept in memory until disconnect or navigation.',
            '凭据仅保存在内存中，断开或离开页面时清除。',
          )
        }}
      </p>
      <n-button attr-type="submit" type="primary" :disabled="busy" :loading="busy" data-test-id="storage-connect"
        ><template #icon><n-icon :component="PlugConnected" /></template>{{ label('Connect', '连接') }}</n-button
      >
    </form>
    <div v-if="connection" class="storage-toolbar">
      <div class="storage-connection" data-test-id="storage-connection" :data-session-id="connection.sessionId">
        <strong>{{ connection.bucket }}</strong
        ><span>{{ connection.endpoint }}</span
        ><n-tag type="success" size="small">{{ label('Connected', '已连接') }}</n-tag>
      </div>
      <n-button data-test-id="storage-disconnect" @click="disconnect"
        ><template #icon><n-icon :component="Unlink" /></template>{{ label('Disconnect', '断开') }}</n-button
      >
    </div>
    <div v-if="busy" class="storage-running" role="status">
      <span>{{ label('Request in progress', '请求正在运行') }}</span
      ><n-button data-test-id="storage-cancel" @click="activeRequest && cancelStorageRequest(activeRequest)"
        ><template #icon><n-icon :component="PlayerStop" /></template>{{ label('Cancel', '取消') }}</n-button
      >
    </div>
    <n-alert v-if="errorText" type="error" :show-icon="false" role="alert" data-test-id="storage-error">{{
      errorText
    }}</n-alert>
    <template v-if="connection">
      <form class="storage-filter" @submit.prevent="list()">
        <n-input
          v-model:value="prefix"
          :disabled="busy"
          :placeholder="label('Object prefix', '对象前缀')"
          data-test-id="storage-prefix"
        />
        <n-button attr-type="submit" :disabled="busy" data-test-id="storage-filter"
          ><template #icon><n-icon :component="Search" /></template>{{ label('Filter', '筛选') }}</n-button
        >
        <n-button
          :disabled="busy"
          :title="label('Refresh', '刷新')"
          :aria-label="label('Refresh', '刷新')"
          @click="list()"
          ><template #icon><n-icon :component="Refresh" /></template
        ></n-button>
      </form>
      <div class="storage-results">
        <section :aria-label="label('Objects', '对象')">
          <div class="storage-table-wrap">
            <table class="storage-table">
              <thead>
                <tr>
                  <th>{{ label('Object key', '对象键') }}</th>
                  <th>{{ label('Bytes', '字节') }}</th>
                  <th>{{ label('Modified', '修改时间') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="object in page?.objects ?? []"
                  :key="object.key"
                  data-test-id="storage-object"
                  :class="{ selected: preview?.key === object.key }"
                >
                  <td>
                    <button :disabled="busy" @click="select(object.key)">{{ object.key }}</button>
                  </td>
                  <td>{{ object.size.toLocaleString() }}</td>
                  <td>{{ object.lastModified ? new Date(object.lastModified).toLocaleString() : '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="page?.objects.length === 0" data-test-id="storage-empty">{{ label('No objects', '没有对象') }}</p>
          <div class="storage-pagination">
            <n-button
              :disabled="busy || !page"
              :title="label('First page', '第一页')"
              :aria-label="label('First page', '第一页')"
              data-test-id="storage-first"
              @click="list()"
              ><template #icon><n-icon :component="ArrowLeft" /></template></n-button
            ><span>{{ page?.objects.length ?? 0 }} {{ label('objects', '个对象') }}</span
            ><n-button
              :disabled="busy || !page?.nextToken"
              :title="label('Next page', '下一页')"
              :aria-label="label('Next page', '下一页')"
              data-test-id="storage-next"
              @click="list(page?.nextToken)"
              ><template #icon><n-icon :component="ArrowRight" /></template
            ></n-button>
          </div>
        </section>
        <section class="storage-preview" :aria-label="label('Preview', '预览')" data-test-id="storage-preview">
          <h3>{{ preview?.key ?? label('Preview', '预览') }}</h3>
          <template v-if="preview"
            ><span>{{ preview.contentType }}</span>
            <p v-if="preview.truncated" data-test-id="storage-truncated">
              {{ label('Preview limited to 64 KiB', '预览最多显示 64 KiB') }}
            </p>
            <p v-if="preview.binary">{{ label('Binary content', '二进制内容') }}</p>
            <pre v-else data-test-id="storage-preview-text">{{ preview.text }}</pre>
          </template>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped lang="less">
.storage-workspace {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.storage-connect {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  max-width: 800px;
}
.storage-connect label {
  display: grid;
  gap: 5px;
  min-width: 0;
}
.storage-connect > button {
  justify-self: start;
}
.storage-privacy {
  grid-column: 1 / -1;
  margin: 0;
  opacity: 0.75;
}
.storage-toolbar,
.storage-filter,
.storage-running,
.storage-pagination {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.storage-toolbar {
  justify-content: space-between;
  flex-wrap: wrap;
}
.storage-connection {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  overflow-wrap: anywhere;
  min-width: 0;
}
.storage-filter .n-input {
  flex: 1;
  min-width: 0;
}
.storage-results {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 20px;
}
.storage-results section {
  min-width: 0;
}
.storage-table-wrap {
  max-height: 480px;
  overflow: auto;
}
.storage-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.storage-table th,
.storage-table td {
  padding: 8px;
  border-bottom: 1px solid #8884;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}
.storage-table th:first-child {
  width: 48%;
}
.storage-table th:nth-child(2) {
  width: 72px;
  white-space: nowrap;
}
.storage-table button {
  background: none;
  border: 0;
  padding: 0;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font: inherit;
  overflow-wrap: anywhere;
  max-width: 100%;
}
.storage-table .selected {
  background: #168c4930;
}
.storage-pagination {
  justify-content: flex-end;
  margin-top: 10px;
}
.storage-preview {
  border-left: 1px solid #8884;
  padding-left: 20px;
}
.storage-preview h3 {
  margin: 0 0 8px;
  font-size: 16px;
  overflow-wrap: anywhere;
}
.storage-preview pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 480px;
  overflow: auto;
  margin: 12px 0;
}
@media (max-width: 1100px) {
  .storage-results {
    grid-template-columns: minmax(0, 1fr);
  }
  .storage-preview {
    border-left: 0;
    border-top: 1px solid #8884;
    padding: 16px 0 0;
  }
}
@media (max-width: 760px) {
  .storage-connect {
    grid-template-columns: minmax(0, 1fr);
  }
  .storage-filter {
    flex-wrap: wrap;
  }
}
</style>
