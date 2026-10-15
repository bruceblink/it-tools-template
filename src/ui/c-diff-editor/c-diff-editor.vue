<script setup lang="ts">
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { useStyleStore } from '@/stores/style.store';

const props = withDefaults(defineProps<{ options?: monaco.editor.IDiffEditorOptions }>(), { options: () => ({}) });
const { options } = toRefs(props);

const editorContainer = ref<HTMLElement | null>(null);
let editor: monaco.editor.IStandaloneDiffEditor | null = null;
let originalModel: monaco.editor.ITextModel | null = null;
let modifiedModel: monaco.editor.ITextModel | null = null;

// Route Monaco's standalone text worker through Vite; no language worker is needed by this diff editor.
globalThis.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label !== 'editorWorkerService') {
      throw new Error(`Unsupported Monaco worker: ${label}`);
    }

    return new EditorWorker();
  },
};

monaco.editor.defineTheme('it-tools-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#00000000',
  },
});

monaco.editor.defineTheme('it-tools-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#00000000',
  },
});

const styleStore = useStyleStore();

watch(
  () => styleStore.isDarkTheme,
  (isDarkTheme) => monaco.editor.setTheme(isDarkTheme ? 'it-tools-dark' : 'it-tools-light'),
  { immediate: true },
);

watch(
  () => options.value,
  (options) => editor?.updateOptions(options),
  { immediate: true, deep: true },
);

useResizeObserver(editorContainer, () => {
  editor?.layout();
});

onMounted(() => {
  if (!editorContainer.value) {
    return;
  }

  editor = monaco.editor.createDiffEditor(editorContainer.value, {
    originalEditable: true,
    minimap: {
      enabled: false,
    },
    ...options.value,
  });

  originalModel = monaco.editor.createModel('original text', 'txt');
  modifiedModel = monaco.editor.createModel('modified text', 'txt');
  editor.setModel({
    original: originalModel,
    modified: modifiedModel,
  });
});

onBeforeUnmount(() => {
  editor?.dispose();
  editor = null;
  // The component owns these models; disposing the editor does not release them. Removing the last model lets Monaco stop its idle worker.
  originalModel?.dispose();
  originalModel = null;
  modifiedModel?.dispose();
  modifiedModel = null;
});
</script>

<template>
  <div ref="editorContainer" h-600px />
</template>
