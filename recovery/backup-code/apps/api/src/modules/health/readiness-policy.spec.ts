import {
  REQUIRED_DEPENDENCIES,
  dependencyState,
  readinessVerdict,
  type ReadinessDependency,
} from './readiness-policy';

describe('readiness policy (ADR-016)', () => {
  // D4: the required-dependency set is explicit application policy declared in
  // code. This test is what makes a silent graduation of Redis fail loudly.
  // Frozen is asserted because ReadonlySet/readonly are compile-time views
  // only - the runtime object is what a consumer could actually mutate.
  it('requires the database and does not require Redis', () => {
    expect(REQUIRED_DEPENDENCIES).toHaveLength(1);
    expect(REQUIRED_DEPENDENCIES).toContain('database');
    expect(REQUIRED_DEPENDENCIES).not.toContain('redis');
    expect(Object.isFrozen(REQUIRED_DEPENDENCIES)).toBe(true);
  });

  it('reports a reachable dependency as up, required or not', () => {
    expect(dependencyState('database', true)).toBe('up');
    expect(dependencyState('redis', true)).toBe('up');
  });

  // D3: an unreachable OPTIONAL dependency is distinguishable from an
  // unreachable required one. They share a wire position, so 'optional-down'
  // exists precisely so that 'down' keeps meaning required and unavailable.
  it('reports an unreachable optional dependency as optional-down', () => {
    expect(dependencyState('redis', false)).toBe('optional-down');
  });

  it('reports an unreachable required dependency as down', () => {
    expect(dependencyState('database', false)).toBe('down');
  });

  // D1/D2: the verdict folds over the REQUIRED set only. Reported-but-optional
  // infrastructure cannot fail the probe - this is the production defect
  // ADR-016 exists to correct.
  it('stays ok when only an optional dependency is unreachable', () => {
    expect(readinessVerdict({ database: true, redis: false })).toBe('ok');
  });

  it('reports degraded when a required dependency is unreachable', () => {
    expect(readinessVerdict({ database: false, redis: true })).toBe('degraded');
  });

  // ADR-016 D5 - the graduation case, and the replacement for the it.todo that
  // stood in health.service.spec.ts. Passing an explicit set is not a test-only
  // API: required is part of the production signature, so this exercises the
  // real path a graduation takes. No setter, no DI token, no env switch, no
  // mocked module constant.
  it('reports Redis as down and readiness as degraded once Redis is required', () => {
    const graduated: ReadonlySet<ReadinessDependency> =
      new Set<ReadinessDependency>(['database', 'redis']);

    expect(dependencyState('redis', false, graduated)).toBe('down');
    expect(readinessVerdict({ database: true, redis: false }, graduated)).toBe(
      'degraded',
    );
  });
});
