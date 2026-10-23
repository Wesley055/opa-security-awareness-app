import { Prisma } from '@prisma/client';
import {
  CANONICAL_VERSION,
  NULL_TOKEN,
  canonicalAccuracy,
  canonicalCoordinate,
  canonicalFixPayload,
  canonicalHeading,
  canonicalTimestamp,
  normaliseHeading,
} from './canonical-fix';

describe('canonical serialisation', () => {
  describe('fixed precision', () => {
    it('pads to exactly the required digits', () => {
      expect(canonicalAccuracy(12.1)).toBe('12.10');
      expect(canonicalAccuracy(0)).toBe('0.00');
      expect(canonicalCoordinate(6.5244)).toBe('6.524400');
    });

    it('never uses scientific notation', () => {
      expect(canonicalCoordinate(0.000001)).toBe('0.000001');
      expect(canonicalAccuracy(1e-7)).toBe('0.00');
    });

    /**
     * The toFixed trap. (1.005).toFixed(2) is "1.00" in V8 because it rounds
     * the binary double. decimal.js takes the shortest round-trip string, so
     * it holds exactly 1.005 and rounds half away from zero to 1.01.
     */
    it('rounds the decimal value, not the binary double', () => {
      expect((1.005).toFixed(2)).toBe('1.00');
      expect(canonicalAccuracy(1.005)).toBe('1.01');
      expect(canonicalAccuracy(2.675)).toBe('2.68');
    });

    it('rounds half away from zero, both signs', () => {
      expect(canonicalAccuracy(0.125)).toBe('0.13');
      expect(canonicalAccuracy(-0.125)).toBe('-0.13');
    });

    /** Read-path stability: a stored double that drifts must canonicalise
     * to the same string it was hashed under. */
    it('is stable across float representation drift', () => {
      expect(canonicalAccuracy(12.100000000000001)).toBe(
        canonicalAccuracy(12.1),
      );
    });
  });

  describe('negative zero', () => {
    it('never emits -0', () => {
      expect(canonicalAccuracy(-0)).toBe('0.00');
      expect(canonicalCoordinate(-0)).toBe('0.000000');
      expect(canonicalHeading(-0)).toBe('0.0');
    });

    it('never emits -0 from a tiny negative that rounds to zero', () => {
      expect(canonicalAccuracy(-0.0001)).toBe('0.00');
    });
  });

  describe('heading', () => {
    it('formats to one digit', () => {
      expect(canonicalHeading(271.35)).toBe('271.4');
      expect(canonicalHeading(0)).toBe('0.0');
    });

    /** GPS returns -1 for unknown. That is null, not a bearing. */
    it('treats -1 as null', () => {
      expect(canonicalHeading(-1)).toBe(NULL_TOKEN);
      expect(normaliseHeading(-1)).toBeNull();
      expect(normaliseHeading(null)).toBeNull();
      expect(normaliseHeading(271.4)).toBe(271.4);
    });

    it('wraps into [0, 360)', () => {
      expect(canonicalHeading(360)).toBe('0.0');
      expect(canonicalHeading(361.04)).toBe('1.0');
      expect(canonicalHeading(-90)).toBe('270.0');
    });

    /** 359.96 rounds to 360.0, outside the range. Re-wrap AFTER rounding. */
    it('re-wraps a value that rounds up to 360', () => {
      expect(canonicalHeading(359.96)).toBe('0.0');
    });
  });

  describe('null token', () => {
    it('uses one fixed token for null and undefined', () => {
      expect(canonicalAccuracy(null)).toBe(NULL_TOKEN);
      expect(canonicalAccuracy(undefined)).toBe(NULL_TOKEN);
      expect(canonicalHeading(null)).toBe(NULL_TOKEN);
    });
  });

  describe('timestamps', () => {
    it('emits UTC with exactly millisecond precision', () => {
      expect(canonicalTimestamp(new Date('2026-07-26T05:06:17.123Z'))).toBe(
        '2026-07-26T05:06:17.123Z',
      );
    });

    it('keeps trailing zero milliseconds', () => {
      expect(canonicalTimestamp(new Date('2026-07-26T05:06:17.000Z'))).toBe(
        '2026-07-26T05:06:17.000Z',
      );
    });

    it('converts a non-UTC offset to UTC', () => {
      expect(canonicalTimestamp('2026-07-26T06:06:17.123+01:00')).toBe(
        '2026-07-26T05:06:17.123Z',
      );
    });

    it('rejects an invalid date', () => {
      expect(() => canonicalTimestamp('not-a-date')).toThrow();
    });
  });

  describe('Prisma.Decimal inputs', () => {
    it('canonicalises a Decimal the same as a number', () => {
      const asDecimal = new Prisma.Decimal('6.524400');
      expect(canonicalCoordinate(asDecimal)).toBe(
        canonicalCoordinate(6.5244),
      );
    });
  });

  describe('payload', () => {
    const base = {
      nonce: 'a'.repeat(64),
      latitude: 6.5244,
      longitude: 3.3792,
      accuracy: 12.1,
      speed: 0,
      heading: 271.35,
      recordedAt: new Date('2026-07-26T05:06:17.123Z'),
    };

    it('produces the expected fixture vector', () => {
      expect(canonicalFixPayload(base)).toBe(
        CANONICAL_VERSION +
          '|nonce=' + 'a'.repeat(64) +
          '|lat=6.524400' +
          '|lng=3.379200' +
          '|acc=12.10' +
          '|spd=0.00' +
          '|hdg=271.4' +
          '|rec=2026-07-26T05:06:17.123Z',
      );
    });

    it('is byte-identical for equivalent float representations', () => {
      expect(
        canonicalFixPayload({ ...base, accuracy: 12.100000000000001 }),
      ).toBe(canonicalFixPayload(base));
    });

    it('differs when any field differs', () => {
      expect(canonicalFixPayload({ ...base, speed: 0.01 })).not.toBe(
        canonicalFixPayload(base),
      );
    });

    it('carries the null token for an unknown heading', () => {
      expect(canonicalFixPayload({ ...base, heading: -1 })).toContain(
        '|hdg=' + NULL_TOKEN + '|',
      );
    });

    it('requires a nonce', () => {
      expect(() => canonicalFixPayload({ ...base, nonce: '' })).toThrow();
    });
  });
});
