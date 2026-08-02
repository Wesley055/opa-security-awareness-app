/**
 * ADR-016 - the readiness verdict covers current required capabilities.
 *
 * The required-dependency set is explicit application policy. It is declared
 * here, in code, and is never inferred from configuration - not from the
 * presence of REDIS_URL, and not from an environment toggle such as
 * REDIS_REQUIRED. Graduating a dependency to required is an atomic change
 * made in the same change set as the capability that needs it (D5).
 */

export type ReadinessDependency = 'database' | 'redis';

/** The wire vocabulary for Redis in the readiness response. */
export type RedisReadinessState = 'up' | 'down' | 'optional-down';

export type ReadinessVerdict = 'ok' | 'degraded';

/**
 * The production policy, in one reviewable line.
 *
 * Redis is deliberately absent: nothing in the application depends on it.
 * Adding it here is the graduation step (D5), and it is the whole of the
 * mechanism - there is no other place optionality is decided.
 *
 * Frozen because ReadonlySet is only a compile-time view: the underlying Set
 * stays mutable at runtime, so an exported one could be cast and added to,
 * making policy drift dynamically. D4 forbids exactly that.
 */
export const REQUIRED_DEPENDENCIES = Object.freeze([
  'database',
] as const satisfies readonly ReadinessDependency[]);

const REQUIRED_DEPENDENCY_SET: ReadonlySet<ReadinessDependency> =
  new Set<ReadinessDependency>(REQUIRED_DEPENDENCIES);

/**
 * An unreachable dependency reports 'down' when required and 'optional-down'
 * when not. The two share a wire position and must stay distinguishable.
 */
export function dependencyState(
  dependency: ReadinessDependency,
  reachable: boolean,
  required: ReadonlySet<ReadinessDependency> = REQUIRED_DEPENDENCY_SET,
): RedisReadinessState {
  if (reachable) return 'up';
  return required.has(dependency) ? 'down' : 'optional-down';
}

/**
 * The verdict folds over the required set only. Reported-but-optional
 * infrastructure cannot fail the probe (D1/D2).
 */
export function readinessVerdict(
  reachability: Readonly<Record<ReadinessDependency, boolean>>,
  required: ReadonlySet<ReadinessDependency> = REQUIRED_DEPENDENCY_SET,
): ReadinessVerdict {
  for (const dependency of required) {
    if (!reachability[dependency]) return 'degraded';
  }

  return 'ok';
}
