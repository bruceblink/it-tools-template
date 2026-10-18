<template>
  <format-transformer
    input-label="Your JSON"
    input-placeholder="Paste your JSON here..."
    output-label="TOML from your JSON"
    output-language="toml"
    worker-task-kind="json-to-toml"
    worker-invalid-message="Provided JSON is not valid."
  />
</template>
