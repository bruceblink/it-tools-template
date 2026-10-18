import verifyPDF from 'pdf-signature-reader';

/** Keep the CommonJS PDF verifier behind the file-upload interaction chunk. */
export function verifyPdf(fileBuffer: ArrayBuffer) {
  return verifyPDF(fileBuffer);
}
