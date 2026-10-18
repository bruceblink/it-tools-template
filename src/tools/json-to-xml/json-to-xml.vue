<script setup lang="ts">
const defaultValue = '{"a":{"_attributes":{"x":"1.234","y":"It\'s"}}}';
</script>

<template>
  <format-transformer
    input-label="Your JSON content"
    :input-default="defaultValue"
    input-placeholder="Paste your JSON content here..."
    output-label="Converted XML"
    output-language="xml"
    worker-task-kind="json-to-xml"
    worker-invalid-message="Provided JSON is not valid."
  />
</template>
