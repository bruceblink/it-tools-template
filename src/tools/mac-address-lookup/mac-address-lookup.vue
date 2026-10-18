<script setup lang="ts">
import { createOuiVendorLookup } from './mac-address-lookup.service';
import { macAddressValidationRules } from '@/utils/macAddress';
import { useCopy } from '@/composable/copy';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const macAddress = ref('20:37:06:12:34:56');
const details = ref<string>();
const isLoading = ref(false);
const isUnavailable = ref(false);
const hasCompleteMacAddress = computed(() => /^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(macAddress.value.trim()));
const lookup = createOuiVendorLookup();
let requestGeneration = 0;

async function loadVendor(address: string) {
  const generation = ++requestGeneration;
  details.value = undefined;
  isLoading.value = false;
  isUnavailable.value = false;

  if (!hasCompleteMacAddress.value) {
    return;
  }

  isLoading.value = true;
  try {
    const vendor = await lookup.findVendor(address);
    if (generation === requestGeneration) {
      details.value = vendor;
    }
  }
  catch {
    if (generation === requestGeneration) {
      isUnavailable.value = true;
    }
  }
  finally {
    if (generation === requestGeneration) {
      isLoading.value = false;
    }
  }
}

watch(macAddress, address => void loadVendor(address), { immediate: true });

const { copy } = useCopy({ source: () => details.value ?? '', text: 'Vendor info copied to the clipboard' });
</script>

<template>
  <div>
    <c-input-text
      v-model:value="macAddress"
      label="MAC address:"
      size="large"
      placeholder="Type a MAC address"
      clearable
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      spellcheck="false"
      :validation-rules="macAddressValidationRules"
      mb-5
    />

    <div mb-5px>{{ t('tools.mac-address-lookup.vendorInfo') }}</div>
    <c-card mb-5>
      <div v-if="isLoading" role="status" aria-live="polite" italic op-60>
        {{ t('tools.mac-address-lookup.loading') }}
      </div>

      <div v-else-if="isUnavailable" role="alert">
        <div>{{ t('tools.mac-address-lookup.dataUnavailable') }}</div>
        <c-button mt-3 @click="loadVendor(macAddress)">
          {{ t('tools.mac-address-lookup.retry') }}
        </c-button>
      </div>

      <div v-else-if="details">
        <div v-for="(detail, index) of details.split('\n')" :key="index">
          {{ detail }}
        </div>
      </div>

      <div v-else-if="!hasCompleteMacAddress" italic op-60>
        {{ t('tools.mac-address-lookup.enterFullAddress') }}
      </div>

      <div v-else italic op-60>
        {{ t('tools.mac-address-lookup.unknownVendor') }}
      </div>
    </c-card>

    <div flex justify-center>
      <c-button :disabled="!details" @click="copy()">
        {{ t('tools.mac-address-lookup.copyVendorInfo') }}
      </c-button>
    </div>
  </div>
</template>
