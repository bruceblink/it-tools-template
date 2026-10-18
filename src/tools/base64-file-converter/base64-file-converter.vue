<script setup lang="ts">
import { useMessage } from 'naive-ui';
import { useCopy } from '@/composable/copy';
import { getExtensionFromMimeType, getMimeTypeFromBase64, previewImageFromBase64, useDownloadFileFromBase64Refs } from '@/composable/downloadBase64';
import { readSelectedFileAsDataUrl } from '@/platform-adapter';
import { useValidation } from '@/composable/validation';
import { isValidBase64 } from '@/utils/base64';

const fileName = ref('file');
const fileExtension = ref('');
const base64Input = ref('');
const { download } = useDownloadFileFromBase64Refs(
  {
    source: base64Input,
    filename: fileName,
    extension: fileExtension,
  });
const base64InputValidation = useValidation({
  source: base64Input,
  rules: [
    {
      message: 'Invalid base 64 string',
      validator: value => isValidBase64(value.trim()),
    },
  ],
});

watch(
  base64Input,
  (newValue, _) => {
    const { mimeType } = getMimeTypeFromBase64({ base64String: newValue });
    if (mimeType) {
      fileExtension.value = getExtensionFromMimeType(mimeType) || fileExtension.value;
    }
  },
);

function previewImage() {
  if (!base64InputValidation.isValid) {
    return;
  }
  try {
    const image = previewImageFromBase64(base64Input.value);
    image.style.maxWidth = '100%';
    image.style.maxHeight = '400px';
    const previewContainer = document.getElementById('previewContainer');
    if (previewContainer) {
      previewContainer.innerHTML = '';
      previewContainer.appendChild(image);
    }
  }
  catch (_) {
    //
  }
}

function downloadFile() {
  if (!base64InputValidation.isValid) {
    return;
  }

  try {
    download();
  }
  catch (_) {
    //
  }
}

const fileBase64 = ref('');
const { copy: copyFileBase64 } = useCopy({ source: fileBase64, text: 'Base64 string copied to the clipboard' });
const message = useMessage();

async function onUpload(file: File) {
  if (file) {
    const result = await readSelectedFileAsDataUrl(file);
    if (result.status === 'success') {
      fileBase64.value = result.value;
      return;
    }

    fileBase64.value = '';
    message.error(result.status === 'unsupported'
      ? 'Reading selected files is not supported in this context.'
      : result.status === 'denied'
        ? 'Access to the selected file was denied.'
        : 'Could not read the selected file.');
  }
}
</script>

<template>
  <c-card title="Base64 to file">
    <n-grid cols="3" x-gap="12">
      <n-gi span="2">
        <c-input-text
          v-model:value="fileName"
          label="File Name"
          placeholder="Download filename"
          mb-2
        />
      </n-gi>
      <n-gi>
        <c-input-text
          v-model:value="fileExtension"
          label="Extension"
          placeholder="Extension"
          mb-2
        />
      </n-gi>
    </n-grid>
    <c-input-text
      v-model:value="base64Input"
      multiline
      placeholder="Put your base64 file string here..."
      rows="5"
      :validation="base64InputValidation"
      mb-2
    />

    <div flex justify-center py-2>
      <div id="previewContainer" />
    </div>

    <div flex justify-center gap-3>
      <c-button :disabled="base64Input === '' || !base64InputValidation.isValid" @click="previewImage()">
        Preview image
      </c-button>
      <c-button :disabled="base64Input === '' || !base64InputValidation.isValid" @click="downloadFile()">
        Download file
      </c-button>
    </div>
  </c-card>

  <c-card title="File to base64">
    <c-file-upload title="Drag and drop a file here, or click to select a file" @file-upload="onUpload" />
    <c-input-text :value="fileBase64" multiline readonly placeholder="File in base64 will be here" rows="5" my-2 />

    <div flex justify-center>
      <c-button @click="copyFileBase64()">
        Copy
      </c-button>
    </div>
  </c-card>
</template>

<style lang="less" scoped>
::v-deep(.n-upload-trigger) {
  width: 100%;
}
</style>
