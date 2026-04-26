<script setup lang="ts">
import { useThemeVars } from 'naive-ui';
import Memo from './regex-memo.content.md';

const themeVars = useThemeVars();
const searchQuery = ref('');
const memoRef = ref<HTMLElement | null>(null);

function filterSections() {
  if (!memoRef.value) return;
  const query = searchQuery.value.toLowerCase().trim();
  const headings = memoRef.value.querySelectorAll('h3');

  headings.forEach((heading) => {
    const section: Element[] = [heading];
    let el = heading.nextElementSibling;
    while (el && el.tagName !== 'H3' && el.tagName !== 'H2') {
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
::v-deep(table) {
  border-collapse: collapse;
}
::v-deep(table), ::v-deep(td), ::v-deep(th) {
  border: 1px solid v-bind('themeVars.textColor1');
  padding: 5px;
}
::v-deep(a) {
  color: v-bind('themeVars.textColor1');
}
</style>
