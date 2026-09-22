import { PlatformAdminService } from "../../src/modules/admin-provisioning/platform-admin.service";
import { EnrollmentService } from "../../src/modules/auth/enrollment.service";
import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import { randomUUID } from "crypto";
import { prismaTest } from "./prisma-test-client";
import { PrismaService } from "../../src/prisma/prisma.service";
import { JwtStrategy } from "../../src/modules/auth/jwt.strategy";
import { FacilitiesService } from "../../src/modules/facilities/facilities.service";
import { FacilitiesController } from "../../src/modules/facilities/facilities.controller";
import { OperatorIncidentsController } from "../../src/modules/facilities/operator-incidents.controller";
import { OperatorMembersController } from "../../src/modules/facilities/operator-members.controller";
import { FacilityAdminResidentProvisioningController } from "../../src/modules/facilities/facility-admin-resident-provisioning.controller";
import { AdminProvisioningController } from "../../src/modules/admin-provisioning/admin-provisioning.controller";
import { AdminProvisioningService } from "../../src/modules/admin-provisioning/admin-provisioning.service";
import { IncidentTimelineController } from "../../src/modules/incident-timeline/incident-timeline.controller";
import { IncidentTimelineService } from "../../src/modules/incident-timeline/incident-timeline.service";
import { EvidenceController } from "../../src/modules/evidence/evidence.controller";
import { EvidenceService } from "../../src/modules/evidence/evidence.service";

const secret = "tenant-isolation-integration-only-signing-key";
const jwt = new JwtService({ secret });
// Test authority must not be replaced by host environment secrets.
const configValues: Record<string, string | number> = {
  JWT_ACCESS_SECRET: secret,
  ENROLLMENT_ENCRYPTION_KEY: "ab".repeat(32),
  BCRYPT_ROUNDS: 4,
};
type Seat = { id: string; email: string; role: string };
const token = (u: Seat) =>
  jwt.sign({ sub: u.id, email: u.email, role: u.role, credentialVersion: 0 });

