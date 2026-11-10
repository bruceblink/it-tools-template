<script setup lang="ts">
import { NAlert, NButton, NCard, NFormItem, NInput, NInputNumber, NSelect, NSwitch, NTag } from 'naive-ui';
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  PluginToolCommandExecutor,
  PluginToolCommandResult,
  PluginToolInputField,
  PluginToolInputValue,
  PluginToolInputValueMap,
  PluginToolWorkbenchDefinition,
} from '@/shared/plugin-tool-workbench';

const props = defineProps<{
  tool: PluginToolWorkbenchDefinition;
  execute: PluginToolCommandExecutor;
}>();

const { locale } = useI18n();
const labels = computed(() => locale.value === 'zh'
  ? {
      run: '运行',
      result: '结果',
      required: '此字段为必填项。',
      tooLong: '输入超过最大长度。',
      invalidNumber: '请输入有效数字。',
      invalidInteger: '请输入安全整数。',
      belowMinimum: '输入小于允许的最小值。',
      aboveMaximum: '输入大于允许的最大值。',
      invalidOption: '请选择有效选项。',
      unexpectedResult: '插件返回了未声明的结果类型。',
      commandTimedOut: '插件命令执行超时。',
      commandCancelled: '插件命令已取消。',
      commandFailed: '插件命令执行失败。',
    }
  : {
      run: 'Run',
      result: 'Result',
      required: 'is required.',
      tooLong: 'exceeds the maximum length.',
      invalidNumber: 'must be a valid number.',
      invalidInteger: 'must be a safe integer.',
      belowMinimum: 'is below the minimum allowed.',
      aboveMaximum: 'is above the maximum allowed.',
      invalidOption: 'must be a valid option.',
      unexpectedResult: 'The plugin returned an unexpected result type.',
      commandTimedOut: 'The plugin command timed out.',
      commandCancelled: 'The plugin command was cancelled.',
      commandFailed: 'The plugin command could not be completed.',
    });

const inputValues = reactive<Record<string, PluginToolInputValue>>({});
const inputError = ref<string>();
const commandError = ref<string>();
const result = ref<PluginToolCommandResult>();
const isRunning = ref(false);
let activeController: AbortController | undefined;

function fieldError(label: string, message: string): string {
  return locale.value === 'zh' ? `${label}：${message}` : `${label} ${message}`;
}

function resetInputValues(fields: readonly PluginToolInputField[]): void {
  for (const key of Object.keys(inputValues)) {
    delete inputValues[key];
  }
  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      inputValues[field.id] = field.defaultValue;
    }
    else if (field.type === 'boolean') {
      inputValues[field.id] = false;
    }
    else if (field.type === 'select') {
      inputValues[field.id] = field.options[0]?.value ?? null;
    }
    else {
      inputValues[field.id] = field.type === 'number' ? null : '';
    }
  }
}

watch(() => props.tool.fields, fields => resetInputValues(fields), { immediate: true });

function getStringValue(id: string): string {
  const value = inputValues[id];
  return typeof value === 'string' ? value : '';
}

function getNumberValue(id: string): number | null {
  const value = inputValues[id];
  return typeof value === 'number' ? value : null;
}

function getBooleanValue(id: string): boolean {
  return inputValues[id] === true;
}

function setInputValue(id: string, value: PluginToolInputValue): void {
  inputValues[id] = value;
}

function getSelectOptions(field: PluginToolInputField) {
  return field.type === 'select'
    ? field.options.map(option => ({ label: option.label, value: option.value }))
    : [];
}

function validateInput(): PluginToolInputValueMap | undefined {
  for (const field of props.tool.fields) {
    const value = inputValues[field.id];
    if (field.required && (value === null || value === undefined || (typeof value === 'string' && value.trim().length === 0))) {
      inputError.value = fieldError(field.label, labels.value.required);
      return undefined;
    }
    if ((field.type === 'text' || field.type === 'textarea') && typeof value === 'string' && field.maxLength !== undefined && value.length > field.maxLength) {
      inputError.value = fieldError(field.label, labels.value.tooLong);
      return undefined;
    }
    if (field.type === 'number' && value !== null && value !== undefined) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        inputError.value = fieldError(field.label, labels.value.invalidNumber);
        return undefined;
      }
      // 整数字段只提交安全整数，避免插件收到无法精确表示的整数值。
      if (field.integer && !Number.isSafeInteger(value)) {
        inputError.value = fieldError(field.label, labels.value.invalidInteger);
        return undefined;
      }
      if (field.minimum !== undefined && value < field.minimum) {
        inputError.value = fieldError(field.label, labels.value.belowMinimum);
        return undefined;
      }
      if (field.maximum !== undefined && value > field.maximum) {
        inputError.value = fieldError(field.label, labels.value.aboveMaximum);
        return undefined;
      }
    }
    if (field.type === 'select' && value !== null && value !== undefined && !field.options.some(option => option.value === value)) {
      inputError.value = fieldError(field.label, labels.value.invalidOption);
      return undefined;
    }
  }
  inputError.value = undefined;
  return { ...inputValues };
}

