<script setup lang="ts">
import { useThemeVars } from 'naive-ui';
import Memo from './git-memo.content.md';

const themeVars = useThemeVars();
const searchQuery = ref('');
const memoRef = ref<HTMLElement | null>(null);

function filterSections() {
  if (!memoRef.value) return;
  const query = searchQuery.value.toLowerCase().trim();
  const headings = memoRef.value.querySelectorAll('h2');

  headings.forEach((heading) => {
    const section: Element[] = [heading];
    let el = heading.nextElementSibling;
    while (el && el.tagName !== 'H2') {
      section.push(el);
      el = el.nextElementSibling;
    }
    const visible = !query || heading.textContent?.toLowerCase().includes(query);
    section.forEach(e => ((e as HTMLElement).style.display = visible ? '' : 'none'));
  });
}

watch(searchQuery, filterSections);
</script>

<template>
  <c-input-text
    v-model:value="searchQuery"
    placeholder="Search sections..."
    mb-4
    clearable
  />
  <div ref="memoRef">
    <Memo />
  </div>
</template>

<style lang="less" scoped>
::v-deep(pre) {
  margin: 0;
  padding: 15px 22px;
  background-color: v-bind('themeVars.cardColor');
  border-radius: 4px;
  overflow: auto;
}
</style>
