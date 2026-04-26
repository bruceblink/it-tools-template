<script setup lang="ts">
import type * as monaco from 'monaco-editor';

const renderSideBySide = ref(true);
const ignoreTrimWhitespace = ref(false);

const diffOptions = computed<monaco.editor.IDiffEditorOptions>(() => ({
  renderSideBySide: renderSideBySide.value,
  ignoreTrimWhitespace: ignoreTrimWhitespace.value,
}));
</script>

<template>
  <div flex items-center gap-4 mb-2>
    <n-switch v-model:value="renderSideBySide" />
    <span>Side by side</span>
    <n-switch v-model:value="ignoreTrimWhitespace" />
    <span>Ignore whitespace</span>
  </div>
  <c-card w-full important:flex-1 important:pa-0>
    <c-diff-editor :options="diffOptions" />
  </c-card>
</template>
