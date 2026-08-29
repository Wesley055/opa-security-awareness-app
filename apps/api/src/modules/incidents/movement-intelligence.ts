export type MovementState = 'MOVING' | 'STATIONARY' | 'UNKNOWN';

export type MovementDirection =
  | 'NORTH'
  | 'NORTH_EAST'
  | 'EAST'
  | 'SOUTH_EAST'
  | 'SOUTH'
  | 'SOUTH_WEST'
  | 'WEST'
  | 'NORTH_WEST';

export interface MovementPoint {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  recordedAt: string;
}

export interface MovementIntelligence {
  state: MovementState;
  bearingDegrees: number | null;
  direction: MovementDirection | null;
  effectiveSpeedMps: number | null;
  distanceFromPreviousMeters: number | null;
  distanceFromActivationMeters: number | null;
  lastMovementAt: string | null;
}

const EARTH_RADIUS_METERS = 6_371_000;
const MIN_CLEAR_MOVEMENT_METERS = 15;
const MIN_STATIONARY_WINDOW_MS = 30_000;
const MAX_STATIONARY_SPEED_MPS = 0.8;
const MIN_STATIONARY_POINTS = 3;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

export function distanceMeters(
  from: Pick<MovementPoint, 'latitude' | 'longitude'>,
  to: Pick<MovementPoint, 'latitude' | 'longitude'>,
): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

export function bearingDegrees(
  from: Pick<MovementPoint, 'latitude' | 'longitude'>,
  to: Pick<MovementPoint, 'latitude' | 'longitude'>,
): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function directionFromBearing(
  bearing: number,
): MovementDirection {
  const normalized = ((bearing % 360) + 360) % 360;

  if (normalized >= 337.5 || normalized < 22.5) return 'NORTH';
  if (normalized < 67.5) return 'NORTH_EAST';
  if (normalized < 112.5) return 'EAST';
  if (normalized < 157.5) return 'SOUTH_EAST';
  if (normalized < 202.5) return 'SOUTH';
  if (normalized < 247.5) return 'SOUTH_WEST';
  if (normalized < 292.5) return 'WEST';
  return 'NORTH_WEST';
}

function accuracyEnvelopeMeters(
  first: MovementPoint,
  second: MovementPoint,
): number {
  const firstAccuracy =
    first.accuracy !== null && Number.isFinite(first.accuracy)
      ? Math.max(0, first.accuracy)
      : 0;

  const secondAccuracy =
    second.accuracy !== null && Number.isFinite(second.accuracy)
      ? Math.max(0, second.accuracy)
      : 0;

  return Math.max(
    MIN_CLEAR_MOVEMENT_METERS,
    firstAccuracy + secondAccuracy,
  );
}

export function deriveMovementIntelligence(
  activation: Pick<MovementPoint, 'latitude' | 'longitude'>,
  points: MovementPoint[],
): MovementIntelligence {
  if (points.length === 0) {
    return {
      state: 'UNKNOWN',
      bearingDegrees: null,
      direction: null,
      effectiveSpeedMps: null,
      distanceFromPreviousMeters: null,
      distanceFromActivationMeters: null,
      lastMovementAt: null,
    };
  }

  const latest = points[points.length - 1]!;

  const distanceFromActivation = distanceMeters(
    activation,
    latest,
  );

  if (points.length === 1) {
    return {
      state: 'UNKNOWN',
      bearingDegrees: null,
      direction: null,
      effectiveSpeedMps:
        latest.speed !== null && Number.isFinite(latest.speed)
          ? Math.max(0, latest.speed)
          : null,
      distanceFromPreviousMeters: null,
      distanceFromActivationMeters: distanceFromActivation,
      lastMovementAt: null,
    };
  }

  const previous = points[points.length - 2]!;
  const previousDistance = distanceMeters(previous, latest);
  const movementThreshold = accuracyEnvelopeMeters(
    previous,
    latest,
  );

  const calculatedBearing =
    previousDistance > movementThreshold
      ? bearingDegrees(previous, latest)
      : null;

  let state: MovementState = 'UNKNOWN';
  let lastMovementAt: string | null = null;

  if (previousDistance > movementThreshold) {
    state = 'MOVING';
    lastMovementAt = latest.recordedAt;
  } else if (points.length >= MIN_STATIONARY_POINTS) {
    const stationaryWindow = points.slice(-MIN_STATIONARY_POINTS);
    const first = stationaryWindow[0]!;
    const last = stationaryWindow[stationaryWindow.length - 1]!;

    const elapsedMs =
      Date.parse(last.recordedAt) - Date.parse(first.recordedAt);

    const allLowSpeed = stationaryWindow.every(
      (point) =>
        point.speed === null ||
        (Number.isFinite(point.speed) &&
          point.speed <= MAX_STATIONARY_SPEED_MPS),
    );

    const maxDisplacement = stationaryWindow.reduce(
      (maximum, point) =>
        Math.max(maximum, distanceMeters(first, point)),
      0,
    );

    const maxAccuracyEnvelope = stationaryWindow.reduce(
      (maximum, point) =>
        Math.max(maximum, accuracyEnvelopeMeters(first, point)),
      MIN_CLEAR_MOVEMENT_METERS,
    );

    if (
      elapsedMs >= MIN_STATIONARY_WINDOW_MS &&
      allLowSpeed &&
      maxDisplacement <= maxAccuracyEnvelope
    ) {
      state = 'STATIONARY';
    }
  }

  return {
    state,
    bearingDegrees: calculatedBearing,
    direction:
      calculatedBearing === null
        ? null
        : directionFromBearing(calculatedBearing),
    effectiveSpeedMps:
      latest.speed !== null && Number.isFinite(latest.speed)
        ? Math.max(0, latest.speed)
        : null,
    distanceFromPreviousMeters: previousDistance,
    distanceFromActivationMeters: distanceFromActivation,
    lastMovementAt,
  };
}