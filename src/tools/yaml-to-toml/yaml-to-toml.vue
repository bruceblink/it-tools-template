<template>
  <format-transformer
    input-label="Your YAML"
    input-placeholder="Paste your YAML here..."
    output-label="TOML from your YAML"
    output-language="toml"
    worker-task-kind="yaml-to-toml"
    worker-invalid-message="Provided YAML is not valid."
  />
</template>
