<script setup lang="ts">
import Editor from './editor/editor.vue';
import TextareaCopyable from '@/components/TextareaCopyable.vue';

const html = ref('<h1>Hey!</h1><p>Welcome to this html wysiwyg editor</p>');

// Defer formatting code so the editor can render before loading its output formatter.
const formattedHtml = asyncComputed(async () => {
  const [{ format }, { default: htmlParser }] = await Promise.all([
    import('prettier'),
    import('prettier/plugins/html'),
  ]);

  return format(html.value, { parser: 'html', plugins: [htmlParser] });
}, '');

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
