<script setup lang="ts">
const sampleInput = [
  '192.168.1.0/25',
  '192.168.1.128-192.168.1.255',
  '10.0.0.1',
  '10.0.0.2',
].join('\n');
</script>

<template>
  <format-transformer
    input-label="IPv4 addresses, ranges, or CIDR blocks"
    :input-default="sampleInput"
    input-placeholder="Paste one IPv4 address, range, or CIDR block per line..."
    output-label="Merged CIDR blocks"
    output-language="txt"
    worker-task-kind="ipv4-cidr-merge"
  />
</template>
