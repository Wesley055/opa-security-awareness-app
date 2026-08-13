// Nest loads reflect-metadata at runtime, and @nestjs/testing pulls it into
// specs that build a testing module. This spec does neither - it reads
// decorator metadata off the classes directly - so it must import the
// polyfill itself. Without this the WHOLE SUITE dies at load with
// "Reflect.getMetadata is not a function", not merely this file.
// See ingest-fixes.dto.spec.ts, which learned the same thing first.
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminProvisioningController } from '../../modules/admin-provisioning/admin-provisioning.controller';
import { JwtAuthGuard } from '../../modules/auth/jwt-auth.guard';
import { EvidenceController } from '../../modules/evidence/evidence.controller';
import { FacilitiesController } from '../../modules/facilities/facilities.controller';
import { FacilityOperatorGuard } from '../../modules/facilities/guards/facility-operator.guard';
import { IncidentTimelineController } from '../../modules/incident-timeline/incident-timeline.controller';
import { AdminGuard } from './admin.guard';
import { IncidentAccessGuard } from './incident-access.guard';

/**
 * Every guard in this codebase has its own spec, and every one of those
 * specs constructs the guard directly. None of them prove the guard is
 * ATTACHED to anything. A correct guard on an undecorated controller is an
 * unprotected endpoint with a passing test suite.
 *
 * GUARDS_METADATA rather than the '__guards__' string it resolves to: the
 * constant is what Nest itself reads, so a rename becomes a compile error
 * instead of a silently empty array and four vacuously passing tests. It is
 * a deep import into @nestjs/common/constants, which is not documented
 * public surface - accepted deliberately, because the alternative is a
 * magic string that cannot fail loudly.
 *
 * SCOPE: the four controllers where a missing decorator exposes privileged
 * or cross-user data. IncidentsController carries only JwtAuthGuard and its
 * ownership boundary is enforced inside IncidentsService, so it is not
 * pinned here.
 */
function classGuards(target: object): unknown[] {
  return (
    (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ??
    []
  );
}

describe('privileged controller guard attachment', () => {
  it('protects every administrative provisioning route with JWT + AdminGuard', () => {
    expect(classGuards(AdminProvisioningController)).toEqual([
      JwtAuthGuard,
      AdminGuard,
    ]);
  });

  it('protects the facility Command Center with JWT + FacilityOperatorGuard', () => {
    expect(classGuards(FacilitiesController)).toEqual([
      JwtAuthGuard,
      FacilityOperatorGuard,
    ]);
  });

  it('protects incident evidence with JWT + IncidentAccessGuard', () => {
    expect(classGuards(EvidenceController)).toEqual([
      JwtAuthGuard,
      IncidentAccessGuard,
    ]);
  });

  it('protects the incident timeline with JWT + IncidentAccessGuard', () => {
    expect(classGuards(IncidentTimelineController)).toEqual([
      JwtAuthGuard,
      IncidentAccessGuard,
    ]);
  });
});