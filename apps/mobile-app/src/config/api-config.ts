import Constants from 'expo-constants';

/**
 * Where the OPA API lives, resolved rather than hardcoded.
 *
 * The previous value was a literal LAN address with a comment admitting it
 * would break on a different network. It was correct on the machine it was
 * written on and frozen everywhere else. This resolves it instead.
 *
 * Order, most explicit first:
 *
 *   1. expo.extra.apiBaseUrl   - set it and it wins. This is what a real
 *                                build (EAS, staging, production) uses.
 *   2. Metro hostUri           - the address THIS DEVICE used to load the
 *                                JS bundle, so it is reachable by
 *                                construction. Self-healing across DHCP
 *                                leases, networks and machines.
 *   3. throw                   - a mobile app pointed at nothing must fail
 *                                loudly on launch, not silently at the
 *                                moment somebody presses SOS.
 */

/** Port the API listens on in development. Overridable via extra.apiPort. */
const DEFAULT_API_PORT = 3000;

function readExtra(): Record<string, unknown> {
  const extra = Constants.expoConfig?.extra;
  return typeof extra === 'object' && extra !== null
    ? (extra as Record<string, unknown>)
    : {};
}

/**
 * hostUri looks like "192.168.12.126:8081" or "10.0.0.4:8081". Only the host
 * is wanted - the port is Metro's, not the API's. Guarded because on a
 * production build there is no Metro and this is undefined.
 */
function hostFromMetro(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    // Older SDKs and some launch paths only populate the manifest form.
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)
      ?.debuggerHost;

  if (typeof hostUri !== 'string' || hostUri.length === 0) {
    return null;
  }

  const host = hostUri.split(':')[0];
  return host !== undefined && host.length > 0 ? host : null;
}

export function resolveApiBaseUrl(): string {
  const extra = readExtra();

  const explicit = extra.apiBaseUrl;
  if (typeof explicit === 'string' && explicit.length > 0) {
    return explicit.replace(/\/+$/, '');
  }

  const host = hostFromMetro();
  if (host !== null) {
    const port =
      typeof extra.apiPort === 'number' ? extra.apiPort : DEFAULT_API_PORT;
    return `http://${host}:${port}`;
  }

  throw new Error(
    'OPA API base URL could not be resolved. Set expo.extra.apiBaseUrl in app.json for a standalone build, or run through Expo so the Metro host can be used.',
  );
}

/**
 * Resolved once at module load. If this throws, it throws at startup with a
 * message naming the fix - which is the point.
 */
export const API_BASE_URL = resolveApiBaseUrl();
