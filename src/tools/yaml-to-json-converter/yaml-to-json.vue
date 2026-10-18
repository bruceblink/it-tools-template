<template>
  <format-transformer
    input-label="Your YAML"
    input-placeholder="Paste your yaml here..."
    output-label="JSON from your YAML"
    output-language="json"
    worker-task-kind="yaml-to-json"
    worker-invalid-message="Provided YAML is not valid."
  />
</template>
