import { BadRequestException } from '@nestjs/common';
import { toE164 } from './normalize-phone-number';

/**
 * OPA accepts a phone number from ANY country. Nigeria is the default dialing
 * context for input with no country code - it is not an allowed-country list.
 */
describe('toE164', () => {
  describe('Nigeria, the default region', () => {
    it('normalises a local number with a leading zero', () => {
      expect(toE164('08024662124')).toBe('+2348024662124');
    });

    it('normalises a bare country code with no plus', () => {
      expect(toE164('2348024662124')).toBe('+2348024662124');
    });

    it('leaves an already-canonical Nigerian number unchanged', () => {
      expect(toE164('+2348024662124')).toBe('+2348024662124');
    });

    it('tolerates spaces, dashes and parentheses', () => {
      expect(toE164('+234 802 466 2124')).toBe('+2348024662124');
      expect(toE164('0802-466-2124')).toBe('+2348024662124');
    });
  });

  describe('any other country, by its own country code', () => {
    it('accepts the United States', () => {
      expect(toE164('+14694791451')).toBe('+14694791451');
    });

    it('accepts the United Kingdom', () => {
      expect(toE164('+447911123456')).toBe('+447911123456');
    });

    it('accepts South Africa, Kenya, Ghana and India', () => {
      expect(toE164('+27821234567')).toBe('+27821234567');
      expect(toE164('+254712345678')).toBe('+254712345678');
      expect(toE164('+233241234567')).toBe('+233241234567');
      expect(toE164('+919876543210')).toBe('+919876543210');
    });

    it('DOES NOT rewrite an international number as Nigerian', () => {
      // The defect this whole change exists to remove: SmsProvider used to
      // prepend +234 to anything it did not recognise.
      expect(toE164('+14694791451')).not.toContain('+234');
    });
  });

  describe('an explicit region overrides the default', () => {
    it('parses a bare US number as US when told to', () => {
      expect(toE164('4694791451', 'US')).toBe('+14694791451');
    });

    it('parses a bare UK number as UK when told to', () => {
      expect(toE164('07911123456', 'GB')).toBe('+447911123456');
    });

    it('still honours an explicit country code over the region hint', () => {
      expect(toE164('+2348024662124', 'US')).toBe('+2348024662124');
    });
  });

  describe('invalid input is rejected, never guessed at', () => {
    it.each([
      ['empty', ''],
      ['whitespace', '   '],
      ['too short', '123'],
      ['letters', 'not-a-number'],
      ['implausible length', '+234800000000000000'],
    ])('rejects %s', (_label, value) => {
      expect(() => toE164(value)).toThrow(BadRequestException);
    });
  });
});
