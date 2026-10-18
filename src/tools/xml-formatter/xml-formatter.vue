<script setup lang="ts">
const defaultValue = '<hello><world>foo</world><world>bar</world></hello>';
const indentSize = useStorage('xml-formatter:indent-size', 2);
const collapseContent = useStorage('xml-formatter:collapse-content', true);
const workerTaskOptions = computed(() => ({
  indentSize: indentSize.value,
  collapseContent: collapseContent.value,
}));
</script>

<template>
  <div important:flex-full important:flex-shrink-0 important:flex-grow-0>
    <div flex justify-center>
      <n-form-item label="Collapse content:" label-placement="left">
        <n-switch v-model:value="collapseContent" />
      </n-form-item>
      <n-form-item label="Indent size:" label-placement="left" label-width="100" :show-feedback="false">
        <n-input-number v-model:value="indentSize" min="0" max="10" w-100px />
      </n-form-item>
    </div>
  </div>

  <format-transformer
    input-label="Your XML"
    input-placeholder="Paste your XML here..."
    output-label="Formatted XML from your XML"
    output-language="xml"
    :input-default="defaultValue"
    worker-task-kind="xml-format"
    :worker-task-options="workerTaskOptions"
    worker-invalid-message="Provided XML is not valid."
  />
</template>
