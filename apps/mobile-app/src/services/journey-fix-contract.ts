/**
 * Shared Journey fix contract.
 *
 * This module is deliberately dependency-light so both the foreground tracker
 * and the headless TaskManager capture context can use the same fix shape,
 * sanitizer and retention policy without importing the API/network stack.
 */

export const ACTIVE_INCIDENT_QUEUE_DEPTH = 7200;

export type TrackedFixSource = 'foreground' | 'background' | 'manual';

/**
 * Exactly the fields JourneyFixDto accepts. forbidNonWhitelisted is true, so
 * one unrecognised property 400s the whole batch. Do not add a field here
 * without adding it to the DTO first.
 */
export interface TrackedFix {
  idempotencyKey: string;
  source: TrackedFixSource;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  recordedAt: string;
}

/**
 * ADR-010: speed and horizontalAccuracy are documented by SIGN, not by a
 * single sentinel, so ANY negative is discarded.
 */
export const cleanNonNegative = (
  value: number | null | undefined,
): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
