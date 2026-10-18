<script setup lang="ts">
const defaultValue = '<a x="1.234" y="It\'s"/>';
</script>

<template>
  <format-transformer
    input-label="Your XML content"
    :input-default="defaultValue"
    input-placeholder="Paste your XML content here..."
    output-label="Converted JSON"
    output-language="json"
    worker-task-kind="xml-to-json"
    worker-invalid-message="Provided XML is not valid."
  />
</template>
