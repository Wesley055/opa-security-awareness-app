import { randomUUID, randomBytes } from "node:crypto";
import { Test } from "@nestjs/testing";
import { ValidationPipe, type ExecutionContext } from "@nestjs/common";
import request from "supertest";
import { ConfigService } from "@nestjs/config";
import type { UserRole } from "@prisma/client";
import { prismaTest as db } from "./prisma-test-client";
import { InstitutionalService } from "../../src/modules/onboarding/institutional.service";
import { InstitutionalController } from "../../src/modules/onboarding/institutional.controller";
import { JwtAuthGuard } from "../../src/modules/auth/jwt-auth.guard";
import { EnrollmentService } from "../../src/modules/auth/enrollment.service";
import { IncidentDetailService } from "../../src/modules/incidents/incident-detail.service";
import { IncidentTrackingService } from "../../src/modules/incidents/incident-tracking.service";
import { IncidentsService } from "../../src/modules/incidents/incidents.service";
import { IncidentTimelineService } from "../../src/modules/incident-timeline/incident-timeline.service";
import { JourneySessionService } from "../../src/modules/journey/journey-session.service";
import { IncidentAccessTokenService } from "../../src/modules/incident-access/incident-access-token.service";
const service = new InstitutionalService(
  db as never,
  new EnrollmentService(
    db as never,
    new ConfigService({
      ENROLLMENT_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    }),
  ),
);
let a: string,
  b: string,
  op: string,
  fa: string,
  foreignOp: string,
  foreignFa: string,
  admin: string,
  support: string,
  owner: string,
  journey: string,
  incident: string,
  caseId: string,
  assignment: string,
  grant: string;
