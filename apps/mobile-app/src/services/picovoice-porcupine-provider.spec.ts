import {
  PorcupineManager,
} from '@picovoice/porcupine-react-native';

import { PicovoicePorcupineProvider } from './picovoice-porcupine-provider';

jest.mock('@picovoice/porcupine-react-native', () => ({
  PorcupineManager: {
    fromKeywordPaths: jest.fn(),
  },
}));

const mockedFromKeywordPaths =
  PorcupineManager.fromKeywordPaths as jest.MockedFunction<
    typeof PorcupineManager.fromKeywordPaths
  >;

describe('PicovoicePorcupineProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects missing configuration before touching the native engine', async () => {
    const provider = new PicovoicePorcupineProvider({
      accessKey: '',
      keywordPath: '',
      phrase: 'HELP HELP',
    });

    await expect(
      provider.start(jest.fn()),
    ).rejects.toThrow(
      'Picovoice access key is not configured.',
    );

    expect(mockedFromKeywordPaths).not.toHaveBeenCalled();
  });

  it('emits one provider-neutral event for keyword index zero', async () => {
    let detectionCallback:
      | ((keywordIndex: number) => void)
      | undefined;

    const manager = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn(),
    };

    mockedFromKeywordPaths.mockImplementation(
      async (
        _accessKey,
        _keywordPaths,
        callback,
      ) => {
        detectionCallback = callback;
        return manager as never;
      },
    );

    const onTrigger = jest.fn();

    const provider = new PicovoicePorcupineProvider({
      accessKey: 'test-access-key',
      keywordPath: '/tmp/help-help.ppn',
      phrase: 'HELP HELP',
      sensitivity: 0.6,
    });

    await provider.start(onTrigger);

    expect(provider.isRunning()).toBe(true);
    expect(manager.start).toHaveBeenCalledTimes(1);

    detectionCallback?.(0);

    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(onTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        phrase: 'HELP HELP',
        confidence: null,
        provider: 'picovoice_porcupine',
      }),
    );
  });

  it('ignores unexpected keyword indexes', async () => {
    let detectionCallback:
      | ((keywordIndex: number) => void)
      | undefined;

    const manager = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn(),
    };

    mockedFromKeywordPaths.mockImplementation(
      async (
        _accessKey,
        _keywordPaths,
        callback,
      ) => {
        detectionCallback = callback;
        return manager as never;
      },
    );

    const onTrigger = jest.fn();

    const provider = new PicovoicePorcupineProvider({
      accessKey: 'test-access-key',
      keywordPath: '/tmp/help-help.ppn',
      phrase: 'HELP HELP',
    });

    await provider.start(onTrigger);

    detectionCallback?.(1);

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('stops and deletes native resources', async () => {
    const manager = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn(),
    };

    mockedFromKeywordPaths.mockResolvedValue(
      manager as never,
    );

    const provider = new PicovoicePorcupineProvider({
      accessKey: 'test-access-key',
      keywordPath: '/tmp/help-help.ppn',
      phrase: 'HELP HELP',
    });

    await provider.start(jest.fn());
    await provider.stop();

    expect(manager.stop).toHaveBeenCalledTimes(1);
    expect(manager.delete).toHaveBeenCalledTimes(1);
    expect(provider.isRunning()).toBe(false);
  });

  it('rejects invalid sensitivity before native initialization', async () => {
    const provider = new PicovoicePorcupineProvider({
      accessKey: 'test-access-key',
      keywordPath: '/tmp/help-help.ppn',
      phrase: 'HELP HELP',
      sensitivity: 1.5,
    });

    await expect(
      provider.start(jest.fn()),
    ).rejects.toThrow(
      'Picovoice sensitivity must be between 0 and 1.',
    );

    expect(mockedFromKeywordPaths).not.toHaveBeenCalled();
  });
});
