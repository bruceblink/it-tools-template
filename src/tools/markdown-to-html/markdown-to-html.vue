<script setup lang="ts">
import markdownit from 'markdown-it';
import TextareaCopyable from '@/components/TextareaCopyable.vue';
import { sanitizeHtmlForRender } from '@/utils/sanitizeHtml';

const inputMarkdown = ref('');
const outputHtml = computed(() => {
  const md = markdownit();
  return md.render(inputMarkdown.value);
});

// Isolate the printable document and sanitize only its DOM; copied HTML stays unchanged.
function printHtml() {
  const w = window.open('', '_blank');
  if (w === null) {
    return;
  }
  w.opener = null;
  w.document.body.innerHTML = sanitizeHtmlForRender(outputHtml.value);
  w.print();
}
</script>

<template>
  <div>
    <c-input-text
      v-model:value="inputMarkdown"
      multiline
      raw-text
      placeholder="Your Markdown content..."
      rows="8"
      autofocus
      label="Your Markdown to convert:"
    />

    <n-divider />

    <n-form-item label="Output HTML:">
      <TextareaCopyable :value="outputHtml" :word-wrap="true" language="html" />
    </n-form-item>

    <div flex justify-center>
      <n-button @click="printHtml"> Print as PDF </n-button>
    </div>
  </div>
</template>