async function runCommand(): Promise<void> {
  if (isRunning.value) {
    return;
  }
  const input = validateInput();
  if (!input) {
    return;
  }

  activeController?.abort();
  activeController = new AbortController();
  const controller = activeController;
  isRunning.value = true;
  commandError.value = undefined;
  result.value = undefined;
  try {
    const nextResult = await props.execute({
      pluginId: props.tool.pluginId,
      version: props.tool.version,
      toolId: props.tool.toolId,
      commandId: props.tool.commandId,
      input,
    }, controller.signal);
    if (controller.signal.aborted) {
      return;
    }
    if (nextResult.kind !== props.tool.resultKind) {
      commandError.value = labels.value.unexpectedResult;
      return;
    }
    result.value = nextResult;
  }
  catch (error) {
    if (!controller.signal.aborted) {
      const code = getPluginCommandFailureCode(error);
      commandError.value = code === 'timeout'
        ? labels.value.commandTimedOut
        : code === 'cancelled'
          ? labels.value.commandCancelled
          : labels.value.commandFailed;
    }
  }
  finally {
    if (activeController === controller) {
      isRunning.value = false;
    }
  }
}

/** 只识别宿主传递的固定错误码，不显示异常消息或插件返回内容。 */
function getPluginCommandFailureCode(error: unknown): 'timeout' | 'cancelled' | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return error.code === 'timeout' || error.code === 'cancelled' ? error.code : undefined;
}

onUnmounted(() => activeController?.abort());
</script>

<template>
  <div class="plugin-tool-workbench">
    <n-card :title="tool.title">
      <template #header-extra>
        <n-tag size="small">{{ tool.pluginId }} · {{ tool.version }}</n-tag>
      </template>

      <p class="plugin-tool-workbench-description">{{ tool.description }}</p>
      <form class="plugin-tool-workbench-form" @submit.prevent="runCommand">
        <n-form-item
          v-for="field in tool.fields"
          :key="field.id"
          :label="field.label"
          :required="field.required"
          :show-feedback="false"
          label-placement="top"
        >
          <div class="plugin-tool-workbench-field">
            <n-input
            v-if="field.type === 'text' || field.type === 'textarea'"
            :value="getStringValue(field.id)"
            :type="field.type === 'textarea' ? 'textarea' : 'text'"
            :placeholder="field.placeholder"
            :maxlength="field.maxLength"
            :disabled="isRunning"
            :autosize="field.type === 'textarea' ? { minRows: 4, maxRows: 16 } : undefined"
            :aria-label="field.label"
            @update:value="value => setInputValue(field.id, value)"
          />
          <n-input-number
            v-else-if="field.type === 'number'"
            :value="getNumberValue(field.id)"
            :min="field.minimum"
            :max="field.maximum"
            :step="field.step"
            :disabled="isRunning"
            style="width: 100%"
            :aria-label="field.label"
            @update:value="value => setInputValue(field.id, value)"
          />
          <n-switch
            v-else-if="field.type === 'boolean'"
            :value="getBooleanValue(field.id)"
            :disabled="isRunning"
            :aria-label="field.label"
            @update:value="value => setInputValue(field.id, value)"
          />
          <n-select
            v-else
            :value="typeof inputValues[field.id] === 'string' ? inputValues[field.id] as string : null"
            :options="getSelectOptions(field)"
            :disabled="isRunning"
            :aria-label="field.label"
            @update:value="value => setInputValue(field.id, value)"
          />
            <small v-if="field.description" class="plugin-tool-workbench-field-description">
              {{ field.description }}
            </small>
          </div>
        </n-form-item>

        <n-alert v-if="inputError" type="error" :show-icon="false" role="alert">
          {{ inputError }}
        </n-alert>
        <n-button attr-type="submit" type="primary" :loading="isRunning">
          {{ labels.run }}
        </n-button>
      </form>

      <n-alert v-if="commandError" type="error" :show-icon="false" role="alert" mt-4>
        {{ commandError }}
      </n-alert>
      <n-card v-if="result" class="plugin-tool-workbench-result" :title="labels.result" size="small" mt-4>
        <pre class="plugin-tool-workbench-text-result">{{ result.kind === 'json' ? JSON.stringify(result.value, null, 2) : result.value }}</pre>
      </n-card>
    </n-card>
  </div>
</template>

<style scoped>
.plugin-tool-workbench {
  width: 100%;
  min-width: 0;
}

.plugin-tool-workbench :deep(.n-card),
.plugin-tool-workbench :deep(.n-card-content) {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}

.plugin-tool-workbench-description {
  margin: 0 0 20px;
  line-height: 1.6;
  color: var(--n-text-color-3);
}

.plugin-tool-workbench-form {
  display: grid;
  gap: 16px;
}

.plugin-tool-workbench-field {
  width: 100%;
  min-width: 0;
}

.plugin-tool-workbench-field-description {
  display: block;
  margin-top: 6px;
  color: var(--n-text-color-3);
  line-height: 1.5;
}

.plugin-tool-workbench-result :deep(.n-card-content) {
  min-width: 0;
  overflow: auto;
}

.plugin-tool-workbench-text-result {
  max-width: 100%;
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
}
</style>
