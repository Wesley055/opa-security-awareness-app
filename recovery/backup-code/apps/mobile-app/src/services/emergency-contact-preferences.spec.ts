import { api } from './api';
import { setEmergencySmsPreference } from './emergency-contact-preferences';

jest.mock('./api', () => ({
  api: {
    patch: jest.fn(),
  },
}));

describe('setEmergencySmsPreference', () => {
  const patch = api.patch as jest.MockedFunction<typeof api.patch>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists SMS opt-out for exactly the selected contact', async () => {
    patch.mockResolvedValue({} as never);

    await setEmergencySmsPreference('contact-123', false);

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      '/emergency-contacts/contact-123',
      { receivesEmergencySms: false },
    );
  });

  it('persists SMS opt-in for exactly the selected contact', async () => {
    patch.mockResolvedValue({} as never);

    await setEmergencySmsPreference('contact-456', true);

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      '/emergency-contacts/contact-456',
      { receivesEmergencySms: true },
    );
  });
});
