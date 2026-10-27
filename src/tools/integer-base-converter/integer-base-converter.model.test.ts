import { describe, expect, it } from 'vitest';
import { convertBase, convertBaseOutputs } from './integer-base-converter.model';

describe('integer-base-converter', () => {
  describe('convertBase', () => {
    describe('when the input and target bases are between 2 and 64', () => {
      it('should convert integer between different bases', () => {
        expect(convertBase({ value: '0', fromBase: 2, toBase: 11 })).toEqual('0');
        expect(convertBase({ value: '0', fromBase: 5, toBase: 2 })).toEqual('0');
        expect(convertBase({ value: '0', fromBase: 10, toBase: 16 })).toEqual('0');
        expect(convertBase({ value: '10100101', fromBase: 2, toBase: 16 })).toEqual('a5');
        expect(convertBase({ value: '192654', fromBase: 10, toBase: 8 })).toEqual('570216');
        expect(convertBase({ value: 'zz', fromBase: 64, toBase: 10 })).toEqual('2275');
        expect(convertBase({ value: '42540766411283223938465490632011909384', fromBase: 10, toBase: 10 })).toEqual('42540766411283223938465490632011909384');
        expect(convertBase({ value: '42540766411283223938465490632011909384', fromBase: 10, toBase: 16 })).toEqual('20010db8000085a300000000ac1f8908');
        expect(convertBase({ value: '20010db8000085a300000000ac1f8908', fromBase: 16, toBase: 10 })).toEqual('42540766411283223938465490632011909384');
      });
    });

    it('parses the input once when producing all fixed and custom outputs', () => {
      expect(convertBaseOutputs({ value: '10100101', fromBase: 2, customBase: 7 })).toEqual({
        base2: '10100101',
        base8: '245',
        base10: '165',
        base16: 'a5',
        base64: '2B',
        custom: '324',
      });
    });

    it('rejects bases outside the supported alphabet', () => {
      expect(() => convertBase({ value: '42', fromBase: 1, toBase: 10 })).toThrow('Base must be an integer between 2 and 64.');
      expect(() => convertBase({ value: '42', fromBase: 10, toBase: 65 })).toThrow('Base must be an integer between 2 and 64.');
    });
  });
});
