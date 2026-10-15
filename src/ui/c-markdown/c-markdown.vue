<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { marked, type Tokens } from 'marked';
import { sanitizeHtmlForRender } from '@/utils/sanitizeHtml';

const props = withDefaults(defineProps<{ markdown?: string }>(), { markdown: '' });
const { markdown } = toRefs(props);

marked.use({
  renderer: {
    link({ href, text, title }: Tokens.Link) {
      const titleAttribute = title ? ` title="${title}"` : '';
      return `<a class="text-primary transition decoration-none hover:underline" href="${href}"${titleAttribute} target="_blank" rel="noopener">${text}</a>`;
    },
  },
});

const html = computed(() => sanitizeHtmlForRender(marked.parse(markdown.value) as string));
</script>

<template>
  <div v-html="html" />
</template>
