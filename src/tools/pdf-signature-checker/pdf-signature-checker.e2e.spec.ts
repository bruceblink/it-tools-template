import { expect, test } from '@playwright/test';
import forge from 'node-forge';

const { md, pem, pki, pkcs7, util } = forge;

const signatureContentsLength = 8192;
const signatureOids = {
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  data: '1.2.840.113549.1.7.1',
  sha256: '2.16.840.1.101.3.4.2.1',
} as const;

// Generate an in-memory PDF and self-signed test certificate; no private test key is written to disk.
function createSignedPdf(): { signed: Buffer; tampered: Buffer } {
  const keyPair = pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  const certificate = pki.createCertificate();
  const certificateAttributes = [
    { name: 'commonName', value: 'PDF test signer' },
    { name: 'organizationName', value: 'IT Tools Test' },
    { name: 'countryName', value: 'US' },
  ];
  certificate.publicKey = keyPair.publicKey;
  certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date('2025-01-01T00:00:00.000Z');
  certificate.validity.notAfter = new Date('2035-01-01T00:00:00.000Z');
  certificate.setSubject(certificateAttributes);
  certificate.setIssuer(certificateAttributes);
  certificate.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyCertSign: true },
  ]);
  certificate.sign(keyPair.privateKey, md.sha256.create());

  const byteRangePlaceholder = '0000000000 0000000000 0000000000 0000000000';
  const contentsPlaceholder = '0'.repeat(signatureContentsLength);
  const objects: Array<[number, string]> = [
    [1, '<< /Type /Catalog /Pages 2 0 R /AcroForm 4 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Annots [5 0 R] >>'],
    [4, '<< /SigFlags 3 /Fields [5 0 R] >>'],
    [5, '<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /V 6 0 R /Rect [0 0 0 0] /P 3 0 R >>'],
    [6, `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [${byteRangePlaceholder}] /Contents <${contentsPlaceholder}> /M (D:20260101000000Z) /Name (PDF test signer) /Reason (file-level test) >>`],
    [7, '<< /Title (Original document) >>'],
  ];

  const offsets = new Array<number>(objects.length + 1).fill(0);
  let pdf = '%PDF-1.7\n';
  for (const [objectNumber, body] of objects) {
    offsets[objectNumber] = Buffer.byteLength(pdf, 'ascii');
    pdf += `${objectNumber} 0 obj\n${body}\nendobj\n`;
  }
  const crossReferenceOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let objectNumber = 1; objectNumber <= objects.length; objectNumber++) {
    pdf += `${offsets[objectNumber]!.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF\n`;

  const contentsMarker = '/Contents <';
  const contentsStart = pdf.indexOf(contentsMarker) + contentsMarker.length - 1;
  const contentsEnd = contentsStart + 1 + signatureContentsLength;
  const secondRangeStart = contentsEnd + 1;
  const byteRangeToken = `/ByteRange [${byteRangePlaceholder}]`;
  const byteRangeOffset = pdf.indexOf(byteRangeToken);
  const byteRanges = [0, contentsStart, secondRangeStart, Buffer.byteLength(pdf, 'ascii') - secondRangeStart];
  const actualByteRange = `/ByteRange [${byteRanges.map(value => value.toString().padStart(10, '0')).join(' ')}]`;
  if (contentsStart < 0 || byteRangeOffset < 0 || actualByteRange.length !== byteRangeToken.length) {
    throw new Error('The generated PDF signature placeholders are invalid.');
  }
  pdf = pdf.replace(byteRangeToken, actualByteRange);
  const pdfBuffer = Buffer.from(pdf, 'ascii');
  const signedDataBytes = Buffer.concat([
    pdfBuffer.subarray(0, contentsStart),
    pdfBuffer.subarray(secondRangeStart),
  ]);

  const signedData = pkcs7.createSignedData();
  signedData.content = util.createBuffer(signedDataBytes.toString('binary'));
  signedData.addCertificate(certificate);
  signedData.addSigner({
    key: keyPair.privateKey,
    certificate,
    digestAlgorithm: signatureOids.sha256,
    authenticatedAttributes: [
      { type: signatureOids.contentType, value: signatureOids.data },
      { type: signatureOids.messageDigest },
      { type: signatureOids.signingTime, value: '2026-01-01T00:00:00.000Z' },
    ],
  });
  signedData.sign({ detached: true });

  const pemMessage = pkcs7.messageToPem(signedData);
  const derBytes = pem.decode(pemMessage)[0]?.body;
  if (!derBytes) {
    throw new Error('The generated PDF test signature has no DER payload.');
  }
  const signatureHex = Buffer.from(derBytes, 'binary').toString('hex').toUpperCase();
  if (signatureHex.length > signatureContentsLength) {
    throw new Error('The generated PDF test signature exceeds its placeholder.');
  }
  pdfBuffer.write(signatureHex.padEnd(signatureContentsLength, '0'), contentsStart + 1, 'ascii');

  const tampered = Buffer.from(pdfBuffer);
  const originalTextOffset = tampered.indexOf(Buffer.from('Original document', 'ascii'));
  if (originalTextOffset < 0) {
    throw new Error('The generated PDF does not contain its signed test text.');
  }
  tampered.write('Modified document', originalTextOffset, 'ascii');

  return { signed: pdfBuffer, tampered };
}

test.describe('Tool - Pdf signature checker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pdf-signature-checker');
  });

  test('Has correct title', async ({ page }) => {
    await expect(page).toHaveTitle('PDF signature checker - IT Tools');
  });

  test('loads the verifier only after a file is selected', async ({ page }) => {
    const verifierRequests: string[] = [];
    page.on('request', (request) => {
      if (/(?:^|\/)verify-pdf(?:-[^/]+)?\.(?:js|ts)$/.test(new URL(request.url()).pathname)) {
        verifierRequests.push(request.url());
      }
    });

    await page.goto('/pdf-signature-checker');
    await expect(page.getByText('Drag and drop a PDF file here, or click to select a file')).toBeVisible();
    expect(verifierRequests).toHaveLength(0);

    await page.locator('input[type="file"]').setInputFiles({
      name: 'unsigned.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\n%%EOF'),
    });

    await expect.poll(() => verifierRequests.length).toBe(1);
    await expect(page.getByText('The selected PDF could not be read or verified.')).toBeVisible();
  });

  test('reports signature integrity separately from certificate trust', async ({ page }) => {
    const signedPdf = createSignedPdf();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'signed-test.pdf',
      mimeType: 'application/pdf',
      buffer: signedPdf.signed,
    });

    const status = page.getByRole('table', { name: 'PDF signature verification status' });
    await expect(status.getByRole('row').filter({ hasText: 'Overall result' })).toContainText('Not verified');
    await expect(status.getByRole('row').filter({ hasText: 'Document integrity' })).toContainText('Valid');
    await expect(status.getByRole('row').filter({ hasText: 'Certificate chain' })).toContainText('Not trusted');
    await expect(page.getByText('PDF test signer').first()).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'tampered-test.pdf',
      mimeType: 'application/pdf',
      buffer: signedPdf.tampered,
    });
    await expect(status.getByRole('row').filter({ hasText: 'Document integrity' })).toContainText('Invalid');
  });
});
