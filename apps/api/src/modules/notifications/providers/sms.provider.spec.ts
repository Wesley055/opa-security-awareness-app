/**
 * Provider truthfulness.
 *
 * Africa's Talking reports per-recipient failure INSIDE a successful HTTP
 * response - sms.send() does not throw when a message is rejected. The
 * provider previously returned success:true whenever the call did not throw,
 * so a rejection was recorded as a delivery. The 6 August production sending
 * log showed exactly that: one number returning "Failed" while OPA recorded
 * the notification as SENT.
 *
 * These tests pin the rule that fixes it: "Success" is the ONLY accepted
 * status, and everything else fails closed.
 */
describe('SmsProvider send-time status handling', () => {
  const REQUEST = { recipient: '+2347037119196', message: 'test' };

  let sendMock: jest.Mock;

  // LOADED DYNAMICALLY, AFTER THE MOCK EXISTS. A static
  // `import { SmsProvider }` at the top of this file would bind the class
  // BEFORE beforeEach installs the mock, and jest.resetModules() does not
  // rebind an already-imported reference. The lazy require('africastalking')
  // inside send() would then resolve against whatever was in the registry
  // when the class first loaded - so these tests would pass or fail
  // depending on module-cache state, which is worse than failing outright.
  let SmsProviderClass: typeof import('./sms.provider').SmsProvider;

  beforeEach(() => {
    jest.resetModules();
    process.env.AFRICASTALKING_API_KEY = 'test-key';
    process.env.AFRICASTALKING_USERNAME = 'test-user';

    sendMock = jest.fn();
    jest.doMock(
      'africastalking',
      () => () => ({ SMS: { send: sendMock } }),
      { virtual: true },
    );

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    SmsProviderClass = require('./sms.provider').SmsProvider;
  });

  afterEach(() => {
    delete process.env.AFRICASTALKING_API_KEY;
    delete process.env.AFRICASTALKING_USERNAME;
    jest.dontMock('africastalking');
  });

  const provider = () => new SmsProviderClass();

  const withRecipients = (recipients: unknown) =>
    sendMock.mockResolvedValue({ SMSMessageData: { Recipients: recipients } });

  it('accepts a Success status and returns the messageId', async () => {
    withRecipients([{ status: 'Success', messageId: 'ATXid_1' }]);

    const result = await provider().send(REQUEST);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('ATXid_1');
    expect(result.error).toBeUndefined();
  });

  // The exact case measured in production on 6 August.
  it('rejects a Failed status and preserves it in the error', async () => {
    withRecipients([{ status: 'Failed', messageId: 'ATXid_2' }]);

    const result = await provider().send(REQUEST);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed');
  });

  it.each([
    'InsufficientBalance',
    'UserInBlacklist',
    'CouldNotSend',
    'InvalidPhoneNumber',
    'SomethingNobodyHasSeenYet',
  ])('fails closed on status %s', async (status) => {
    withRecipients([{ status, messageId: 'x' }]);

    const result = await provider().send(REQUEST);

    // An UNKNOWN provider state must never become a successful delivery
    // record. Failing closed is the only safe default for a safety product.
    expect(result.success).toBe(false);
    expect(result.error).toContain(status);
  });

  it('fails closed when the status field is missing entirely', async () => {
    withRecipients([{ messageId: 'x' }]);

    const result = await provider().send(REQUEST);

    expect(result.success).toBe(false);
  });

  it('fails closed on an empty Recipients array', async () => {
    withRecipients([]);

    const result = await provider().send(REQUEST);

    expect(result.success).toBe(false);
  });

  it('fails closed on a malformed response with no SMSMessageData', async () => {
    sendMock.mockResolvedValue({});

    const result = await provider().send(REQUEST);

    expect(result.success).toBe(false);
  });

  it('still fails when the call throws', async () => {
    sendMock.mockRejectedValue(new Error('network down'));

    const result = await provider().send(REQUEST);

    expect(result.success).toBe(false);
    expect(result.error).toContain('network down');
  });

  it('fails without attempting a send when credentials are absent', async () => {
    delete process.env.AFRICASTALKING_API_KEY;

    const result = await provider().send(REQUEST);

    expect(result.success).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
