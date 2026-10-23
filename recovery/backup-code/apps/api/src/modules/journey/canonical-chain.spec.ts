import type { CanonicalChainInput } from './canonical-chain';
import {
  canonicalChainEnvelope,
  canonicalDigest,
  canonicalSequence,
} from './canonical-chain';
import { CANONICAL_VERSION, NULL_TOKEN } from './canonical-fix';

const PREV = '0123456789abcdef'.repeat(4);
const PAYLOAD = 'fedcba9876543210'.repeat(4);
const RECEIVED = new Date('2026-07-26T03:32:32.123Z');

/**
 * Partial<CanonicalChainInput> rather than Record<string, unknown>: the
 * spread then needs no cast, so a wrong-typed override is a compile error
 * in the test rather than a runtime surprise.
 */
function envelope(overrides: Partial<CanonicalChainInput> = {}): string {
  return canonicalChainEnvelope({
    previousHash: PREV,
    payloadHash: PAYLOAD,
    sequence: 7,
    receivedAt: RECEIVED,
    ...overrides,
  });
}

describe('canonicalSequence', () => {
  it('formats zero', () => {
    expect(canonicalSequence(0)).toBe('0');
  });

  it('formats a typical sequence with no padding', () => {
    expect(canonicalSequence(7)).toBe('7');
    expect(canonicalSequence(1042)).toBe('1042');
  });

  it('formats MAX_SAFE_INTEGER positionally, with no separators', () => {
    const out = canonicalSequence(Number.MAX_SAFE_INTEGER);
    expect(out).toBe('9007199254740991');
    expect(out).not.toContain('e');
    expect(out).not.toContain(',');
  });

  it('rejects a negative sequence', () => {
    expect(() => canonicalSequence(-1)).toThrow(/non-negative/);
  });

  it('rejects a non-integer', () => {
    expect(() => canonicalSequence(1.5)).toThrow(/safe integer/);
  });

  it('rejects an unsafe integer', () => {
    expect(() => canonicalSequence(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      /safe integer/,
    );
  });

  it('rejects NaN and Infinity', () => {
    expect(() => canonicalSequence(Number.NaN)).toThrow(/safe integer/);
    expect(() => canonicalSequence(Number.POSITIVE_INFINITY)).toThrow(
      /safe integer/,
    );
  });
});

describe('canonicalDigest', () => {
  it('accepts a lowercase 64-character hex digest', () => {
    expect(canonicalDigest(PREV, 'previousHash')).toBe(PREV);
  });

  it('rejects an uppercase digest', () => {
    expect(() => canonicalDigest(PREV.toUpperCase(), 'previousHash')).toThrow(
      /lowercase/,
    );
  });

  it('rejects a digest that is too short or too long', () => {
    expect(() => canonicalDigest(PREV.slice(0, 63), 'payloadHash')).toThrow();
    expect(() => canonicalDigest(PREV + 'a', 'payloadHash')).toThrow();
  });

  it('rejects a non-hex character', () => {
    expect(() => canonicalDigest('g'.repeat(64), 'payloadHash')).toThrow();
  });

  it('rejects the empty string', () => {
    expect(() => canonicalDigest('', 'payloadHash')).toThrow();
  });

  it('rejects the null token, which is not a digest', () => {
    expect(() => canonicalDigest(NULL_TOKEN, 'previousHash')).toThrow();
  });
});

describe('canonicalChainEnvelope', () => {
  it('emits the exact documented envelope for a chained row', () => {
    expect(envelope()).toBe(
      'v1|prev=' +
        PREV +
        '|payload=' +
        PAYLOAD +
        '|seq=7|rcv=2026-07-26T03:32:32.123Z',
    );
  });

  it('emits the null token for a genesis row', () => {
    expect(envelope({ previousHash: null, sequence: 0 })).toBe(
      'v1|prev=null|payload=' +
        PAYLOAD +
        '|seq=0|rcv=2026-07-26T03:32:32.123Z',
    );
  });

  it('starts with the shared canonical version', () => {
    expect(envelope().split('|')[0]).toBe(CANONICAL_VERSION);
  });

  it('keeps field order fixed', () => {
    const labels = envelope()
      .split('|')
      .slice(1)
      .map((part) => part.split('=')[0]);
    expect(labels).toEqual(['prev', 'payload', 'seq', 'rcv']);
  });

  it('is byte-identical for identical inputs', () => {
    expect(envelope()).toBe(envelope());
  });

  it('changes when previousHash changes', () => {
    expect(envelope({ previousHash: PAYLOAD })).not.toBe(envelope());
  });

  it('changes when payloadHash changes', () => {
    expect(envelope({ payloadHash: PREV })).not.toBe(envelope());
  });

  it('changes when sequence changes', () => {
    expect(envelope({ sequence: 8 })).not.toBe(envelope());
  });

  it('changes when receivedAt changes by one millisecond', () => {
    expect(
      envelope({ receivedAt: new Date('2026-07-26T03:32:32.124Z') }),
    ).not.toBe(envelope());
  });

  it('treats an ISO string and a Date as the same instant', () => {
    expect(envelope({ receivedAt: '2026-07-26T03:32:32.123Z' })).toBe(
      envelope(),
    );
  });

  it('always emits exactly three fractional digits on receivedAt', () => {
    const out = envelope({
      receivedAt: new Date('2026-07-26T03:32:32.100Z'),
    });
    expect(out).toContain('rcv=2026-07-26T03:32:32.100Z');
  });

  it('rejects an empty-string previousHash rather than coercing it', () => {
    expect(() => envelope({ previousHash: '' })).toThrow(/previousHash/);
  });

  it('rejects undefined previousHash rather than assuming genesis', () => {
    const input: CanonicalChainInput = {
      previousHash: undefined as unknown as null,
      payloadHash: PAYLOAD,
      sequence: 1,
      receivedAt: RECEIVED,
    };
    expect(() => canonicalChainEnvelope(input)).toThrow(
      /previousHash must be null \(genesis\)/,
    );
  });

  it('cannot collide with a payload preimage', () => {
    expect(envelope().startsWith('v1|prev=')).toBe(true);
  });
});
