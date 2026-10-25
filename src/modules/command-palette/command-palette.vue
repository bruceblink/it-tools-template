<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useMessage } from 'naive-ui';
import { useCommandPaletteStore } from './command-palette.store';
import type { PaletteOption } from './command-palette.types';

const isModalOpen = defineModel<boolean>('open', { default: false });
const inputRef = ref();
const router = useRouter();
const commandPaletteStore = useCommandPaletteStore();
const { searchPrompt, filteredSearchResult } = storeToRefs(commandPaletteStore);
const message = useMessage();
const { t } = useI18n();
const flatSearchResults = computed(() => Object.values(filteredSearchResult.value).flat());

const keys = useMagicKeys();

whenever(isModalOpen, () => inputRef.value?.focus());

whenever(() => keys.escape?.value ?? false, close);

function close() {
  isModalOpen.value = false;
  searchPrompt.value = '';
}

watch(isModalOpen, (isOpen) => {
  if (isOpen) {
    void commandPaletteStore.loadExtensionCommands().catch(() => {
      message.error(t('taskStatus.error'));
    });
  }
  else {
    searchPrompt.value = '';
  }
}, { immediate: true });

const selectedOptionIndex = ref(0);

function handleKeydown(event: KeyboardEvent) {
  const { key } = event;
  const isEnterPressed = key === 'Enter';
  const isArrowUpOrDown = ['ArrowUp', 'ArrowDown'].includes(key);
  const isArrowDown = key === 'ArrowDown';

  if (isArrowUpOrDown) {
    const increment = isArrowDown ? 1 : -1;
    const maxIndex = Math.max(flatSearchResults.value.length - 1, 0);

    selectedOptionIndex.value = Math.min(Math.max(selectedOptionIndex.value + increment, 0), maxIndex);

    return;
  }

  if (isEnterPressed) {
    const option = flatSearchResults.value[selectedOptionIndex.value];

    // An empty search result has no selected command to activate.
    if (option) {
      activateOption(option);
    }
  }
}

function getOptionIndex(option: PaletteOption) {
  return flatSearchResults.value.findIndex(candidate => candidate === option);
}

async function activateOption(option: PaletteOption) {
  const { closeOnSelect } = option;

  if (option.action) {
    try {
      await option.action();
      if (closeOnSelect) {
        close();
      }
    }
    catch {
      message.error(option.actionErrorMessage ?? t('taskStatus.error'));
    }
    return;
  }

  const closeAfterNavigation = closeOnSelect || closeOnSelect === undefined;

  if (option.to) {
    router.push(option.to);

    if (closeAfterNavigation) {
      close();
    }
    return;
  }

  if (option.href) {
    window.open(option.href, '_blank');

    if (closeAfterNavigation) {
      close();
    }
  }
}
</script>

<template>
  <c-modal
    v-model:open="isModalOpen"
    class="palette-modal"
    shadow-xl
    important:max-w-650px
    important:pa-12px
    @keydown="handleKeydown"
  >
    <c-input-text
      ref="inputRef"
      v-model:value="searchPrompt"
      raw-text
      placeholder="Type to search a tool or a command..."
      autofocus
      clearable
    />

    <div v-for="(options, category) in filteredSearchResult" :key="category">
      <div ml-3 mt-3 text-sm text-primary font-bold op-60>
        {{ category }}
      </div>
      <command-palette-option
        v-for="option in options"
        :key="option.name"
        :option="option"
        :selected="selectedOptionIndex === getOptionIndex(option)"
        @activated="activateOption"
      />
    </div>
  </c-modal>
</template>

<style scoped lang="less">
.c-input-text {
  font-size: 18px;

  ::v-deep(.input-wrapper) {
    padding: 4px;
    padding-left: 18px;
  }
}

.c-modal--overlay {
  align-items: flex-start !important;
  padding-top: 80px;
}
</style>
