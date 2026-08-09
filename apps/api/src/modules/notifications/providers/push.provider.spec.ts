import { PushProvider } from './push.provider';

/**
 * ADR-015 section 6b: a provider that cannot deliver MUST return failure.
 *
 * Until 9 August 2026 this provider logged to the console and returned
 * success:true with a fabricated messageId. The dispatch worker records
 * delivery outcome from that value, so the production database held records
 * of successful Push deliveries that never happened - and the
 * hash-chained timeline faithfully preserved the false claim.
 *
 * These tests exist so the honest failure cannot regress silently.
 */
describe('PushProvider', () => {
  const provider = new PushProvider();
  const request = {
    recipient: 'recipient-under-test',
    message: 'An emergency alert.',
  };

  it('reports FAILURE rather than a delivery it never attempted', async () => {
    const result = await provider.send(request);
    expect(result.success).toBe(false);
  });

  it('names the channel and the reason in the error', async () => {
    const result = await provider.send(request);
    expect(result.error).toBe('Push provider not implemented');
    expect(result.provider).toBe('Push');
  });

  it('returns NO messageId, because no message exists', async () => {
    // The old stub minted an identifier for a message that was never sent.
    // An invented id is as untrue as the success flag it accompanied.
    const result = await provider.send(request);
    expect(result.messageId).toBeUndefined();
  });
});
