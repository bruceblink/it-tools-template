<script setup lang="ts">
import TextareaCopyable from '@/components/TextareaCopyable.vue';
import { useCopy } from '@/composable/copy';
import { useDownloadFileFromBase64 } from '@/composable/downloadBase64';
import { textToBase64 } from '@/utils/base64';
import { buildSvgPlaceholder } from './svg-placeholder-generator.service';

const width = ref<number | null>(600);
const height = ref<number | null>(350);
const fontSize = ref<number | null>(26);
const bgColor = ref('#cccccc');
const fgColor = ref('#333333');
const useExactSize = ref(true);
const customText = ref('');
const svgString = computed(() => {
  const w = width.value ?? 600;
  const h = height.value ?? 350;
  const text = customText.value.length > 0 ? customText.value : `${w}x${h}`;

  return buildSvgPlaceholder({
    width: w,
    height: h,
    fontSize: fontSize.value ?? 26,
    backgroundColor: bgColor.value,
    textColor: fgColor.value,
    text,
    useExactSize: useExactSize.value,
  });
});
const base64 = computed(() => `data:image/svg+xml;base64,${textToBase64(svgString.value)}`);

const { copy: copySVG } = useCopy({ source: svgString });
const { copy: copyBase64 } = useCopy({ source: base64 });
const { download } = useDownloadFileFromBase64({ source: base64 });
</script>

<template>
  <div>
    <n-form label-placement="left" label-width="100">
      <div flex gap-3>
        <n-form-item label="Width (in px)" flex-1>
          <n-input-number v-model:value="width" placeholder="SVG width..." min="1" />
        </n-form-item>
        <n-form-item label="Background" flex-1>
          <n-color-picker v-model:value="bgColor" :modes="['hex']" />
        </n-form-item>
      </div>
      <div flex gap-3>
        <n-form-item label="Height (in px)" flex-1>
          <n-input-number v-model:value="height" placeholder="SVG height..." min="1" />
        </n-form-item>
        <n-form-item label="Text color" flex-1>
          <n-color-picker v-model:value="fgColor" :modes="['hex']" />
        </n-form-item>
      </div>
      <div flex gap-3>
        <n-form-item label="Font size" flex-1>
          <n-input-number v-model:value="fontSize" placeholder="Font size..." min="1" />
        </n-form-item>

        <c-input-text
          v-model:value="customText"
          label="Custom text"
          :placeholder="`Default is ${width ?? 600}x${height ?? 350}`"
          label-position="left"
          label-width="100px"
          label-align="right"
          flex-1
        />
      </div>
      <n-form-item label="Use exact size" label-placement="left">
        <n-switch v-model:value="useExactSize" />
      </n-form-item>
    </n-form>

    <n-form-item label="SVG HTML element">
      <TextareaCopyable :value="svgString" copy-placement="none" />
    </n-form-item>
    <n-form-item label="SVG in Base64">
      <TextareaCopyable :value="base64" copy-placement="none" />
    </n-form-item>

    <div flex justify-center gap-3>
      <c-button @click="copySVG()">
        Copy svg
      </c-button>
      <c-button @click="copyBase64()">
        Copy base64
      </c-button>
      <c-button @click="download()">
        Download svg
      </c-button>
    </div>
  </div>

  <img :src="base64" alt="Image">
</template>

<style lang="less" scoped>
.n-input-number {
  width: 100%;
}
</style>
