<template>
  <format-transformer
    input-label="Your JSON"
    input-placeholder="Paste your JSON here..."
    output-label="YAML from your JSON"
    output-language="yaml"
    worker-task-kind="json-to-yaml"
    worker-invalid-message="Provided JSON is not valid."
  />
</template>
