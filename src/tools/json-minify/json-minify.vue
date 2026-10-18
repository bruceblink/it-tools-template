<script setup lang="ts">
const defaultValue = '{\n\t"hello": [\n\t\t"world"\n\t]\n}';
</script>

<template>
  <format-transformer
    input-label="Your raw JSON"
    :input-default="defaultValue"
    input-placeholder="Paste your raw JSON here..."
    output-label="Minified version of your JSON"
    output-language="json"
    worker-task-kind="json-minify"
  />
</template>
