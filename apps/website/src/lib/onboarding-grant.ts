export const grantDurations = [
  ["4h", 4],
  ["8h", 8],
  ["24h", 24],
  ["3d", 72],
] as const;
export function grantExpiry(
  duration: string,
  custom: string,
  now = Date.now(),
): string {
  const hours = grantDurations.find(([value]) => value === duration)?.[1];
  const expires = hours
    ? now + hours * 3600000
    : duration === "custom"
      ? new Date(custom).getTime()
      : NaN;
  if (!Number.isFinite(expires) || expires <= now)
    throw new Error("Choose a future expiration.");
  return new Date(expires).toISOString();
}
