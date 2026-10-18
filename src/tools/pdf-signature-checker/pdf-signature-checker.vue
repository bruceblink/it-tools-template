<script setup lang="ts">
import type { SignatureInfo } from './pdf-signature-checker.types';
import { formatBytes } from '@/utils/convert';
import { readSelectedFileAsArrayBuffer } from '@/platform-adapter';

const signatures = ref<SignatureInfo[]>([]);
const status = ref<'idle' | 'parsed' | 'error' | 'loading'>('idle');
const file = ref<File | null>(null);
const noSignatureMessage = 'No readable supported digital signature was found in the selected PDF.';
const errorMessage = ref(noSignatureMessage);

// Read only the user-selected file and verify it locally in this page.
async function onVerifyClicked(uploadedFile: File) {
  file.value = uploadedFile;
  status.value = 'loading';
  signatures.value = [];
  errorMessage.value = noSignatureMessage;
  try {
    const fileResult = await readSelectedFileAsArrayBuffer(uploadedFile);
    if (fileResult.status !== 'success') {
      errorMessage.value = fileResult.status === 'unsupported'
        ? 'Reading selected files is not supported in this context.'
        : fileResult.status === 'denied'
          ? 'Access to the selected file was denied.'
          : 'Could not read the selected file.';
      status.value = 'error';
      return;
    }
    const { verifyPdf } = await import('./verify-pdf');
    const result = verifyPdf(fileResult.value);
    const parsedSignatures = Array.isArray(result.signatures) ? result.signatures : [];
    if (parsedSignatures.length === 0) {
      errorMessage.value = noSignatureMessage;
      status.value = 'error';
      return;
    }
    signatures.value = parsedSignatures;
    status.value = 'parsed';
  }
  catch {
    signatures.value = [];
    errorMessage.value = 'The selected PDF could not be read or verified.';
    status.value = 'error';
  }
}
</script>

<template>
  <div style="flex: 0 0 100%">
    <div mx-auto max-w-600px>
      <c-file-upload title="Drag and drop a PDF file here, or click to select a file" accept=".pdf" @file-upload="onVerifyClicked" />

      <c-card v-if="file" mt-4 flex gap-2>
        <div font-bold>
          {{ file.name }}
        </div>

        <div>
          {{ formatBytes(file.size) }}
        </div>
      </c-card>

      <div v-if="status === 'error'">
        <c-alert mt-4>
          {{ errorMessage }}
        </c-alert>
      </div>
    </div>
  </div>

  <div v-if="status === 'parsed' && signatures.length" style="flex: 0 0 100%" mt-5 flex flex-col gap-4>
    <div v-for="(signature, index) of signatures" :key="index">
      <div mb-2 font-bold>
        Signature {{ index + 1 }} certificates :
      </div>

      <pdf-signature-details :signature="signature" />
    </div>
  </div>
</template>
