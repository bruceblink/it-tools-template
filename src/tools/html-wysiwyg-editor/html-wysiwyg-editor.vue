<script setup lang="ts">
import { format } from 'prettier';
import htmlParser from 'prettier/plugins/html';
import { useStorage } from '@vueuse/core';
import Editor from './editor/editor.vue';
import TextareaCopyable from '@/components/TextareaCopyable.vue';

const html = useStorage('html-wysiwyg-editor--html', '<h1>Hey!</h1><p>Welcome to this html wysiwyg editor</p>');

const formattedHtml = asyncComputed(() => format(html.value, { parser: 'html', plugins: [htmlParser] }), '');

function downloadHtml() {
  const blob = new Blob([formattedHtml.value], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'document.html';
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <Editor v-model:html="html" />
  <div flex gap-2 items-center>
    <TextareaCopyable :value="formattedHtml" language="html" flex-1 />
    <c-button @click="downloadHtml">
      Download .html
    </c-button>
  </div>
</template>