describe("tenant isolation over HTTP and PostgreSQL", () => {
  let app: INestApplication;
  let a: string, b: string;
  let opA: Seat,
    opB: Seat,
    adminA: Seat,
    adminB: Seat,
    platform: Seat,
    residentA: Seat,
    residentB: Seat;
  let incidentA: string, incidentB: string;
  const evidence = {
    // The transport is excluded: tests must never upload to external blob storage.
    // Persist an evidence record so denied writes can be checked in PostgreSQL.
    uploadEvidence: jest.fn(async (input: { incidentId: string }) =>
      prismaTest.evidence.create({
        data: {
          incidentId: input.incidentId,
          type: "DOCUMENT",
          status: "PENDING",
        },
      }),
    ),
    listForIncident: (incidentId: string) =>
      prismaTest.evidence.findMany({ where: { incidentId } }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: "jwt" })],
      controllers: [
        FacilitiesController,
        OperatorIncidentsController,
        OperatorMembersController,
        FacilityAdminResidentProvisioningController,
        AdminProvisioningController,
        IncidentTimelineController,
        EvidenceController,
      ],
      providers: [
        JwtStrategy,
        EnrollmentService,
        PlatformAdminService,
        FacilitiesService,
        AdminProvisioningService,
        IncidentTimelineService,
        { provide: PrismaService, useValue: prismaTest },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => configValues[key],
            getOrThrow: (key: string) => {
              const value = configValues[key];
              if (value === undefined)
                throw new Error("Missing test configuration");
              return value;
            },
          },
        },
        { provide: EvidenceService, useValue: evidence },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    evidence.uploadEvidence.mockClear();
    a = (
      await prismaTest.facility.create({
        data: { name: "Lagos A", type: "SECURITY_PROVIDER" },
      })
    ).id;
    b = (
      await prismaTest.facility.create({
        data: { name: "Abuja B", type: "SECURITY_PROVIDER" },
      })
    ).id;
    const seat = (
      role: "USER" | "FACILITY_OPERATOR" | "FACILITY_ADMIN" | "ADMIN",
      facilityId: string | null,
    ) =>
      prismaTest.user.create({
        data: {
          email: randomUUID() + "@example.test",
          phoneNumber:
            "+" + String(Date.now()) + String(Math.random()).slice(2, 8),
          firstName: "Test",
          lastName: "Seat",
          role,
          facilityId,
        },
      });
    opA = await seat("FACILITY_OPERATOR", a);
    opB = await seat("FACILITY_OPERATOR", b);
    adminA = await seat("FACILITY_ADMIN", a);
    adminB = await seat("FACILITY_ADMIN", b);
    platform = await seat("ADMIN", a);
    residentA = await seat("USER", a);
    residentB = await seat("USER", b);
    const incident = (userId: string, facilityId: string) =>
      prismaTest.incident.create({
        data: {
          userId,
          facilityId,
          trigger: "SOS_BUTTON",
          latitude: "6.5",
          longitude: "3.3",
        },
      });
    incidentA = (await incident(residentA.id, a)).id;
    incidentB = (await incident(residentB.id, b)).id;
  });
  const get = (u: Seat, path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set("Authorization", "Bearer " + token(u));
  const post = (u: Seat, path: string) =>
    request(app.getHttpServer())
      .post(path)
      .set("Authorization", "Bearer " + token(u));

  it('bounds roster pages and counts by current facility and role without identity disclosure', async () => {
    await prismaTest.user.createMany({ data: Array.from({ length: 52 }, (_, i) => ({
      email: randomUUID() + '@example.test', phoneNumber: '+' + String(900000000000 + i),
      firstName: 'Private', lastName: 'Identity', facilityId: a, role: 'USER' as const,
    })) });
    for (const [seat, path] of [[opA, '/operator/facility/members'], [adminA, '/facility-admin/facility/residents']] as const) {
      const first = await get(seat, path).expect(200);
      const second = await get(seat, path + '?page=1').expect(200);
      expect(first.body.residentCount).toBe(53);
      expect(first.body.residents).toHaveLength(50);
      expect(first.body.hasNext).toBe(true);
      expect(second.body.residents).toHaveLength(3);
      expect(second.body.hasNext).toBe(false);
      const ids = [...first.body.residents, ...second.body.residents].map((row: { id: string }) => row.id);
      expect(new Set(ids).size).toBe(53);
      expect(ids).not.toContain(residentB.id);
      expect(JSON.stringify(first.body)).not.toMatch(/example\.test|Private|Identity/);
      await get(seat, path + '?page=-1').expect(400);
      await get(seat, path + '?page=0.5').expect(400);
    }
    await get(opA, '/facility-admin/facility/residents').expect(403);
    await get(adminA, '/operator/facility/members').expect(403);
  });

  it('reads closed history through existing status filters without exposing a foreign incident', async () => {
    await prismaTest.incident.updateMany({ where: { id: { in: [incidentA, incidentB] } }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    const result = await get(opA, '/operator/incidents?status=RESOLVED&take=1').expect(200);
    expect(result.body.incidents.map((row: { id: string }) => row.id)).toEqual([incidentA]);
    expect(result.body.hasMore).toBe(false);
    const live = await get(opA, '/operator/incidents').expect(200);
    expect(live.body.incidents).toEqual([]);
    await get(adminA, '/operator/incidents?status=RESOLVED').expect(403);
  });

  it.each(["A", "B"])(
    "%s operator reads own resources; foreign and absent incidents are identical",
    async (side) => {
      const [op, own, other] =
        side === "A"
          ? ([opA, incidentA, incidentB] as const)
          : ([opB, incidentB, incidentA] as const);
      await get(op, `/incidents/${own}/timeline`).expect(200);
      const foreign = await get(op, `/incidents/${other}/timeline`).expect(404);
      const missing = await get(
        op,
        `/incidents/${randomUUID()}/timeline`,
      ).expect(404);
      expect(foreign.body).toEqual(missing.body);
      expect(foreign.body).not.toHaveProperty("userId");
    },
  );
  it.each(["A", "B"])(
    "%s operator can upload own evidence but cannot mutate foreign incidents",
    async (side) => {
      const [op, own, other] =
        side === "A"
          ? ([opA, incidentA, incidentB] as const)
          : ([opB, incidentB, incidentA] as const);
      await post(op, `/incidents/${own}/evidence`)
        .field("type", "DOCUMENT")
        .attach("file", Buffer.from("test"), "test.txt")
        .expect(201);
      const foreign = await post(op, `/incidents/${other}/evidence`)
        .field("type", "DOCUMENT")
        .attach("file", Buffer.from("test"), "test.txt")
        .expect(404);
      const missing = await post(op, `/incidents/${randomUUID()}/evidence`)
        .field("type", "DOCUMENT")
        .attach("file", Buffer.from("test"), "test.txt")
        .expect(404);
      expect(foreign.body).toEqual(missing.body);
      expect(
        await prismaTest.evidence.count({ where: { incidentId: other } }),
      ).toBe(0);
      expect(evidence.uploadEvidence).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["A", "B"])(
    "%s queue, cursor and roster remain inside authenticated facility",
    async (side) => {
      const [op, own, other, foreignFacility] =
        side === "A"
          ? ([opA, incidentA, incidentB, b] as const)
          : ([opB, incidentB, incidentA, a] as const);
      const page = await get(
        op,
        "/operator/incidents?take=1&status=OPEN",
      ).expect(200);
      expect(page.body.incidents.map((i: { id: string }) => i.id)).toEqual([
        own,
      ]);
      const cursor = Buffer.from(
        JSON.stringify({
          c: new Date(Date.now() + 10000).toISOString(),
          i: other,
        }),
      ).toString("base64url");
      const next = await get(
        op,
        "/operator/incidents?take=1&cursor=" + cursor,
      ).expect(200);
      expect(next.body.incidents.map((i: { id: string }) => i.id)).toEqual([
        own,
      ]);
      await get(op, `/facilities/${foreignFacility}/incidents`).expect(403);
      await get(op, "/operator/incidents?facilityId=" + foreignFacility).expect(
        400,
      );
      const members = await get(op, "/operator/facility/members").expect(200);
      expect(members.body.facility.id).toBe(side === "A" ? a : b);
    },
  );
  it("denies unauthenticated, nonoperator and suspended/removed operators", async () => {
    await request(app.getHttpServer()).get("/operator/incidents").expect(401);
    await get(residentA, "/operator/incidents").expect(403);
    await get(residentA, `/incidents/${incidentB}/timeline`).expect(404);
    await post(residentA, `/incidents/${incidentB}/evidence`).expect(404);
    const staleToken = token(opA);
    await prismaTest.user.update({
      where: { id: opA.id },
      data: { isActive: false },
    });
    await request(app.getHttpServer())
      .get("/operator/incidents")
      .set("Authorization", "Bearer " + staleToken)
      .expect(401);
    await prismaTest.user.update({
      where: { id: opA.id },
      data: { isActive: true, facilityId: null },
    });
    await get(opA, "/operator/incidents").expect(403);
    await get(opA, `/incidents/${incidentA}/timeline`).expect(404);
    await post(opA, `/incidents/${incidentA}/evidence`).expect(404);
  });
  it("pages tied timestamps deterministically and rechecks lifecycle without exposing private journeys", async () => {
    const at = new Date("2026-09-17T12:00:00.000Z");
    await prismaTest.incident.updateMany({ data: { status: "CANCELLED" } });
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort().reverse();
    for (const id of ids) {
      // Preserve the one-active-incident-per-owner constraint.
      const owner = await prismaTest.user.create({ data: {
        email: randomUUID() + "@example.test", phoneNumber: randomUUID(),
        firstName: "Private", lastName: "Owner", facilityId: a,
      } });
      await prismaTest.incident.create({ data: {
        id, userId: owner.id, facilityId: a, trigger: "SOS_BUTTON", createdAt: at,
      } });
    }
    await prismaTest.journeySession.create({ data: {
      userId: residentA.id, purpose: "SAFEWALK", expectedArrivalAt: new Date(0),
      destinationLabel: "Private destination never in queue",
    } });
    const first = await get(opA, "/operator/incidents?take=2").expect(200);
    expect(first.body.incidents.map((row: { id: string }) => row.id)).toEqual(ids.slice(0, 2));
    const second = await get(opA, "/operator/incidents?take=2&cursor=" + first.body.nextCursor).expect(200);
    expect(second.body.incidents.map((row: { id: string }) => row.id)).toEqual(ids.slice(2));
    expect(second.body.hasMore).toBe(false);
    await prismaTest.incident.update({ where: { id: ids[2] }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    const refreshed = await get(opA, "/operator/incidents?take=2").expect(200);
    expect(refreshed.body.incidents.map((row: { id: string }) => row.id)).toEqual(ids.slice(0, 2));
    expect(refreshed.body.hasMore).toBe(false);
    expect(await prismaTest.incident.count()).toBe(5);
    expect(JSON.stringify(refreshed.body)).not.toContain("Private destination");
    expect(JSON.stringify(refreshed.body)).not.toContain(residentA.email);
    expect(refreshed.body.incidents[0].user).toEqual({ firstName: "[protected]", lastName: "[protected]" });
  });

  it("uses current membership and denies changed roles and revoked credentials on queue continuation", async () => {
    const bearer = token(opA);
    const read = () => request(app.getHttpServer()).get("/operator/incidents").set("Authorization", "Bearer " + bearer);
    await prismaTest.user.update({ where: { id: opA.id }, data: { facilityId: b } });
    const moved = await read().expect(200);
    expect(moved.body.incidents.map((row: { id: string }) => row.id)).toEqual([incidentB]);
    await prismaTest.user.update({ where: { id: opA.id }, data: { role: "FACILITY_ADMIN" } });
    await read().expect(403);
    await prismaTest.user.update({ where: { id: opA.id }, data: { role: "FACILITY_OPERATOR", credentialVersion: 1 } });
    await read().expect(401);
  });

  it.each(["USER", "FACILITY_ADMIN"])("denies the %s role the operator queue", async role => {
    await get(role === "USER" ? residentA : adminA, "/operator/incidents").expect(403);
  });

  it("separates explicit platform access from operator and facility-admin access", async () => {
    await get(platform, `/facilities/${b}/incidents`).expect(200);
    await get(platform, `/incidents/${incidentB}/timeline`).expect(200);
    await get(platform, "/operator/incidents").expect(403);
    await get(platform, "/facility-admin/facility/residents").expect(403);
    await get(opA, "/admin/residents?email=" + residentB.email).expect(404);
    await post(opA, "/admin/operators").send({}).expect(403);
    await get(platform, "/admin/residents?email=" + residentB.email).expect(
      404,
    );
  });
  it.each(["A", "B"])(
    "%s facility admin invitation read/resend cannot address a foreign resident",
    async (side) => {
      const [admin, own, other] =
        side === "A"
          ? ([adminA, residentA, residentB] as const)
          : ([adminB, residentB, residentA] as const);
      await prismaTest.user.update({
        where: { id: own.id },
        data: { accountStatus: "PENDING_ACTIVATION" },
      });
      await get(
        admin,
        `/facility-admin/facility/residents/${own.id}/invitation`,
      ).expect(200);
      await post(
        admin,
        `/facility-admin/facility/residents/${own.id}/invitation/resend`,
      ).expect(201);
      const foreign = await get(
        admin,
        `/facility-admin/facility/residents/${other.id}/invitation`,
      ).expect(404);
      const absent = await get(
        admin,
        `/facility-admin/facility/residents/${randomUUID()}/invitation`,
      ).expect(404);
      expect(foreign.body).toEqual(absent.body);
      await post(
        admin,
        `/facility-admin/facility/residents/${other.id}/invitation/resend`,
      ).expect(404);
      expect(
        await prismaTest.accountInvitationDelivery.count({
          where: { userId: other.id },
        }),
      ).toBe(0);
    },
  );
  it("rejects forged provisioning tenant IDs and records the actual inviter for allowed provisioning", async () => {
    const data = {
      firstName: "Ada",
      lastName: "Test",
      email: "ada@example.test",
      phoneNumber: "+2348012345678",
    };
    await post(adminA, "/facility-admin/facility/residents")
      .send({ ...data, facilityId: b })
      .expect(400);
    await post(adminA, "/facility-admin/facility/residents/bulk")
      .send({ residents: [{ ...data, facilityId: b }] })
      .expect(400);
    const created = await post(adminA, "/facility-admin/facility/residents")
      .send(data)
      .expect(202);
    expect(created.body).toEqual({
      requestId: expect.any(String),
      status: "VERIFICATION_PENDING",
    });
    const pending = await prismaTest.enrollmentRequest.findUniqueOrThrow({
      where: { id: created.body.requestId },
    });
    expect(pending.facilityId).toBe(a);
    expect(pending.invitedByUserId).toBe(adminA.id);
    expect(await prismaTest.user.count({ where: { email: data.email } })).toBe(
      0,
    );
    await post(adminA, "/admin/operators")
      .send({ ...data, facilityId: b })
      .expect(403);
  });
  it("retains former-tenant invitation history only for platform admin and audits reassignment/removal", async () => {
    await prismaTest.user.update({
      where: { id: residentA.id },
      data: { accountStatus: "PENDING_ACTIVATION" },
    });
    await post(
      adminA,
      `/facility-admin/facility/residents/${residentA.id}/invitation/resend`,
    ).expect(201);
    // Historical service regression; the public reassignment shortcut is retired.
    await request(app.getHttpServer())
      .patch(`/admin/residents/${residentA.id}/facility`)
      .set("Authorization", "Bearer " + token(platform))
      .send({ facilityId: b })
      .expect(404);
    await app
      .get(AdminProvisioningService)
      .assignResidentToFacility(residentA.id, b, platform.id);
    await get(
      adminA,
      `/facility-admin/facility/residents/${residentA.id}/invitation`,
    ).expect(404);
    const own = await get(
      adminB,
      `/facility-admin/facility/residents/${residentA.id}/invitation`,
    ).expect(200);
    expect(own.body.history).toEqual([]);
    expect(own.body.canResend).toBe(true);
    const history = {
      body: await app
        .get(AdminProvisioningService)
        .getResidentInvitation(residentA.id),
    };
    expect(history.body.history).toHaveLength(1);
    expect(history.body.history[0]!.status).toBe("CANCELLED");
    await post(
      adminB,
      `/facility-admin/facility/residents/${residentA.id}/invitation/resend`,
    ).expect(201);
    await app
      .get(AdminProvisioningService)
      .removeResidentFromFacility(residentA.id, b, platform.id);
    const audit = await prismaTest.administrativeAuditEvent.findMany({
      where: { resourceId: residentA.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((e) => e.action)).toEqual([
      "RESIDENT_ASSIGNED",
      "RESIDENT_REMOVED",
    ]);
    expect(
      audit.every(
        (e) => e.actorUserId === platform.id && e.actorRole === "ADMIN",
      ),
    ).toBe(true);
    expect(audit[0]?.previousFacilityId).toBe(a);
    expect(audit[0]?.facilityId).toBe(b);
  });
  it("keeps platform administrator member lists masked without reveal grants", async () => {
    const result = await get(
      platform,
      "/admin/facilities/" + a + "/members",
    ).expect(200);
    for (const member of result.body.members) {
      expect(member).toMatchObject({
        firstName: "[protected]",
        lastName: "[protected]",
        email: "[protected]",
        phoneNumber: "[protected]",
      });
      expect(member.id).toBeDefined();
      expect(member.role).toBeDefined();
      expect(member.accountStatus).toBeDefined();
    }
    expect(
      result.body.members.filter(
        (member: { role: string }) => member.role === "FACILITY_OPERATOR",
      ),
    ).toHaveLength(1);
    expect(
      result.body.members.filter(
        (member: { role: string }) => member.role === "USER",
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(result.body)).not.toContain(opA.email);
    expect(JSON.stringify(result.body)).not.toContain(residentA.email);
    expect(await prismaTest.identityAccessGrant.count()).toBe(0);
  });

  it("records facility creation with authenticated platform actor", async () => {
    const created = await post(platform, "/admin/facilities")
      .send({ name: "Kano", type: "SECURITY_PROVIDER" })
      .expect(201);
    const audit = await prismaTest.administrativeAuditEvent.findFirst({
      where: { resourceId: created.body.id },
    });
    expect(audit?.actorUserId).toBe(platform.id);
    expect(audit?.action).toBe("FACILITY_CREATED");
  });
  it("cancels only stale queued invitations, preserves same-facility queues and in-flight outcomes", async () => {
    const queued = await prismaTest.accountInvitationDelivery.create({
      data: {
        userId: residentA.id,
        facilityId: a,
        invitedByUserId: adminA.id,
        channel: "SMS",
        status: "QUEUED",
        recipient: "+2348012345678",
      },
    });
    const sending = await prismaTest.accountInvitationDelivery.create({
      data: {
        userId: residentA.id,
        facilityId: a,
        invitedByUserId: adminA.id,
        channel: "SMS",
        status: "SENDING",
        recipient: "+2348012345678",
      },
    });
    const service = new AdminProvisioningService(prismaTest as never);
    await service.assignResidentToFacility(residentA.id, a, platform.id);
    expect(
      (
        await prismaTest.accountInvitationDelivery.findUniqueOrThrow({
          where: { id: queued.id },
        })
      ).status,
    ).toBe("QUEUED");
    await service.assignResidentToFacility(residentA.id, b, platform.id);
    expect(
      (
        await prismaTest.accountInvitationDelivery.findUniqueOrThrow({
          where: { id: queued.id },
        })
      ).status,
    ).toBe("CANCELLED");
    expect(
      (
        await prismaTest.accountInvitationDelivery.findUniqueOrThrow({
          where: { id: sending.id },
        })
      ).status,
    ).toBe("SENDING");
  });
  it("rolls back membership and queue cancellation if provenance cannot be stored", async () => {
    const delivery = await prismaTest.accountInvitationDelivery.create({
      data: {
        userId: residentA.id,
        facilityId: a,
        channel: "SMS",
        status: "QUEUED",
        recipient: "+2348012345678",
      },
    });
    const service = new AdminProvisioningService(prismaTest as never);
    await expect(
      service.assignResidentToFacility(residentA.id, b, "invalid-actor-uuid"),
    ).rejects.toThrow();
    expect(
      (await prismaTest.user.findUniqueOrThrow({ where: { id: residentA.id } }))
        .facilityId,
    ).toBe(a);
    expect(
      (
        await prismaTest.accountInvitationDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        })
      ).status,
    ).toBe("QUEUED");
    expect(await prismaTest.administrativeAuditEvent.count()).toBe(0);
  });

  it("ignores stale or forged signed authority claims and rejects pending/deactivated platform accounts", async () => {
    const forged = jwt.sign({
      sub: opA.id,
      email: opA.email,
      role: "ADMIN",
      facilityId: b,
      credentialVersion: 0,
    });
    await request(app.getHttpServer())
      .get("/incidents/" + incidentB + "/timeline")
      .set("Authorization", "Bearer " + forged)
      .expect(404);
    await request(app.getHttpServer())
      .get("/admin/facilities/" + b + "/members")
      .set("Authorization", "Bearer " + forged)
      .expect(403);
    const platformToken = token(platform);
    await prismaTest.user.update({
      where: { id: platform.id },
      data: { role: "USER" },
    });
    await request(app.getHttpServer())
      .get("/incidents/" + incidentB + "/timeline")
      .set("Authorization", "Bearer " + platformToken)
      .expect(404);
    await prismaTest.user.update({
      where: { id: platform.id },
      data: { role: "ADMIN", accountStatus: "PENDING_ACTIVATION" },
    });
    await get(platform, "/incidents/" + incidentB + "/timeline").expect(401);
    await prismaTest.user.update({
      where: { id: platform.id },
      data: { accountStatus: "ACTIVE", isActive: false },
    });
    await post(platform, "/admin/facilities")
      .send({ name: "Denied", type: "OTHER" })
      .expect(401);
  });
  it("enforces the cooldown for the current facility while ignoring foreign terminal delivery history", async () => {
    await prismaTest.user.update({
      where: { id: residentA.id },
      data: { accountStatus: "PENDING_ACTIVATION" },
    });
    await prismaTest.accountInvitationDelivery.create({
      data: {
        userId: residentA.id,
        facilityId: b,
        channel: "SMS",
        status: "FAILED",
        recipient: "+2348012345678",
        lastAttemptAt: new Date(),
      },
    });
    const path =
      "/facility-admin/facility/residents/" + residentA.id + "/invitation";
    const before = await get(adminA, path).expect(200);
    expect(before.body.history).toEqual([]);
    expect(before.body.canResend).toBe(true);
    await post(adminA, path + "/resend").expect(201);
    await prismaTest.accountInvitationDelivery.updateMany({
      where: { userId: residentA.id, facilityId: a },
      data: { status: "FAILED", lastAttemptAt: new Date() },
    });
    const after = await get(adminA, path).expect(200);
    expect(after.body.canResend).toBe(false);
    await post(adminA, path + "/resend").expect(409);
  });
});
