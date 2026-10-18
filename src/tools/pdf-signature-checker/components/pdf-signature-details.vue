<script setup lang="ts">
import type { SignatureInfo } from '../pdf-signature-checker.types';
import type { CKeyValueListItems } from '@/ui/c-key-value-list/c-key-value-list.types';

const props = defineProps<{ signature: SignatureInfo }>();
const { signature } = toRefs(props);

const tableHeaders = {
  validityPeriod: 'Validity period',
  issuedBy: 'Issued by',
  issuedTo: 'Issued to',
  pemCertificate: 'PEM certificate',
};

// Show signature integrity and certificate trust as separate results.
const verificationRows = computed(() => [
  { check: 'Overall result', result: signature.value.verified ? 'Verified' : 'Not verified' },
  { check: 'Document integrity', result: signature.value.integrity ? 'Valid' : 'Invalid' },
  { check: 'Certificate chain', result: signature.value.authenticity ? 'Trusted' : 'Not trusted' },
  { check: 'Certificate time validity', result: signature.value.expired ? 'Expired or not yet valid' : 'Currently valid' },
]);

// The table exposes dynamic slot values as unknown, so validate certificate fields before rendering them.
function getValidityPeriodItems(value: unknown): CKeyValueListItems {
  if (!isRecord(value)) {
    return [];
  }

  return [
    { label: 'Not before', value: getStringValue(value, 'notBefore') },
    { label: 'Not after', value: getStringValue(value, 'notAfter') },
  ];
}

function getCertificatePartyItems(value: unknown): CKeyValueListItems {
  if (!isRecord(value)) {
    return [];
  }

  return [
    { label: 'Common name', value: getStringValue(value, 'commonName') },
    { label: 'Organization name', value: getStringValue(value, 'organizationName') },
    { label: 'Country name', value: getStringValue(value, 'countryName') },
    { label: 'Locality name', value: getStringValue(value, 'localityName') },
    { label: 'Organizational unit name', value: getStringValue(value, 'organizationalUnitName') },
    { label: 'State or province name', value: getStringValue(value, 'stateOrProvinceName') },
  ];
}

function getStringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPemCertificate(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const certs = computed(() => signature.value.meta.certs.map((certificate, index) => ({
  ...certificate,
  validityPeriod: {
    notBefore: new Date(certificate.validityPeriod.notBefore).toLocaleString(),
    notAfter: new Date(certificate.validityPeriod.notAfter).toLocaleString(),
  },
  certificateName: `Certificate ${index + 1}`,
})),
);
</script>

<template>
  <div flex flex-col gap-2>
    <c-table
      :data="verificationRows"
      :headers="[
        { key: 'check', label: 'Check' },
        { key: 'result', label: 'Result' },
      ]"
      description="PDF signature verification status"
    />

    <c-table :data="certs" :headers="tableHeaders">
      <template #validityPeriod="{ value }">
        <c-key-value-list :items="getValidityPeriodItems(value)" />
      </template>

      <template #issuedBy="{ value }">
        <c-key-value-list :items="getCertificatePartyItems(value)" />
      </template>

      <template #issuedTo="{ value }">
        <c-key-value-list :items="getCertificatePartyItems(value)" />
      </template>

      <template #pemCertificate="{ value }">
        <c-modal-value :value="getPemCertificate(value)" label="View PEM cert">
          <template #value>
            <div break-all text-xs>
              {{ getPemCertificate(value) }}
            </div>
          </template>
        </c-modal-value>
      </template>
    </c-table>
  </div>
</template>
