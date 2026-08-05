import * as Location from 'expo-location';
import { api } from './api';
import {
  cleanHeading,
  cleanNonNegative,
  startTracking,
  stopTracking,
  trackerDebugState,
} from './journey-tracker';

jest.mock('expo-location', () => ({
  Accuracy: { High: 6 },
  getForegroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));

jest.mock('./api', () => ({
  api: {
    post: jest.fn(),
  },
}));

const mockedLocation = Location as jest.Mocked<typeof Location>;
const mockedPost = api.post as jest.Mock;

describe('journey-tracker sanitizers', () => {
  it('keeps finite non-negative values', () => {
    expect(cleanNonNegative(0)).toBe(0);
    expect(cleanNonNegative(2.5)).toBe(2.5);
  });

  it('drops negative, missing and non-finite values', () => {
    expect(cleanNonNegative(-1)).toBeUndefined();
    expect(cleanNonNegative(Number.NaN)).toBeUndefined();
    expect(cleanNonNegative(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(cleanNonNegative(null)).toBeUndefined();
    expect(cleanNonNegative(undefined)).toBeUndefined();
  });

  it('keeps headings from zero through 360 inclusive', () => {
    expect(cleanHeading(0)).toBe(0);
    expect(cleanHeading(180)).toBe(180);
    expect(cleanHeading(360)).toBe(360);
  });

  it('drops invalid headings', () => {
    expect(cleanHeading(-1)).toBeUndefined();
    expect(cleanHeading(361)).toBeUndefined();
    expect(cleanHeading(Number.NaN)).toBeUndefined();
    expect(cleanHeading(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(cleanHeading(null)).toBeUndefined();
    expect(cleanHeading(undefined)).toBeUndefined();
  });
});

describe('journey-tracker lifecycle', () => {
  beforeEach(() => {
    stopTracking();

    mockedPost.mockReset();
    mockedLocation.getForegroundPermissionsAsync.mockReset();
    mockedLocation.watchPositionAsync.mockReset();
  });

  afterEach(() => {
    stopTracking();
  });

  it('stays stopped when foreground permission is denied', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
    } as never);

    await startTracking();

    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockedLocation.watchPositionAsync).not.toHaveBeenCalled();

    expect(trackerDebugState()).toEqual({
      running: false,
      sessionId: null,
      queued: 0,
    });
  });

  it('stopTracking is idempotent when nothing is running', () => {
    expect(() => stopTracking()).not.toThrow();
    expect(() => stopTracking()).not.toThrow();

    expect(trackerDebugState()).toEqual({
      running: false,
      sessionId: null,
      queued: 0,
    });
  });
});