const at = new Date("2026-10-04T00:00:00Z");
async function person(role: UserRole, facilityId: string | null = null) {
  const id = randomUUID();
  return (
    await db.user.create({
      data: {
        id,
        email: id + "@example.test",
        phoneNumber: id,
        firstName: "Synthetic",
        lastName: "Masked",
        role,
        facilityId,
      },
    })
  ).id;
}
beforeEach(async () => {
  a = (
    await db.facility.create({ data: { name: "Synthetic A", type: "OTHER" } })
  ).id;
  b = (
    await db.facility.create({ data: { name: "Synthetic B", type: "OTHER" } })
  ).id;
  op = await person("FACILITY_OPERATOR", a);
  fa = await person("FACILITY_ADMIN", a);
  await person("FACILITY_ADMIN", a);
  foreignOp = await person("FACILITY_OPERATOR", b);
  foreignFa = await person("FACILITY_ADMIN", b);
  admin = await person("ADMIN");
  support = await person("TECHNICAL_SUPPORT");
  owner = await person("USER", a);
  journey = (
    await db.journeySession.create({
      data: {
        userId: owner,
        purpose: "SAFEWALK",
        destinationLabel: "PRIVATE_DESTINATION",
        expectedArrivalAt: new Date("2026-10-04T00:05:00Z"),
      },
    })
  ).id;
  incident = (
    await db.incident.create({
      data: {
        userId: owner,
        facilityId: a,
        journeySessionId: journey,
        createdAt: at,
        trigger: "SOS_BUTTON",
      },
    })
  ).id;
  await db.journeySession.update({
    where: { id: journey },
    data: { safeWalkEmergencyIncidentId: incident, safeWalkEmergencyAt: at },
  });
  await db.supportEmployment.create({
    data: { userId: support, appointedByUserId: admin },
  });
  assignment = (
    await db.facilitySupportAssignment.create({
      data: {
        facilityId: a,
        actorUserId: support,
        assignedByUserId: admin,
        reason: "Synthetic scope",
      },
    })
  ).id;
  grant = (
    await db.supportCapabilityGrant.create({
      data: {
        facilityId: a,
        actorUserId: support,
        approvedByUserId: admin,
        capability: "INCIDENT_SUPPORT_READ",
        reason: "Synthetic scope",
      },
    })
  ).id;
  caseId = (
    await db.supportCase.create({
      data: {
        facilityId: a,
        reportedByUserId: support,
        assignedToUserId: support,
        category: "Synthetic",
        summary: "Synthetic",
        priority: "NORMAL",
      },
    })
  ).id;
});
describe("SafeWalk Command Center boundary", () => {
  it.each(["FACILITY_OPERATOR", "FACILITY_ADMIN"] as const)(
    "never enumerates ordinary or overdue private journeys for %s",
    async (role) => {
      const privateOwner = await person("USER", a);
      await db.journeySession.create({
        data: {
          userId: privateOwner,
          purpose: "SAFEWALK",
          destinationLabel: "PRIVATE_OVERDUE",
          expectedArrivalAt: new Date(0),
        },
      });
      const result = await service.safeWalkEmergencies(
        role === "FACILITY_OPERATOR" ? op : fa,
        a,
      );
      expect(result.incidents.map((r) => r.id)).toEqual([incident]);
      expect(JSON.stringify(result)).not.toMatch(
        /PRIVATE_|example.test|Synthetic|guardian|destination|latitude|longitude/,
      );
      expect(await db.incident.count()).toBe(1);
    },
  );
  it("requires both canonical linkage directions and an emergency timestamp", async () => {
    const other = await db.incident.create({
      data: {
        userId: owner,
        facilityId: a,
        trigger: "SOS_BUTTON",
        status: "RESOLVED",
      },
    });
    await db.journeySession.update({
      where: { id: journey },
      data: { safeWalkEmergencyIncidentId: other.id },
    });
    expect((await service.safeWalkEmergencies(op, a)).incidents).toEqual([]);
    await db.journeySession.update({
      where: { id: journey },
      data: {
        safeWalkEmergencyIncidentId: null,
        safeWalkEmergencyAt: null,
      },
    });
    expect((await service.safeWalkEmergencies(op, a)).incidents).toEqual([]);
  });
  it("presents stored provenance and excludes nested private journey data in detail", async () => {
    const result = await new IncidentDetailService(db as never).getDetail(
      incident,
    );
    expect(result.safeWalkEmergency).toEqual({
      source: "SAFEWALK_EXPLICIT",
      emergencyStartedAt: at.toISOString(),
    });
    expect(result).not.toHaveProperty("journeySession");
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE_|example.test|Synthetic/,
    );
  });
  it("excludes late-uploaded private fixes while retaining authorized emergency tracking", async () => {
    const journeys = new JourneySessionService();
    await db.$transaction((tx) =>
      journeys.recordTrackedFixes(tx, {
        sessionId: journey,
        fixes: [
          {
            idempotencyKey: randomUUID(),
            source: "background",
            latitude: 8,
            longitude: 9,
            recordedAt: new Date(+at - 1000),
          },
        ],
      }),
    );
    expect(
      (await service.safeWalkEmergencies(op, a)).incidents[0],
    ).toMatchObject({
      lastFixReceivedAt: null,
      trackingState: "AWAITING_FIRST_FIX",
    });
    expect(
      (await new IncidentTrackingService(db as never).getTracking(incident))
        .points,
    ).toEqual([]);
    await db.$transaction((tx) =>
      journeys.recordTrackedFixes(tx, {
        sessionId: journey,
        fixes: [
          {
            idempotencyKey: randomUUID(),
            source: "background",
            latitude: 10,
            longitude: 11,
            recordedAt: new Date(+at + 1000),
          },
        ],
      }),
    );
    expect(
      (await service.safeWalkEmergencies(op, a)).incidents[0]
        ?.lastFixReceivedAt,
    ).not.toBeNull();
    const tracking = await new IncidentTrackingService(db as never).getTracking(
      incident,
    );
    expect(tracking.points).toHaveLength(1);
    expect(tracking.points[0]?.latitude).toBe(10);
  });
  it("keeps acknowledgement durable without changing OPEN and denies Facility Admin response", async () => {
    const operations = new IncidentsService(
      db as never,
      new IncidentAccessTokenService(db as never),
      new IncidentTimelineService(db as never),
      new JourneySessionService(),
    );
    await expect(
      operations.operationalEvent(
        incident,
        fa,
        "ACKNOWLEDGED",
        "review",
        randomUUID(),
      ),
    ).rejects.toThrow();
    await operations.operationalEvent(
      incident,
      op,
      "ACKNOWLEDGED",
      "review",
      randomUUID(),
    );
    expect(
      (await service.safeWalkEmergencies(op, a)).incidents[0],
    ).toMatchObject({
      status: "OPEN",
      acknowledged: true,
      lastOperationalEvent: "OPERATOR_ACKNOWLEDGED",
    });
  });
  it.each(["operator", "admin"])(
    "denies direct foreign facility %s reads",
    async (role) => {
      const actor = role === "operator" ? foreignOp : foreignFa;
      expect((await service.safeWalkEmergencies(actor, b)).incidents).toEqual(
        [],
      );
      await expect(service.safeWalkEmergencies(actor, a)).rejects.toThrow();
    },
  );
  it.each(["SUSPENDED", "REVOKED"] as const)(
    "denies stale %s Operator and Facility Admin membership",
    async (membershipState) => {
      for (const actor of [op, fa]) {
        await db.user.update({
          where: { id: actor },
          data: { membershipState },
        });
        await expect(service.safeWalkEmergencies(actor, a)).rejects.toThrow();
      }
    },
  );
  it("denies inactive accounts and facilities", async () => {
    await db.user.update({ where: { id: op }, data: { isActive: false } });
    await expect(service.safeWalkEmergencies(op, a)).rejects.toThrow();
    await db.facility.update({ where: { id: a }, data: { isActive: false } });
    await expect(service.safeWalkEmergencies(fa, a)).rejects.toThrow();
  });
  it("requires assigned current case for Support and records actual support provenance", async () => {
    await expect(service.safeWalkEmergencies(support, a)).rejects.toThrow();
    expect(
      (await service.safeWalkEmergencies(support, a, caseId)).incidents,
    ).toHaveLength(1);
    expect(
      await db.administrativeAuditEvent.findFirst({
        where: { actorUserId: support, action: "SAFEWALK_EMERGENCY_READ" },
      }),
    ).toMatchObject({
      actorRole: "TECHNICAL_SUPPORT",
      authorityGrantId: grant,
      caseReference: caseId,
      facilityId: a,
    });
    await expect(
      service.safeWalkEmergencies(support, b, caseId),
    ).rejects.toThrow();
    await db.supportCase.update({
      where: { id: caseId },
      data: { status: "CLOSED" },
    });
    await expect(
      service.safeWalkEmergencies(support, a, caseId),
    ).rejects.toThrow();
  });
  it.each(["employment", "assignment", "permission", "expiry"])(
    "denies stale Support access after %s change",
    async (kind) => {
      expect(
        (await service.safeWalkEmergencies(support, a, caseId)).incidents,
      ).toHaveLength(1);
      if (kind === "employment")
        await db.supportEmployment.update({
          where: { userId: support },
          data: { state: "SUSPENDED" },
        });
      if (kind === "assignment")
        await db.facilitySupportAssignment.update({
          where: { id: assignment },
          data: { revokedAt: new Date() },
        });
      if (kind === "permission")
        await db.supportCapabilityGrant.update({
          where: { id: grant },
          data: { revokedAt: new Date() },
        });
      if (kind === "expiry")
        await db.supportCapabilityGrant.update({
          where: { id: grant },
          data: {
            createdAt: new Date(Date.now() - 3600000),
            expiresAt: new Date(Date.now() - 1000),
          },
        });
      await expect(
        service.safeWalkEmergencies(support, a, caseId),
      ).rejects.toThrow();
    },
  );
  it("keeps Super Admin explicit and denies resident Command Center access", async () => {
    expect(
      (await service.safeWalkEmergencies(admin, a)).incidents,
    ).toHaveLength(1);
    await expect(service.safeWalkEmergencies(owner, a)).rejects.toThrow();
  });
  it("protects the actual HTTP read against foreign facility and invalid query", async () => {
    const module = await Test.createTestingModule({
      controllers: [InstitutionalController],
      providers: [{ provide: InstitutionalService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext) {
          const req = ctx.switchToHttp().getRequest();
          req.user = { sub: req.headers["x-test-actor"] };
          return true;
        },
      })
      .compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    try {
      const path = "/institutional/facilities/" + a + "/safewalk-emergencies";
      await request(app.getHttpServer())
        .get(path)
        .set("x-test-actor", op)
        .expect(200);
      await request(app.getHttpServer())
        .get(path)
        .set("x-test-actor", foreignOp)
        .expect(403);
      await request(app.getHttpServer())
        .get(path)
        .set("x-test-actor", foreignFa)
        .expect(403);
      await request(app.getHttpServer())
        .get(path + "?destination=private")
        .set("x-test-actor", op)
        .expect(400);
    } finally {
      await app.close();
    }
  });
});
