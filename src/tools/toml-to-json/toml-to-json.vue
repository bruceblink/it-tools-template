<template>
  <format-transformer
    input-label="Your TOML"
    input-placeholder="Paste your TOML here..."
    output-label="JSON from your TOML"
    output-language="json"
    worker-task-kind="toml-to-json"
    worker-invalid-message="Provided TOML is not valid."
  />
</template>
