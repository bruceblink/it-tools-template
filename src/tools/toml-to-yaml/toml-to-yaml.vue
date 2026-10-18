<template>
  <format-transformer
    input-label="Your TOML"
    input-placeholder="Paste your TOML here..."
    output-label="YAML from your TOML"
    output-language="yaml"
    worker-task-kind="toml-to-yaml"
    worker-invalid-message="Provided TOML is not valid."
  />
</template>
