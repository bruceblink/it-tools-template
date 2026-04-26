import { describe, expect, it } from 'vitest';
import { ValidationErrorsIBAN } from 'ibantools';
import { getFriendlyErrors } from './iban-validator-and-parser.service';

describe('iban-validator-and-parser service', () => {
  describe('getFriendlyErrors', () => {
    it('returns empty array for empty error list', () => {
      expect(getFriendlyErrors([])).toEqual([]);
    });

    it('returns friendly message for NoIBANProvided', () => {
      expect(getFriendlyErrors([ValidationErrorsIBAN.NoIBANProvided])).toEqual(['No IBAN provided']);
    });

    it('returns friendly message for WrongIBANChecksum', () => {
      expect(getFriendlyErrors([ValidationErrorsIBAN.WrongIBANChecksum])).toEqual(['Wrong IBAN checksum']);
    });

    it('returns friendly message for WrongBBANLength', () => {
      expect(getFriendlyErrors([ValidationErrorsIBAN.WrongBBANLength])).toEqual(['Wrong BBAN length']);
    });

    it('returns multiple friendly messages for multiple errors', () => {
      const errors = getFriendlyErrors([
        ValidationErrorsIBAN.NoIBANCountry,
        ValidationErrorsIBAN.WrongBBANFormat,
      ]);
      expect(errors).toHaveLength(2);
      expect(errors).toContain('No IBAN country');
      expect(errors).toContain('Wrong BBAN format');
    });

    it('filters out unknown error codes', () => {
      // 999 is not a valid error code, should be filtered
      const errors = getFriendlyErrors([999 as ValidationErrorsIBAN, ValidationErrorsIBAN.WrongIBANChecksum]);
      expect(errors).toEqual(['Wrong IBAN checksum']);
    });
  });
});
