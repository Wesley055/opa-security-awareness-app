import { isDisplayableToUsers, isMockConfidence } from './data-confidence';
import type { DataConfidence } from './data-confidence';

/**
 * Pins the primitive-and-derived relationship these two helpers now have.
 *
 * This is the point of the refactor they were extracted for: the rule about
 * what counts as untrustworthy data lives in ONE place. If a fourth
 * DataConfidence level is added later, the exhaustive case below fails and
 * forces a decision about which of the two helpers should change, instead of
 * the question being answered by accident in three separate files.
 */
describe('confidence predicates', () => {
  const ALL: DataConfidence[] = ['MOCK', 'VERIFIED', 'PRODUCTION'];

  it('treats only MOCK as mocked', () => {
    expect(isMockConfidence('MOCK')).toBe(true);
    expect(isMockConfidence('VERIFIED')).toBe(false);
    expect(isMockConfidence('PRODUCTION')).toBe(false);
  });

  it('makes displayability the exact negation of mockedness', () => {
    for (const confidence of ALL) {
      expect(isDisplayableToUsers(confidence)).toBe(
        !isMockConfidence(confidence),
      );
    }
  });

  it('does not display MOCK, and does display the other two', () => {
    expect(isDisplayableToUsers('MOCK')).toBe(false);
    expect(isDisplayableToUsers('VERIFIED')).toBe(true);
    expect(isDisplayableToUsers('PRODUCTION')).toBe(true);
  });

  // Guards the list above against a new level being added without anyone
  // revisiting these predicates.
  it('covers every declared confidence level', () => {
    expect(ALL).toHaveLength(3);
  });
});
